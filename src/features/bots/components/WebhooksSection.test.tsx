import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { Bot, IncomingWebhook } from "../../../core/graphql/generated/schema-types";

const webhooksData = vi.hoisted(() => ({ current: [] as unknown[] }));
const channelsData = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock("../api/botsApi", () => ({
  useIncomingWebhooks: () => ({
    data: webhooksData.current,
    isPending: false,
    isError: false,
    isFetching: false,
  }),
  useRevokeIncomingWebhook: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useInvalidateBots: () => vi.fn(),
}));
vi.mock("../api/useAllChannels", () => ({
  useAllChannels: () => ({ data: { items: channelsData.current, truncated: false } }),
}));
vi.mock("../../updater/hooks/useSpaceHasCapability", () => ({
  useSpaceHasCapability: () => false,
}));
vi.mock("../../commands/runtime/runFromClick", () => ({ runCommandFromClick: vi.fn() }));
vi.mock("./NewWebhookDialog", () => ({
  NewWebhookDialog: ({ channel }: { channel?: { title: string } }) => (
    <div role="dialog" aria-label="New webhook form">
      for {channel?.title}
    </div>
  ),
}));

import { WebhooksSection } from "./WebhooksSection";

const BOTS = [{ userId: "bot-1", name: "Deploys", deactivatedAt: null }] as unknown as Bot[];

function hook(extra: Partial<IncomingWebhook>): IncomingWebhook {
  return {
    id: "h-1",
    conversationId: "c-1",
    botUserId: "bot-1",
    preset: "PLAIN",
    template: null,
    createdAt: "2026-10-01T00:00:00Z",
    lastUsedAt: null,
    revokedAt: null,
    ...extra,
  } as IncomingWebhook;
}

function renderSection() {
  render(<WebhooksSection serverId="ws-1" bots={BOTS} onNewBot={vi.fn()} />);
}

beforeEach(() => {
  channelsData.current = [
    { id: "c-1", title: "ops", encryptedAt: null },
    { id: "c-2", title: "alerts", encryptedAt: null },
  ];
});

describe("WebhooksSection revoked webhooks", () => {
  it("shows a revoked webhook of a channel without an active one, with its date and a button", () => {
    const revokedAt = new Date(Date.now() - 3 * 86_400_000).toISOString();
    webhooksData.current = [hook({ id: "h-old", revokedAt })];
    renderSection();
    const list = screen.getByRole("list", { name: "Revoked webhooks" });
    expect(list).toHaveTextContent("ops · Deploys");
    expect(list).toHaveTextContent(
      "Revoked 3 days ago. It no longer posts; make a new webhook for a new URL.",
    );
    expect(screen.getByRole("button", { name: "New webhook for ops" })).toBeInTheDocument();
  });

  it("shows only the latest revoked webhook of a channel", () => {
    webhooksData.current = [
      hook({ id: "h-a", revokedAt: new Date(Date.now() - 10 * 86_400_000).toISOString() }),
      hook({ id: "h-b", revokedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() }),
    ];
    renderSection();
    const items = screen.getByRole("list", { name: "Revoked webhooks" }).querySelectorAll("li");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent("Revoked 2 days ago");
  });

  it("hides a revoked webhook of a channel that has an active one", () => {
    webhooksData.current = [
      hook({ id: "h-old", revokedAt: "2026-10-20T00:00:00Z" }),
      hook({ id: "h-new" }),
    ];
    renderSection();
    expect(screen.queryByRole("list", { name: "Revoked webhooks" })).not.toBeInTheDocument();
  });

  it("names a channel the viewer is not in, without a button", () => {
    webhooksData.current = [hook({ conversationId: "c-9", revokedAt: "2026-10-20T00:00:00Z" })];
    renderSection();
    expect(screen.getByRole("list", { name: "Revoked webhooks" })).toHaveTextContent(
      "A channel you are not in · Deploys",
    );
    expect(screen.queryByRole("button", { name: /New webhook for/ })).not.toBeInTheDocument();
  });

  it("opens the new webhook form for that channel", () => {
    webhooksData.current = [hook({ conversationId: "c-2", revokedAt: "2026-10-20T00:00:00Z" })];
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "New webhook for alerts" }));
    expect(screen.getByRole("dialog", { name: "New webhook form" })).toHaveTextContent(
      "for alerts",
    );
  });
});
