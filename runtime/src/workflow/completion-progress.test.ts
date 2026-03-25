import { describe, expect, it } from "vitest";
import {
  deriveWorkflowProgressSnapshot,
  mergeWorkflowProgressSnapshots,
} from "./completion-progress.js";

describe("completion-progress", () => {
  it("derives reusable verification evidence and remaining verifier work", () => {
    const snapshot = deriveWorkflowProgressSnapshot({
      stopReason: "completed",
      completionState: "needs_verification",
      toolCalls: [
        {
          name: "system.bash",
          args: { command: "make test" },
          result: JSON.stringify({
            stdout: "ok",
            stderr: "",
            exitCode: 0,
            __agencVerification: {
              category: "build",
              repoLocal: true,
              command: "make test",
            },
          }),
          isError: false,
        },
      ],
      plannerUsed: true,
      deterministicStepsExecuted: 2,
      updatedAt: 10,
    });

    expect(snapshot).toMatchObject({
      completionState: "needs_verification",
      satisfiedRequirements: ["build_verification"],
      remainingRequirements: ["workflow_verifier_pass"],
      reusableEvidence: [
        expect.objectContaining({
          requirement: "build_verification",
          summary: "make test",
        }),
      ],
    });
  });

  it("merges resumable progress without silently upgrading partial work to completed", () => {
    const previous = deriveWorkflowProgressSnapshot({
      stopReason: "completed",
      completionState: "needs_verification",
      toolCalls: [
        {
          name: "system.bash",
          args: { command: "ctest" },
          result: JSON.stringify({
            stdout: "ok",
            stderr: "",
            exitCode: 0,
            __agencVerification: {
              category: "build",
              repoLocal: true,
              command: "ctest",
            },
          }),
          isError: false,
        },
      ],
      plannerUsed: true,
      deterministicStepsExecuted: 1,
      updatedAt: 5,
    });
    const next = {
      completionState: "completed" as const,
      stopReason: "completed" as const,
      requiredRequirements: ["workflow_verifier_pass"] as const,
      satisfiedRequirements: ["workflow_verifier_pass"] as const,
      remainingRequirements: [] as const,
      reusableEvidence: [] as const,
      updatedAt: 20,
    };

    const merged = mergeWorkflowProgressSnapshots({
      previous,
      next,
    });

    expect(merged).toMatchObject({
      completionState: "completed",
      satisfiedRequirements: expect.arrayContaining([
        "build_verification",
        "workflow_verifier_pass",
      ]),
      remainingRequirements: [],
    });
    expect(merged?.reusableEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requirement: "build_verification",
          summary: "ctest",
        }),
      ]),
    );
  });
});
