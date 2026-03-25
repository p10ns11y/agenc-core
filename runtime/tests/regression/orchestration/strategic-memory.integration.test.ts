import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteBackend } from "../../../src/memory/sqlite/backend.js";
import { StrategicMemory } from "../../../src/autonomous/strategic-memory.js";

describe("strategic memory integration", () => {
  const backends: SqliteBackend[] = [];

  afterEach(async () => {
    await Promise.all(backends.splice(0).map((backend) => backend.close()));
  });

  it("persists strategic goals, working notes, and execution summaries across restarts", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "agenc-strategic-memory-"));
    const dbPath = path.join(tempDir, "strategic-memory.sqlite");

    const backend1 = new SqliteBackend({ dbPath });
    backends.push(backend1);
    const memory1 = StrategicMemory.fromMemoryBackend(backend1);
    const added = await memory1.addGoal({
      title: "Repair planner fallback semantics",
      description: "Make continue_without_delegation satisfy dependency edges",
      priority: "high",
      source: "meta-planner",
    });
    await memory1.addWorkingNote({
      title: "Planner incident",
      content: "The last fallback path kept the dependency graph blocked.",
      source: "test",
    });
    await memory1.recordExecutionSummary({
      goalId: added.goal.id,
      goalTitle: added.goal.title,
      outcome: "failure",
      summary: "Verification failed before synthesis could resume.",
      source: "test",
    });
    await backend1.flush();
    await backend1.close();

    const backend2 = new SqliteBackend({ dbPath });
    backends.push(backend2);
    const memory2 = StrategicMemory.fromMemoryBackend(backend2);
    const snapshot = await memory2.buildPlanningSnapshot();

    expect(
      snapshot.activeGoals.some((goal) => goal.title === added.goal.title),
    ).toBe(true);
    expect(
      snapshot.workingNotes.some(
        (note) => note.data.title === "Planner incident",
      ),
    ).toBe(true);
    expect(
      snapshot.recentOutcomes.some(
        (summary) =>
          summary.data.goalTitle === added.goal.title &&
          summary.data.summary.includes("Verification failed"),
      ),
    ).toBe(true);
  });
});
