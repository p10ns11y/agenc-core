import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { runDelegatedWorkspaceGateSuite } from "./delegated-workspace-gate-suite.js";

const INCIDENT_FIXTURE_DIR = fileURLToPath(
  new URL("../../benchmarks/v1/incidents", import.meta.url),
);

describe("delegated-workspace gate suite", () => {
  it("runs all mandatory delegated-workspace executable gates", async () => {
    const artifact = await runDelegatedWorkspaceGateSuite({
      incidentFixtureDir: INCIDENT_FIXTURE_DIR,
    });

    expect(artifact.scenarioCount).toBe(6);
    expect(artifact.mandatoryScenarioCount).toBe(6);
    expect(artifact.advisoryScenarioCount).toBe(0);
    expect(artifact.mandatoryPassRate).toBe(1);
    expect(artifact.falseCompletedScenarios).toBe(0);
    expect(
      artifact.scenarios.map((scenario) => scenario.scenarioId),
    ).toEqual([
      "delegated_split_workspace_root_trace_replay",
      "canonical_scope_no_split_root_invariant",
      "preflight_rejects_impossible_delegated_scope",
      "legacy_alias_ingestion_persists_canonical_scope",
      "shared_artifact_multi_writer_denied",
      "degraded_provider_retry_does_not_complete_broken_scope",
    ]);
  });
});
