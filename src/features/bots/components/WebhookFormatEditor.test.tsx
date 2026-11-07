import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";

import { queryKeys } from "../../../core/query/keys";
import { queryClient as globalQueryClient } from "../../../core/query/queryClient";
import { fakeServerInfo, serverInfoQueryClient } from "../../../test/serverInfo";
import { expectReachableByKeyboard } from "../../../test/keyboard";
import {
  INCOMING_WEBHOOKS,
  WEBHOOK_FORMATS,
  WEBHOOK_TEST_SESSIONS,
} from "../../updater/api/serverCapabilities";
import {
  callsTo,
  graphqlError,
  routeRequests,
} from "../../conversations/__fixtures__/conversations";

const requestMock = vi.fn();
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));
vi.mock("../webhookUrl", () => ({
  webhookUrl: async (token: string) => `https://rim.example/api/hooks/${token}`,
}));
vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({ platform: "web" }),
}));

import { NewWebhookDialog } from "./NewWebhookDialog";
import { WebhookFormatEditor } from "./WebhookFormatEditor";

const GITHUB = {
  key: "github",
  name: "GitHub",
  setupNote: "Paste this as the Payload URL in GitHub.",
  format: {
    version: 1,
    rules: [{ when: [{ header: "X-GitHub-Event", equals: "ping" }], post: "pong" }],
  },
  sampleHeaders: [{ name: "X-GitHub-Event", value: "ping" }],
  sampleBody: '{"zen":"hi"}',
};
const GRAFANA = {
  key: "grafana",
  name: "Grafana",
  setupNote: "Add a webhook contact point in Grafana.",
  format: {
    version: 1,
    rules: [{ when: [{ field: "status", equals: "firing" }], post: "Firing" }],
  },
  sampleHeaders: [],
  sampleBody: '{"status":"firing"}',
};

function hook(extra: Record<string, unknown> = {}) {
  return {
    id: "h-1",
    conversationId: "c-1",
    botUserId: "bot-1",
    preset: "PLAIN",
    template: null,
    createdAt: "2026-11-01T00:00:00Z",
    lastUsedAt: null,
    revokedAt: null,
    ...extra,
  };
}

/** A client whose server lists `capabilities`, which the capability checks read from the app's own client. */
function clientWith(capabilities: string[]) {
  globalQueryClient.setQueryData(
    queryKeys.serverInfo,
    fakeServerInfo({ bots: "ENABLED" }, { capabilities }),
  );
  return serverInfoQueryClient({ bots: "ENABLED" }, { capabilities });
}

function renderWith(ui: React.ReactElement, capabilities: string[]) {
  const qc = clientWith(capabilities);
  render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const ALL = [INCOMING_WEBHOOKS, WEBHOOK_FORMATS, WEBHOOK_TEST_SESSIONS];

function editor(
  target: React.ComponentProps<typeof WebhookFormatEditor>["target"],
  capabilities = ALL,
) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  renderWith(
    <WebhookFormatEditor serverId="ws-1" target={target} onSaved={onSaved} onClose={onClose} />,
    capabilities,
  );
  return { onSaved, onClose };
}

const NEW = { kind: "new" as const, conversationId: "c-1", botUserId: "bot-1" };

beforeEach(() => {
  requestMock.mockReset();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async () => undefined) },
  });
});
afterEach(() => {
  globalQueryClient.removeQueries({ queryKey: queryKeys.serverInfo });
});

