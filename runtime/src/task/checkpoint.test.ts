import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { Keypair } from "@solana/web3.js";
import { InMemoryCheckpointStore } from "./checkpoint.js";
import { SqliteCheckpointStore } from "./sqlite-checkpoint-store.js";
import { TaskExecutor } from "./executor.js";
import type {
  TaskExecutionContext,
  TaskExecutionResult,
  TaskExecutorConfig,
  CheckpointStore,
  TaskCheckpoint,
  ClaimResult,
} from "./types.js";
import { silentLogger } from "../utils/logger.js";
import { RuntimeSchemaCompatibilityError } from "../workflow/schema-version.js";
import {
  createTask,
  createDiscoveryResult,
  createMockOperations,
  createMockDiscovery,
  createMockClaim,
  waitFor,
} from "./test-utils.js";

const agentId = new Uint8Array(32).fill(42);
const agentPda = Keypair.generate().publicKey;

const defaultHandler = async (
  _ctx: TaskExecutionContext,
): Promise<TaskExecutionResult> => ({
  proofHash: new Uint8Array(32).fill(1),
});

function createExecutorConfig(
  overrides: Partial<TaskExecutorConfig> = {},
): TaskExecutorConfig {
  return {
    operations: createMockOperations(),
    handler: defaultHandler,
    agentId,
    agentPda,
    logger: silentLogger,
    ...overrides,
  };
}

function makeTrustedExecutionResultAttestation(recordedAt = Date.now()) {
  return {
    schemaVersion: 1 as const,
    source: "live_runtime" as const,
    trust: "trusted" as const,
    recordedAt,
  };
}

// ============================================================================
// InMemoryCheckpointStore Tests
// ============================================================================

