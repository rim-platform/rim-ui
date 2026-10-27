import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";

import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import type { ConversationSummary } from "../../conversations/types";

const conversation = vi.hoisted(() => ({ current: null as ConversationSummary | null }));

vi.mock("../../conversations/api/useConversation", () => ({
  useConversation: () => ({ data: conversation.current }),
}));

import { lockVault } from "../../../core/accountVault/accountVault";
import { writeSealedItem } from "../../../core/accountVault/sealedStorage";
import { unlockTestVault } from "../../../test/accountVault";
import { renderWithProviders } from "../../../test/utils";
import { useShellStore } from "../../../shell/state/useShellStore";
import { makeConversation } from "../../conversations/__fixtures__/conversations";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useKeySetupOfferStore } from "../../key-identity/state/keySetupOffer";
import { useE2eeStore, type WebEncryption } from "../state/useE2eeStore";
import { PlaintextNotice } from "./PlaintextNotice";

const TITLE = "This conversation is not encrypted";

// Dismissals are also remembered in memory for the session, so each test opens its own DM.
let seq = 0;
let conversationId = "";

function openDm({
  support = "ready",
  notReady = ["Bob"],
  ...overrides
}: Partial<ConversationSummary> & {
  support?: WebEncryption;
  notReady?: string[] | null;
} = {}) {
  conversation.current = makeConversation({
    id: conversationId,
    title: null,
    conversationType: ConversationTypeEnum.DIRECT,
    memberIds: ["me", "u-bob"],
    encryptedAt: null,
    ...overrides,
  });
  useE2eeStore.setState({
    webEncryption: support,
    notReady: notReady ? { [conversationId]: notReady } : {},
  });
  return renderWithProviders(
    <PlaintextNotice workspaceId="ws-1" conversationId={conversationId} />,
  );
}

describe("PlaintextNotice", () => {
  beforeEach(async () => {
    conversationId = `dm-${++seq}`;
    // Dismissals are kept sealed with the account's other values.
    await unlockTestVault();
    useAuthStore.setState({ session: { userId: "me" } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useE2eeStore.setState({ webEncryption: "checking", groups: {}, notReady: {} });
    useAuthStore.setState({ session: null });
    useShellStore.getState().reset();
    useKeySetupOfferStore.setState({ available: null, requested: false });
    conversation.current = null;
  });

  it("shows once for an unencrypted DM, naming who is not ready", () => {
    const first = openDm({ notReady: ["Bob", "Carol"] });

    const dialog = screen.getByRole("dialog", { name: TITLE });
    expect(dialog).toHaveTextContent(/the server can read them/);
    expect(dialog).toHaveTextContent(
      "Bob and Carol have not set up encryption on a desktop device yet.",
    );
    expect(screen.queryByRole("button", { name: "Open security settings" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    first.unmount();
    openDm({ notReady: ["Bob", "Carol"] });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Not encrypted" })).toBeInTheDocument();
  });

  it("does not open by itself while the account is locked, and opens from the marker", () => {
    act(() => lockVault());
    openDm();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Not encrypted" }));
    expect(screen.getByRole("dialog", { name: TITLE })).toBeInTheDocument();
  });

  it("opens by itself once the account is unlocked", async () => {
    act(() => lockVault());
    openDm();
    expect(screen.queryByRole("dialog")).toBeNull();

    await act(unlockTestVault);
    expect(screen.getByRole("dialog", { name: TITLE })).toBeInTheDocument();
  });

  it("stays closed for a conversation dismissed in an earlier session", () => {
    writeSealedItem("rim.e2ee.plaintextNoticeSeen", JSON.stringify([`me/${conversationId}`]));
    openDm();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows again for another account on this device", () => {
    writeSealedItem(
      "rim.e2ee.plaintextNoticeSeen",
      JSON.stringify([`someone-else/${conversationId}`]),
    );
    openDm();
    expect(screen.getByRole("dialog", { name: TITLE })).toBeInTheDocument();
  });

  it.each<[string, Parameters<typeof openDm>[0]]>([
    ["a channel", { conversationType: ConversationTypeEnum.CHANNEL, title: "general" }],
    ["an encrypted DM", { encryptedAt: "2026-10-09T00:00:00Z" }],
    ["a browser still checking its keys", { support: "checking" }],
    ["members whose readiness is not known yet", { notReady: null }],
  ])("shows neither dialog nor marker for %s", (_, setup) => {
    openDm(setup);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Not encrypted" })).toBeNull();
  });

  it("says a member's desktop turns encryption on when everyone is ready", () => {
    openDm({ notReady: [] });
    expect(screen.getByRole("dialog", { name: TITLE })).toHaveTextContent(
      "a member's desktop app turns encryption on when it opens this conversation",
    );
  });

  it("offers the key setup only when this browser has no device key", () => {
    useKeySetupOfferStore.setState({ available: "link" });
    openDm({ support: "noDeviceKey", notReady: null });

    expect(screen.getByRole("dialog", { name: TITLE })).toHaveTextContent(
      "This browser is not set up for encryption.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Set up encryption" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useKeySetupOfferStore.getState().requested).toBe(true);
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "conversation" });
  });

  it("offers the key setup on a desktop without a key, whose readiness is never checked", () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    try {
      useKeySetupOfferStore.setState({ available: "enroll" });
      openDm({ notReady: null });

      const dialog = screen.getByRole("dialog", { name: TITLE });
      expect(dialog).toHaveTextContent("This computer is not set up for encryption.");
      expect(dialog).toHaveTextContent("Set up encryption on this computer");
      expect(dialog).not.toHaveTextContent("Link this browser with its code");
      fireEvent.click(screen.getByRole("button", { name: "Set up encryption" }));
      expect(useKeySetupOfferStore.getState().requested).toBe(true);
    } finally {
      Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    }
  });

  it("waits for the readiness on a desktop that holds its key", () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    try {
      openDm({ notReady: null });

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.queryByRole("button", { name: "Not encrypted" })).toBeNull();
    } finally {
      Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    }
  });

  it("opens Settings > Security when the key setup step cannot help this device", () => {
    openDm({ support: "noDeviceKey", notReady: null });

    fireEvent.click(screen.getByRole("button", { name: "Open security settings" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useKeySetupOfferStore.getState().requested).toBe(false);
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings", tab: "security" });
  });

  it("reopens from the marker after it was dismissed", () => {
    openDm();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    fireEvent.click(screen.getByRole("button", { name: "Not encrypted" }));
    expect(screen.getByRole("dialog", { name: TITLE })).toHaveTextContent(
      "Bob has not set up encryption on a desktop device yet.",
    );
  });

  it("gives focus back to the composer when it closes", async () => {
    const composer = document.createElement("textarea");
    composer.setAttribute("data-composer-input", "");
    document.body.appendChild(composer);
    try {
      openDm();
      fireEvent.click(screen.getByRole("button", { name: "OK" }));
      await waitFor(() => expect(composer).toHaveFocus());
    } finally {
      composer.remove();
    }
  });

  it("still shows and closes when localStorage is unavailable", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const first = openDm();

    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    first.unmount();
    openDm();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
