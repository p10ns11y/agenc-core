import { describe, expect, it } from "vitest";

import {
  resolvePipelineCompletionState,
  resolveWorkflowCompletionState,
} from "./completion-state.js";

describe("completion-state", () => {
  it("marks failed pipelines with completed work as partial", () => {
    expect(
      resolvePipelineCompletionState({
        status: "failed",
        completedSteps: 2,
      }),
    ).toBe("partial");
  });

  it("marks halted pipelines as blocked", () => {
    expect(
      resolvePipelineCompletionState({
        status: "halted",
        completedSteps: 1,
      }),
    ).toBe("blocked");
  });

  it("marks implementation-class completed runs without verifier coverage as needs_verification", () => {
    expect(
      resolveWorkflowCompletionState({
        stopReason: "completed",
        toolCalls: [
          {
            name: "system.writeFile",
            args: { path: "/workspace/src/main.c" },
            result: JSON.stringify({ ok: true }),
            isError: false,
          },
        ],
        verificationContract: {
          workspaceRoot: "/workspace",
          targetArtifacts: ["/workspace/src/main.c"],
          completionContract: {
            taskClass: "behavior_required",
            placeholdersAllowed: false,
            partialCompletionAllowed: false,
          },
        },
        verifier: {
          performed: false,
          overall: "skipped",
        },
      }),
    ).toBe("needs_verification");
  });

  it("marks the shell-stub incident shape as needs_verification before verifier rollout", () => {
    expect(
      resolveWorkflowCompletionState({
        stopReason: "completed",
        plannerUsed: true,
        deterministicStepsExecuted: 4,
        toolCalls: [
          {
            name: "system.bash",
            args: {
              command:
                "cat <<'STUB' > /workspace/src/jobs.c\n/* Stub */\nSTUB",
            },
            result: JSON.stringify({ stdout: "", stderr: "", exitCode: 0 }),
            isError: false,
          },
          {
            name: "system.bash",
            args: { command: "make" },
            result: JSON.stringify({ stdout: "ok", stderr: "", exitCode: 0 }),
            isError: false,
          },
        ],
        verifier: {
          performed: false,
          overall: "skipped",
        },
      }),
    ).toBe("needs_verification");
  });

  it("marks partial progress honestly when execution stops after grounded work", () => {
    expect(
      resolveWorkflowCompletionState({
        stopReason: "validation_error",
        toolCalls: [
          {
            name: "system.writeFile",
            args: { path: "/workspace/README.md" },
            result: JSON.stringify({ ok: true }),
            isError: false,
          },
        ],
        completionContract: {
          taskClass: "scaffold_allowed",
          placeholdersAllowed: true,
          partialCompletionAllowed: true,
        },
      }),
    ).toBe("partial");
  });

  it("marks missing behavior harness as needs_verification when implementation progress exists", () => {
    expect(
      resolveWorkflowCompletionState({
        stopReason: "validation_error",
        validationCode: "missing_behavior_harness",
        toolCalls: [
          {
            name: "system.writeFile",
            args: { path: "/workspace/src/shell.c" },
            result: JSON.stringify({ ok: true }),
            isError: false,
          },
        ],
        verificationContract: {
          workspaceRoot: "/workspace",
          targetArtifacts: ["/workspace/src/shell.c"],
          acceptanceCriteria: [
            "Shell job-control behavior is verified with scenario coverage",
          ],
          completionContract: {
            taskClass: "artifact_only",
            placeholdersAllowed: false,
            partialCompletionAllowed: false,
          },
        },
      }),
    ).toBe("needs_verification");
  });
});
