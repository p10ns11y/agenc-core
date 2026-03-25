import { describe, expect, it } from "vitest";

import { buildCanonicalDelegatedFilesystemScope } from "./delegated-filesystem-scope.js";

describe("buildCanonicalDelegatedFilesystemScope", () => {
  it("canonicalizes alias placeholders only when a trusted host root is supplied", () => {
    const scope = buildCanonicalDelegatedFilesystemScope({
      workspaceRoot: "/workspace",
      inheritedWorkspaceRoot: "/home/tetsuo/git/AgenC/agenc-core",
      hostWorkspaceRoot: "/home/tetsuo/git/AgenC/agenc-core",
      allowedReadRoots: ["/workspace", "/home/tetsuo/git/AgenC/agenc-core"],
      allowedWriteRoots: ["/workspace/docs", "docs"],
      inputArtifacts: ["/workspace/PLAN.md", "PLAN.md"],
      requiredSourceArtifacts: [
        "/workspace/PLAN.md",
        "/home/tetsuo/git/AgenC/agenc-core/PLAN.md",
      ],
      targetArtifacts: ["/workspace/docs/OUT.md", "docs/OUT.md"],
    });

    expect(scope).toEqual({
      workspaceRoot: "/home/tetsuo/git/AgenC/agenc-core",
      allowedReadRoots: ["/home/tetsuo/git/AgenC/agenc-core"],
      allowedWriteRoots: [
        "/home/tetsuo/git/AgenC/agenc-core",
        "/home/tetsuo/git/AgenC/agenc-core/docs",
      ],
      inputArtifacts: ["/home/tetsuo/git/AgenC/agenc-core/PLAN.md"],
      requiredSourceArtifacts: ["/home/tetsuo/git/AgenC/agenc-core/PLAN.md"],
      targetArtifacts: ["/home/tetsuo/git/AgenC/agenc-core/docs/OUT.md"],
    });
  });

  it("does not use inherited planner or host roots as structured fallback inputs", () => {
    const scope = buildCanonicalDelegatedFilesystemScope({
      workspaceRoot: null,
      inheritedWorkspaceRoot: "/home/tetsuo/git/AgenC/agenc-core",
      hostWorkspaceRoot: "/tmp/wrong-fallback",
      allowedReadRoots: ["/workspace/src", "src"],
      allowedWriteRoots: ["src"],
      requiredSourceArtifacts: ["/workspace/src/index.ts"],
      targetArtifacts: ["src/index.ts"],
    });

    expect(scope).toEqual({
      allowedReadRoots: [],
      allowedWriteRoots: [],
      inputArtifacts: [],
      requiredSourceArtifacts: [],
      targetArtifacts: [],
    });
  });
});
