import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";

vi.mock("../hooks/useE2eeConversation", () => ({
  usePrincipalNames: () => ({
    nameOf: (p: string | null | undefined) => (p === "rimp1_bob" ? "Bob" : "Someone"),
    userOf: () => undefined,
    principalOf: () => null,
  }),
  useDeviceNames: () => (d: string | null | undefined) => (d ? "Laptop" : "device"),
}));

import { renderWithProviders } from "../../../test/utils";
import type { GroupView } from "../api/e2eeCommands";
import { EncryptionNotices } from "./EncryptionNotices";

function group(overrides: Partial<GroupView> = {}): GroupView {
  return {
    conversationId: "c",
    incarnation: 1,
    nextIncarnation: null,
    joinEpoch: 1,
    removed: false,
    verifyPending: false,
    unverified: [],
    misbehaved: null,
    readdRequestedAt: null,
    lastUpdateAt: null,
    resets: [],
    hasGroup: true,
    epoch: 3,
    commitPending: false,
    awaitingReadd: null,
    ...overrides,
  };
}

function e2ee(overrides: Record<string, unknown>) {
  return {
    encryptedAt: "2026-10-09T00:00:00Z",
    encrypted: true,
    conversationType: undefined,
    desktop: true,
    group: group(),
    notReady: [],
    sendBlock: null,
    ...overrides,
  } as never;
}

describe("EncryptionNotices", () => {
  it("names who is not ready in a conversation that is not encrypted yet", () => {
    renderWithProviders(
      <EncryptionNotices
        workspaceId="ws"
        e2ee={e2ee({ encryptedAt: null, encrypted: false, group: undefined, notReady: ["Bob"] })}
      />,
    );
    expect(
      screen.getByText(/Not encrypted yet: Bob has not set up encryption on a desktop device/),
    ).toBeInTheDocument();
  });

  it("warns about a device RIM cannot verify and that sending stopped", () => {
    renderWithProviders(
      <EncryptionNotices
        workspaceId="ws"
        e2ee={e2ee({
          group: group({
            unverified: [
              {
                principalId: "rimp1_bob",
                deviceId: "0199d1a0-dead-7000-8000-000000000009",
                reason: "unknownDevice",
              },
            ],
          }),
          sendBlock: "unverified",
        })}
      />,
    );
    expect(
      screen.getByText(/Unverified device present: Bob's Laptop \(0199d1a0\)/),
    ).toBeInTheDocument();
    expect(screen.getByText(/it can read new messages/)).toBeInTheDocument();
  });

  it("says this device waits to be re-added", () => {
    renderWithProviders(
      <EncryptionNotices workspaceId="ws" e2ee={e2ee({ sendBlock: "awaitingReadd" })} />,
    );
    expect(
      screen.getByText("This device can't read new messages until another device re-adds it"),
    ).toBeInTheDocument();
  });

  it("sends the web app to the desktop app", () => {
    renderWithProviders(
      <EncryptionNotices workspaceId="ws" e2ee={e2ee({ desktop: false, sendBlock: "web" })} />,
    );
    expect(screen.getByText(/Open it in the RIM desktop app/)).toBeInTheDocument();
  });

  it("shows nothing when all is well", () => {
    const { container } = renderWithProviders(
      <EncryptionNotices workspaceId="ws" e2ee={e2ee({})} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
