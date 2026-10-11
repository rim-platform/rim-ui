import type { AiModelDef } from "./types";

/** One entry of Anthropic's `GET /v1/models` response. */
export interface AnthropicModelEntry {
  id: string;
  display_name?: string;
  type: string;
  created_at?: string;
  max_input_tokens?: number;
}

/** One entry of OpenAI's `GET /v1/models` response. */
export interface OpenAiModelEntry {
  id: string;
  created?: number;
  owned_by?: string;
}

const ANTHROPIC_DEFAULT_CONTEXT_WINDOW = 200_000;
const OPENAI_DEFAULT_CONTEXT_WINDOW = 128_000;

/** Id prefixes of OpenAI chat models. */
const OPENAI_CHAT_ID = /^(gpt-|o\d|chatgpt-)/;

/**
 * Id fragments of OpenAI models that are not usable through Chat Completions:
 * audio, image, embedding and moderation endpoints, and the Responses-only
 * codex, pro and deep-research variants.
 */
const OPENAI_NON_CHAT_FRAGMENTS = [
  "realtime",
  "audio",
  "transcribe",
  "tts",
  "image",
  "moderation",
  "embedding",
  "search",
  "instruct",
  "codex",
  "deep-research",
];

/** Responses-only `-pro` models, such as `o3-pro` or `gpt-5-pro`. */
const OPENAI_PRO_SUFFIX = /-pro$/;

/** A dated snapshot suffix: `-2026-03-05`, or the older `-0613`. */
const SNAPSHOT_SUFFIX = /-(\d{4}-\d{2}-\d{2}|\d{4})$/;

function chatModel(id: string, name: string, contextWindow: number): AiModelDef {
  return { id, name, contextWindow, supportsTools: true, supportsStreaming: true };
}

/**
 * Display name for an OpenAI model id: the family and version form the first
 * word, every further segment is capitalised (`gpt-5.4-mini` → `GPT-5.4 Mini`).
 */
export function openAiModelName(id: string): string {
  const [head = "", ...rest] = id.split("-");
  let family = head;
  if (head === "gpt") family = `GPT-${rest.shift() ?? ""}`;
  else if (head === "chatgpt") family = `ChatGPT-${rest.shift() ?? ""}`;
  const words = rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1));
  return [family, ...words].join(" ");
}

/**
 * The chat models in an OpenAI model list, newest first. Drops non-chat
 * kinds and dated snapshots whose undated alias is also listed.
 */
export function mapOpenAiModels(entries: OpenAiModelEntry[]): AiModelDef[] {
  const chat = entries.filter(
    (m) =>
      OPENAI_CHAT_ID.test(m.id) &&
      !OPENAI_PRO_SUFFIX.test(m.id) &&
      !OPENAI_NON_CHAT_FRAGMENTS.some((fragment) => m.id.includes(fragment)),
  );
  const ids = new Set(chat.map((m) => m.id));
  return chat
    .filter((m) => {
      const alias = m.id.replace(SNAPSHOT_SUFFIX, "");
      return alias === m.id || !ids.has(alias);
    })
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0) || a.id.localeCompare(b.id))
    .map((m) => chatModel(m.id, openAiModelName(m.id), OPENAI_DEFAULT_CONTEXT_WINDOW));
}

/** The models in an Anthropic model list, newest first. */
export function mapAnthropicModels(entries: AnthropicModelEntry[]): AiModelDef[] {
  const createdAt = (m: AnthropicModelEntry) => Date.parse(m.created_at ?? "") || 0;
  return entries
    .filter((m) => m.type === "model")
    .sort((a, b) => createdAt(b) - createdAt(a) || a.id.localeCompare(b.id))
    .map((m) =>
      chatModel(
        m.id,
        m.display_name || m.id,
        m.max_input_tokens ?? ANTHROPIC_DEFAULT_CONTEXT_WINDOW,
      ),
    );
}
