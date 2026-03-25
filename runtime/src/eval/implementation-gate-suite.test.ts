import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { runImplementationGateSuite } from "./implementation-gate-suite.js";

const INCIDENT_FIXTURE_DIR = fileURLToPath(
  new URL("../../benchmarks/v1/incidents", import.meta.url),
);

describe("implementation gate suite", () => {
  it("covers the mandatory false-completion family and keeps advisory cases separate", async () => {
    const artifact = await runImplementationGateSuite({
      incidentFixtureDir: INCIDENT_FIXTURE_DIR,
    });

    expect(artifact.scenarioCount).toBeGreaterThanOrEqual(7);
    expect(artifact.mandatoryScenarioCount).toBe(5);
    expect(artifact.advisoryScenarioCount).toBe(2);
    expect(artifact.falseCompletedScenarios).toBe(0);
    expect(artifact.mandatoryPassRate).toBe(1);
    expect(
      artifact.scenarios.map((scenario) => scenario.scenarioId),
    ).toEqual(
      expect.arrayContaining([
        "shell_stub_false_completion_replay_gate",
        "deterministic_impl_behavior_gap",
        "valid_scaffold_placeholders",
        "implementation_replaces_scaffold",
        "resume_after_partial_completion",
        "degraded_provider_retry_without_false_completion",
        "safety_gates_risky_incomplete_output",
      ]),
    );
  });
});
