import { describe, expect, it } from "vitest";

import {
  assessDelegationAdmission,
  assessDirectDelegationAdmission,
} from "./delegation-admission.js";

describe("assessDelegationAdmission", () => {
  it("keeps explicitly requested read-only delegation admissible", () => {
    const decision = assessDelegationAdmission({
      messageText:
        "Delegate deeper research into the flaky logs, inspect the workspace state, and report the findings.",
      totalSteps: 3,
      synthesisSteps: 1,
      explicitDelegationRequested: true,
      steps: [
        {
          name: "inspect_logs",
          objective:
            "Inspect flaky test logs and workspace state, then report grounded findings",
          inputContract:
            "Return grounded findings from the inspected logs and files",
          acceptanceCriteria: [
            "Observed timeout clusters are grounded in the logs",
          ],
          requiredToolCapabilities: ["system.readFile", "system.listDir"],
          contextRequirements: ["ci_logs"],
          executionContext: {
            version: "v1",
            workspaceRoot: "/tmp/project",
            allowedReadRoots: ["/tmp/project"],
            allowedWriteRoots: ["/tmp/project"],
            requiredSourceArtifacts: ["/tmp/project/logs/flaky.log"],
            effectClass: "read_only",
            verificationMode: "grounded_read",
            stepKind: "delegated_research",
          },
          maxBudgetHint: "2m",
          canRunParallel: false,
        },
      ],
      edges: [],
      threshold: 0,
      maxFanoutPerTurn: 4,
      maxDepth: 4,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("approved");
    expect(decision.shape).toBe("test_triage");
  });

});
