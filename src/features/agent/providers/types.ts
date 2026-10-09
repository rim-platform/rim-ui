/**
 * AI Provider abstraction layer.
 * Each provider (Anthropic, OpenAI, Ollama) implements this interface.
 */

export interface AiModelDef {
  id: string;
  name: string;
  contextWindow: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
  inputPricePerMToken?: number;
  outputPricePerMToken?: number;
}

export interface AiProviderConfig {
  id: string;
  name: string;
  models: AiModelDef[];
}

export interface AiMessage {
  role: "user" | "assistant" | "system";
  content: string | AiContentBlock[];
}

export type AiContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface AiToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AiChatRequest {
  model: string;
  messages: AiMessage[];
  tools?: AiToolDefinition[];
  systemPrompt?: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

export type AiStreamChunk =
  | { kind: "text_delta"; text: string }
  | { kind: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { kind: "done"; usage: { inputTokens: number; outputTokens: number } }
  | { kind: "error"; message: string };

/**
 * Result of `AiProvider.validateCredentials`. Post-#59 this replaces the
 * previous `Promise<boolean>` contract so the Settings UI can distinguish
 * "provider said the key is bad" (user must fix the key) from "we couldn't
 * reach the provider" (user must fix their network). Pre-fix both paths
 * collapsed to `false` and produced a misleading "Invalid API key" toast
 * on a DNS/TLS failure (Hawkeye WARN #4).
 */
export type ValidationOutcome =
  { kind: "valid" } | { kind: "invalid" } | { kind: "network_error"; message: string };

export interface AiProvider {
  readonly config: AiProviderConfig;
  /**
   * Stream a chat completion. The API key is read from the secret vault by the
   * Rust proxy on every request — the JS side never holds the key bytes.
   * (Phase 5 / Option B, agent-settings-consolidation §3.)
   */
  chat(request: AiChatRequest): AsyncIterable<AiStreamChunk>;
}
