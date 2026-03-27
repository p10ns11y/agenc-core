import type {
  LLMCollectionsSearchConfig,
  LLMMessage,
  LLMProviderNativeServerToolType,
  LLMRemoteMcpServerConfig,
  LLMXSearchConfig,
  LLMXaiCapabilitySurface,
  LLMWebSearchConfig,
} from "./types.js";
import type { GatewayLLMConfig } from "../gateway/types.js";
import { normalizeGrokModel } from "../gateway/context-window.js";

export const PROVIDER_NATIVE_WEB_SEARCH_TOOL = "web_search";
export const PROVIDER_NATIVE_X_SEARCH_TOOL = "x_search";
export const PROVIDER_NATIVE_CODE_INTERPRETER_TOOL = "code_interpreter";
export const PROVIDER_NATIVE_FILE_SEARCH_TOOL = "file_search";
export const PROVIDER_NATIVE_MCP_TOOL_PREFIX = "mcp:";

const RESEARCH_LIKE_RE =
  /\b(?:research|compare|comparison|official docs?|primary sources?|reference|references|citation|citations|look up|latest|up[- ]to[- ]date|news)\b/i;
const INTERACTIVE_BROWSER_RE =
  /\b(?:localhost|127\.0\.0\.1|about:blank|screenshot|snapshot|console|network|dom|inspect|click|type|hover|scroll|fill|select|tab|tabs|window|windows|playtest|qa|end-to-end|e2e|navigate to|open the page)\b/i;
const GROK_SERVER_SIDE_TOOL_PREFIX = "grok-4";

export type ProviderNativeSearchMode = "auto" | "on" | "off";

export interface ProviderNativeSearchRoutingDecision {
  readonly toolName: string;
  readonly schemaChars: number;
}

export interface ProviderNativeToolDefinition {
  readonly name: string;
  readonly toolType: LLMProviderNativeServerToolType;
  readonly payload: Record<string, unknown>;
  readonly schemaChars: number;
}

type ProviderNativeToolConfig = Pick<
  GatewayLLMConfig,
  "provider" | "model"
> &
  LLMXaiCapabilitySurface;

export function supportsGrokServerSideTools(model: string | undefined): boolean {
  const normalized = normalizeGrokModel(model)?.trim().toLowerCase();
  if (!normalized) return true;
  return normalized.startsWith(GROK_SERVER_SIDE_TOOL_PREFIX);
}

export function resolveProviderNativeSearchMode(
  llmConfig: Pick<
    GatewayLLMConfig,
    "provider" | "model" | "webSearch" | "searchMode"
  > | undefined,
): ProviderNativeSearchMode {
  if (!llmConfig || llmConfig.provider !== "grok") return "off";
  if (llmConfig.webSearch !== true) return "off";
  if (!supportsGrokServerSideTools(llmConfig.model)) return "off";
  return llmConfig.searchMode ?? "auto";
}

export function supportsProviderNativeWebSearch(
  llmConfig: Pick<
    GatewayLLMConfig,
    "provider" | "model" | "webSearch" | "searchMode"
  > | undefined,
): boolean {
  return resolveProviderNativeSearchMode(llmConfig) !== "off";
}

function buildWebSearchPayload(
  options: LLMWebSearchConfig | undefined,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    type: PROVIDER_NATIVE_WEB_SEARCH_TOOL,
  };
  const filters: Record<string, unknown> = {};
  if ((options?.allowedDomains?.length ?? 0) > 0) {
    filters.allowed_domains = [...(options?.allowedDomains ?? [])];
  }
  if ((options?.excludedDomains?.length ?? 0) > 0) {
    filters.excluded_domains = [...(options?.excludedDomains ?? [])];
  }
  if (Object.keys(filters).length > 0) {
    payload.filters = filters;
  }
  if (options?.enableImageUnderstanding === true) {
    payload.enable_image_understanding = true;
  }
  return payload;
}

function buildXSearchPayload(
  options: LLMXSearchConfig | undefined,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    type: PROVIDER_NATIVE_X_SEARCH_TOOL,
  };
  if ((options?.allowedXHandles?.length ?? 0) > 0) {
    payload.allowed_x_handles = [...(options?.allowedXHandles ?? [])];
  }
  if ((options?.excludedXHandles?.length ?? 0) > 0) {
    payload.excluded_x_handles = [...(options?.excludedXHandles ?? [])];
  }
  if (options?.fromDate) {
    payload.from_date = options.fromDate;
  }
  if (options?.toDate) {
    payload.to_date = options.toDate;
  }
  if (options?.enableImageUnderstanding === true) {
    payload.enable_image_understanding = true;
  }
  if (options?.enableVideoUnderstanding === true) {
    payload.enable_video_understanding = true;
  }
  return payload;
}

function buildFileSearchPayload(
  options: LLMCollectionsSearchConfig | undefined,
): Record<string, unknown> | undefined {
  if (options?.enabled !== true || (options.vectorStoreIds?.length ?? 0) === 0) {
    return undefined;
  }
  const payload: Record<string, unknown> = {
    type: PROVIDER_NATIVE_FILE_SEARCH_TOOL,
    vector_store_ids: [...(options.vectorStoreIds ?? [])],
  };
  if (typeof options.maxNumResults === "number" && options.maxNumResults > 0) {
    payload.max_num_results = options.maxNumResults;
  }
  return payload;
}