describe("InMemoryCheckpointStore", () => {
  let store: InMemoryCheckpointStore;

  beforeEach(() => {
    store = new InMemoryCheckpointStore();
  });

  it("saves and loads a checkpoint", async () => {
    const checkpoint: TaskCheckpoint = {
      taskPda: "abc123",
      stage: "claimed",
      claimResult: {
        success: true,
        taskId: new Uint8Array(32),
        claimPda: Keypair.generate().publicKey,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await store.save(checkpoint);
    const loaded = await store.load("abc123");
    expect(loaded).toEqual(checkpoint);
  });

  it("returns null for unknown task", async () => {
    const loaded = await store.load("nonexistent");
    expect(loaded).toBeNull();
  });

  it("removes a checkpoint", async () => {
    const checkpoint: TaskCheckpoint = {
      taskPda: "abc123",
      stage: "claimed",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await store.save(checkpoint);
    await store.remove("abc123");
    const loaded = await store.load("abc123");
    expect(loaded).toBeNull();
  });

  it("remove is a no-op for unknown task", async () => {
    await expect(store.remove("nonexistent")).resolves.toBeUndefined();
  });

  it("listPending returns all saved checkpoints", async () => {
    const cp1: TaskCheckpoint = {
      taskPda: "task1",
      stage: "claimed",
      createdAt: 1000,
      updatedAt: 1000,
    };
    const cp2: TaskCheckpoint = {
      taskPda: "task2",
      stage: "executed",
      createdAt: 2000,
      updatedAt: 2000,
    };

    await store.save(cp1);
    await store.save(cp2);

    const pending = await store.listPending();
    expect(pending).toHaveLength(2);
    expect(pending).toContainEqual(cp1);
    expect(pending).toContainEqual(cp2);
  });

  it("listPending returns empty array when no checkpoints", async () => {
    const pending = await store.listPending();
    expect(pending).toEqual([]);
  });

  it("save overwrites existing checkpoint for same taskPda", async () => {
    const cp1: TaskCheckpoint = {
      taskPda: "task1",
      stage: "claimed",
      createdAt: 1000,
      updatedAt: 1000,
    };
    const cp2: TaskCheckpoint = {
      taskPda: "task1",
      stage: "executed",
      createdAt: 1000,
      updatedAt: 2000,
    };

    await store.save(cp1);
    await store.save(cp2);

    const loaded = await store.load("task1");
    expect(loaded?.stage).toBe("executed");

    const pending = await store.listPending();
    expect(pending).toHaveLength(1);
  });
});

describe("SqliteCheckpointStore", () => {
  let tempDir = "";
  let store: SqliteCheckpointStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agenc-task-checkpoint-"));
    store = new SqliteCheckpointStore(join(tempDir, "checkpoints.sqlite"));
  });

  afterEach(async () => {
    await store.close();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("persists checkpoints across store instances", async () => {
    const checkpoint: TaskCheckpoint = {
      taskPda: "task-sqlite-1",
      stage: "executed",
      executionResult: { proofHash: new Uint8Array(32).fill(7) },
      executionResultAttestation: makeTrustedExecutionResultAttestation(2_000),
      createdAt: 1_000,
      updatedAt: 2_000,
    };

    await store.save(checkpoint);
    await store.close();

    const reopened = new SqliteCheckpointStore(join(tempDir, "checkpoints.sqlite"));
    await expect(reopened.load("task-sqlite-1")).resolves.toEqual({
      ...checkpoint,
      claimResult: undefined,
      schemaVersion: 1,
    });
    await reopened.close();
  });

  it("marks executed checkpoints without attestation for revalidation on load", async () => {
    const checkpoint: TaskCheckpoint = {
      taskPda: "task-sqlite-untrusted",
      stage: "executed",
      executionResult: { proofHash: new Uint8Array(32).fill(8) },
      createdAt: 1_500,
      updatedAt: 2_500,
    };

    await store.save(checkpoint);
    await store.close();

    const reopened = new SqliteCheckpointStore(join(tempDir, "checkpoints.sqlite"));
    await expect(reopened.load("task-sqlite-untrusted")).resolves.toEqual({
      ...checkpoint,
      claimResult: undefined,
      executionResultAttestation: {
        schemaVersion: 1,
        source: "unknown",
        trust: "needs_revalidation",
        recordedAt: 2_500,
        reason: "missing_attestation",
      },
      schemaVersion: 1,
    });
    await reopened.close();
  });

  it("migrates legacy unversioned checkpoint payloads on load", async () => {
    const dbPath = join(tempDir, "checkpoints.sqlite");
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE task_checkpoint_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        schema_version INTEGER NOT NULL
      );
      INSERT INTO task_checkpoint_meta (id, schema_version) VALUES (1, 1);
      CREATE TABLE task_checkpoints (
        task_pda TEXT PRIMARY KEY,
        stage TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    db.prepare(
      `INSERT INTO task_checkpoints (task_pda, stage, payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      "task-legacy-1",
      "claimed",
      JSON.stringify({
        taskPda: "task-legacy-1",
        stage: "claimed",
        createdAt: 1000,
        updatedAt: 2000,
      }),
      1000,
      2000,
    );
    db.close();

    const reopened = new SqliteCheckpointStore(dbPath);
    await expect(reopened.load("task-legacy-1")).resolves.toEqual({
      taskPda: "task-legacy-1",
      stage: "claimed",
      claimResult: undefined,
      executionResult: undefined,
      createdAt: 1000,
      updatedAt: 2000,
      schemaVersion: 1,
    });
    await reopened.close();
  });

  it("fails loudly when persisted sqlite checkpoint payloads use an unsupported schema", async () => {
    const dbPath = join(tempDir, "checkpoints.sqlite");
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE task_checkpoint_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        schema_version INTEGER NOT NULL
      );
      INSERT INTO task_checkpoint_meta (id, schema_version) VALUES (1, 1);
      CREATE TABLE task_checkpoints (
        task_pda TEXT PRIMARY KEY,
        stage TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    db.prepare(
      `INSERT INTO task_checkpoints (task_pda, stage, payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      "task-bad-schema",
      "claimed",
      JSON.stringify({
        schemaVersion: 999,
        taskPda: "task-bad-schema",
        stage: "claimed",
        createdAt: 1000,
        updatedAt: 2000,
      }),
      1000,
      2000,
    );
    db.close();

    const reopened = new SqliteCheckpointStore(dbPath);
    await expect(reopened.load("task-bad-schema")).rejects.toBeInstanceOf(
      RuntimeSchemaCompatibilityError,
    );
    await reopened.close();
  });
});

// ============================================================================
// Executor Checkpoint Integration Tests
// ============================================================================

describe("TaskExecutor checkpoint integration", () => {
  let executor: TaskExecutor;

  afterEach(async () => {
    if (executor?.isRunning()) {
      await executor.stop();
    }
  });

  describe("pipeline checkpoints", () => {
    it("saves checkpoint after claim and execution, removes after submit", async () => {
      const store = new InMemoryCheckpointStore();
      const saveSpy = vi.spyOn(store, "save");
      const removeSpy = vi.spyOn(store, "remove");

      const ops = createMockOperations();
      const discovery = createMockDiscovery();
      const task = createDiscoveryResult();

      executor = new TaskExecutor(
        createExecutorConfig({
          operations: ops,
          discovery,
          mode: "autonomous",
          checkpointStore: store,
        }),
      );

      const completed = vi.fn();
      executor.on({ onTaskCompleted: completed });

      const startPromise = executor.start();

      // Wait for discovery to start before emitting
      await waitFor(() => discovery.start.mock.calls.length > 0);

      // Emit a task
      discovery._emitTask(task);

      await waitFor(() => completed.mock.calls.length > 0);
      await executor.stop();
      await startPromise.catch(() => {});

      // Should have saved twice: after claim and after execution
      expect(saveSpy).toHaveBeenCalledTimes(2);

      const firstSave = saveSpy.mock.calls[0][0] as TaskCheckpoint;
      expect(firstSave.stage).toBe("claimed");
      expect(firstSave.taskPda).toBe(task.pda.toBase58());

      const secondSave = saveSpy.mock.calls[1][0] as TaskCheckpoint;
      expect(secondSave.stage).toBe("executed");
      expect(secondSave.taskPda).toBe(task.pda.toBase58());

      // Should have removed after submit
      expect(removeSpy).toHaveBeenCalledWith(task.pda.toBase58());

      // Store should be empty
      const pending = await store.listPending();
      expect(pending).toHaveLength(0);
    });

    it("works normally without checkpoint store", async () => {
      const ops = createMockOperations();
      const discovery = createMockDiscovery();
      const task = createDiscoveryResult();

      executor = new TaskExecutor(
        createExecutorConfig({
          operations: ops,
          discovery,
          mode: "autonomous",
        }),
      );

      const completed = vi.fn();
      executor.on({ onTaskCompleted: completed });

      const startPromise = executor.start();
      await waitFor(() => discovery.start.mock.calls.length > 0);
      discovery._emitTask(task);
      await waitFor(() => completed.mock.calls.length > 0);
      await executor.stop();
      await startPromise.catch(() => {});

      expect(completed).toHaveBeenCalledTimes(1);
    });
  });

  describe("crash recovery", () => {
    it("resumes from claimed stage (skips claim, runs execute + submit)", async () => {
      const taskPda = Keypair.generate().publicKey;
      const claimPda = Keypair.generate().publicKey;
      const taskPdaStr = taskPda.toBase58();
      const task = createTask();

      const claimResult: ClaimResult = {
        success: true,
        taskId: new Uint8Array(32),
        claimPda,
      };

      const store = new InMemoryCheckpointStore();
      await store.save({
        taskPda: taskPdaStr,
        stage: "claimed",
        claimResult,
        createdAt: Date.now() - 1000,
        updatedAt: Date.now() - 1000,
      });

      const ops = createMockOperations();
      // fetchClaim returns a valid, non-expired claim
      ops.fetchClaim.mockResolvedValue(
        createMockClaim({
          expiresAt: Math.floor(Date.now() / 1000) + 300,
        }),
      );
      // fetchTask returns the task
      ops.fetchTask.mockResolvedValue(task);

      const handlerCalled = vi.fn();
      const handler = async (
        _ctx: TaskExecutionContext,
      ): Promise<TaskExecutionResult> => {
        handlerCalled();
        return { proofHash: new Uint8Array(32).fill(1) };
      };

      const discovery = createMockDiscovery();
      executor = new TaskExecutor(
        createExecutorConfig({
          operations: ops,
          discovery,
          mode: "autonomous",
          handler,
          checkpointStore: store,
        }),
      );

      const completed = vi.fn();
      executor.on({ onTaskCompleted: completed });

      const startPromise = executor.start();
      await waitFor(() => completed.mock.calls.length > 0);
      await executor.stop();
      await startPromise.catch(() => {});

      // Handler was called (execute step ran)
      expect(handlerCalled).toHaveBeenCalledTimes(1);
      // Claim was NOT called (skipped)
      expect(ops.claimTask).not.toHaveBeenCalled();
      // Submit was called
      expect(ops.completeTask).toHaveBeenCalledTimes(1);
      // Checkpoint was removed after success
      const pending = await store.listPending();
      expect(pending).toHaveLength(0);
    });

    it("resumes from executed stage (skips claim + execute, runs submit)", async () => {
      const taskPda = Keypair.generate().publicKey;
      const claimPda = Keypair.generate().publicKey;
      const taskPdaStr = taskPda.toBase58();
      const task = createTask();

      const claimResult: ClaimResult = {
        success: true,
        taskId: new Uint8Array(32),
        claimPda,
      };

      const executionResult: TaskExecutionResult = {
        proofHash: new Uint8Array(32).fill(1),
      };

      const store = new InMemoryCheckpointStore();
      await store.save({
        taskPda: taskPdaStr,
        stage: "executed",
        claimResult,
        executionResult,
        executionResultAttestation: makeTrustedExecutionResultAttestation(),
        createdAt: Date.now() - 1000,
        updatedAt: Date.now() - 500,
      });

      const ops = createMockOperations();
      ops.fetchClaim.mockResolvedValue(
        createMockClaim({
          expiresAt: Math.floor(Date.now() / 1000) + 300,
        }),
      );
      ops.fetchTask.mockResolvedValue(task);

      const handlerCalled = vi.fn();
      const handler = async (
        _ctx: TaskExecutionContext,
      ): Promise<TaskExecutionResult> => {
        handlerCalled();
        return { proofHash: new Uint8Array(32).fill(1) };
      };

      const discovery = createMockDiscovery();
      executor = new TaskExecutor(
        createExecutorConfig({
          operations: ops,
          discovery,
          mode: "autonomous",
          handler,
          checkpointStore: store,
        }),
      );

      const completed = vi.fn();
      executor.on({ onTaskCompleted: completed });

      const startPromise = executor.start();
      await waitFor(() => completed.mock.calls.length > 0);
      await executor.stop();
      await startPromise.catch(() => {});

      // Handler was NOT called (execute skipped)
      expect(handlerCalled).not.toHaveBeenCalled();
      // Claim was NOT called (skipped)
      expect(ops.claimTask).not.toHaveBeenCalled();
      // Submit was called
      expect(ops.completeTask).toHaveBeenCalledTimes(1);
      // Checkpoint was removed
      const pending = await store.listPending();
      expect(pending).toHaveLength(0);
    });

    it("revalidates untrusted executed checkpoints before submit", async () => {
      const taskPda = Keypair.generate().publicKey;
      const claimPda = Keypair.generate().publicKey;
      const taskPdaStr = taskPda.toBase58();
      const task = createTask();

      const claimResult: ClaimResult = {
        success: true,
        taskId: new Uint8Array(32),
        claimPda,
      };

      const store = new InMemoryCheckpointStore();
      await store.save({
        taskPda: taskPdaStr,
        stage: "executed",
        claimResult,
        executionResult: {
          proofHash: new Uint8Array(32).fill(1),
        },
        createdAt: Date.now() - 1000,
        updatedAt: Date.now() - 500,
      });

      const ops = createMockOperations();
      ops.fetchClaim.mockResolvedValue(
        createMockClaim({
          expiresAt: Math.floor(Date.now() / 1000) + 300,
        }),
      );
      ops.fetchTask.mockResolvedValue(task);

      const handlerCalled = vi.fn();
      const handler = async (
        _ctx: TaskExecutionContext,
      ): Promise<TaskExecutionResult> => {
        handlerCalled();
        return { proofHash: new Uint8Array(32).fill(9) };
      };

      const discovery = createMockDiscovery();
      executor = new TaskExecutor(
        createExecutorConfig({
          operations: ops,
          discovery,
          mode: "autonomous",
          handler,
          checkpointStore: store,
        }),
      );

      const completed = vi.fn();
      executor.on({ onTaskCompleted: completed });

      const startPromise = executor.start();
      await waitFor(() => completed.mock.calls.length > 0);
      await executor.stop();
      await startPromise.catch(() => {});

      expect(handlerCalled).toHaveBeenCalledTimes(1);
      expect(ops.claimTask).not.toHaveBeenCalled();
      expect(ops.completeTask).toHaveBeenCalledTimes(1);
      const submittedProofHash = ops.completeTask.mock.calls[0]?.[2] as Uint8Array;
      expect(Array.from(submittedProofHash)).toEqual(
        Array.from(new Uint8Array(32).fill(9)),
      );
    });

    it("cleans up stale checkpoint when claim has expired", async () => {
      const taskPda = Keypair.generate().publicKey;
      const claimPda = Keypair.generate().publicKey;
      const taskPdaStr = taskPda.toBase58();

      const claimResult: ClaimResult = {
        success: true,
        taskId: new Uint8Array(32),
        claimPda,
      };

      const store = new InMemoryCheckpointStore();
      await store.save({
        taskPda: taskPdaStr,
        stage: "claimed",
        claimResult,
        createdAt: Date.now() - 60000,
        updatedAt: Date.now() - 60000,
      });

      const ops = createMockOperations();
      // Return an expired claim
      ops.fetchClaim.mockResolvedValue(
        createMockClaim({
          expiresAt: Math.floor(Date.now() / 1000) - 10, // expired 10s ago
        }),
      );

      const discovery = createMockDiscovery();
      executor = new TaskExecutor(
        createExecutorConfig({
          operations: ops,
          discovery,
          mode: "autonomous",
          checkpointStore: store,
        }),
      );

      const startPromise = executor.start();
      // Give recovery time to run
      await new Promise((r) => setTimeout(r, 200));
      await executor.stop();
      await startPromise.catch(() => {});

      // Claim should NOT have been called
      expect(ops.claimTask).not.toHaveBeenCalled();
      // Handler should NOT have been called
      expect(ops.completeTask).not.toHaveBeenCalled();
      // Stale checkpoint should have been removed
      const pending = await store.listPending();
      expect(pending).toHaveLength(0);
    });

    it("cleans up checkpoint when task no longer exists on-chain", async () => {
      const taskPda = Keypair.generate().publicKey;
      const claimPda = Keypair.generate().publicKey;
      const taskPdaStr = taskPda.toBase58();

      const store = new InMemoryCheckpointStore();
      await store.save({
        taskPda: taskPdaStr,
        stage: "claimed",
        claimResult: {
          success: true,
          taskId: new Uint8Array(32),
          claimPda,
        },
        createdAt: Date.now() - 1000,
        updatedAt: Date.now() - 1000,
      });

      const ops = createMockOperations();
      // Claim exists and is valid
      ops.fetchClaim.mockResolvedValue(
        createMockClaim({
          expiresAt: Math.floor(Date.now() / 1000) + 300,
        }),
      );
      // But the task is gone
      ops.fetchTask.mockResolvedValue(null);

      const discovery = createMockDiscovery();
      executor = new TaskExecutor(
        createExecutorConfig({
          operations: ops,
          discovery,
          mode: "autonomous",
          checkpointStore: store,
        }),
      );

      const startPromise = executor.start();
      await new Promise((r) => setTimeout(r, 200));
      await executor.stop();
      await startPromise.catch(() => {});

      // Checkpoint should be removed
      const pending = await store.listPending();
      expect(pending).toHaveLength(0);
    });

    it("recovers multiple checkpoints", async () => {
      const task1Pda = Keypair.generate().publicKey;
      const task2Pda = Keypair.generate().publicKey;
      const claimPda = Keypair.generate().publicKey;
      const task = createTask();

      const claimResult: ClaimResult = {
        success: true,
        taskId: new Uint8Array(32),
        claimPda,
      };

      const store = new InMemoryCheckpointStore();
      await store.save({
        taskPda: task1Pda.toBase58(),
        stage: "executed",
        claimResult,
        executionResult: { proofHash: new Uint8Array(32).fill(1) },
        executionResultAttestation: makeTrustedExecutionResultAttestation(),
        createdAt: Date.now() - 2000,
        updatedAt: Date.now() - 1000,
      });
      await store.save({
        taskPda: task2Pda.toBase58(),
        stage: "executed",
        claimResult,
        executionResult: { proofHash: new Uint8Array(32).fill(2) },
        executionResultAttestation: makeTrustedExecutionResultAttestation(),
        createdAt: Date.now() - 2000,
        updatedAt: Date.now() - 500,
      });

      const ops = createMockOperations();
      ops.fetchClaim.mockResolvedValue(
        createMockClaim({
          expiresAt: Math.floor(Date.now() / 1000) + 300,
        }),
      );
      ops.fetchTask.mockResolvedValue(task);

      const discovery = createMockDiscovery();
      executor = new TaskExecutor(
        createExecutorConfig({
          operations: ops,
          discovery,
          mode: "autonomous",
          checkpointStore: store,
        }),
      );

      const completed = vi.fn();
      executor.on({ onTaskCompleted: completed });

      const startPromise = executor.start();
      await waitFor(() => completed.mock.calls.length >= 2);
      await executor.stop();
      await startPromise.catch(() => {});

      expect(ops.completeTask).toHaveBeenCalledTimes(2);
      const pending = await store.listPending();
      expect(pending).toHaveLength(0);
    });

    it("skips recovery when no checkpoint store configured", async () => {
      const ops = createMockOperations();
      const discovery = createMockDiscovery();

      executor = new TaskExecutor(
        createExecutorConfig({
          operations: ops,
          discovery,
          mode: "autonomous",
          // no checkpointStore
        }),
      );

      const startPromise = executor.start();
      await new Promise((r) => setTimeout(r, 200));
      await executor.stop();
      await startPromise.catch(() => {});

      // No tasks should have been processed
      expect(ops.claimTask).not.toHaveBeenCalled();
      expect(ops.completeTask).not.toHaveBeenCalled();
    });

    it("skips recovery when checkpoint store is empty", async () => {
      const store = new InMemoryCheckpointStore();
      const ops = createMockOperations();
      const discovery = createMockDiscovery();

      executor = new TaskExecutor(
        createExecutorConfig({
          operations: ops,
          discovery,
          mode: "autonomous",
          checkpointStore: store,
        }),
      );

      const startPromise = executor.start();
      await new Promise((r) => setTimeout(r, 200));
      await executor.stop();
      await startPromise.catch(() => {});

      expect(ops.claimTask).not.toHaveBeenCalled();
      expect(ops.completeTask).not.toHaveBeenCalled();
    });

    it("recovers persisted checkpoints after process restart with sqlite storage", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "agenc-task-recover-"));
      const dbPath = join(tempDir, "checkpoints.sqlite");
      const store1 = new SqliteCheckpointStore(dbPath);
      const taskPda = Keypair.generate().publicKey;
      const claimPda = Keypair.generate().publicKey;
      const task = createTask();

      await store1.save({
        taskPda: taskPda.toBase58(),
        stage: "claimed",
        claimResult: {
          success: true,
          taskId: new Uint8Array(32),
          claimPda,
        },
        createdAt: Date.now() - 1_000,
        updatedAt: Date.now() - 1_000,
      });
      await store1.close();

      const ops = createMockOperations();
      ops.fetchClaim.mockResolvedValue(
        createMockClaim({
          expiresAt: Math.floor(Date.now() / 1000) + 300,
        }),
      );
      ops.fetchTask.mockResolvedValue(task);

      const handlerCalled = vi.fn();
      const store2 = new SqliteCheckpointStore(dbPath);
      executor = new TaskExecutor(
        createExecutorConfig({
          operations: ops,
          discovery: createMockDiscovery(),
          mode: "autonomous",
          handler: async (
            _ctx: TaskExecutionContext,
          ): Promise<TaskExecutionResult> => {
            handlerCalled();
            return { proofHash: new Uint8Array(32).fill(1) };
          },
          checkpointStore: store2,
        }),
      );

      const completed = vi.fn();
      executor.on({ onTaskCompleted: completed });

      const startPromise = executor.start();
      await waitFor(() => completed.mock.calls.length > 0);
      await executor.stop();
      await startPromise.catch(() => {});

      expect(handlerCalled).toHaveBeenCalledTimes(1);
      await expect(store2.listPending()).resolves.toEqual([]);
      await store2.close();
      await rm(tempDir, { recursive: true, force: true });
    });
  });
});
