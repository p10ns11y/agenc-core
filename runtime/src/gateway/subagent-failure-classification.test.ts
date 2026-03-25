import { describe, expect, it } from "vitest";
import {
  buildEffectiveContextRequirements,
  resolvePlannerStepWorkingDirectory,
  stepRequiresStructuredDelegatedFilesystemScope,
} from "./subagent-failure-classification.js";

describe("subagent-failure-classification", () => {
  it("refuses execution-envelope workspace aliases as live working-directory inputs", () => {
    const result = resolvePlannerStepWorkingDirectory(
      {
        name: "review_plan",
        stepType: "subagent_task",
        objective: "Review PLAN.md",
        inputContract: "Read PLAN.md and return findings",
        acceptanceCriteria: ["3-5 findings"],
        requiredToolCapabilities: ["system.readFile"],
        contextRequirements: [],
        executionContext: {
          version: "v1",
          workspaceRoot: "/workspace",
          allowedReadRoots: ["/workspace", "/home/tetsuo/git/AgenC/agenc-core"],
          allowedWriteRoots: ["/workspace"],
          requiredSourceArtifacts: ["/workspace/PLAN.md"],
          targetArtifacts: ["/workspace/TODO.MD"],
          allowedTools: ["system.readFile"],
          effectClass: "read_only",
          verificationMode: "grounded_read",
          stepKind: "delegated_review",
        },
        maxBudgetHint: "2m",
        canRunParallel: true,
      },
      {
        id: "planner:test:alias",
        createdAt: Date.now(),
        context: { results: {} },
        steps: [],
        plannerContext: {
          parentRequest: "Review PLAN.md",
          history: [],
          memory: [],
          toolOutputs: [],
          workspaceRoot: "/home/tetsuo/git/AgenC/agenc-core",
        },
      },
      "/tmp/not-the-root",
    );

    expect(result).toBeUndefined();
  });

  it("does not fall back to planner workspace roots when the step lacks an execution envelope", () => {
    const result = resolvePlannerStepWorkingDirectory(
      {
        name: "review_plan",
        stepType: "subagent_task",
        objective: "Review PLAN.md",
        inputContract: "Read PLAN.md and return findings",
        acceptanceCriteria: ["3-5 findings"],
        requiredToolCapabilities: ["system.readFile"],
        contextRequirements: ["repo_context"],
        maxBudgetHint: "2m",
        canRunParallel: true,
      },
      {
        id: "planner:test",
        createdAt: Date.now(),
        context: { results: {} },
        steps: [],
        plannerContext: {
          parentRequest: "Review PLAN.md",
          history: [],
          memory: [],
          toolOutputs: [],
          workspaceRoot: "/home/tetsuo/git/stream-test/agenc-shell",
        },
      },
      "/home/tetsuo/git/AgenC",
    );

    expect(result).toBeUndefined();
  });

  it("does not treat raw cwd directives as structured delegated filesystem scope", () => {
    expect(
      stepRequiresStructuredDelegatedFilesystemScope({
        name: "review_plan",
        stepType: "subagent_task",
        objective: "Review PLAN.md",
        inputContract: "Read PLAN.md and return findings",
        acceptanceCriteria: ["3-5 findings"],
        requiredToolCapabilities: ["system.readFile"],
        contextRequirements: ["cwd=/workspace"],
        maxBudgetHint: "2m",
        canRunParallel: true,
      }),
    ).toBe(false);
  });

  it("drops legacy cwd directives while preserving non-scope context requirements", () => {
    expect(
      buildEffectiveContextRequirements({
        name: "review_plan",
        stepType: "subagent_task",
        objective: "Review PLAN.md",
        inputContract: "Read PLAN.md and return findings",
        acceptanceCriteria: ["3-5 findings"],
        requiredToolCapabilities: ["system.readFile"],
        contextRequirements: [
          "cwd=/workspace",
          "working_directory:/tmp/project",
          "repo_context",
          "repo_context",
        ],
        maxBudgetHint: "2m",
        canRunParallel: true,
      }),
    ).toEqual(["repo_context"]);
  });
});
