import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";

import { renderWithProviders } from "../../../test/utils";
import type { DirectDraft } from "../../../shell/state/useShellStore";

const e2ee = vi.hoisted(() => ({ useDeviceReadyForEncryption: vi.fn() }));
const relay = vi.hoisted(() => ({ directMemberReady: vi.fn() }));
vi.mock("../../e2ee/hooks/useE2eeConversation", () => e2ee);
vi.mock("../../relay/conversations/startDirect", () => relay);
vi.mock("../../messages/components/Composer", () => ({
  Composer: ({ workspaceId, draft }: { workspaceId: string; draft: unknown }) => (
    <div data-testid="composer">{JSON.stringify({ workspaceId, draft })}</div>
  ),
}));

import { DraftDirectView } from "./DraftDirectView";

const toBob: DirectDraft = { workspaceId: "ws-1", otherUserId: "u-bob" };
const toDan: DirectDraft = {
  spaceId: "direct-1",
  member: { principalId: "rimp1_dan", relayUrls: [], name: "Dan" },
};

function composerProps() {
  return JSON.parse(screen.getByTestId("composer").textContent ?? "{}");
}

beforeEach(() => {
  e2ee.useDeviceReadyForEncryption.mockReset();
  relay.directMemberReady.mockReset();
});

describe("DraftDirectView", () => {
  it("says the first message starts the conversation and that it will be encrypted", () => {
    e2ee.useDeviceReadyForEncryption.mockReturnValue(true);
    renderWithProviders(<DraftDirectView draft={toBob} />);
    expect(
      screen.getByText("No messages yet. Your first message starts the conversation."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("draft-direct-encrypted")).toHaveTextContent(
      "This conversation will be end-to-end encrypted.",
    );
    expect(composerProps()).toEqual({
      workspaceId: "ws-1",
      draft: { target: toBob, encrypted: true },
    });
  });

  it("says nothing about encryption on a device that is not ready", () => {
    e2ee.useDeviceReadyForEncryption.mockReturnValue(false);
    renderWithProviders(<DraftDirectView draft={toBob} />);
    expect(screen.queryByTestId("draft-direct-encrypted")).not.toBeInTheDocument();
    expect(composerProps().draft.encrypted).toBe(false);
    expect(relay.directMemberReady).not.toHaveBeenCalled();
  });

  it("in a direct space, promises encryption once the other person is known to be ready", async () => {
    e2ee.useDeviceReadyForEncryption.mockReturnValue(true);
    relay.directMemberReady.mockResolvedValue(true);
    renderWithProviders(<DraftDirectView draft={toDan} />);
    expect(await screen.findByTestId("draft-direct-encrypted")).toBeInTheDocument();
    expect(relay.directMemberReady).toHaveBeenCalledWith(toDan.member);
    expect(composerProps()).toEqual({
      workspaceId: "direct-1",
      draft: { target: toDan, encrypted: true },
    });
  });

  it("in a direct space, promises nothing while the other person is not ready", async () => {
    e2ee.useDeviceReadyForEncryption.mockReturnValue(true);
    relay.directMemberReady.mockResolvedValue(false);
    renderWithProviders(<DraftDirectView draft={toDan} />);
    await vi.waitFor(() => expect(relay.directMemberReady).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId("draft-direct-encrypted")).not.toBeInTheDocument();
    expect(composerProps().draft.encrypted).toBe(false);
  });
});
