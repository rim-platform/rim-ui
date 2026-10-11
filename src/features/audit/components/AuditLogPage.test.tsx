import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/utils";
import { expectReachableByKeyboard } from "../../../test/keyboard";
import { useShellStore } from "../../../shell/state/useShellStore";
import {
  AuditOutcomeGql,
  ServerMemberRoleGql,
  TypedVerbGql,
} from "../../../core/graphql/generated/schema-types";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";

// `listAuditLog` requests; the workspace query is answered by `serverMock`.
const requestMock = vi.fn();
const serverMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (document: unknown, variables: unknown) =>
      String(document).includes("listAuditLog")
        ? requestMock(document, variables)
        : serverMock(document, variables),
  },
}));

import { AuditLogPage } from "./AuditLogPage";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeEntry(overrides: {
  id: string;
  commandId: string;
  typedVerb?: TypedVerbGql | null;
  outcome?: AuditOutcomeGql;
  initiator?: string;
}) {
  return {
    actorUserId: "user-1",
    serverId: "ws-1",
    commandId: overrides.commandId,
    initiator: overrides.initiator ?? "user",
    argsRedacted: {},
    sensitivity: "LOW",
    dangerous: false,
    confirmationKind: "none",
    typedVerb: overrides.typedVerb ?? null,
    outcome: overrides.outcome ?? AuditOutcomeGql.SUCCESS,
    errorKind: null,
    capabilityCheckOutcome: null,
    confirmationOutcome: null,
    createdAt: "2026-04-25T10:00:00Z",
    id: overrides.id,
  };
}

function serverWithRole(viewerRole: ServerMemberRoleGql) {
  return { server: { id: "ws-1", name: "Workspace", viewerRole } };
}

