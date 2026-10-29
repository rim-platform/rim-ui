import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import { fakeServerInfo } from "../../../test/serverInfo";
import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";
import {
  baseReadHandlers,
  callsTo,
  routeRequests,
  workspaceMembers,
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
vi.mock("../../e2ee/api/e2eeCommands", () => ({
  decryptReportedAttachment: vi.fn(),
}));

import { toast } from "../../../shared/toast";
import { decryptReportedAttachment } from "../../e2ee/api/e2eeCommands";
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
    messageSentAt: null,
    frankingVerifiedAt: null,
    frankedSenderDeviceId: null,
    frankedContentExpiresAt: null,
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
    queryClient.clear();
    queryClient.setQueryData(queryKeys.serverInfo, fakeServerInfo());
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
    expect(callsTo(requestMock, "query DirectSpaceMessageReports")).toHaveLength(0);
    expect(within(row).queryByRole("button", { name: /Block principal/ })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Delete message" })).not.toBeInTheDocument();
    expect(row).not.toHaveTextContent("Only the reported message is shown");
  });

  it("names the automatic check as the reporter of its reports", async () => {
    queryClient.setQueryData(
      queryKeys.serverInfo,
      fakeServerInfo({}, { capabilities: ["message_edited_at", "message_flag"] }),
    );
    // Replaces the reports handler in place: its needle also matches the gated document.
    serve({
      "query MessageReports": () => ({
        messageReports: {
          items: [report("r1", { reporterUserId: null, automatic: true }), report("r2")],
          next: null,
          pageInfo: { hasNext: false, hasPrev: false },
        },
      }),
    });
    renderSettings();
    const automatic = await screen.findByTestId("report-row-r1");
    await waitFor(() => expect(screen.getByTestId("report-row-r2")).toHaveTextContent("Alice"));
    expect(automatic).toHaveTextContent("Automatic check");
    expect(automatic).toHaveTextContent("a message by Bob");
    expect(automatic).not.toHaveTextContent("Alice");
    expect(callsTo(requestMock, "query MessageReportsWithAutomatic(")).toHaveLength(1);
    expect(callsTo(requestMock, "query MessageReports(")).toHaveLength(0);
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

/** The spec's known-answer content: a mention of Bob and one attachment. */
const BOB_PRINCIPAL = "rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo";
const CONTENT = `{"v":1,"type":"message","id":"0199d1a0-0000-7000-8000-000000000002","rev":0,"threadRootId":null,"body":"hi <@${BOB_PRINCIPAL}>","mentions":["${BOB_PRINCIPAL}"],"mentionAll":false,"replyTo":null,"forwardedFrom":null,"attachments":[{"blobSha256":"EHFcZ6hUOIdDi32ptdrCXM2PTHQwKF46-0Ls56yQrac","secret":"oKGio6SlpqeoqaqrrK2ur7CxsrO0tba3uLm6u7y9vr8","name":"hello.txt","mime":"text/plain","size":18}],"linkPreviews":[]}`;
const BLOB_HEX = "096d52fa9b833e37ef33d387fc5ecab34eabb410807b85e90c862a44614c7c9cb163";

function base64Url(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function hexBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
}

const verified = {
  conversationId: "conv-dm",
  messageId: "0199d1a0-0000-7000-8000-000000000002",
  messageReadable: false,
  messageText: null,
  messageAuthorId: "u-alice",
  messageSentAt: "2026-10-09T00:00:00.123456Z",
  frankingVerifiedAt: "2026-10-09T01:00:00Z",
  frankedSenderDeviceId: "00000000-0000-0000-0000-000000000001",
};

describe("ModerationSettings — verified encrypted reports", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    requestMock.mockReset();
    queryClient.clear();
    queryClient.setQueryData(queryKeys.serverInfo, fakeServerInfo());
    fetchMock.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    vi.mocked(decryptReportedAttachment).mockReset();
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = vi.fn(() => "blob:report");
    URL.revokeObjectURL = vi.fn();
  });

  function serveEncrypted(detail: Record<string, unknown> = {}) {
    // "query MessageReport(" before "query Me", which is a prefix of it.
    routeRequests(requestMock, {
      "query MessageReport(": () => ({
        messageReport: {
          ...report("e1", verified),
          frankedContentExpiresAt: null,
          frankedContent: base64Url(CONTENT),
          ...detail,
        },
      }),
      "query MessageReports": () => ({
        messageReports: {
          items: [report("e1", verified)],
          next: null,
          pageInfo: { hasNext: false, hasPrev: false },
        },
      }),
      "query Server(": () => ({
        server: { id: "ws-1", name: "Acme", viewerRole: ServerMemberRoleGql.MODERATOR },
      }),
      "query ServerBans": () => ({ serverBans: [] }),
      "query ServerMembers": () => ({
        serverMembers: workspaceMembers.map((m) =>
          m.userId === "u-bob" ? { ...m, principalId: BOB_PRINCIPAL } : m,
        ),
      }),
      "query PrincipalDevices": () => ({ principalDevices: [] }),
      "mutation DeleteReportedMessage": () => ({ deleteMessage: true }),
      "query Me": baseReadHandlers["query Me"],
    });
  }

  it("shows the verified content only when the moderator opens it", async () => {
    serveEncrypted();
    renderSettings();
    const row = await screen.findByTestId("report-row-e1");
    expect(row).toHaveTextContent("Encrypted · verified");
    expect(row).not.toHaveTextContent("message not visible to you");
    expect(callsTo(requestMock, "query MessageReport(")).toHaveLength(0);

    fireEvent.click(within(row).getByRole("button", { name: "Show reported message" }));
    expect(await within(row).findByTestId("reported-body")).toHaveTextContent("hi @Bob");
    expect(callsTo(requestMock, "query MessageReport(")).toEqual([
      { serverId: "ws-1", reportId: "e1" },
    ]);
    expect(row).toHaveTextContent(
      "Verified: this is the exact message Alice's device sent. Other messages in the conversation are not shown and are not verified.",
    );
    expect(row).toHaveTextContent("hello.txt");
    expect(row).toHaveTextContent("18 B");
    expect(row).toHaveTextContent("00000000-0000-0000-0000-000000000001");
    expect(row).toHaveTextContent("An encrypted conversation you are not in");
    expect(row).toHaveTextContent("kept until 90 days after this report is closed");
  });

  it("downloads a reported attachment through the report and decrypts it here", async () => {
    serveEncrypted();
    const blob = hexBytes(BLOB_HEX);
    fetchMock.mockResolvedValue(new Response(blob));
    vi.mocked(decryptReportedAttachment).mockResolvedValue(
      new TextEncoder().encode("hello, attachment\n"),
    );
    renderSettings();
    const row = await screen.findByTestId("report-row-e1");
    fireEvent.click(within(row).getByRole("button", { name: "Show reported message" }));
    fireEvent.click(await within(row).findByRole("button", { name: "Download hello.txt" }));

    await waitFor(() => expect(decryptReportedAttachment).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toMatch(
      /\/api\/reports\/e1\/attachments\/EHFcZ6hUOIdDi32ptdrCXM2PTHQwKF46-0Ls56yQrac$/,
    );
    expect(fetchMock.mock.calls[0][1]).toEqual({ credentials: "include" });
    const [content, hash, sent] = vi.mocked(decryptReportedAttachment).mock.calls[0];
    expect(new TextDecoder().decode(content)).toBe(CONTENT);
    expect(hash).toBe("EHFcZ6hUOIdDi32ptdrCXM2PTHQwKF46-0Ls56yQrac");
    expect(Array.from(sent)).toEqual(Array.from(blob));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("says when the content was deleted, and deletes the message after a confirm", async () => {
    serveEncrypted({
      status: "RESOLVED",
      frankedContent: null,
      frankedContentExpiresAt: "2026-01-07T10:00:00Z",
    });
    renderSettings();
    const row = await screen.findByTestId("report-row-e1");
    fireEvent.click(within(row).getByRole("button", { name: "Show reported message" }));
    expect(
      await within(row).findByText("The reported content has been deleted from the server."),
    ).toBeInTheDocument();
    expect(row).toHaveTextContent("deleted from the server on");

    fireEvent.click(within(row).getByRole("button", { name: "Delete message" }));
    const dialog = screen.getByRole("dialog", { name: "Delete this message?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation DeleteReportedMessage")).toEqual([
        {
          input: {
            serverId: "ws-1",
            conversationId: "conv-dm",
            messageId: "0199d1a0-0000-7000-8000-000000000002",
          },
        },
      ]),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Message deleted"));
  });
});
