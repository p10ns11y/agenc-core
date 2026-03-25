import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  evaluatePipelineQualityGates,
  runPipelineQualitySuite,
} from "../../../src/eval/index.js";

const INCIDENT_FIXTURE_DIR = fileURLToPath(
  new URL("../../../benchmarks/v1/incidents", import.meta.url),
);

describe("phase 8 release gate integration", () => {
  it("requires replay plus executable implementation gates before passing release", async () => {
    const artifact = await runPipelineQualitySuite({
      now: () => 1_700_000_300_000,
      runId: "workstream10-release-gate",
      turns: 4,
      desktopRuns: 0,
      incidentFixtureDir: INCIDENT_FIXTURE_DIR,
      delegationBenchmarkK: 2,
    });

    const evaluation = evaluatePipelineQualityGates(artifact);
    expect(artifact.liveCoding.passRate).toBe(1);
    expect(artifact.safety.passRate).toBe(1);
    expect(artifact.longHorizon.passRate).toBe(1);
    expect(artifact.implementationGates.mandatoryPassRate).toBe(1);
    expect(artifact.implementationGates.falseCompletedScenarios).toBe(0);
    expect(artifact.delegatedWorkspaceGates.mandatoryPassRate).toBe(1);
    expect(artifact.delegatedWorkspaceGates.falseCompletedScenarios).toBe(0);
    expect(evaluation.passed).toBe(true);
  });
});
