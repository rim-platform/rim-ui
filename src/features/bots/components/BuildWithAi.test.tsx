import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { AiChatRequest, AiStreamChunk } from "../../agent/providers/types";
import { callsTo, routeRequests } from "../../conversations/__fixtures__/conversations";

const requestMock = vi.fn();
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

let platform: "desktop" | "web" = "desktop";
vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({ platform }),
}));

/** The scripted provider's answers, one per call, and the requests it got. */
let answers: string[] = [];
const requests: AiChatRequest[] = [];
let keySet = true;
vi.mock("../../agent/providers/configuredProvider", () => ({
  NO_API_KEY: "no-api-key",
  providerKeyConfigured: async () => keySet,
  configuredProvider: async () => ({
    modelId: "scripted-model",
    provider: {
      config: { id: "anthropic", name: "Anthropic", models: [] },
      chat: (request: AiChatRequest) => {
        requests.push(structuredClone(request));
        const text = answers.shift() ?? "";
        return (async function* (): AsyncGenerator<AiStreamChunk> {
          yield { kind: "text_delta", text };
          yield { kind: "done", usage: { inputTokens: 1, outputTokens: 1 } };
        })();
      },
    },
  }),
}));

import { BuildWithAi } from "./BuildWithAi";

const GOOD = {
  version: 1,
  rules: [{ when: [{ field: "status", equals: "failed" }], post: "Failed on {host}" }],
};
const SAMPLE = { headers: "X-Event: backup", body: '{"status":"failed","host":"db-1"}' };

function serve() {
  routeRequests(requestMock, {
    "query PreviewWebhookFormat": (v) => {
      const template = v.template as { rules: { post: string }[] };
      return {
        previewWebhookFormat: template.rules[0]?.post.includes("{")
          ? { outcome: "POSTS", rule: 1, text: "Failed on db-1", link: null }
          : { outcome: "FORMAT_REFUSED", rule: 1, reason: "`post` is blank." },
      };
    },
  });
}

function build(opts: { hasRules?: boolean; sample?: typeof SAMPLE } = {}) {
  const onDraft = vi.fn();
  render(
    <BuildWithAi
      serverId="ws-1"
      sample={opts.sample ?? SAMPLE}
      hasRules={opts.hasRules ?? false}
      onDraft={onDraft}
    />,
  );
  fireEvent.change(screen.getByLabelText("What should it post?"), {
    target: { value: "Say which host's backup failed" },
  });
  return onDraft;
}

beforeEach(() => {
  requestMock.mockReset();
  requests.length = 0;
  answers = [];
  platform = "desktop";
  keySet = true;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async () => undefined) },
  });
  serve();
});

describe("Build with AI", () => {
  it("says where the sample goes before anything is sent, sends no tools, and fills a fenced answer as a draft", async () => {
    answers = ["```json\n" + JSON.stringify(GOOD) + "\n```"];
    const onDraft = build();
    const button = await screen.findByRole("button", { name: "Build with AI" });
    expect(
      screen.getByText("This sends what you wrote and the sample to Anthropic."),
    ).toBeInTheDocument();
    expect(requests).toEqual([]);
    fireEvent.click(button);
    await waitFor(() => expect(onDraft).toHaveBeenCalled());
    expect(requests).toHaveLength(1);
    expect("tools" in requests[0]).toBe(false);
    expect(requests[0].messages[0].content).toContain('{"status":"failed","host":"db-1"}');
    expect(onDraft.mock.calls[0][0][0].post).toBe("Failed on {host}");
    expect(await screen.findByText("Rule 1 matches. It would post:")).toBeInTheDocument();
    // Nothing is saved: the only request is the preview.
    expect(
      requestMock.mock.calls.every(([doc]) => String(doc).includes("query PreviewWebhookFormat")),
    ).toBe(true);
  });

  it("sends a refused answer back once with the reason, and takes the second", async () => {
    answers = [JSON.stringify({ version: 1, rules: [{ post: "" }] }), JSON.stringify(GOOD)];
    const onDraft = build();
    fireEvent.click(await screen.findByRole("button", { name: "Build with AI" }));
    await waitFor(() => expect(onDraft).toHaveBeenCalled());
    expect(requests).toHaveLength(2);
    const retry = requests[1].messages;
    expect(retry).toHaveLength(3);
    expect(retry[2].content).toContain("Rule 1: `post` is blank.");
  });

  it("shows the reason and leaves the editor alone when the second answer fails too", async () => {
    answers = ["Sure! Here is a format.", "{ not json"];
    const onDraft = build();
    fireEvent.click(await screen.findByRole("button", { name: "Build with AI" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The answer didn't make a format: The answer isn't JSON.",
    );
    expect(requests).toHaveLength(2);
    expect(onDraft).not.toHaveBeenCalled();
    expect(callsTo(requestMock, "query PreviewWebhookFormat")).toEqual([]);
  });

  it("asks before replacing rules someone already wrote", async () => {
    answers = [JSON.stringify(GOOD)];
    const onDraft = build({ hasRules: true });
    fireEvent.click(await screen.findByRole("button", { name: "Build with AI" }));
    fireEvent.click(await screen.findByRole("button", { name: "Replace my rules" }));
    expect(onDraft).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Replace my rules" })).not.toBeInTheDocument();
  });

  it("asks for a sample first", async () => {
    build({ sample: { headers: "", body: "" } });
    expect(await screen.findByRole("button", { name: "Build with AI" })).toBeDisabled();
    expect(screen.getByText(/Add a sample in Try it first/)).toBeInTheDocument();
  });

  it("offers only Copy prompt on the web, with the sample in what it copies", async () => {
    platform = "web";
    build();
    expect(screen.queryByRole("button", { name: "Build with AI" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a key in Settings" })).not.toBeInTheDocument();
    expect(
      screen.getByText(/The prompt holds the sample, which goes wherever you paste it\./),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
    const writeText = navigator.clipboard.writeText as ReturnType<typeof vi.fn>;
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(String(writeText.mock.calls[0][0])).toContain('{"status":"failed","host":"db-1"}');
    expect(requests).toEqual([]);
  });

  it("offers Copy prompt and the way to Settings on a desktop with no key", async () => {
    keySet = false;
    build();
    expect(
      await screen.findByRole("button", { name: "Add a key in Settings" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy prompt" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Build with AI" })).not.toBeInTheDocument();
  });
});
