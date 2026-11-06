import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";

import { expectReachableByKeyboard } from "../../../test/keyboard";
import { serverInfoQueryClient } from "../../../test/serverInfo";
import { INCOMING_WEBHOOKS } from "../../updater/api/serverCapabilities";
import {
  callsTo,
  graphqlError,
  makeConversation,
  routeRequests,
} from "../../conversations/__fixtures__/conversations";

const requestMock = vi.fn();
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));
vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("../webhookUrl", () => ({
  webhookUrl: async (token: string) => `https://rim.example/api/hooks/${token}`,
}));

import { BotsSettings } from "./BotsSettings";

const SECRET = "rimbot_SECRETSECRETSECRETSECRETSECRETSECRETSECRE";

function bot(n: number, extra: Record<string, unknown> = {}) {
  return {
    userId: `bot-${n}`,
    serverId: "ws-1",
    name: `Bot ${n}`,
    runBy: `Team ${n}`,
    readsGoTo: `Server ${n}`,
    addedByName: "Ivana",
    createdAt: "2026-11-01T00:00:00Z",
    deactivatedAt: null,
    ...extra,
  };
}

function renderSettings(opts: { capabilities?: string[] } = {}): QueryClient {
  const qc = serverInfoQueryClient({}, { capabilities: opts.capabilities ?? [] });
  render(
    <QueryClientProvider client={qc}>
      <BotsSettings serverId="ws-1" />
    </QueryClientProvider>,
  );
  return qc;
}

function serve(
  bots: unknown[],
  extra: Record<string, (v: Record<string, unknown>) => unknown> = {},
) {
  routeRequests(requestMock, {
    "query Bots(": () => ({ bots }),
    ...extra,
  });
}

/** A button once it is enabled; the page disables New bot and New webhook while it loads. */
async function enabledButton(name: string) {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}

/**
 * Presses Tab from where focus is inside `dialog` until it comes back round, and returns what
 * it reached; every stop must be inside the dialog.
 */
async function tabWithin(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
  const reached: HTMLElement[] = [document.activeElement as HTMLElement];
  for (let i = 0; i < 150; i += 1) {
    await user.tab();
    const active = document.activeElement as HTMLElement;
    expect(dialog).toContainElement(active);
    if (reached.includes(active)) break;
    reached.push(active);
  }
  return reached;
}

async function openNewBot() {
  fireEvent.click(await enabledButton("New bot"));
}

