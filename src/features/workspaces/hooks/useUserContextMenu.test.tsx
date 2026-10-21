import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import { ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import {
  callsTo,
  currentUser,
  makeConversation,
  routeRequests,
  workspaceMembers,
} from "../../conversations/__fixtures__/conversations";
import type { ConversationSummary } from "../../conversations/types";
import { useKnownHandles } from "../state/useKnownHandles";
import { useRelayStore } from "../../relay/state/useRelayStore";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));
vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));
const direct = vi.hoisted(() => ({ openDirectWithMember: vi.fn() }));
vi.mock("../../conversations/state/openDirect", () => direct);

import { toast } from "../../../shared/toast";
import { useUserContextMenu } from "./useUserContextMenu";

const { OWNER, MODERATOR, MEMBER, GUEST } = ServerMemberRoleGql;

interface Alice {
  role?: ServerMemberRoleGql;
  timeoutUntil?: string | null;
  principalId?: string | null;
}

function serve(viewerRole: ServerMemberRoleGql, alice: Alice = {}) {
  routeRequests(requestMock, {
    "query Me": () => ({ me: currentUser }),
    "query ServerMembers": () => ({
      serverMembers: workspaceMembers.map((m) =>
        m.userId === "u-alice"
          ? {
              ...m,
              memberRole: alice.role ?? MEMBER,
              timeoutUntil: alice.timeoutUntil ?? null,
              principalId: alice.principalId ?? null,
            }
          : m.userId === "me"
            ? { ...m, memberRole: viewerRole, principalId: "rimp1_me" }
            : m,
      ),
    }),
    "query Server(": () => ({ server: { id: "ws-1", name: "Acme", viewerRole } }),
    "query Contacts": () => ({
      contacts: [{ principalId: "rimp1_bob", relayUrls: [], addedAt: "" }],
    }),
    "mutation ClearTimeout": () => ({ clearTimeout: true }),
    "mutation SetMemberRole": () => ({ setMemberRole: { userId: "u-alice", memberRole: GUEST } }),
    "mutation RemoveContact": () => ({ removeContact: true }),
  });
}

/** A person shown on a surface, with their context menu bound to them. */
function Person({
  userId,
  conversation,
  onRemove,
}: {
  userId: string;
  conversation?: ConversationSummary;
  onRemove?: (userId: string) => void;
}) {
  const menu = useUserContextMenu({
    workspaceId: "ws-1",
    conversation,
    onRemoveFromConversation: onRemove,
  });
  return (
    <>
      <span data-testid="person" tabIndex={0} {...menu.bind({ userId })}>
        {userId}
      </span>
      {menu.element}
    </>
  );
}

async function renderPerson(
  viewerRole: ServerMemberRoleGql,
  props: Partial<Parameters<typeof Person>[0]> = {},
) {
  const qc = createTestQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <Person userId="u-alice" {...props} />
    </QueryClientProvider>,
  );
  await waitFor(() => {
    expect(qc.getQueryData<{ viewerRole: string }>(queryKeys.server("ws-1"))?.viewerRole).toBe(
      viewerRole,
    );
    expect(qc.getQueryData(queryKeys.serverMembers("ws-1"))).toBeDefined();
    expect(qc.getQueryData(queryKeys.me)).toBeDefined();
  });
  return qc;
}

/** The labels of a menu panel's items, radio items included. */
function itemsOf(menu: HTMLElement): string[] {
  return Array.from(menu.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')).map(
    (el) => el.textContent ?? "",
  );
}

/** Right-clicks the person and returns the top-level items of the menu that opens. */
function openMenu(): string[] {
  fireEvent.contextMenu(screen.getByTestId("person"));
  return topLevelItems();
}

function topLevelItems(): string[] {
  return itemsOf(screen.getAllByRole("menu")[0]);
}

function openSubmenu(name: string): string[] {
  fireEvent.click(screen.getByRole("menuitem", { name }));
  return itemsOf(screen.getAllByRole("menu")[1]);
}