function buildRemoteMcpPayload(
  server: LLMRemoteMcpServerConfig,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    type: "mcp",
    server_url: server.serverUrl,
    server_label: server.serverLabel,
  };
  if (server.serverDescription) {
    payload.server_description = server.serverDescription;
  }
  if ((server.allowedTools?.length ?? 0) > 0) {
    payload.allowed_tools = [...(server.allowedTools ?? [])];
  }
  if (server.authorization) {
    payload.authorization = server.authorization;
  }
  if (server.headers && Object.keys(server.headers).length > 0) {
    payload.headers = { ...server.headers };
  }
  return payload;
}

function createDefinition(
  name: string,
  toolType: LLMProviderNativeServerToolType,
  payload: Record<string, unknown>,
): ProviderNativeToolDefinition {
  return {
    name,
    toolType,
    payload,
    schemaChars: JSON.stringify(payload).length,
  };
}

export function getProviderNativeToolDefinitions(
  llmConfig: ProviderNativeToolConfig | undefined,
): readonly ProviderNativeToolDefinition[] {
  if (!llmConfig || llmConfig.provider !== "grok") return [];
  if (!supportsGrokServerSideTools(llmConfig.model)) return [];

  const definitions: ProviderNativeToolDefinition[] = [];

  if (llmConfig.webSearch === true) {
    definitions.push(
      createDefinition(
        PROVIDER_NATIVE_WEB_SEARCH_TOOL,
        "web_search",
        buildWebSearchPayload(llmConfig.webSearchOptions),
      ),
    );
  }
  if (llmConfig.xSearch === true) {
    definitions.push(
      createDefinition(
        PROVIDER_NATIVE_X_SEARCH_TOOL,
        "x_search",
        buildXSearchPayload(llmConfig.xSearchOptions),
      ),
    );
  }
  if (llmConfig.codeExecution === true) {
    definitions.push(
      createDefinition(
        PROVIDER_NATIVE_CODE_INTERPRETER_TOOL,
        "code_interpreter",
        { type: PROVIDER_NATIVE_CODE_INTERPRETER_TOOL },
      ),
    );
  }

  const fileSearchPayload = buildFileSearchPayload(llmConfig.collectionsSearch);
  if (fileSearchPayload) {
    definitions.push(
      createDefinition(
        PROVIDER_NATIVE_FILE_SEARCH_TOOL,
        "file_search",
        fileSearchPayload,
      ),
    );
  }

  if (llmConfig.remoteMcp?.enabled === true) {
    for (const server of llmConfig.remoteMcp.servers ?? []) {
      definitions.push(
        createDefinition(
          `${PROVIDER_NATIVE_MCP_TOOL_PREFIX}${server.serverLabel}`,
          "mcp",
          buildRemoteMcpPayload(server),
        ),
      );
    }
  }

  return definitions;
}

export function getProviderNativeAdvertisedToolNames(
  llmConfig: ProviderNativeToolConfig | undefined,
): readonly string[] {
  return getProviderNativeToolDefinitions(llmConfig).map(
    (definition) => definition.name,
  );
}

export function isResearchLikeText(value: string): boolean {
  return RESEARCH_LIKE_RE.test(value);
}

export function isInteractiveBrowserText(value: string): boolean {
  return INTERACTIVE_BROWSER_RE.test(value);
}

export function getProviderNativeWebSearchRoutingDecision(
  params: {
    readonly llmConfig: Pick<
      GatewayLLMConfig,
      "provider" | "model" | "webSearch" | "searchMode"
    > | undefined;
    readonly messageText: string;
    readonly history: readonly LLMMessage[];
  },
): ProviderNativeSearchRoutingDecision | undefined {
  const mode = resolveProviderNativeSearchMode(params.llmConfig);
  if (mode === "off") return undefined;

  const recentHistory = params.history
    .slice(-4)
    .map((entry) =>
      Array.isArray(entry.content)
        ? entry.content
            .filter((part): part is { type: "text"; text: string } =>
              part.type === "text" && typeof part.text === "string"
            )
            .map((part) => part.text)
            .join(" ")
        : entry.content
    )
    .filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    )
    .join(" ");
  const combined = `${recentHistory}\n${params.messageText}`.trim();

  if (isInteractiveBrowserText(combined)) {
    return undefined;
  }
  if (mode === "on" || isResearchLikeText(combined)) {
    const definition = createDefinition(
      PROVIDER_NATIVE_WEB_SEARCH_TOOL,
      "web_search",
      { type: PROVIDER_NATIVE_WEB_SEARCH_TOOL },
    );
    return {
      toolName: definition.name,
      schemaChars: definition.schemaChars,
    };
  }
  return undefined;
}

export function isProviderNativeToolName(toolName: string): boolean {
  const normalized = toolName.trim();
  return (
    normalized === PROVIDER_NATIVE_WEB_SEARCH_TOOL ||
    normalized === PROVIDER_NATIVE_X_SEARCH_TOOL ||
    normalized === PROVIDER_NATIVE_CODE_INTERPRETER_TOOL ||
    normalized === PROVIDER_NATIVE_FILE_SEARCH_TOOL ||
    normalized.startsWith(PROVIDER_NATIVE_MCP_TOOL_PREFIX)
  );
}
