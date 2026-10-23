import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { applyWorkspaceEvent } from "../../../core/events/useWorkspaceEvents";
import { JoinRequestStatus } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import {
  callsTo,
  graphqlError,
  routeRequests,
} from "../../conversations/__fixtures__/conversations";
import type { JoinRequestRow } from "../api/publicJoinLink";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));
vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

import { toast } from "../../../shared/toast";
import { JoinRequestsSection } from "./JoinRequestsSection";

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

function request(id: string, overrides: Partial<JoinRequestRow> = {}): JoinRequestRow {
  return {
    id,
    serverId: "ws-1",
    workspaceName: "Acme",
    userId: `u-${id}`,
    message: null,
    status: JoinRequestStatus.OPEN,
    createdAt: new Date(NOW - 2 * 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(NOW + 29 * DAY).toISOString(),
    user: {
      id: `u-${id}`,
      username: `user_${id}`,
      displayName: null,
      avatarUrl: null,
      handle: null,
    },
    ...overrides,
  };
}

const ada = request("jr-ada", {
  message: "I maintain the docs\nand would like to help.",
  user: {
    id: "u-jr-ada",
    username: "ada",
    displayName: "Ada",
    avatarUrl: null,
    handle: "@ada:rim.example.org",
  },
});
const bob = request("jr-bob", {
  user: { id: "u-jr-bob", username: "bob", displayName: null, avatarUrl: null, handle: null },
});
const gone = request("jr-gone", { user: null });
const older = request("jr-older", {
  createdAt: new Date(NOW - 10 * DAY).toISOString(),
  user: { id: "u-jr-older", username: "old", displayName: "Olga", avatarUrl: null, handle: null },
});
const late = request("jr-late", {
  user: { id: "u-jr-late", username: "late", displayName: "Lena", avatarUrl: null, handle: null },
});

/** A server whose open requests are `open`; accept and decline close them. */
function serve(
  start: JoinRequestRow[] = [ada, bob, gone],
  extra: Record<string, (vars: Record<string, unknown>) => unknown> = {},
) {
  const state = { open: [...start], older: [older] };
  routeRequests(requestMock, {
    "query JoinRequests(": (vars) => {
      if (vars.cursor) {
        return {
          joinRequests: {
            items: state.older,
            next: null,
            prev: null,
            pageInfo: { hasNext: false, hasPrev: true },
          },
        };
      }
      const last = state.open[state.open.length - 1];
      return {
        joinRequests: {
          items: state.open,
          next: last ? { createdAt: last.createdAt, requestId: last.id } : null,
          prev: null,
          pageInfo: { hasNext: state.older.length > 0, hasPrev: false },
        },
      };
    },
    "query JoinRequestCount": () => ({
      joinRequests: {
        items: [...state.open, ...state.older].map((r) => ({ id: r.id })),
        pageInfo: { hasNext: false, hasPrev: false },
      },
    }),
    "mutation AcceptJoinRequest": (vars) => {
      state.open = state.open.filter((r) => r.id !== vars.requestId);
      return { acceptJoinRequest: { id: vars.requestId, status: JoinRequestStatus.ACCEPTED } };
    },
    "mutation DeclineJoinRequest": (vars) => {
      state.open = state.open.filter((r) => r.id !== vars.requestId);
      return { declineJoinRequest: { id: vars.requestId, status: JoinRequestStatus.DECLINED } };
    },
    ...extra,
  });
  return state;
}

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // The viewer, whose handle domain shortens handles on it.
  qc.setQueryData(queryKeys.me, {
    id: "u-me",
    username: "viewer",
    handle: "@viewer:rim.example.org",
  });
  render(
    <QueryClientProvider client={qc}>
      <JoinRequestsSection serverId="ws-1" />
    </QueryClientProvider>,
  );
  return qc;
}

const row = (id: string) => screen.getByTestId(`join-request-row-${id}`);
const heading = () => screen.getByRole("heading", { name: /^Join requests/ });

