import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";

import { renderWithProviders } from "../../../test/utils";

vi.mock("../api/useCustomEmojis", () => ({
  useCustomEmojis: vi.fn(),
}));

vi.mock("../../workspaces/api/useCurrentUser", () => ({
  useCurrentUser: vi.fn(),
}));

vi.mock("../../workspaces/api/useMyServerRole", () => ({
  useIsOwner: vi.fn(),
}));

vi.mock("../../../shared/media/serverMedia", () => ({
  useServerMediaUrl: (url: string) => `blob:${url}`,
}));

import { useCustomEmojis } from "../api/useCustomEmojis";
import { useCurrentUser } from "../../workspaces/api/useCurrentUser";
import { useIsOwner } from "../../workspaces/api/useMyServerRole";
import { EmojiManagement } from "./EmojiManagement";

const uploadedByAlice = {
  id: "emoji-1",
  name: "party",
  imageUrl: "http://example.com/party.png",
  serverId: "srv-1",
  uploadedBy: "user-alice",
  createdAt: "2026-07-01T00:00:00Z",
};

const uploadedByBob = {
  id: "emoji-2",
  name: "cool",
  imageUrl: "http://example.com/cool.png",
  serverId: "srv-1",
  uploadedBy: "user-bob",
  createdAt: "2026-07-02T00:00:00Z",
};

function mockAs(currentUserId: string, isOwner: boolean, emojis: unknown[]) {
  vi.mocked(useCustomEmojis).mockReturnValue({ emojis, isLoading: false } as ReturnType<
    typeof useCustomEmojis
  >);
  vi.mocked(useCurrentUser).mockReturnValue({
    data: {
      id: currentUserId,
      username: "u",
      displayName: "U",
      avatarUrl: null,
      statusText: null,
      bio: null,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial mock of a large TanStack Query return type
  } as any);
  vi.mocked(useIsOwner).mockReturnValue(isOwner);
}

describe("EmojiManagement", () => {
  beforeEach(() => {
    vi.mocked(useCustomEmojis).mockReset();
    vi.mocked(useCurrentUser).mockReset();
    vi.mocked(useIsOwner).mockReset();
  });

  it("always shows the upload form — any server member may create emoji", () => {
    mockAs("user-alice", false, []);
    renderWithProviders(<EmojiManagement serverId="srv-1" />);
    expect(screen.getByText("Upload Emoji")).toBeInTheDocument();
  });

  it("shows the delete button for the owner, even on someone else's upload", () => {
    mockAs("user-alice", true, [uploadedByBob]);
    renderWithProviders(<EmojiManagement serverId="srv-1" />);
    expect(screen.getByLabelText("Delete cool")).toBeInTheDocument();
  });

  it("shows the delete button for the uploader, even when not the owner", () => {
    mockAs("user-bob", false, [uploadedByBob]);
    renderWithProviders(<EmojiManagement serverId="srv-1" />);
    expect(screen.getByLabelText("Delete cool")).toBeInTheDocument();
  });

  it("hides the delete button for a non-owner viewing someone else's upload", () => {
    mockAs("user-carol", false, [uploadedByAlice]);
    renderWithProviders(<EmojiManagement serverId="srv-1" />);
    expect(screen.queryByLabelText("Delete party")).not.toBeInTheDocument();
  });

  it("shows each emoji through the server media loader", () => {
    mockAs("user-alice", false, [uploadedByAlice]);
    renderWithProviders(<EmojiManagement serverId="srv-1" />);
    expect(screen.getByAltText("party")).toHaveAttribute(
      "src",
      "blob:http://example.com/party.png",
    );
  });
});