function makePage(
  items: ReturnType<typeof makeEntry>[],
  opts: { hasNextPage?: boolean; nextCursor?: string | null } = {},
) {
  return {
    listAuditLog: {
      items,
      nextCursor: opts.nextCursor ?? null,
      pageInfo: {
        hasNextPage: opts.hasNextPage ?? false,
        hasPrevPage: false,
      },
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("AuditLogPage", () => {
  beforeEach(() => {
    requestMock.mockReset();
    serverMock.mockReset();
    useShellStore.getState().reset();
    useAuthStore.setState({ session: { userId: "user-1" } });
    useWorkspaceStore.setState({ workspaceId: null });
  });

  it.each([ServerMemberRoleGql.OWNER, ServerMemberRoleGql.MODERATOR])(
    "asks a %s for the whole workspace log",
    async (role) => {
      useWorkspaceStore.setState({ workspaceId: "ws-1" });
      serverMock.mockResolvedValue(serverWithRole(role));
      requestMock.mockResolvedValue(makePage([]));
      renderWithProviders(<AuditLogPage />);

      await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
      expect(requestMock.mock.calls[0][1].filter).toEqual({ serverId: "ws-1" });
      await waitFor(() =>
        expect(screen.getByText("No audit log entries yet.")).toBeInTheDocument(),
      );
      expect(screen.queryByTestId("audit-scope-note")).not.toBeInTheDocument();
    },
  );

  it.each([ServerMemberRoleGql.MEMBER, ServerMemberRoleGql.GUEST])(
    "asks a %s for their own actions in the workspace and says so",
    async (role) => {
      useWorkspaceStore.setState({ workspaceId: "ws-1" });
      serverMock.mockResolvedValue(serverWithRole(role));
      requestMock.mockResolvedValue(makePage([]));
      renderWithProviders(<AuditLogPage />);

      await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
      expect(requestMock.mock.calls[0][1].filter).toEqual({
        serverId: "ws-1",
        actorUserId: "user-1",
      });
      expect(await screen.findByTestId("audit-scope-note")).toHaveTextContent(
        "Showing your own actions",
      );
    },
  );

  it("asks for the viewer's own actions when no workspace is selected", async () => {
    requestMock.mockResolvedValue(makePage([]));
    renderWithProviders(<AuditLogPage />);

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(requestMock.mock.calls[0][1].filter).toEqual({ actorUserId: "user-1" });
    expect(serverMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("audit-scope-note")).toHaveTextContent("Showing your own actions");
  });

  it("holds the request until the viewer's role is known", async () => {
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    serverMock.mockImplementation(() => new Promise(() => {}));
    renderWithProviders(<AuditLogPage />);

    await waitFor(() => expect(serverMock).toHaveBeenCalledTimes(1));
    expect(requestMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Loading audit log")).toBeInTheDocument();
  });

  it("falls back to the viewer's own actions when the role cannot be read", async () => {
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    serverMock.mockRejectedValue(new Error("network failure"));
    requestMock.mockResolvedValue(makePage([]));
    renderWithProviders(<AuditLogPage />);

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(requestMock.mock.calls[0][1].filter).toEqual({
      serverId: "ws-1",
      actorUserId: "user-1",
    });
  });

  it("renders skeleton rows while loading", () => {
    requestMock.mockImplementation(() => new Promise(() => {}));
    renderWithProviders(<AuditLogPage />);
    expect(screen.getByLabelText("Loading audit log")).toBeInTheDocument();
  });

  it("renders audit log entries with typed verb chip", async () => {
    requestMock.mockResolvedValueOnce(
      makePage([
        makeEntry({
          id: "a-1",
          commandId: "message.send",
          typedVerb: TypedVerbGql.WRITE,
          outcome: AuditOutcomeGql.SUCCESS,
        }),
        makeEntry({
          id: "a-2",
          commandId: "channel.open",
          typedVerb: TypedVerbGql.READ,
          outcome: AuditOutcomeGql.SUCCESS,
        }),
      ]),
    );

    renderWithProviders(<AuditLogPage />);

    await waitFor(() => {
      expect(screen.getByText("message.send")).toBeInTheDocument();
    });

    expect(screen.getByText("channel.open")).toBeInTheDocument();

    // Verify typed verb chips within their rows
    const row1 = screen.getByTestId("audit-row-a-1");
    expect(row1.querySelector("[data-testid='typed-verb-chip']")).toHaveTextContent("Write");

    const row2 = screen.getByTestId("audit-row-a-2");
    expect(row2.querySelector("[data-testid='typed-verb-chip']")).toHaveTextContent("Read");
  });

  it("renders '—' for entries with null typedVerb", async () => {
    requestMock.mockResolvedValueOnce(
      makePage([makeEntry({ id: "a-null", commandId: "some.cmd", typedVerb: null })]),
    );

    renderWithProviders(<AuditLogPage />);

    await waitFor(() => expect(screen.getByText("some.cmd")).toBeInTheDocument());

    const row = screen.getByTestId("audit-row-a-null");
    expect(row.querySelector("[data-testid='typed-verb-chip']")).toHaveTextContent("—");
  });

  it("renders empty state when no entries", async () => {
    requestMock.mockResolvedValueOnce(makePage([]));
    renderWithProviders(<AuditLogPage />);

    await waitFor(() => {
      expect(screen.getByText("No audit log entries yet.")).toBeInTheDocument();
    });
  });

  it("renders filter-aware empty state when verb filter is active", async () => {
    requestMock.mockResolvedValue(makePage([]));
    renderWithProviders(<AuditLogPage />);

    await waitFor(() => expect(screen.getByText("No audit log entries yet.")).toBeInTheDocument());

    // Click the "Write" filter chip
    fireEvent.click(screen.getByRole("button", { name: "Write", pressed: false }));

    await waitFor(() => {
      expect(screen.getByText("No entries match this filter.")).toBeInTheDocument();
    });
  });

  it("reaches its close buttons and filters by keyboard and filters with Enter", async () => {
    requestMock.mockResolvedValue(makePage([]));
    const user = userEvent.setup();
    renderWithProviders(<AuditLogPage />);
    await waitFor(() => expect(screen.getByText("No audit log entries yet.")).toBeInTheDocument());

    const write = screen.getByRole("button", { name: "Write", pressed: false });
    await expectReachableByKeyboard(user, [
      screen.getByRole("button", { name: "Back to conversation" }),
      screen.getByRole("button", { name: "Close audit log" }),
      write,
    ]);
    write.focus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(screen.getByText("No entries match this filter.")).toBeInTheDocument(),
    );
  });

  it("renders error state with retry button", async () => {
    requestMock.mockRejectedValueOnce(new Error("network failure"));
    renderWithProviders(<AuditLogPage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    });
  });

  it("filter chip sets typedVerb in the query variables (WRITE variant)", async () => {
    requestMock.mockResolvedValue(makePage([]));
    renderWithProviders(<AuditLogPage />);

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    // Initial call: the viewer's own actions, no verb
    expect(requestMock.mock.calls[0][1].filter).toEqual({ actorUserId: "user-1" });

    // Click Write filter
    fireEvent.click(screen.getByRole("button", { name: "Write", pressed: false }));

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    expect(requestMock.mock.calls[1][1].filter).toEqual({
      actorUserId: "user-1",
      typedVerb: TypedVerbGql.WRITE,
    });
  });

  it("toggling the same chip twice clears the filter", async () => {
    requestMock.mockResolvedValue(makePage([]));
    renderWithProviders(<AuditLogPage />);

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Delete", pressed: false }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    expect(requestMock.mock.calls[1][1].filter).toEqual({
      actorUserId: "user-1",
      typedVerb: TypedVerbGql.DELETE,
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete", pressed: true }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(3));
    expect(requestMock.mock.calls[2][1].filter).toEqual({ actorUserId: "user-1" });
  });

  it("clear filter button resets filter to null", async () => {
    requestMock.mockResolvedValue(makePage([]));
    renderWithProviders(<AuditLogPage />);

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Execute", pressed: false }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));

    // "Clear filter" button appears when filter is active + results empty
    const clearBtns = screen.getAllByRole("button", { name: /Clear filter/i });
    fireEvent.click(clearBtns[0]);

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(3));
    expect(requestMock.mock.calls[2][1].filter).toEqual({ actorUserId: "user-1" });
  });

  it("close button navigates back to conversation surface", async () => {
    requestMock.mockResolvedValueOnce(makePage([]));
    useShellStore.getState().setMainSurface({ kind: "audit-log" });
    renderWithProviders(<AuditLogPage />);

    await waitFor(() => expect(screen.getByText("No audit log entries yet.")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Close audit log" }));
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "conversation" });
  });

  it("Older button sends next cursor in pagination", async () => {
    requestMock.mockResolvedValueOnce(
      makePage([makeEntry({ id: "a-1", commandId: "cmd.a", typedVerb: TypedVerbGql.READ })], {
        hasNextPage: true,
        nextCursor: "cursor-abc",
      }),
    );
    renderWithProviders(<AuditLogPage />);

    await waitFor(() => expect(screen.getByText("cmd.a")).toBeInTheDocument());

    requestMock.mockResolvedValueOnce(makePage([]));
    fireEvent.click(screen.getByRole("button", { name: /Older/ }));

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    expect(requestMock.mock.calls[1][1]).toMatchObject({
      pagination: expect.objectContaining({ after: "cursor-abc" }),
    });
  });
});
