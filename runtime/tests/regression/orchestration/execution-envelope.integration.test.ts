import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createMockMemoryBackend } from "../../../src/memory/test-utils.js";
import { PipelineExecutor } from "../../../src/workflow/pipeline.js";
import type { SubAgentConfig, SubAgentResult } from "../../../src/gateway/sub-agent.js";
import { SubAgentOrchestrator } from "../../../src/gateway/subagent-orchestrator.js";

class RecordingManager {
  private readonly entries = new Map<string, SubAgentResult>();
  private seq = 0;

  public readonly spawnCalls: SubAgentConfig[] = [];

  constructor(private readonly result: SubAgentResult) {}

  async spawn(config: SubAgentConfig): Promise<string> {
    const id = `sub-${++this.seq}`;
    this.spawnCalls.push(config);
    this.entries.set(id, {
      sessionId: id,
      ...this.result,
    });
    return id;
  }

  getResult(sessionId: string): SubAgentResult | null {
    return this.entries.get(sessionId) ?? null;
  }

  cancel(): boolean {
    return true;
  }
}

const TEMP_DIRS: string[] = [];

afterEach(() => {
  for (const path of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("execution envelope integration", () => {
  it("treats the structured execution envelope as authoritative over misleading prompt cwd hints", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "agenc-envelope-"));
    TEMP_DIRS.push(workspaceRoot);
    writeFileSync(join(workspaceRoot, "PLAN.md"), "# plan\n", "utf8");
    const baseExecutor = new PipelineExecutor({
      toolHandler: async () => '{"stdout":"ok","exitCode":0}',
      memoryBackend: createMockMemoryBackend(),
    });
    const manager = new RecordingManager({
      output: '{"status":"completed","summary":"wrote AGENC.md"}',
      success: true,
      durationMs: 12,
      toolCalls: [
        {
          name: "system.readFile",
          args: { path: `${workspaceRoot}/PLAN.md` },
          result: `{"path":"${workspaceRoot}/PLAN.md","content":"# plan"}`,
          isError: false,
          durationMs: 2,
        },
        {
          name: "system.writeFile",
          args: { path: `${workspaceRoot}/AGENC.md` },
          result: `{"path":"${workspaceRoot}/AGENC.md","written":true}`,
          isError: false,
          durationMs: 3,
        },
      ],
      stopReason: "completed",
    });
    const orchestrator = new SubAgentOrchestrator({
      fallbackExecutor: baseExecutor,
      resolveSubAgentManager: () => manager,
      pollIntervalMs: 5,
      unsafeBenchmarkMode: true,
    });

    const result = await orchestrator.execute({
      id: "planner:envelope:1",
      createdAt: Date.now(),
      context: { results: {} },
      steps: [],
      plannerContext: {
        parentRequest: "Write AGENC.md from PLAN.md",
        history: [],
        memory: [],
        toolOutputs: [],
        workspaceRoot,
      },
      plannerSteps: [
        {
          name: "write_agenc_md",
          stepType: "subagent_task",
          objective: "Write the repository guide",
          inputContract: "Use the current PLAN.md as the source of truth.",
          acceptanceCriteria: ["AGENC.md written with the required sections"],
          requiredToolCapabilities: ["system.readFile", "system.writeFile"],
          contextRequirements: ["cwd=/tmp/wrong-root"],
          executionContext: {
            version: "v1",
            workspaceRoot,
            allowedReadRoots: [workspaceRoot],
            allowedWriteRoots: [workspaceRoot],
            requiredSourceArtifacts: [`${workspaceRoot}/PLAN.md`],
            targetArtifacts: [`${workspaceRoot}/AGENC.md`],
            allowedTools: ["system.readFile", "system.writeFile"],
            effectClass: "filesystem_write",
            verificationMode: "mutation_required",
            stepKind: "delegated_write",
          },
          maxBudgetHint: "4m",
          canRunParallel: false,
        },
      ],
    });

    expect(result.status).toMatch(/^(?:completed|failed)$/);
    expect(manager.spawnCalls).toHaveLength(1);
    expect(manager.spawnCalls[0]).toMatchObject({
      workingDirectory: workspaceRoot,
      workingDirectorySource: "execution_envelope",
    });
    expect(manager.spawnCalls[0]?.tools).toEqual(
      expect.arrayContaining(["system.readFile", "system.writeFile"]),
    );
    expect(manager.spawnCalls[0]?.delegationSpec?.executionContext).toEqual(
      expect.objectContaining({
        workspaceRoot,
        requiredSourceArtifacts: [`${workspaceRoot}/PLAN.md`],
        targetArtifacts: [`${workspaceRoot}/AGENC.md`],
      }),
    );
  });

  it("rejects delegated workspace aliases instead of canonicalizing them into live execution scope", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "agenc-envelope-"));
    TEMP_DIRS.push(workspaceRoot);
    writeFileSync(join(workspaceRoot, "PLAN.md"), "# plan\n", "utf8");
    const baseExecutor = new PipelineExecutor({
      toolHandler: async () => '{"stdout":"ok","exitCode":0}',
      memoryBackend: createMockMemoryBackend(),
    });
    const manager = new RecordingManager({
      output: '{"status":"completed","summary":"updated PLAN.md"}',
      success: true,
      durationMs: 12,
      toolCalls: [
        {
          name: "system.readFile",
          args: { path: `${workspaceRoot}/PLAN.md` },
          result: `{"path":"${workspaceRoot}/PLAN.md","content":"# plan"}`,
          isError: false,
          durationMs: 2,
        },
      ],
      stopReason: "completed",
    });
    const orchestrator = new SubAgentOrchestrator({
      fallbackExecutor: baseExecutor,
      resolveSubAgentManager: () => manager,
      pollIntervalMs: 5,
      unsafeBenchmarkMode: true,
    });

    const result = await orchestrator.execute({
      id: "planner:envelope:2",
      createdAt: Date.now(),
      context: { results: {} },
      steps: [],
      plannerContext: {
        parentRequest: "Inspect PLAN.md",
        history: [],
        memory: [],
        toolOutputs: [],
        workspaceRoot,
      },
      plannerSteps: [
        {
          name: "review_plan",
          stepType: "subagent_task",
          objective: "Review the implementation plan",
          inputContract: "Inspect PLAN.md in the delegated workspace.",
          acceptanceCriteria: ["PLAN.md inspected"],
          requiredToolCapabilities: ["system.readFile"],
          contextRequirements: [],
          executionContext: {
            version: "v1",
            workspaceRoot: "/workspace",
            allowedReadRoots: ["/workspace", workspaceRoot],
            allowedWriteRoots: [],
            requiredSourceArtifacts: [
              "/workspace/PLAN.md",
              `${workspaceRoot}/PLAN.md`,
            ],
            allowedTools: ["system.readFile"],
            effectClass: "read_only",
            verificationMode: "grounded_read",
            stepKind: "delegated_review",
          },
          maxBudgetHint: "2m",
          canRunParallel: false,
        },
      ],
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain(
      "Delegated local-file work must have a canonical workspace root before child execution.",
    );
    expect(manager.spawnCalls).toHaveLength(0);
  });

  it("rejects broken delegated contracts before any child execution begins", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "agenc-envelope-"));
    const outsideRoot = mkdtempSync(join(tmpdir(), "agenc-envelope-outside-"));
    TEMP_DIRS.push(workspaceRoot);
    TEMP_DIRS.push(outsideRoot);
    mkdirSync(join(workspaceRoot, "src"), { recursive: true });
    writeFileSync(join(outsideRoot, "PLAN.md"), "# plan\n", "utf8");
    const baseExecutor = new PipelineExecutor({
      toolHandler: async () => '{"stdout":"ok","exitCode":0}',
      memoryBackend: createMockMemoryBackend(),
    });
    const manager = new RecordingManager({
      output: '{"status":"completed","summary":"should not run"}',
      success: true,
      durationMs: 12,
      toolCalls: [],
      stopReason: "completed",
    });
    const orchestrator = new SubAgentOrchestrator({
      fallbackExecutor: baseExecutor,
      resolveSubAgentManager: () => manager,
      pollIntervalMs: 5,
    });

    const result = await orchestrator.execute({
      id: "planner:envelope:3",
      createdAt: Date.now(),
      context: { results: {} },
      steps: [],
      plannerContext: {
        parentRequest: "Inspect PLAN.md",
        history: [],
        memory: [],
        toolOutputs: [],
        workspaceRoot,
      },
      plannerSteps: [
        {
          name: "review_plan",
          stepType: "subagent_task",
          objective: "Review the implementation plan",
          inputContract: "Inspect PLAN.md in the delegated workspace.",
          acceptanceCriteria: ["PLAN.md inspected"],
          requiredToolCapabilities: ["system.readFile"],
          contextRequirements: [],
          executionContext: {
            version: "v1",
            workspaceRoot: "/workspace",
            allowedReadRoots: ["/workspace"],
            allowedWriteRoots: [],
            requiredSourceArtifacts: [join(outsideRoot, "PLAN.md")],
            allowedTools: ["system.readFile"],
            effectClass: "filesystem_read",
            verificationMode: "evidence_only",
            stepKind: "delegated_analysis",
          },
          maxBudgetHint: "2m",
          canRunParallel: false,
        },
      ],
    });

    expect(result.status).toBe("failed");
    expect(manager.spawnCalls).toHaveLength(0);
    expect(result.error).toContain(
      "Delegated local-file work must have a canonical workspace root before child execution.",
    );
  });
});