describe("useUserContextMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestMock.mockReset();
    useShellStore.getState().reset();
    useRelayStore.getState().reset();
    useAuthStore.setState({ session: { userId: "me" } });
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  afterEach(() => {
    useAuthStore.setState({ session: null });
  });

  it("offers a member someone else's profile, a message and their username", async () => {
    serve(MEMBER);
    await renderPerson(MEMBER);
    expect(openMenu()).toEqual(["View profile", "Send message", "Copy @username"]);
    expect(screen.queryByText("Moderation")).not.toBeInTheDocument();
  });

  it("offers the viewer their profile, status, username and settings", async () => {
    serve(MEMBER);
    await renderPerson(MEMBER, { userId: "me" });
    expect(openMenu()).toEqual(["View profile", "Set status…", "Copy @username", "Settings"]);
  });

  it("opens from the ContextMenu key and from Shift+F10", async () => {
    serve(MEMBER);
    await renderPerson(MEMBER);
    fireEvent.keyDown(screen.getByTestId("person"), { key: "ContextMenu" });
    expect(screen.getByRole("menu", { name: "Actions for Alice" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId("person"), { key: "F10", shiftKey: true });
    expect(screen.getByRole("menu", { name: "Actions for Alice" })).toBeInTheDocument();
  });

  const matrix: [ServerMemberRoleGql, ServerMemberRoleGql, boolean][] = [
    [OWNER, OWNER, false],
    [OWNER, MODERATOR, true],
    [OWNER, MEMBER, true],
    [OWNER, GUEST, true],
    [MODERATOR, OWNER, false],
    [MODERATOR, MODERATOR, false],
    [MODERATOR, MEMBER, true],
    [MODERATOR, GUEST, true],
    [MEMBER, MODERATOR, false],
    [MEMBER, MEMBER, false],
    [MEMBER, GUEST, false],
    [GUEST, MEMBER, false],
    [GUEST, GUEST, false],
  ];

  it.each(matrix)("viewer %s on target %s: moderation %s", async (viewer, target, shown) => {
    serve(viewer, { role: target });
    await renderPerson(viewer);
    const items = openMenu();
    if (shown) {
      expect(screen.getByText("Moderation")).toBeInTheDocument();
      expect(items).toEqual(expect.arrayContaining(["Kick…", "Ban…"]));
    } else {
      expect(screen.queryByText("Moderation")).not.toBeInTheDocument();
      expect(items).not.toContain("Kick…");
    }
  });

  it("offers an owner every moderation action on a member, kick and ban last", async () => {
    serve(OWNER);
    await renderPerson(OWNER);
    expect(openMenu()).toEqual([
      "View profile",
      "Send message",
      "Copy @username",
      "Change role",
      "Time out",
      "Kick…",
      "Ban…",
    ]);
    expect(screen.getByRole("menuitem", { name: "Kick…" })).toHaveClass("text-rim-danger");
    expect(openSubmenu("Change role")).toEqual(["Moderator", "Member", "Guest"]);
    expect(screen.getByRole("menuitemradio", { name: "Member" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: "Guest" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("offers a moderator only Member and Guest for a guest", async () => {
    serve(MODERATOR, { role: GUEST });
    await renderPerson(MODERATOR);
    openMenu();
    expect(openSubmenu("Change role")).toEqual(["Member", "Guest"]);
  });

  it("changes a role through the confirmation dialog with the chosen role picked", async () => {
    serve(OWNER);
    await renderPerson(OWNER);
    openMenu();
    openSubmenu("Change role");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Guest" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Change Alice's role" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Guest" })).toBeChecked();
    expect(callsTo(requestMock, "mutation SetMemberRole")).toHaveLength(0);
    fireEvent.click(
      within(screen.getByTestId("moderation-dialog")).getByRole("button", { name: "Change role" }),
    );
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation SetMemberRole")).toEqual([
        { serverId: "ws-1", userId: "u-alice", role: GUEST },
      ]),
    );
  });

  it("offers the timeout lengths and opens the timeout dialog on the chosen one", async () => {
    serve(MODERATOR);
    await renderPerson(MODERATOR);
    openMenu();
    expect(openSubmenu("Time out")).toEqual(["10 minutes", "1 hour", "1 day", "1 week", "Custom…"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "1 week" }));
    expect(screen.getByRole("dialog", { name: "Time out Alice" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 week" })).toHaveAttribute("aria-pressed", "true");
  });

  it("opens the timeout dialog on Custom with the date and time input", async () => {
    serve(MODERATOR);
    await renderPerson(MODERATOR);
    openMenu();
    openSubmenu("Time out");
    fireEvent.click(screen.getByRole("menuitem", { name: "Custom…" }));
    expect(screen.getByLabelText("Duration: custom date and time")).toBeInTheDocument();
  });

  it("offers Clear timeout instead of Time out while a timeout is in force", async () => {
    serve(OWNER, { timeoutUntil: "2999-01-01T00:00:00Z" });
    await renderPerson(OWNER);
    const items = openMenu();
    expect(items).toContain("Clear timeout");
    expect(items).not.toContain("Time out");
    fireEvent.click(screen.getByRole("menuitem", { name: "Clear timeout" }));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation ClearTimeout")).toEqual([
        { serverId: "ws-1", userId: "u-alice" },
      ]),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Cleared Alice's timeout"));
  });

  it("offers Time out again once the timeout has run out", async () => {
    serve(MODERATOR, { timeoutUntil: "2000-01-01T00:00:00Z" });
    await renderPerson(MODERATOR);
    const items = openMenu();
    expect(items).toContain("Time out");
    expect(items).not.toContain("Clear timeout");
  });

  it("opens the kick and ban dialogs", async () => {
    serve(MODERATOR);
    await renderPerson(MODERATOR);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Kick…" }));
    expect(screen.getByRole("dialog", { name: "Kick Alice?" })).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByTestId("moderation-dialog")).getByRole("button", { name: "Cancel" }),
    );
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Ban…" }));
    expect(screen.getByRole("dialog", { name: "Ban Alice?" })).toBeInTheDocument();
  });

  it("offers removal from the conversation it was opened in, through the caller", async () => {
    serve(MODERATOR);
    const onRemove = vi.fn();
    await renderPerson(MODERATOR, {
      conversation: makeConversation({ title: "general" }),
      onRemove,
    });
    expect(openMenu()).toContain("Remove from #general…");
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove from #general…" }));
    expect(onRemove).toHaveBeenCalledWith("u-alice");
  });

  it("offers no removal without the caller's go-ahead", async () => {
    serve(MEMBER);
    await renderPerson(MEMBER, { conversation: makeConversation({ title: "general" }) });
    expect(openMenu()).not.toContain("Remove from #general…");
  });

  it("sends a message through the direct message flow", async () => {
    serve(MEMBER);
    await renderPerson(MEMBER);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Send message" }));
    expect(direct.openDirectWithMember).toHaveBeenCalledWith("u-alice");
  });

  it("copies the username", async () => {
    serve(MEMBER);
    await renderPerson(MEMBER);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy @username" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("@alice");
    expect(toast.success).toHaveBeenCalledWith("Copied @alice");
  });

  it("copies the whole handle once a server answered it", async () => {
    useKnownHandles.setState({ byUser: { "u-alice": "@alice:elsewhere.example" } });
    try {
      serve(MEMBER);
      await renderPerson(MEMBER);
      openMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: "Copy @username" }));
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("@alice:elsewhere.example");
    } finally {
      useKnownHandles.setState({ byUser: {} });
    }
  });

  it("offers no copy for a person from elsewhere whose handle is not known", async () => {
    routeRequests(requestMock, {
      "query Me": () => ({ me: currentUser }),
      "query ServerMembers": () => ({
        serverMembers: workspaceMembers.map((m) =>
          m.userId === "u-alice" ? { ...m, username: "r_abcdef", displayName: null } : m,
        ),
      }),
      "query Server(": () => ({ server: { id: "ws-1", name: "Acme", viewerRole: MEMBER } }),
      "query Contacts": () => ({ contacts: [] }),
    });
    await renderPerson(MEMBER);
    expect(openMenu()).toEqual(["View profile", "Send message"]);
  });

  it("shows the profile card until Escape", async () => {
    serve(MEMBER);
    await renderPerson(MEMBER);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "View profile" }));
    expect(screen.getByText("@alice")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("@alice")).not.toBeInTheDocument();
  });

  it("opens the status picker and the settings for the viewer", async () => {
    serve(MEMBER);
    await renderPerson(MEMBER, { userId: "me" });
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Settings" }));
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings" });
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Set status…" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByText("Set status...")).toBeInTheDocument();
  });

  describe("contacts", () => {
    beforeEach(() => {
      useRelayStore
        .getState()
        .setStarted(
          { serverId: "rims1_relay", roles: ["host", "relay"], directSpaceId: "direct-1" },
          { endpoint: "e", userId: "me", principalId: "rimp1_me", deviceId: "d1" },
          [],
        );
    });

    async function renderWithContacts(alice: Alice) {
      serve(MEMBER, alice);
      const qc = await renderPerson(MEMBER);
      await waitFor(() => expect(qc.getQueryData(queryKeys.relayContacts)).toBeDefined());
    }

    it("offers adding someone with a principal who is not a contact", async () => {
      await renderWithContacts({ principalId: "rimp1_alice" });
      expect(openMenu()).toContain("Add to contacts");
    });

    it("offers removing a contact and removes them", async () => {
      await renderWithContacts({ principalId: "rimp1_bob" });
      const items = openMenu();
      expect(items).toContain("Remove from contacts");
      expect(items).not.toContain("Add to contacts");
      fireEvent.click(screen.getByRole("menuitem", { name: "Remove from contacts" }));
      await waitFor(() =>
        expect(callsTo(requestMock, "mutation RemoveContact")).toEqual([
          { principalId: "rimp1_bob" },
        ]),
      );
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith("Removed Alice from your contacts"),
      );
    });

    it("offers neither for someone without a principal", async () => {
      await renderWithContacts({ principalId: null });
      const items = openMenu();
      expect(items).not.toContain("Add to contacts");
      expect(items).not.toContain("Remove from contacts");
    });
  });
});
