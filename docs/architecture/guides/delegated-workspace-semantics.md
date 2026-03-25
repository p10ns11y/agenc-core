# Delegated Workspace Semantics

This guide defines the final delegated local-file execution rules for AgenC runtime.

## Authoritative rule

Delegated local-file execution has one executable filesystem contract:

- `executionContext.workspaceRoot`
- `executionContext.allowedReadRoots`
- `executionContext.allowedWriteRoots`
- `executionContext.requiredSourceArtifacts`
- `executionContext.targetArtifacts`

Those values are canonical concrete host paths by the time a child session is spawned.

## Why `/workspace` is presentation-only

`/workspace` may still appear in:

- planner text
- prompts
- operator-visible traces
- legacy compatibility payloads at ingestion

It is not executable runtime truth for delegated local-file work.

If a legacy payload uses `/workspace/...`, the runtime canonicalizes the full delegated scope once at ingestion and persists only concrete host paths after that point. If canonicalization cannot produce a coherent scope, the delegated step is rejected before child execution.

The tool layer does not repair `/workspace` aliases on the fly for delegated sessions.

## Canonical delegated scope lifecycle

1. Legacy or structured input arrives.
2. The runtime canonical scope builder rewrites delegated workspace/artifact paths into concrete host paths.
3. Spawn-time preflight validates:
   - workspace root consistency
   - read/write root containment
   - required source presence
   - target containment
4. The canonical scope is persisted into child/background state.
5. Resume/retry/replay reuses the persisted canonical scope directly.

The runtime must never reconstruct delegated workspace truth from prompt text, transcript text, or `contextRequirements` after ingestion.

## Shared-artifact multi-agent writes

Shared-artifact multi-writer delegation is denied by default.

If multiple delegated child steps share one primary artifact, AgenC defaults to:

- inline execution for the writer
- optional bounded read-only critique only

Why:

- tightly shared coding work is a poor fit for multi-agent fanout
- AgenC does not implement a real lock manager or ownership-transfer runtime for arbitrary files
- prose-only “ownership” is not a safety boundary

`PLAN.md`-style fanout is therefore rejected unless the runtime can prove a safe structural ownership shape.

## Debugging delegated preflight failures

When delegated local-file spawn fails before child execution, check these in order:

1. Does the step carry a canonical `executionContext`?
2. Does `executionContext.workspaceRoot` match the child `workingDirectory`?
3. Are all required source artifacts inside `allowedReadRoots` and present on disk?
4. Are all target artifacts inside `allowedWriteRoots`?
5. Are any paths still using `/workspace/...` instead of concrete host paths?

Common failure modes:

- raw `cwd=/workspace/...` reached orchestration without being canonicalized at ingestion
- required source artifacts point outside the canonical workspace root
- required source artifacts were declared for a workspace root that does not exist yet
- multiple delegated writers targeted the same primary artifact

## Operator meaning

If a delegated local-file step is rejected before child spawn, that means the runtime protected correctness. The fix is to correct the delegated execution envelope or the delegation shape, not to relax the preflight or re-enable prompt-derived workspace truth.
