import { describe, expect, it } from "vitest";

import {
  mapAnthropicModels,
  mapOpenAiModels,
  openAiModelName,
  type AnthropicModelEntry,
  type OpenAiModelEntry,
} from "./liveModels";

/**
 * An OpenAI `/v1/models` page: chat models, every excluded kind, a snapshot
 * whose alias is listed (`gpt-5.4-2026-03-05`) and one whose alias is not.
 */
const OPENAI_MODELS: OpenAiModelEntry[] = [
  { id: "gpt-4o", created: 1_715_000_000 },
  { id: "gpt-5.4", created: 1_772_000_000 },
  { id: "gpt-5.4-2026-03-05", created: 1_772_600_000 },
  { id: "gpt-5.5", created: 1_780_000_000 },
  { id: "gpt-5.4-mini", created: 1_773_000_000 },
  { id: "gpt-5.2-2025-12-11", created: 1_765_000_000 },
  { id: "o4-mini", created: 1_744_000_000 },
  { id: "chatgpt-4o-latest", created: 1_723_000_000 },
  { id: "gpt-realtime", created: 1_781_000_000 },
  { id: "gpt-4o-audio-preview", created: 1_781_000_000 },
  { id: "gpt-4o-transcribe", created: 1_781_000_000 },
  { id: "gpt-4o-mini-tts", created: 1_781_000_000 },
  { id: "gpt-image-1", created: 1_781_000_000 },
  { id: "omni-moderation-latest", created: 1_781_000_000 },
  { id: "text-embedding-3-large", created: 1_781_000_000 },
  { id: "gpt-4o-search-preview", created: 1_781_000_000 },
  { id: "gpt-3.5-turbo-instruct", created: 1_781_000_000 },
  { id: "gpt-5.3-codex", created: 1_781_000_000 },
  { id: "o3-deep-research", created: 1_781_000_000 },
  { id: "gpt-5-pro", created: 1_781_000_000 },
  { id: "dall-e-3", created: 1_781_000_000 },
  { id: "whisper-1", created: 1_781_000_000 },
];

describe("mapOpenAiModels", () => {
  it("keeps chat models newest first, without other kinds or aliased snapshots", () => {
    expect(mapOpenAiModels(OPENAI_MODELS).map((m) => m.id)).toEqual([
      "gpt-5.5",
      "gpt-5.4-mini",
      "gpt-5.4",
      "gpt-5.2-2025-12-11",
      "o4-mini",
      "chatgpt-4o-latest",
      "gpt-4o",
    ]);
  });

  it("names entries from their ids with the default context window", () => {
    expect(mapOpenAiModels([{ id: "gpt-5.4-mini", created: 1 }])).toEqual([
      {
        id: "gpt-5.4-mini",
        name: "GPT-5.4 Mini",
        contextWindow: 128_000,
        supportsTools: true,
        supportsStreaming: true,
      },
    ]);
  });
});

describe("openAiModelName", () => {
  it.each([
    ["gpt-5.5", "GPT-5.5"],
    ["gpt-5.4-nano", "GPT-5.4 Nano"],
    ["gpt-5-chat-latest", "GPT-5 Chat Latest"],
    ["o4-mini", "o4 Mini"],
    ["chatgpt-4o-latest", "ChatGPT-4o Latest"],
  ])("%s reads as %s", (id, name) => {
    expect(openAiModelName(id)).toBe(name);
  });
});

describe("mapAnthropicModels", () => {
  const entries: AnthropicModelEntry[] = [
    {
      id: "claude-haiku-4-5",
      display_name: "Claude Haiku 4.5",
      type: "model",
      created_at: "2025-10-15T00:00:00Z",
    },
    {
      id: "claude-opus-5-5",
      display_name: "Claude Opus 5.5",
      type: "model",
      created_at: "2026-09-01T00:00:00Z",
      max_input_tokens: 1_000_000,
    },
    {
      id: "claude-sonnet-5-5",
      display_name: "",
      type: "model",
      created_at: "2026-08-01T00:00:00Z",
    },
    { id: "not-a-model", display_name: "Other", type: "other", created_at: "2026-10-01T00:00:00Z" },
  ];

  it("keeps models newest first", () => {
    expect(mapAnthropicModels(entries).map((m) => m.id)).toEqual([
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-haiku-4-5",
    ]);
  });

  it("takes the context window from the API and falls back to the default", () => {
    const [opus, sonnet] = mapAnthropicModels(entries);
    expect(opus).toMatchObject({ name: "Claude Opus 5.5", contextWindow: 1_000_000 });
    expect(sonnet).toMatchObject({ name: "claude-sonnet-5-5", contextWindow: 200_000 });
  });
});