describe("NewWebhookDialog", () => {
  const props = {
    serverId: "ws-1",
    channel: {
      id: "c-1",
      serverId: "ws-1",
      title: "ops",
      isPrivate: false,
    } as React.ComponentProps<typeof NewWebhookDialog>["channel"],
    bots: [{ userId: "bot-1", name: "Deploys" }] as React.ComponentProps<
      typeof NewWebhookDialog
    >["bots"],
  };

  it("offers Plain and GitHub as a preset on a host without formats, and asks for no formats", async () => {
    routeRequests(requestMock, {});
    renderWith(<NewWebhookDialog {...props} onCreated={vi.fn()} onClose={vi.fn()} />, [
      INCOMING_WEBHOOKS,
    ]);
    const select = await screen.findByLabelText("Preset");
    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Plain", "GitHub"]);
    expect(callsTo(requestMock, "query WebhookFormats")).toEqual([]);
  });

  it("offers each ready-made format and Custom, and sends a copy of Grafana's as the template", async () => {
    const onCreated = vi.fn();
    routeRequests(requestMock, {
      "query WebhookFormats": () => ({ webhookFormats: [GITHUB, GRAFANA] }),
      "mutation CreateIncomingWebhookWithFormat": () => ({
        createIncomingWebhook: { webhook: hook({ id: "h-9" }), token: "rimhook_T" },
      }),
    });
    renderWith(<NewWebhookDialog {...props} onCreated={onCreated} onClose={vi.fn()} />, ALL);
    const select = await screen.findByLabelText("Format");
    await waitFor(() =>
      expect(
        within(select)
          .getAllByRole("option")
          .map((o) => o.textContent),
      ).toEqual(["Plain", "GitHub", "Grafana", "Custom"]),
    );
    fireEvent.change(select, { target: { value: "grafana" } });
    fireEvent.click(screen.getByRole("button", { name: "Create webhook" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(callsTo(requestMock, "mutation CreateIncomingWebhookWithFormat")).toEqual([
      {
        input: {
          conversationId: "c-1",
          botUserId: "bot-1",
          preset: "PLAIN",
          template: GRAFANA.format,
        },
      },
    ]);
    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        setupNote: GRAFANA.setupNote,
        url: "https://rim.example/api/hooks/rimhook_T",
      }),
    );
  });

  it("sends GitHub as the preset, as before, with the host's setup note", async () => {
    const onCreated = vi.fn();
    routeRequests(requestMock, {
      "query WebhookFormats": () => ({ webhookFormats: [GITHUB, GRAFANA] }),
      "mutation CreateIncomingWebhook(": () => ({
        createIncomingWebhook: { webhook: hook(), token: "rimhook_T" },
      }),
    });
    renderWith(<NewWebhookDialog {...props} onCreated={onCreated} onClose={vi.fn()} />, ALL);
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Grafana" })).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText("Format"), { target: { value: "GITHUB" } });
    fireEvent.click(screen.getByRole("button", { name: "Create webhook" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(callsTo(requestMock, "mutation CreateIncomingWebhook(")[0]).toEqual({
      input: { conversationId: "c-1", botUserId: "bot-1", preset: "GITHUB" },
    });
    expect(onCreated.mock.calls[0][0].setupNote).toBe(GITHUB.setupNote);
  });

  it("opens the editor for Custom", async () => {
    routeRequests(requestMock, {
      "query WebhookFormats": () => ({ webhookFormats: [GITHUB, GRAFANA] }),
    });
    renderWith(<NewWebhookDialog {...props} onCreated={vi.fn()} onClose={vi.fn()} />, ALL);
    await waitFor(() => expect(screen.getByRole("option", { name: "Custom" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Format"), { target: { value: "custom" } });
    fireEvent.click(screen.getByRole("button", { name: "Write the format" }));
    expect(await screen.findByRole("heading", { name: "Rule 1" })).toBeInTheDocument();
  });
});

describe("WebhookFormatEditor", () => {
  function serve(extra: Record<string, (v: Record<string, unknown>) => unknown> = {}) {
    routeRequests(requestMock, {
      "query WebhookFormats": () => ({ webhookFormats: [GITHUB, GRAFANA] }),
      ...extra,
    });
  }

  it("is reachable from the keyboard: rules, conditions, moving, Try it and saving", async () => {
    serve();
    editor(NEW);
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Rule 1" });
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Add condition" })[0]);
    const dialog = screen.getByRole("dialog");
    await expectReachableByKeyboard(user, [
      within(dialog).getByRole("button", { name: "Move rule 1 down" }),
      within(dialog).getByRole("button", { name: "Move rule 2 up" }),
      within(dialog).getByRole("button", { name: "Remove rule 2" }),
      within(dialog).getByLabelText("Rule 1, condition 1: what it tests"),
      within(dialog).getByLabelText("Rule 1, condition 1: field"),
      within(dialog).getByLabelText("Rule 1, condition 1: equals"),
      within(dialog).getAllByLabelText("Post")[0],
      within(dialog).getByRole("button", { name: "Try" }),
      within(dialog).getByRole("button", { name: "Start test URL" }),
      within(dialog).getByRole("button", { name: "Create webhook" }),
    ]);
  });

  it("moves a rule with its buttons", async () => {
    serve();
    editor(NEW);
    await screen.findByRole("heading", { name: "Rule 1" });
    fireEvent.change(screen.getAllByLabelText("Post")[0], { target: { value: "first" } });
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    fireEvent.change(screen.getAllByLabelText("Post")[1], { target: { value: "second" } });
    fireEvent.click(screen.getByRole("button", { name: "Move rule 2 up" }));
    expect(screen.getAllByLabelText("Post").map((p) => (p as HTMLTextAreaElement).value)).toEqual([
      "second",
      "first",
    ]);
  });

  it("says each outcome of Try it", async () => {
    let answer: Record<string, unknown> = {};
    serve({ "query PreviewWebhookFormat": () => ({ previewWebhookFormat: answer }) });
    editor(NEW);
    await screen.findByRole("heading", { name: "Rule 1" });
    const cases: [Record<string, unknown>, RegExp][] = [
      [
        { outcome: "POSTS", rule: 2, text: "**Deployed** v2", link: null },
        /Rule 2 matches\. It would post:/,
      ],
      [{ outcome: "NO_RULE" }, /No rule matches, so nothing would post\./],
      [
        { outcome: "NO_VALUE", rule: 2, placeholder: "pull_request.title" },
        /Rule 2 matches, but `pull_request\.title` has no value, so nothing would post\./,
      ],
    ];
    for (const [preview, said] of cases) {
      answer = preview;
      fireEvent.click(screen.getByRole("button", { name: "Try" }));
      expect(await screen.findByText(said)).toBeInTheDocument();
    }
    answer = { outcome: "POSTS", rule: 1, text: "**Deployed** v2", link: null };
    fireEvent.click(screen.getByRole("button", { name: "Try" }));
    expect(await screen.findByText("Deployed", { selector: "strong" })).toBeInTheDocument();
  });

  it("puts a refusal beside the rule it names, from Try it and from saving", async () => {
    serve({
      "query PreviewWebhookFormat": () => ({
        previewWebhookFormat: { outcome: "FORMAT_REFUSED", rule: 2, reason: "`post` is blank." },
      }),
      "mutation CreateIncomingWebhookWithFormat": () => {
        throw graphqlError("VALIDATION", "Rule 2: A `{` has no `}`. Write `{{` for a brace.");
      },
    });
    editor(NEW);
    await screen.findByRole("heading", { name: "Rule 1" });
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    fireEvent.click(screen.getByRole("button", { name: "Try" }));
    const second = (await screen.findByRole("heading", { name: "Rule 2" })).closest("li")!;
    expect(await within(second).findByRole("alert")).toHaveTextContent("`post` is blank.");
    const first = screen.getByRole("heading", { name: "Rule 1" }).closest("li")!;
    expect(within(first).queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create webhook" }));
    await waitFor(() =>
      expect(within(second).getByRole("alert")).toHaveTextContent("A `{` has no `}`."),
    );
  });

  it("copies the format as JSON and pastes it back the same", async () => {
    serve();
    editor(NEW);
    await screen.findByRole("option", { name: "GitHub" });
    fireEvent.change(screen.getByLabelText("Start from"), { target: { value: "github" } });
    fireEvent.click(screen.getByRole("button", { name: "Start from this" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy as JSON" }));
    const writeText = navigator.clipboard.writeText as ReturnType<typeof vi.fn>;
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = String(writeText.mock.calls[0][0]);
    expect(JSON.parse(copied)).toEqual(GITHUB.format);
    // Fills Try it with the format's sample too.
    expect(screen.getByLabelText("Body")).toHaveValue(GITHUB.sampleBody);

    fireEvent.change(screen.getByLabelText("Start from"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Replace the rules with this" }));
    expect(screen.getAllByLabelText("Post")[0]).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Paste JSON" }));
    fireEvent.change(screen.getByLabelText("A format's JSON"), { target: { value: copied } });
    fireEvent.click(screen.getByRole("button", { name: "Replace the rules with this JSON" }));
    expect(screen.getAllByLabelText("Post")[0]).toHaveValue("pong");
    fireEvent.click(screen.getByRole("button", { name: /^(Copy as JSON|Copied)$/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText.mock.calls[1][0]).toBe(copied);
  });

  it("refuses pasted JSON that isn't a format, naming why", async () => {
    serve();
    editor(NEW);
    await screen.findByRole("heading", { name: "Rule 1" });
    fireEvent.click(screen.getByRole("button", { name: "Paste JSON" }));
    fireEvent.change(screen.getByLabelText("A format's JSON"), {
      target: { value: '{"version":1,"rules":[{"post":"x","when":[{"field":"a","equal":"b"}]}]}' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Replace the rules with this JSON" }));
    expect(await screen.findByText(/no key `equal`/)).toBeInTheDocument();
  });

  it("opens an unedited GitHub webhook as a copy and says it stops getting updates", async () => {
    const saved: unknown[] = [];
    serve({
      "mutation UpdateIncomingWebhookFormat": (v) => {
        saved.push(v);
        return { updateIncomingWebhookFormat: hook({ template: GITHUB.format }) };
      },
    });
    const { onSaved } = editor({ kind: "edit", webhook: hook({ preset: "GITHUB" }) as never });
    expect(await screen.findByText(/stops getting RIM's updates/)).toBeInTheDocument();
    expect(screen.getAllByLabelText("Post")[0]).toHaveValue("pong");
    expect(screen.getByText("The URL stays the same.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save format" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ kind: "updated" }));
    expect(saved).toEqual([
      { id: "h-1", preset: "PLAIN", template: GITHUB.format, workspaceId: "ws-1" },
    ]);
  });

  it("shows no delivery log on a host with formats but no test sessions, and Try it still works", async () => {
    serve({
      "query PreviewWebhookFormat": () => ({ previewWebhookFormat: { outcome: "NO_RULE" } }),
    });
    editor(NEW, [INCOMING_WEBHOOKS, WEBHOOK_FORMATS]);
    await screen.findByRole("heading", { name: "Rule 1" });
    expect(screen.queryByRole("button", { name: "Start test URL" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try" }));
    expect(await screen.findByText(/No rule matches/)).toBeInTheDocument();
  });
});

describe("the delivery log", () => {
  const delivery = (id: number, extra: Record<string, unknown> = {}) => ({
    id,
    receivedAt: "2026-11-07T10:00:00Z",
    contentType: "application/json",
    headers: [{ name: "x-github-event", value: "push" }],
    bodyState: "TEXT",
    body: '{"ref":"main"}',
    ...extra,
  });

  it("starts a test URL, lists what arrives with its outcome under the draft, and saving keeps the URL", async () => {
    let previews = 0;
    routeRequests(requestMock, {
      "query WebhookFormats": () => ({ webhookFormats: [GITHUB] }),
      "mutation StartWebhookTestSession": () => ({
        startWebhookTestSession: {
          id: "s-1",
          token: "rimhook_TEST",
          expiresAt: "2026-11-07T11:00:00Z",
        },
      }),
      "query WebhookTestDeliveries": (v) => ({
        webhookTestDeliveries: {
          expiresAt: "2026-11-07T11:00:00Z",
          deliveries:
            v.after === 0
              ? [
                  delivery(1),
                  delivery(2, {
                    contentType: "application/x-www-form-urlencoded",
                    body: "payload=%7B%7D",
                    headers: [],
                  }),
                ]
              : [],
        },
      }),
      "query PreviewWebhookFormat": (v) => {
        previews += 1;
        return {
          previewWebhookFormat:
            v.body === "payload=%7B%7D"
              ? { outcome: "BODY_REFUSED", reason: "The body must be JSON." }
              : { outcome: "NO_RULE" },
        };
      },
      "mutation CreateIncomingWebhookKeepingTestUrl": () => ({
        createIncomingWebhook: { webhook: hook({ id: "h-9" }), token: "", keptTestUrl: true },
      }),
      "mutation EndWebhookTestSession": () => ({ endWebhookTestSession: true }),
    });
    const { onSaved } = editor(NEW);
    fireEvent.click(await screen.findByRole("button", { name: "Start test URL" }));
    expect(
      await screen.findByText("https://rim.example/api/hooks/rimhook_TEST"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Nothing posts to the channel yet\. When you save, this URL starts posting/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "What arrives is held in memory for up to an hour, and only you can see it.",
      ),
    ).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "Deliveries, newest first" });
    await waitFor(() => expect(list.children).toHaveLength(2), { timeout: 3000 });
    await waitFor(() => expect(within(list).getByText(/Not JSON/)).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(within(list).getByText(/push · No rule matches/)).toBeInTheDocument();
    expect(within(list).getByText(/This is form-encoded/)).toBeInTheDocument();
    expect(screen.getByText("2 new deliveries")).toBeInTheDocument();

    // Fixing the draft works every row out again.
    const before = previews;
    fireEvent.change(screen.getAllByLabelText("Post")[0], { target: { value: "pushed" } });
    await waitFor(() => expect(previews).toBeGreaterThan(before), { timeout: 3000 });

    fireEvent.click(screen.getByRole("button", { name: "Create webhook" }));
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith({
        kind: "created",
        id: "h-9",
        url: "https://rim.example/api/hooks/rimhook_TEST",
        keptTestUrl: true,
      }),
    );
    expect(callsTo(requestMock, "mutation CreateIncomingWebhookKeepingTestUrl")[0]).toEqual({
      input: expect.objectContaining({ testSessionId: "s-1" }),
    });
  });

  it("ends the session when the editor closes", async () => {
    routeRequests(requestMock, {
      "query WebhookFormats": () => ({ webhookFormats: [GITHUB] }),
      "mutation StartWebhookTestSession": () => ({
        startWebhookTestSession: { id: "s-2", token: null, expiresAt: "2026-11-07T11:00:00Z" },
      }),
      "query WebhookTestDeliveries": () => ({
        webhookTestDeliveries: { expiresAt: "2026-11-07T11:00:00Z", deliveries: [] },
      }),
      "mutation EndWebhookTestSession": () => ({ endWebhookTestSession: true }),
    });
    const qc = clientWith(ALL);
    const { unmount } = render(
      <QueryClientProvider client={qc}>
        <WebhookFormatEditor
          serverId="ws-1"
          target={{ kind: "edit", webhook: hook({ template: GITHUB.format }) as never }}
          onSaved={vi.fn()}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Listen" }));
    expect(
      await screen.findByText(/Deliveries keep posting under the saved format/),
    ).toBeInTheDocument();
    expect(callsTo(requestMock, "mutation StartWebhookTestSession")[0]).toEqual({
      serverId: "ws-1",
      webhookId: "h-1",
    });
    unmount();
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation EndWebhookTestSession")).toEqual([
        { sessionId: "s-2", workspaceId: "ws-1" },
      ]),
    );
  });

  it("says when the session ended and offers to start again", async () => {
    routeRequests(requestMock, {
      "query WebhookFormats": () => ({ webhookFormats: [GITHUB] }),
      "mutation StartWebhookTestSession": () => ({
        startWebhookTestSession: {
          id: "s-3",
          token: "rimhook_GONE",
          expiresAt: "2026-11-07T11:00:00Z",
        },
      }),
      "query WebhookTestDeliveries": () => {
        throw graphqlError("NOT_FOUND", "Not found");
      },
      "mutation EndWebhookTestSession": () => ({ endWebhookTestSession: true }),
    });
    editor(NEW);
    fireEvent.click(await screen.findByRole("button", { name: "Start test URL" }));
    expect(
      await screen.findByText(/This test URL has ended\. Starting again gives a new URL\./),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start a new test URL" })).toBeInTheDocument();
  });

  it("shows a hostile body as plain text with its invisible characters named", async () => {
    routeRequests(requestMock, {
      "query WebhookFormats": () => ({ webhookFormats: [GITHUB] }),
      "mutation StartWebhookTestSession": () => ({
        startWebhookTestSession: {
          id: "s-4",
          token: "rimhook_X",
          expiresAt: "2026-11-07T11:00:00Z",
        },
      }),
      "query WebhookTestDeliveries": (v) => ({
        webhookTestDeliveries: {
          expiresAt: "2026-11-07T11:00:00Z",
          deliveries:
            v.after === 0 ? [delivery(1, { body: "<img src=x onerror=alert(1)> **bold** ‮" })] : [],
        },
      }),
      "query PreviewWebhookFormat": () => ({ previewWebhookFormat: { outcome: "NO_RULE" } }),
      "mutation EndWebhookTestSession": () => ({ endWebhookTestSession: true }),
    });
    editor(NEW);
    fireEvent.click(await screen.findByRole("button", { name: "Start test URL" }));
    const list = await screen.findByRole("list", { name: "Deliveries, newest first" });
    const body = await within(list).findByText(/<img src=x onerror=alert\(1\)>/);
    expect(body.tagName).toBe("PRE");
    expect(document.querySelector("img[src='x']")).toBeNull();
    expect(body.textContent).not.toContain("‮");
  });
});
