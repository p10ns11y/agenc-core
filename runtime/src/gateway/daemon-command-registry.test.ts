import { describe, expect, it, vi } from "vitest";

import { silentLogger } from "../utils/logger.js";
import { createDaemonCommandRegistry } from "./daemon-command-registry.js";

describe("createDaemonCommandRegistry /context", () => {
  it("reports a finite local compaction window even when the hard session budget is unlimited", async () => {
    const replies: string[] = [];
    const registry = createDaemonCommandRegistry(
      {
        logger: silentLogger,
        configPath: "/tmp/config.json",
        gateway: {
          config: {
            llm: {
              provider: "grok",
              model: "grok-4.20-beta-0309-reasoning",
              sessionTokenBudget: 0,
            },
          },
        },
        yolo: false,
        resetWebSessionContext: vi.fn(async () => {}),
        getWebChatChannel: () => null,
        getHostWorkspacePath: () => "/tmp/project",
        getChatExecutor: () =>
          ({
            getSessionTokenUsage: () => 25_136,
          }) as any,
        getResolvedContextWindowTokens: () => 2_000_000,
        getSystemPrompt: () => "# Agent\n# Repository Guidelines\n# Tool\n# Memory\n",
        getMemoryBackendName: () => "sqlite",
        getPolicyEngineState: () => undefined,
        isPolicyEngineEnabled: () => false,
        isGovernanceAuditLogEnabled: () => false,
        listSessionCredentialLeases: () => [],
        revokeSessionCredentials: vi.fn(async () => 0),
        resolvePolicyScopeForSession: ({ sessionId, runId, channel }) => ({
          sessionId,
          runId,
          channel: channel ?? "webchat",
        }),
        buildPolicySimulationPreview: vi.fn(async () => ({
          toolName: "system.readFile",
          sessionId: "session-1",
          policy: { allowed: true, mode: "normal", violations: [] },
          approval: { required: false, elevated: false, denied: false },
        })),
        getSubAgentRuntimeConfig: () => null,
        getActiveDelegationAggressiveness: () => "balanced",
        resolveDelegationScoreThreshold: () => 0,
        getDelegationAggressivenessOverride: () => null,
        setDelegationAggressivenessOverride: () => {},
        configureDelegationRuntimeServices: () => {},
        getWebChatInboundHandler: () => null,
        getDesktopHandleBySession: () => undefined,
        getSessionModelInfo: () => undefined,
        handleConfigReload: vi.fn(async () => {}),
        getVoiceBridge: () => null,
        getDesktopManager: () => null,
        getDesktopBridges: () => new Map(),
        getPlaywrightBridges: () => new Map(),
        getContainerMCPBridges: () => new Map(),
        getGoalManager: () => null,
        startSlashInit: vi.fn(async () => ({
          filePath: "/tmp/project/AGENC.md",
          started: true,
        })),
      },
      {
        get: () => ({ history: new Array(6).fill({}) }),
      } as any,
      (value) => value,
      [],
      { name: "sqlite" } as any,
      { size: 181 } as any,
      [],
      [],
      {} as any,
      {} as any,
      null,
      undefined,
      undefined,
    );

    const handled = await registry.dispatch(
      "/context",
      "session-1",
      "user-1",
      "webchat",
      async (content) => {
        replies.push(content);
      },
    );

    expect(handled).toBe(true);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("Session Budget: unlimited");
    expect(replies[0]).toContain("Free: 0 tokens");
    expect(replies[0]).toContain(
      "Compaction: local enabled @ 16,000 tokens; provider disabled",
    );
  });
});
