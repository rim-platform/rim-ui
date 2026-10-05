import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import { ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";
import {
  baseReadHandlers,
  callsTo,
  routeRequests,
} from "../../conversations/__fixtures__/conversations";

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
import { ModerationSettings } from "./ModerationSettings";

const bans = [
  {
    userId: "u-carol",
    reason: "spam",
    bannedBy: "me",
    createdAt: "2026-10-01T10:00:00Z",
    expiresAt: null,
    user: { id: "u-carol", username: "carol", displayName: "Carol", avatarUrl: null },
  },
  {
    userId: "u-dave",
    reason: null,
    bannedBy: "me",
    createdAt: "2026-10-02T10:00:00Z",
    expiresAt: "2026-11-02T10:00:00Z",
    user: null,
  },
];

function report(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    conversationId: "conv-1",
    messageId: `m-${id}`,
    reporterUserId: "u-alice",
    reason: `reason ${id}`,
    status: "OPEN",
    resolvedBy: null,
    resolvedAt: null,
    createdAt: "2026-10-03T10:00:00Z",
    messageReadable: true,
    messageText: `text of ${id}`,
    messageAuthorId: "u-bob",
    ...overrides,
  };
}

const firstPage = {
  items: [
    report("r1"),
    report("r2", { messageReadable: false, messageText: null, messageAuthorId: null }),
  ],
  next: { createdAt: "2026-10-03T10:00:00Z", reportId: "r2" },
  pageInfo: { hasNext: true, hasPrev: false },
};

const secondPage = {
  items: [report("r3")],
  next: null,
  pageInfo: { hasNext: false, hasPrev: true },
};

function serve(extra: Record<string, (vars: Record<string, unknown>) => unknown> = {}) {
  // Specific handlers first: "query Me" (from the base handlers) is a prefix of
  // "query MessageReports". Overrides replace values in place, keeping that order.
  const handlers: Record<string, (vars: Record<string, unknown>) => unknown> = {
    "query Server(": () => ({
      server: { id: "ws-1", name: "Acme", viewerRole: ServerMemberRoleGql.MODERATOR },
    }),
    "query ServerBans": () => ({ serverBans: bans }),
    "query MessageReports": (vars) => ({
      messageReports: vars.cursor ? secondPage : firstPage,
    }),
    "mutation UnbanMember": () => ({ unbanMember: true }),
    "mutation ResolveReport": (vars) => ({
      resolveReport: { id: vars.reportId, status: vars.outcome },
    }),
    ...baseReadHandlers,
  };
  routeRequests(requestMock, Object.assign(handlers, extra));
}

function renderSettings() {
  const qc = createTestQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <ModerationSettings serverId="ws-1" />
    </QueryClientProvider>,
  );
  return qc;
}

describe("ModerationSettings", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it("renders nothing for an ordinary member", async () => {
    routeRequests(requestMock, {
      ...baseReadHandlers,
      "query Server(": () => ({
        server: { id: "ws-1", name: "Acme", viewerRole: ServerMemberRoleGql.MEMBER },
      }),
    });
    renderSettings();
    await waitFor(() => expect(callsTo(requestMock, "query Server(")).toHaveLength(1));
    expect(screen.queryByText("Moderation")).not.toBeInTheDocument();
    expect(callsTo(requestMock, "query ServerBans")).toHaveLength(0);
  });

  it("lists bans with reason and expiry and lifts one", async () => {
    serve();
    renderSettings();
    const carol = await screen.findByTestId("ban-row-u-carol");
    expect(carol).toHaveTextContent("Carol");
    expect(carol).toHaveTextContent("spam");
    expect(carol).toHaveTextContent("Never expires");
    const dave = screen.getByTestId("ban-row-u-dave");
    expect(dave).toHaveTextContent("No reason given");
    expect(dave).toHaveTextContent("Expires");

    fireEvent.click(within(carol).getByRole("button", { name: "Unban Carol" }));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation UnbanMember")).toEqual([
        { serverId: "ws-1", userId: "u-carol" },
      ]),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Unbanned Carol"));
  });

  it("asks for open reports by default and shows reporter, reason and message", async () => {
    serve();
    renderSettings();
    const row = await screen.findByTestId("report-row-r1");
    expect(callsTo(requestMock, "query MessageReports")[0]).toEqual({
      serverId: "ws-1",
      status: "OPEN",
      dir: "AFTER",
      cursor: null,
      limit: 20,
    });
    await waitFor(() => expect(row).toHaveTextContent("Alice"));
    expect(row).toHaveTextContent("a message by Bob");
    expect(row).toHaveTextContent("reason r1");
    expect(row).toHaveTextContent("text of r1");
  });

  it("says when the reported message is not visible to the moderator", async () => {
    serve();
    renderSettings();
    const row = await screen.findByTestId("report-row-r2");
    expect(row).toHaveTextContent("message not visible to you");
    expect(row).not.toHaveTextContent("text of r2");
  });

  it("resolves and dismisses reports", async () => {
    serve();
    renderSettings();
    const r1 = await screen.findByTestId("report-row-r1");
    fireEvent.click(within(r1).getByRole("button", { name: "Resolve" }));
    const r2 = screen.getByTestId("report-row-r2");
    fireEvent.click(within(r2).getByRole("button", { name: "Dismiss" }));

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation ResolveReport")).toEqual([
        { serverId: "ws-1", reportId: "r1", outcome: "RESOLVED" },
        { serverId: "ws-1", reportId: "r2", outcome: "DISMISSED" },
      ]),
    );
    expect(toast.success).toHaveBeenCalledWith("Report resolved");
    expect(toast.success).toHaveBeenCalledWith("Report dismissed");
  });

  it("loads more reports with the next cursor", async () => {
    serve();
    renderSettings();
    await screen.findByTestId("report-row-r1");
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByTestId("report-row-r3")).toBeInTheDocument();
    expect(callsTo(requestMock, "query MessageReports")[1]).toEqual({
      serverId: "ws-1",
      status: "OPEN",
      dir: "AFTER",
      cursor: { createdAt: "2026-10-03T10:00:00Z", reportId: "r2" },
      limit: 20,
    });
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("filters by status, with no Resolve/Dismiss on closed reports", async () => {
    serve({
      "query MessageReports": (vars) => ({
        messageReports: {
          items: vars.status === "RESOLVED" ? [report("r9", { status: "RESOLVED" })] : [],
          next: null,
          pageInfo: { hasNext: false, hasPrev: false },
        },
      }),
    });
    renderSettings();
    expect(await screen.findByText("No reports.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "RESOLVED" } });

    const row = await screen.findByTestId("report-row-r9");
    expect(row).toHaveTextContent("Resolved");
    expect(within(row).queryByRole("button", { name: "Resolve" })).not.toBeInTheDocument();
    expect(callsTo(requestMock, "query MessageReports").map((v) => v.status)).toEqual([
      "OPEN",
      "RESOLVED",
    ]);
  });
});
