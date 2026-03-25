import { describe, expect, it } from "vitest";

import { assessDelegationAdmission } from "./delegation-admission.js";

describe("assessDelegationAdmission", () => {
  it("denies shared-primary-artifact plans when multiple mutable child steps target the same file", () => {
    const decision = assessDelegationAdmission({
      messageText:
        "Review PLAN.md from multiple angles, update PLAN.md in parallel, then synthesize the result.",
      totalSteps: 4,
      synthesisSteps: 1,
      steps: [
        {
          name: "architecture_writer",
          objective: "Update PLAN.md with architecture feedback",
          inputContract: "Write the architecture changes into PLAN.md",
          acceptanceCriteria: ["PLAN.md includes architecture updates"],
          requiredToolCapabilities: ["system.writeFile"],
          contextRequirements: [],
          executionContext: {
            version: "v1",
            workspaceRoot: "/tmp/project",
            allowedReadRoots: ["/tmp/project"],
            allowedWriteRoots: ["/tmp/project"],
            requiredSourceArtifacts: ["/tmp/project/PLAN.md"],
            targetArtifacts: ["/tmp/project/PLAN.md"],
            effectClass: "filesystem_write",
            verificationMode: "mutation_required",
            stepKind: "delegated_execution",
          },
          maxBudgetHint: "3m",
          canRunParallel: true,
        },
        {
          name: "security_writer",
          objective: "Update PLAN.md with security feedback",
          inputContract: "Write the security changes into PLAN.md",
          acceptanceCriteria: ["PLAN.md includes security updates"],
          requiredToolCapabilities: ["system.writeFile"],
          contextRequirements: [],
          executionContext: {
            version: "v1",
            workspaceRoot: "/tmp/project",
            allowedReadRoots: ["/tmp/project"],
            allowedWriteRoots: ["/tmp/project"],
            requiredSourceArtifacts: ["/tmp/project/PLAN.md"],
            targetArtifacts: ["/tmp/project/PLAN.md"],
            effectClass: "filesystem_write",
            verificationMode: "mutation_required",
            stepKind: "delegated_execution",
          },
          maxBudgetHint: "3m",
          canRunParallel: true,
        },
      ],
      edges: [],
      threshold: 0,
      maxFanoutPerTurn: 4,
      maxDepth: 4,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("shared_artifact_writer_inline");
    expect(decision.diagnostics).toMatchObject({
      sharedPrimaryArtifact: "/tmp/project/PLAN.md",
    });
    expect(decision.stepAdmissions.map((entry) => entry.ownedArtifacts)).toEqual([
      ["/tmp/project/PLAN.md"],
      ["/tmp/project/PLAN.md"],
    ]);
  });

  it("keeps owned artifacts as structural runtime data for safe disjoint branches", () => {
    const decision = assessDelegationAdmission({
      messageText:
        "Implement the parser in one branch and the docs in another, then summarize.",
      totalSteps: 3,
      synthesisSteps: 1,
      steps: [
        {
          name: "parser_branch",
          objective: "Implement the parser",
          inputContract: "Update src/parser.c only",
          acceptanceCriteria: ["src/parser.c compiles"],
          requiredToolCapabilities: ["system.writeFile"],
          contextRequirements: [],
          executionContext: {
            version: "v1",
            workspaceRoot: "/tmp/project",
            allowedReadRoots: ["/tmp/project"],
            allowedWriteRoots: ["/tmp/project"],
            requiredSourceArtifacts: ["/tmp/project/src/parser.c"],
            targetArtifacts: ["/tmp/project/src/parser.c"],
            effectClass: "filesystem_write",
            verificationMode: "mutation_required",
            stepKind: "delegated_execution",
          },
          maxBudgetHint: "4m",
          canRunParallel: true,
        },
        {
          name: "docs_branch",
          objective: "Update the guide",
          inputContract: "Update docs/AGENC.md only",
          acceptanceCriteria: ["docs/AGENC.md reflects the parser work"],
          requiredToolCapabilities: ["system.writeFile"],
          contextRequirements: [],
          executionContext: {
            version: "v1",
            workspaceRoot: "/tmp/project",
            allowedReadRoots: ["/tmp/project"],
            allowedWriteRoots: ["/tmp/project"],
            requiredSourceArtifacts: ["/tmp/project/docs/AGENC.md"],
            targetArtifacts: ["/tmp/project/docs/AGENC.md"],
            effectClass: "filesystem_write",
            verificationMode: "mutation_required",
            stepKind: "delegated_execution",
          },
          maxBudgetHint: "4m",
          canRunParallel: true,
        },
      ],
      edges: [],
      threshold: 0,
      maxFanoutPerTurn: 4,
      maxDepth: 4,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.stepAdmissions.map((entry) => entry.ownedArtifacts)).toEqual([
      ["/tmp/project/src/parser.c"],
      ["/tmp/project/docs/AGENC.md"],
    ]);
  });
});
