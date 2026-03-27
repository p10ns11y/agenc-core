## PR #31: refactor(runtime): remove daemon marketplace layer
- **Date:** 2026-03-23
- **Files changed:** runtime gateway/config/routing surfaces, onboarding, runtime index/types, runtime marketplace module tree, runtime marketplace tool tree, related docs, generated runtime API baseline
- **What worked:** removing the daemon-local marketplace as a single subsystem was clean once the protocol-backed operator surfaces were kept scoped to `marketplace/serialization.ts`, the CLI/TUI, and `market.*` handlers
- **What didn't:** the generated runtime baseline and several daemon/routing tests still assumed the deleted exports and needed an explicit follow-up cleanup pass
- **Rule added to CLAUDE.md:** no

## PR #49: fix(runtime): enforce request-level completion semantics
- **Date:** 2026-03-27
- **Files changed:** runtime workflow completion state/progress/contracts, planner verifier/execution/admission surfaces, planner tests, background-run progress persistence, generated runtime package metadata, public runtime artifact
- **What worked:** layering request-level milestone debt on top of the existing local verifier prevented false global completion claims without replacing the current verifier stack, and the explicit-delegation admission correction preserved planner-owned synthesis fallback
- **What didn't:** the first delegation-admission pass was too aggressive for explicitly requested read-only research, so the planner dropped out to the direct loop until the explicit-delegation signals were widened and the local-first vetoes were conditioned on them
- **Rule added to CLAUDE.md:** no

## PR #52: feat(runtime): add xAI capability surface and native tools
- **Date:** 2026-03-27
- **Files changed:** runtime LLM shared capability types, Grok provider config/adapter/tool registry, gateway config/provider-manager validation surfaces, adapter/provider-native tests, xAI API gotcha notes, generated runtime/public artifact metadata
- **What worked:** replacing the one-off `web_search` path with a documented provider-native tool catalog made the Grok adapter align cleanly with xAI MCP specs, and wiring server-side tool telemetry into provider evidence preserved observability without weakening the existing client-side function path
- **What didn't:** the first adapter pass only patched the request builder; typecheck caught missing local option-shape plumbing and over-constrained readonly evidence arrays before merge, which had to be corrected before the capability layer was actually complete
- **Rule added to CLAUDE.md:** no
