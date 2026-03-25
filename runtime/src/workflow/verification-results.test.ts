import { describe, expect, it } from "vitest";
import {
  resolveRuntimeVerificationDecision,
  verificationChannelFail,
  verificationChannelPass,
} from "./verification-results.js";

describe("verification-results", () => {
  it("keeps a passing hybrid verification decision when all channels pass", () => {
    const decision = resolveRuntimeVerificationDecision({
      channels: [
        verificationChannelPass({
          channel: "artifact_state",
          message: "artifact checks passed",
        }),
        verificationChannelPass({
          channel: "placeholder_stub",
          message: "placeholder checks passed",
        }),
      ],
    });

    expect(decision).toMatchObject({
      ok: true,
      channels: [
        expect.objectContaining({ channel: "artifact_state", ok: true }),
        expect.objectContaining({ channel: "placeholder_stub", ok: true }),
      ],
    });
  });

  it("uses the first failing channel as the authoritative workflow diagnostic", () => {
    const decision = resolveRuntimeVerificationDecision({
      channels: [
        verificationChannelPass({
          channel: "artifact_state",
          message: "artifact checks passed",
        }),
        verificationChannelFail({
          channel: "placeholder_stub",
          code: "contradictory_completion_claim",
          message: "placeholder markers remained",
        }),
        verificationChannelFail({
          channel: "rubric",
          code: "acceptance_evidence_missing",
          message: "rubric criteria missing",
        }),
      ],
    });

    expect(decision.ok).toBe(false);
    expect(decision.diagnostic).toEqual({
      code: "contradictory_completion_claim",
      message: "placeholder markers remained",
    });
    expect(decision.channels).toHaveLength(3);
  });
});