describe("JoinRequestsSection", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it("lists each open request with the person, the message, when it was asked and its expiry", async () => {
    serve();
    renderList();

    const list = await screen.findByRole("list", { name: "Join requests" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.dataset.testid),
    ).toEqual(["join-request-row-jr-ada", "join-request-row-jr-bob", "join-request-row-jr-gone"]);
    expect(callsTo(requestMock, "query JoinRequests(")[0]).toEqual({
      serverId: "ws-1",
      dir: "AFTER",
      cursor: null,
      limit: 50,
    });

    expect(row("jr-ada")).toHaveTextContent("Ada");
    expect(row("jr-ada")).toHaveTextContent("I maintain the docs and would like to help.");
    // A handle on the viewer's own domain reads short.
    await waitFor(() => expect(row("jr-ada")).toHaveTextContent(/Ada@adaI maintain/));
    expect(row("jr-ada")).toHaveTextContent("asked 2h ago");
    expect(row("jr-ada")).toHaveTextContent(/expires /);
    // A person named by their handle is not named twice.
    expect(row("jr-bob")).toHaveTextContent("bobNo message");
    expect(row("jr-bob")).not.toHaveTextContent("@bob");
    expect(row("jr-bob")).toHaveTextContent("No message");
    expect(row("jr-gone")).toHaveTextContent("A deleted account");
    expect(within(row("jr-ada")).getByRole("button", { name: "Accept Ada" })).toBeEnabled();
    expect(within(row("jr-ada")).getByRole("button", { name: "Decline Ada" })).toBeEnabled();
  });

  it("says when there are no open requests", async () => {
    serve([]);
    renderList();
    expect(await screen.findByText("No one is waiting to join.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("shows the server's refusal to list them", async () => {
    serve([], {
      "query JoinRequests(": () => {
        throw graphqlError("FORBIDDEN", "only the owner and moderators see join requests");
      },
    });
    renderList();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "only the owner and moderators see join requests",
    );
  });

  it("shows nothing on a server without join requests", async () => {
    serve([], {
      "query JoinRequests(": () => {
        throw Object.assign(new Error("unknown field"), {
          response: { errors: [{ message: 'Unknown field "joinRequests"' }] },
        });
      },
    });
    renderList();
    await waitFor(() => expect(callsTo(requestMock, "query JoinRequests(")).toHaveLength(1));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: /^Join requests/ })).not.toBeInTheDocument(),
    );
  });

  it("loads older requests through the page's next cursor", async () => {
    serve();
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByRole("button", { name: "Load more" }));

    await waitFor(() => expect(row("jr-older")).toBeInTheDocument());
    expect(callsTo(requestMock, "query JoinRequests(")[1]).toEqual({
      serverId: "ws-1",
      dir: "AFTER",
      cursor: { createdAt: gone.createdAt, requestId: "jr-gone" },
      limit: 50,
    });
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("counts the open requests in a badge", async () => {
    serve();
    renderList();
    await waitFor(() => expect(heading()).toHaveTextContent("Join requests4"));
    expect(heading()).toHaveAccessibleName(/^Join requests\s*4 open$/);
  });

  it("accepts a request, and the list and badge refresh", async () => {
    serve();
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByRole("button", { name: "Accept Ada" }));

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation AcceptJoinRequest")).toEqual([
        { serverId: "ws-1", requestId: "jr-ada" },
      ]),
    );
    expect(toast.success).toHaveBeenCalledWith("Ada joined the workspace");
    await waitFor(() => expect(screen.queryByTestId("join-request-row-jr-ada")).toBeNull());
    await waitFor(() => expect(heading()).toHaveTextContent("Join requests3"));
  });

  it("says why an acceptance was refused", async () => {
    serve([ada], {
      "mutation AcceptJoinRequest": () => {
        throw graphqlError("VALIDATION", "this instance allows 50 members per workspace");
      },
    });
    const user = userEvent.setup();
    renderList();
    await user.click(await screen.findByRole("button", { name: "Accept Ada" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("This instance allows 50 members per workspace."),
    );
  });

  it("declines a request at once, and it leaves the list", async () => {
    serve();
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByRole("button", { name: "Decline Ada" }));

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation DeclineJoinRequest")).toEqual([
        { serverId: "ws-1", requestId: "jr-ada" },
      ]),
    );
    expect(toast.success).toHaveBeenCalledWith("Declined Ada's request");
    await waitFor(() => expect(screen.queryByTestId("join-request-row-jr-ada")).toBeNull());
    await waitFor(() => expect(heading()).toHaveTextContent("Join requests3"));
  });

  it("shows 100+ when the first page of 100 has more after it", async () => {
    serve([ada], {
      "query JoinRequestCount": (vars) => {
        expect(vars.limit).toBe(100);
        return {
          joinRequests: {
            items: Array.from({ length: 100 }, (_, n) => ({ id: `jr-${n}` })),
            pageInfo: { hasNext: true, hasPrev: false },
          },
        };
      },
    });
    renderList();
    await waitFor(() => expect(heading()).toHaveTextContent("Join requests100+"));
  });

  describe("live updates", () => {
    it("shows a new request and counts it when JoinRequestCreated arrives", async () => {
      const state = serve();
      const qc = renderList();
      await waitFor(() => expect(heading()).toHaveTextContent("Join requests4"));

      state.open = [late, ...state.open];
      act(() =>
        applyWorkspaceEvent(
          {
            type: "JoinRequestCreated",
            workspace_id: "ws-1",
            request_id: "jr-late",
            user_id: "u-x",
          },
          qc,
          "ws-1",
        ),
      );

      await waitFor(() => expect(row("jr-late")).toBeInTheDocument());
      await waitFor(() => expect(heading()).toHaveTextContent("Join requests5"));
    });

    it("drops a request another moderator decided when JoinRequestDecided arrives", async () => {
      const state = serve();
      const qc = renderList();
      await waitFor(() => expect(row("jr-bob")).toBeInTheDocument());

      state.open = state.open.filter((r) => r.id !== "jr-bob");
      act(() =>
        applyWorkspaceEvent(
          {
            type: "JoinRequestDecided",
            workspace_id: "ws-1",
            request_id: "jr-bob",
            user_id: "u-jr-bob",
            outcome: "declined",
          },
          qc,
          "ws-1",
        ),
      );

      await waitFor(() => expect(screen.queryByTestId("join-request-row-jr-bob")).toBeNull());
      await waitFor(() => expect(heading()).toHaveTextContent("Join requests3"));
      expect(toast.info).not.toHaveBeenCalled();
    });

    it("leaves another workspace's list alone", async () => {
      serve();
      const qc = renderList();
      await screen.findByRole("list", { name: "Join requests" });
      const before = callsTo(requestMock, "query JoinRequests(").length;

      act(() =>
        applyWorkspaceEvent(
          { type: "JoinRequestCreated", workspace_id: "ws-2", request_id: "jr-x", user_id: "u-x" },
          qc,
          "ws-2",
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(callsTo(requestMock, "query JoinRequests(")).toHaveLength(before);
    });
  });
});
