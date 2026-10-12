import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import { withLimits } from "../../../test/limits";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import {
  baseReadHandlers,
  callsTo,
  graphqlError,
  makeConversation,
  routeRequests,
} from "../__fixtures__/conversations";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import { NewChannelDialog } from "./NewChannelDialog";

const created = makeConversation({ id: "conv-new", title: "secret", isPrivate: true });

function renderDialog(onClose = vi.fn()) {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <NewChannelDialog onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

function typeName(value: string) {
  fireEvent.change(screen.getByPlaceholderText("general"), { target: { value } });
}

function submit() {
  fireEvent.submit(screen.getByPlaceholderText("general").closest("form")!);
}

describe("NewChannelDialog", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useShellStore.getState().reset();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    routeRequests(requestMock, {
      ...baseReadHandlers,
      "mutation CreateConversation": () => ({ createConversation: created }),
      "mutation AddConversationMembers": () => ({
        addConversationMembers: { ...created, memberIds: ["me", "u-alice"], memberCount: 2 },
      }),
    });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
  });

  it("renders the name field, a private toggle with its warning, and a disabled Create button", () => {
    renderDialog();
    expect(screen.getByText("New channel")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /private/i })).not.toBeChecked();
    expect(
      screen.getByText("Only invited members can see this channel. This cannot be changed later."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create/i })).toBeDisabled();
  });

  it("creates a public channel without inviting anyone", async () => {
    const onClose = renderDialog();
    typeName("  spaced  ");
    submit();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(callsTo(requestMock, "mutation CreateConversation")).toEqual([
      { input: { serverId: "ws-1", title: "spaced", isChannel: true, isPrivate: false } },
    ]);
    expect(callsTo(requestMock, "mutation AddConversationMembers")).toHaveLength(0);
    expect(useShellStore.getState().selectedConversationId).toBe("conv-new");
  });

  it("sends isPrivate and then adds the picked members before navigating", async () => {
    const onClose = renderDialog();
    typeName("secret");
    fireEvent.click(screen.getByRole("switch", { name: /private/i }));
    fireEvent.click(await screen.findByRole("option", { name: /alice/i }));
    submit();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(callsTo(requestMock, "mutation CreateConversation")).toEqual([
      { input: { serverId: "ws-1", title: "secret", isChannel: true, isPrivate: true } },
    ]);
    expect(callsTo(requestMock, "mutation AddConversationMembers")).toEqual([
      { serverId: "ws-1", conversationId: "conv-new", userIds: ["u-alice"] },
    ]);
    // The create resolves before the invite is sent.
    const order = requestMock.mock.calls
      .map(([doc]) => String(doc))
      .filter((doc) => doc.includes("mutation"))
      .map((doc) => (doc.includes("CreateConversation") ? "create" : "add"));
    expect(order).toEqual(["create", "add"]);
    expect(useShellStore.getState().selectedConversationId).toBe("conv-new");
  });

  it("does not offer the viewer in the member picker", async () => {
    renderDialog();
    expect(await screen.findByRole("option", { name: /alice/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /me myself/i })).not.toBeInTheDocument();
  });

  it("shows the server's message when the create fails", async () => {
    routeRequests(requestMock, {
      ...baseReadHandlers,
      "mutation CreateConversation": () => {
        throw graphqlError("VALIDATION", "A channel with that name already exists");
      },
    });
    const onClose = renderDialog();
    typeName("general");
    submit();

    expect(await screen.findByText("A channel with that name already exists")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not submit when the name is only whitespace", () => {
    renderDialog();
    typeName("   ");
    submit();
    expect(callsTo(requestMock, "mutation CreateConversation")).toHaveLength(0);
  });

  it("shows the instance's channel cap, which it cannot count, and nothing without one", () => {
    const { unmount } = render(<NewChannelDialog onClose={vi.fn()} />, {
      wrapper: withLimits({ channelsPerWorkspace: 50 }),
    });
    expect(screen.getByTestId("limit-note")).toHaveTextContent("Up to 50 channels per workspace");
    unmount();

    renderDialog();
    expect(screen.queryByTestId("limit-note")).not.toBeInTheDocument();
  });
});
