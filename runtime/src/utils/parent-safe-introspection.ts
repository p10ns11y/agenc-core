export interface ParentSafeReadOnlyIntrospectionIntent {
  readonly command: "pwd" | "ls";
}

const EXPLICIT_CHILD_ISOLATION_RE =
  /\b(?:execute_with_agent|sub[\s-]?agent|child\s+agent|delegate|delegation|spawn|parallel(?:ize|ism)?|handoff|isolation)\b/i;
const COMPLEX_INTROSPECTION_RE =
  /\b(?:grep|find|search|rg|ripgrep|tree|recursive|glob|write|edit|modify|create|delete|remove|move|rename|build|test|install|deploy|serve|status|diff)\b/i;
const TRIVIAL_PWD_RE =
  /^\s*(?:pwd|run\s+pwd|what(?:'s| is)\s+(?:the\s+)?(?:current\s+)?(?:working\s+directory|cwd)|show\s+(?:me\s+)?(?:the\s+)?(?:current\s+)?(?:working\s+directory|cwd)|tell\s+me\s+(?:the\s+)?(?:current\s+)?(?:working\s+directory|cwd))\s*[?.!]*\s*$/i;
const TRIVIAL_LS_RE =
  /^\s*(?:ls(?:\s+-[A-Za-z]+)?|run\s+ls(?:\s+-[A-Za-z]+)?|list\s+(?:the\s+)?files(?:\s+(?:here|in\s+(?:the\s+)?(?:current\s+)?(?:directory|workspace)))?|show\s+(?:me\s+)?(?:the\s+)?files(?:\s+(?:here|in\s+(?:the\s+)?(?:current\s+)?(?:directory|workspace)))?|what(?:'s| is)\s+in\s+(?:the\s+)?(?:current\s+)?(?:directory|workspace)|show\s+(?:me\s+)?what(?:'s| is)\s+in\s+(?:the\s+)?(?:current\s+)?(?:directory|workspace)|what\s+files\s+are\s+here)\s*[?.!]*\s*$/i;

export function inferParentSafeReadOnlyIntrospection(
  messageText: string,
): ParentSafeReadOnlyIntrospectionIntent | undefined {
  const trimmed = messageText.trim();
  if (trimmed.length === 0) return undefined;
  if (EXPLICIT_CHILD_ISOLATION_RE.test(trimmed)) return undefined;
  if (COMPLEX_INTROSPECTION_RE.test(trimmed)) return undefined;

  if (TRIVIAL_PWD_RE.test(trimmed)) {
    return { command: "pwd" };
  }
  if (TRIVIAL_LS_RE.test(trimmed)) {
    return { command: "ls" };
  }
  return undefined;
}

export function resolveParentSafeReadOnlyIntrospectionToolNames(
  intent: ParentSafeReadOnlyIntrospectionIntent,
  allowedToolNames: readonly string[],
): readonly string[] {
  const preferredToolNames =
    intent.command === "ls"
      ? ["system.bash", "desktop.bash", "system.listDir"]
      : ["system.bash", "desktop.bash"];
  if (allowedToolNames.length === 0) {
    return preferredToolNames;
  }
  return preferredToolNames.filter((toolName) =>
    allowedToolNames.includes(toolName),
  );
}
