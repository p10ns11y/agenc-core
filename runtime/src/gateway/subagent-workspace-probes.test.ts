import { describe, expect, it } from "vitest";

import type { Pipeline, PipelinePlannerSubagentStep } from "../workflow/pipeline.js";
import { buildWorkspaceStateGuidanceLines } from "./subagent-workspace-probes.js";

describe("subagent-workspace-probes", () => {
  it("uses only the trusted execution-envelope workspace root for prompt guidance", () => {
    const step: PipelinePlannerSubagentStep = {
      name: "inspect_workspace",
      stepType: "subagent_task",
      objective: "Inspect authored package state",
      inputContract: "Use the approved workspace only",
      acceptanceCriteria: ["Summarize package state"],
      requiredToolCapabilities: ["system.readFile"],
      contextRequirements: ["cwd=/workspace/legacy-hint"],
      executionContext: {
        version: "v1",
        workspaceRoot: "/home/tetsuo/git/AgenC/agenc-core",
        allowedReadRoots: ["/home/tetsuo/git/AgenC/agenc-core"],
        allowedWriteRoots: ["/home/tetsuo/git/AgenC/agenc-core"],
        allowedTools: ["system.readFile"],
        effectClass: "read_only",
        verificationMode: "grounded_read",
        stepKind: "delegated_review",
      },
      maxBudgetHint: "2m",
      canRunParallel: true,
    };
    const pipeline: Pipeline = {
      id: "planner:test:trusted-guidance",
      createdAt: Date.now(),
      context: { results: {} },
      steps: [],
      plannerSteps: [step],
      plannerContext: {
        parentRequest: "Inspect the approved workspace only.",
        history: [],
        memory: [],
        toolOutputs: [],
      },
    };

    expect(
      buildWorkspaceStateGuidanceLines(
        step,
        pipeline,
        [{ path: "/home/tetsuo/git/AgenC/agenc-core/package.json" }],
        "/tmp/fabricated-root",
      ),
    ).toEqual([]);
  });
});