describe("BotsSettings", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("says what a bot is and lists each bot with its statements and actions", async () => {
    serve([bot(1)]);
    renderSettings();
    expect(
      await screen.findByRole("heading", { name: "Bots in this workspace" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/A bot is an account for a program/)).toBeInTheDocument();
    const row = (await screen.findByText("Bot 1")).closest("li")!;
    expect(within(row).getByTestId("bot-badge")).toBeInTheDocument();
    expect(within(row).getByText("Team 1")).toBeInTheDocument();
    expect(within(row).getByText("Server 1")).toBeInTheDocument();
    expect(within(row).getByText("Ivana")).toBeInTheDocument();
    for (const name of ["Edit", "Tokens", "Channels", "Deactivate"]) {
      expect(within(row).getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("says there are no bots yet and offers New bot", async () => {
    serve([]);
    renderSettings();
    expect(await screen.findByText("No bots yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New bot" })).toBeEnabled();
  });

  it("shows a load failure with a retry that reads again", async () => {
    let fail = true;
    routeRequests(requestMock, {
      "query Bots(": () => {
        if (fail) throw graphqlError("FORBIDDEN", "Not for you");
        return { bots: [] };
      },
    });
    renderSettings();
    expect(await screen.findByText("Not for you")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No bots yet.")).toBeInTheDocument();
  });

  it("disables New bot at 25 active bots and says why", async () => {
    serve(Array.from({ length: 25 }, (_, i) => bot(i)));
    renderSettings();
    await screen.findByText("Bot 0");
    expect(screen.getByRole("button", { name: "New bot" })).toBeDisabled();
    expect(screen.getByText(/at most 25 active bots/)).toBeInTheDocument();
  });

  it("keeps deactivated bots in a collapsed list without actions", async () => {
    serve([bot(1), bot(2, { deactivatedAt: "2026-11-02T00:00:00Z" })]);
    renderSettings();
    await screen.findByText("Bot 1");
    const details = screen.getByText(/Deactivated bots \(1\)/).closest("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(within(details).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("asks before deactivating, in danger words, and sends nothing on Cancel", async () => {
    serve([bot(1)], { "mutation DeactivateBot": () => ({ deactivateBot: bot(1) }) });
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Deactivate" }));
    expect(
      screen.getByText(
        "Its tokens and webhooks stop working and it leaves the workspace. Its messages stay. This can't be undone.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(callsTo(requestMock, "mutation DeactivateBot")).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Deactivate" }));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation DeactivateBot")).toEqual([{ botUserId: "bot-1" }]),
    );
  });

  describe("New bot", () => {
    it("requires both statements, counts them and shows a server refusal inline", async () => {
      serve([], {
        "mutation CreateBot": () => {
          throw graphqlError("VALIDATION", "A name like that is taken");
        },
      });
      renderSettings();
      await openNewBot();
      const submit = screen.getByRole("button", { name: "Add bot" });
      expect(submit).toBeDisabled();
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Helper" } });
      fireEvent.change(screen.getByLabelText("Who runs it"), { target: { value: "Us" } });
      expect(submit).toBeDisabled();
      fireEvent.change(screen.getByLabelText("Where what it reads goes"), {
        target: { value: "Here" },
      });
      expect(screen.getByText("2 / 200")).toBeInTheDocument();
      expect(screen.getByText("4 / 200")).toBeInTheDocument();
      expect(screen.getAllByText(/People in its channels see this/)).toHaveLength(2);
      fireEvent.click(submit);
      expect(await screen.findByRole("alert")).toHaveTextContent("A name like that is taken");
    });

    it("shows the token once, closes only on Done, and keeps it out of the caches", async () => {
      serve([], {
        "mutation CreateBot": () => ({ createBot: { bot: bot(1), token: SECRET } }),
      });
      const qc = renderSettings();
      await openNewBot();
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Bot 1" } });
      fireEvent.change(screen.getByLabelText("Who runs it"), { target: { value: "Us" } });
      fireEvent.change(screen.getByLabelText("Where what it reads goes"), {
        target: { value: "Here" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Add bot" }));

      const field = await screen.findByDisplayValue(SECRET);
      expect(field).toHaveAttribute("readonly");
      expect(screen.getByText(/RIM won't show this again/)).toBeInTheDocument();

      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.getByDisplayValue(SECRET)).toBeInTheDocument();

      expect(
        JSON.stringify(
          qc
            .getQueryCache()
            .getAll()
            .map((q) => q.state.data),
        ),
      ).not.toContain(SECRET);
      expect(
        JSON.stringify(
          qc
            .getMutationCache()
            .getAll()
            .map((m) => m.state.data),
        ),
      ).not.toContain(SECRET);

      fireEvent.click(screen.getByRole("button", { name: "Done" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "New bot" })).toHaveFocus());
      expect(screen.queryByDisplayValue(SECRET)).not.toBeInTheDocument();
      expect(
        JSON.stringify(
          qc
            .getQueryCache()
            .getAll()
            .map((q) => q.state.data),
        ),
      ).not.toContain(SECRET);
    });
  });

  describe("Tokens", () => {
    const token = (n: number, extra: Record<string, unknown> = {}) => ({
      id: `t-${n}`,
      label: `ci-${n}`,
      createdAt: "2026-11-01T00:00:00Z",
      lastUsedAt: null,
      revokedAt: null,
      ...extra,
    });

    it("lists labels with 'Never' for an unused token and confirms before revoking", async () => {
      serve([bot(1)], {
        "query BotTokens": () => ({ botTokens: [token(1)] }),
        "mutation RevokeBotToken": () => ({ revokeBotToken: token(1) }),
      });
      renderSettings();
      fireEvent.click(await screen.findByRole("button", { name: "Tokens" }));
      expect(await screen.findByText("ci-1")).toBeInTheDocument();
      expect(screen.getByText(/Last used Never/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Revoke ci-1" }));
      expect(screen.getByText("Anything using it stops working.")).toBeInTheDocument();
      expect(callsTo(requestMock, "mutation RevokeBotToken")).toEqual([]);
      fireEvent.click(
        within(screen.getAllByRole("dialog")[1]).getByRole("button", { name: "Revoke" }),
      );
      await waitFor(() =>
        expect(callsTo(requestMock, "mutation RevokeBotToken")).toEqual([{ tokenId: "t-1" }]),
      );
    });

    it("disables New token at five active tokens and says why", async () => {
      serve([bot(1)], {
        "query BotTokens": () => ({ botTokens: [1, 2, 3, 4, 5].map((n) => token(n)) }),
      });
      renderSettings();
      fireEvent.click(await screen.findByRole("button", { name: "Tokens" }));
      await screen.findByText("ci-5");
      expect(screen.getByRole("button", { name: "New token" })).toBeDisabled();
      expect(screen.getByText(/at most 5 tokens/)).toBeInTheDocument();
    });

    it("shows a new token in place of the Tokens dialog, with no close icon and no Escape, and brings Tokens back on Done", async () => {
      serve([bot(1)], {
        "query BotTokens": () => ({ botTokens: [] }),
        "mutation CreateBotToken": () => ({
          createBotToken: { botToken: token(2), token: SECRET },
        }),
      });
      const qc = renderSettings();
      fireEvent.click(await screen.findByRole("button", { name: "Tokens" }));
      fireEvent.change(await screen.findByLabelText("New token label"), {
        target: { value: "ci" },
      });
      fireEvent.click(screen.getByRole("button", { name: "New token" }));
      expect(await screen.findByDisplayValue(SECRET)).toBeInTheDocument();
      // Only the show-once dialog is open, and it has no close icon.
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.getByDisplayValue(SECRET)).toBeInTheDocument();
      expect(
        JSON.stringify(
          qc
            .getMutationCache()
            .getAll()
            .map((m) => m.state.data),
        ),
      ).not.toContain(SECRET);

      fireEvent.click(screen.getByRole("button", { name: "Done" }));
      expect(screen.queryByDisplayValue(SECRET)).not.toBeInTheDocument();
      const tokens = await screen.findByRole("dialog", { name: "Tokens of Bot 1" });
      // Focus lands inside the Tokens dialog and Tab stays there.
      await waitFor(() => expect(tokens).toContainElement(document.activeElement as HTMLElement));
      const user = userEvent.setup();
      for (let i = 0; i < 12; i += 1) {
        await user.tab();
        expect(tokens).toContainElement(document.activeElement as HTMLElement);
      }
    });
  });

  describe("Channels", () => {
    const channels = [
      makeConversation({ id: "c-open", title: "general", memberIds: ["me"] }),
      makeConversation({ id: "c-in", title: "ops", memberIds: ["me", "bot-1"] }),
      makeConversation({ id: "c-priv", title: "secret", isPrivate: true, memberIds: ["me"] }),
      makeConversation({ id: "c-enc", title: "sealed", encryptedAt: "2026-10-01T00:00:00Z" }),
    ];

    function serveChannels(extra: Record<string, (v: Record<string, unknown>) => unknown> = {}) {
      serve([bot(1)], {
        "query BotChannels": () => ({
          channels: {
            items: channels,
            next: null,
            pageInfo: { hasNext: false },
          },
        }),
        ...extra,
      });
    }

    it("ticks where the bot is, marks private channels and leaves out encrypted ones", async () => {
      serveChannels();
      renderSettings();
      fireEvent.click(await screen.findByRole("button", { name: "Channels" }));
      expect(await screen.findByRole("checkbox", { name: /ops/ })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: /general/ })).not.toBeChecked();
      expect(screen.queryByText("sealed")).not.toBeInTheDocument();
      expect(screen.getByText(/lets it read that channel/)).toBeInTheDocument();
      expect(screen.getAllByText("Private")).toHaveLength(1);
      expect(screen.queryByText(/You are not in this private channel/)).not.toBeInTheDocument();
    });

    it("puts Save and Cancel before the list in Tab order", async () => {
      serveChannels();
      renderSettings();
      fireEvent.click(await screen.findByRole("button", { name: "Channels" }));
      await screen.findByRole("checkbox", { name: /ops/ });
      const dialog = screen.getByRole("dialog");
      const order = Array.from(
        dialog.querySelectorAll<HTMLElement>("button, input, [tabindex]"),
      ).map((el) => el.textContent || el.getAttribute("type"));
      expect(order.indexOf("Save")).toBeLessThan(order.indexOf("checkbox"));
      expect(order.indexOf("Cancel")).toBeLessThan(order.indexOf("checkbox"));
    });

    it("loads every page of the list and says when it was cut at 1,000", async () => {
      const many = (from: number, n: number) =>
        Array.from({ length: n }, (_, i) =>
          makeConversation({ id: `c-${from + i}`, title: `chan ${from + i}`, memberIds: ["me"] }),
        );
      const cursor = { createdAt: "2026-11-01T00:00:00Z", conversationId: "x" };
      serve([bot(1)], {
        "query BotChannels": (v) => {
          const page = v.cursor ? 2 : 1;
          return {
            channels: {
              items: many(page * 100, page === 1 ? 100 : 5),
              next: page === 1 ? cursor : null,
              pageInfo: { hasNext: page === 1 },
            },
          };
        },
      });
      renderSettings();
      fireEvent.click(await screen.findByRole("button", { name: "Channels" }));
      await screen.findByRole("checkbox", { name: /chan 204/ });
      expect(screen.getAllByRole("checkbox")).toHaveLength(105);
      expect(screen.queryByText(/The list was cut/)).not.toBeInTheDocument();
      expect(callsTo(requestMock, "query BotChannels")).toHaveLength(2);
    });

    it("stops at 1,000 channels and says so", async () => {
      serve([bot(1)], {
        "query BotChannels": () => ({
          channels: {
            items: Array.from({ length: 100 }, (_, i) =>
              makeConversation({ id: `c-${Math.random()}-${i}`, title: `c${i}`, memberIds: [] }),
            ),
            next: { createdAt: "2026-11-01T00:00:00Z", conversationId: "x" },
            pageInfo: { hasNext: true },
          },
        }),
      });
      renderSettings();
      fireEvent.click(await screen.findByRole("button", { name: "Channels" }));
      expect(await screen.findByText(/The list was cut after 1,000/)).toBeInTheDocument();
      expect(callsTo(requestMock, "query BotChannels")).toHaveLength(10);
    });

    it("adds and removes on Save, and names the channel that failed", async () => {
      serveChannels({
        "mutation AddConversationMembers": (v) => {
          if (v.conversationId === "c-priv") throw graphqlError("NOT_FOUND", "No such channel");
          return { addConversationMembers: channels[0] };
        },
        "mutation RemoveConversationMember": () => ({ removeConversationMember: true }),
      });
      renderSettings();
      fireEvent.click(await screen.findByRole("button", { name: "Channels" }));
      fireEvent.click(await screen.findByRole("checkbox", { name: /general/ }));
      fireEvent.click(screen.getByRole("checkbox", { name: /secret/ }));
      fireEvent.click(screen.getByRole("checkbox", { name: /ops/ }));
      expect(callsTo(requestMock, "mutation AddConversationMembers")).toEqual([]);
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("secret: No such channel");
      expect(callsTo(requestMock, "mutation AddConversationMembers")).toEqual([
        { serverId: "ws-1", conversationId: "c-open", userIds: ["bot-1"] },
        { serverId: "ws-1", conversationId: "c-priv", userIds: ["bot-1"] },
      ]);
      expect(callsTo(requestMock, "mutation RemoveConversationMember")).toEqual([
        { serverId: "ws-1", conversationId: "c-in", userId: "bot-1" },
      ]);
    });
  });

  describe("Incoming webhooks", () => {
    const hook = (extra: Record<string, unknown> = {}) => ({
      id: "h-1",
      conversationId: "c-open",
      botUserId: "bot-1",
      preset: "GITHUB",
      createdAt: "2026-11-01T00:00:00Z",
      lastUsedAt: null,
      revokedAt: null,
      ...extra,
    });
    const channelsHandler = () => ({
      channels: {
        next: null,
        pageInfo: { hasNext: false },
        items: [
          makeConversation({ id: "c-open", title: "general", memberIds: ["me"] }),
          makeConversation({ id: "c-free", title: "releases", memberIds: ["me"] }),
        ],
        pageInfo: { hasNext: false },
      },
    });

    it("is not shown, and not asked for, on a server without incoming_webhooks", async () => {
      serve([bot(1)], { "query BotChannels": channelsHandler });
      renderSettings({ capabilities: [] });
      await screen.findByText("Bot 1");
      expect(screen.queryByText("Incoming webhooks")).not.toBeInTheDocument();
      expect(callsTo(requestMock, "query IncomingWebhooks")).toEqual([]);
    });

    it("lists webhooks with channel, bot, preset and last use, and confirms before revoking", async () => {
      serve([bot(1)], {
        "query BotChannels": channelsHandler,
        "query IncomingWebhooks": () => ({
          incomingWebhooks: [hook(), hook({ id: "h-2", revokedAt: "x" })],
        }),
        "mutation RevokeIncomingWebhook": () => ({ revokeIncomingWebhook: hook() }),
      });
      renderSettings({ capabilities: [INCOMING_WEBHOOKS] });
      expect(await screen.findByRole("heading", { name: "Incoming webhooks" })).toBeInTheDocument();
      const row = (await screen.findByText(/general · Bot 1 · GitHub/)).closest("li")!;
      expect(within(row).getByText(/Last used Never/)).toBeInTheDocument();
      expect(screen.getByText(/keep it like a password/)).toBeInTheDocument();
      fireEvent.click(within(row).getByRole("button", { name: /Revoke/ }));
      expect(callsTo(requestMock, "mutation RevokeIncomingWebhook")).toEqual([]);
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Revoke" }));
      await waitFor(() =>
        expect(callsTo(requestMock, "mutation RevokeIncomingWebhook")).toEqual([{ id: "h-1" }]),
      );
    });

    async function createHook(preset: "Plain" | "GitHub") {
      serve([bot(1)], {
        "query BotChannels": channelsHandler,
        "query IncomingWebhooks": () => ({ incomingWebhooks: [hook()] }),
        "mutation CreateIncomingWebhook": () => ({
          createIncomingWebhook: { webhook: hook({ id: "h-9" }), token: "rimhook_TOKEN" },
        }),
      });
      renderSettings({ capabilities: [INCOMING_WEBHOOKS] });
      fireEvent.click(await enabledButton("New webhook"));
      const dialog = await screen.findByRole("dialog");
      const channelOptions = within(dialog)
        .getAllByRole("option")
        .map((o) => o.textContent);
      fireEvent.change(within(dialog).getByLabelText("Channel"), { target: { value: "c-free" } });
      fireEvent.change(within(dialog).getByLabelText("Preset"), {
        target: { value: preset === "GitHub" ? "GITHUB" : "PLAIN" },
      });
      fireEvent.click(within(dialog).getByRole("button", { name: "Create webhook" }));
      return channelOptions;
    }

    it("offers only channels without a webhook and shows the URL once, built from the server", async () => {
      const options = await createHook("Plain");
      expect(options).toEqual(["Choose a channel", "releases", "Bot 1", "Plain", "GitHub"]);
      expect(
        await screen.findByDisplayValue("https://rim.example/api/hooks/rimhook_TOKEN"),
      ).toBeInTheDocument();
      expect(callsTo(requestMock, "mutation CreateIncomingWebhook")).toEqual([
        { input: { conversationId: "c-free", botUserId: "bot-1", preset: "PLAIN" } },
      ]);
      expect(screen.queryByText(/Payload URL/)).not.toBeInTheDocument();
    });

    it("adds the GitHub steps only for the GitHub preset", async () => {
      await createHook("GitHub");
      expect(await screen.findByText(/paste this as the Payload URL/)).toBeInTheDocument();
      expect(screen.getByText(/application\/json, and leave Secret empty/)).toBeInTheDocument();
    });
  });

  describe("keyboard", () => {
    it("reaches every control of the Bots tab and its dialogs with Tab", async () => {
      serve([bot(1), bot(2, { deactivatedAt: "2026-11-02T00:00:00Z" })], {
        "query BotTokens": () => ({
          botTokens: [
            {
              id: "t-1",
              label: "ci",
              createdAt: "2026-11-01T00:00:00Z",
              lastUsedAt: null,
              revokedAt: null,
            },
          ],
        }),
        "query BotChannels": () => ({
          channels: {
            items: [
              makeConversation({ id: "c-1", title: "general", memberIds: ["me"] }),
              makeConversation({ id: "c-2", title: "releases", memberIds: ["me"] }),
            ],
            next: null,
            pageInfo: { hasNext: false },
          },
        }),
        "query IncomingWebhooks": () => ({
          incomingWebhooks: [
            {
              id: "h-1",
              conversationId: "c-1",
              botUserId: "bot-1",
              preset: "PLAIN",
              createdAt: "2026-11-01T00:00:00Z",
              lastUsedAt: null,
              revokedAt: null,
            },
          ],
        }),
      });
      renderSettings({ capabilities: [INCOMING_WEBHOOKS] });
      const user = userEvent.setup();
      await screen.findByText("Bot 1");
      await screen.findByText(/general · Bot 1 · Plain/);

      const buttons = (root: HTMLElement) =>
        within(root)
          .getAllByRole("button")
          .filter((b) => !b.hasAttribute("disabled"));
      const page = document.body;
      await expectReachableByKeyboard(user, [
        ...buttons(page).filter((b) => !b.closest("details")),
        screen.getByText(/Deactivated bots/),
      ]);

      // Each dialog: every control in it is reachable, and Tab stays inside it.
      for (const name of ["Edit", "Tokens", "Channels", "Deactivate"]) {
        fireEvent.click(
          within(screen.getByRole("list", { name: "Bots" })).getByRole("button", { name }),
        );
        const dialog = await screen.findByRole("dialog");
        await waitFor(() =>
          expect(dialog.querySelectorAll("button, input, select").length).toBeGreaterThan(1),
        );
        const targets = Array.from(
          dialog.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])"),
        );
        const reached = await tabWithin(user, dialog);
        expect(targets.filter((t) => !reached.includes(t))).toEqual([]);
        fireEvent.keyDown(document, { key: "Escape" });
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      }

      fireEvent.click(await enabledButton("New webhook"));
      const webhook = await screen.findByRole("dialog");
      const reached = await tabWithin(user, webhook);
      const targets = Array.from(
        webhook.querySelectorAll<HTMLElement>("select, button:not([disabled])"),
      );
      expect(targets.filter((t) => !reached.includes(t))).toEqual([]);
    });
  });
});
