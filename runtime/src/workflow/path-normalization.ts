import { dirname, isAbsolute, relative, resolve as resolvePath } from "node:path";

const WORKSPACE_ALIAS_ROOT = "/workspace";

const NON_EXECUTABLE_ENVELOPE_ROOTS = [
  "/workspace",
  "/abs/path",
  "/absolute/path",
  "<workspace-root>",
  "<workspace_root>",
  "<actual-workspace-root>",
  "<actual_workspace_root>",
] as const;

function trimPath(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function expandHomeDirectory(value: string): string {
  if (value === "~" || value.startsWith("~/") || value.startsWith("~\\")) {
    const home = process.env.HOME ?? process.env.USERPROFILE;
    if (!home || home.trim().length === 0) return value;
    return value === "~" ? home : `${home}${value.slice(1)}`;
  }
  return value;
}

export function isNonExecutableEnvelopePath(
  value: string | undefined | null,
): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  return NON_EXECUTABLE_ENVELOPE_ROOTS.some((root) =>
    trimmed === root || trimmed.startsWith(`${root}/`)
  );
}

export function isWorkspaceAliasPath(
  value: string | undefined | null,
): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  return (
    trimmed === WORKSPACE_ALIAS_ROOT ||
    trimmed.startsWith(`${WORKSPACE_ALIAS_ROOT}/`)
  );
}

export function translateWorkspaceAliasPath(
  value: string,
  workspaceRoot?: string,
): string | undefined {
  const trimmed = trimPath(value);
  if (!trimmed || !workspaceRoot || !isWorkspaceAliasPath(trimmed)) {
    return undefined;
  }
  const normalizedWorkspaceRoot = resolvePath(workspaceRoot);
  if (trimmed === WORKSPACE_ALIAS_ROOT) {
    return normalizedWorkspaceRoot;
  }
  return resolvePath(
    normalizedWorkspaceRoot,
    trimmed.slice(`${WORKSPACE_ALIAS_ROOT}/`.length),
  );
}

export function isConcreteExecutableEnvelopeRoot(
  value: string | undefined | null,
): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (isNonExecutableEnvelopePath(trimmed)) return false;
  return (
    trimmed.startsWith("/") ||
    trimmed.startsWith("~") ||
    /^[a-zA-Z]:[\\/]/.test(trimmed)
  );
}

export function normalizeWorkspaceRoot(
  value: string | undefined | null,
): string | undefined {
  const trimmed = trimPath(value);
  if (!trimmed) return undefined;
  return resolvePath(expandHomeDirectory(trimmed));
}

export function normalizeEnvelopePath(
  rawPath: string,
  workspaceRoot?: string,
): string {
  const trimmed = trimPath(rawPath);
  if (!trimmed) return "";
  const expanded = expandHomeDirectory(trimmed);
  const normalizedWorkspaceRoot = workspaceRoot ? resolvePath(workspaceRoot) : undefined;
  const translatedAliasPath = translateWorkspaceAliasPath(
    expanded,
    normalizedWorkspaceRoot,
  );
  if (translatedAliasPath) {
    return translatedAliasPath;
  }
  if (isAbsolute(expanded)) {
    return resolvePath(expanded);
  }
  if (normalizedWorkspaceRoot) {
    return resolvePath(normalizedWorkspaceRoot, expanded);
  }
  return resolvePath(expanded);
}

export function normalizeEnvelopeRoots(
  roots: readonly (string | undefined | null)[],
  workspaceRoot?: string,
): readonly string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  const candidates = workspaceRoot ? [workspaceRoot, ...roots] : [...roots];
  for (const root of candidates) {
    const trimmed = trimPath(root);
    if (!trimmed) continue;
    const next = normalizeEnvelopePath(trimmed, workspaceRoot);
    if (!next || seen.has(next)) continue;
    seen.add(next);
    normalized.push(next);
  }
  return normalized;
}

export function isPathWithinRoot(path: string, root: string): boolean {
  const normalizedPath = resolvePath(path);
  const normalizedRoot = resolvePath(root);
  if (normalizedPath === normalizedRoot) return true;
  const rel = relative(normalizedRoot, normalizedPath);
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
}

export function isPathWithinAnyRoot(
  path: string,
  roots: readonly string[],
): boolean {
  return roots.some((root) => isPathWithinRoot(path, root));
}

export function normalizeArtifactPaths(
  paths: readonly (string | undefined | null)[],
  workspaceRoot?: string,
): readonly string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const path of paths) {
    const trimmed = trimPath(path);
    if (!trimmed) continue;
    const resolved = normalizeEnvelopePath(trimmed, workspaceRoot);
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    normalized.push(resolved);
  }
  return normalized;
}

export function inferDirectoryTargetsForArtifacts(
  paths: readonly string[],
): readonly string[] {
  const seen = new Set<string>();
  const directories: string[] = [];
  for (const path of paths) {
    const next = dirname(path);
    if (!next || seen.has(next)) continue;
    seen.add(next);
    directories.push(next);
  }
  return directories;
}
