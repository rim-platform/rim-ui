import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import {
  callsTo,
  graphqlError,
  routeRequests,
} from "../../conversations/__fixtures__/conversations";
import {
  MALLORY,
  TROLL,
  abuseReport,
  blockOutcome,
  ipBlock,
  moderationHandlers,
  principalBlock,
  type ModerationWorld,
} from "../__fixtures__/instanceModeration";

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
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { InstanceModerationSettings } from "./InstanceModerationSettings";

const MODERATION_ROOTS = [
  "query InstanceReports(",
  "query InstancePrincipalBlocks",
  "query InstanceIpBlocks",
];

let world: ModerationWorld;

function serve(extra: Record<string, (vars: Record<string, unknown>) => unknown> = {}) {
  routeRequests(requestMock, { ...moderationHandlers(world), ...extra });
}

function renderPage() {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <InstanceModerationSettings />
    </QueryClientProvider>,
  );
}

function typeInto(label: string | RegExp, value: string, form: HTMLElement) {
  fireEvent.change(within(form).getByLabelText(label), { target: { value } });
}

describe("InstanceModerationSettings", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    vi.mocked(toast.info).mockReset();
    useAuthStore.setState({ session: { userId: "u-op" } });
    world = {
      operator: true,
      reports: [
        abuseReport("r1"),
        abuseReport("r2", {
          reporterUserId: null,
          reporterUsername: null,
          subjectPrincipalId: null,
          subjectUsername: null,
          subjectServerId: "rims1_badserver",
        }),
        abuseReport("r3", { resolved: true, resolvedAt: "2026-10-04T10:00:00Z" }),
      ],
      principalBlocks: [principalBlock(TROLL, { username: "troll" })],
      ipBlocks: [
        ipBlock("198.51.100.0/24"),
        ipBlock("203.0.113.7/32", { expiresAt: "2026-10-01T10:00:00Z", expired: true }),
      ],
    };
  });

  it("tells a non-operator the page is for operators and asks for no queue", async () => {
    world.operator = false;
    serve();
    renderPage();
    expect(await screen.findByText("Instance operators only")).toBeInTheDocument();
    for (const root of MODERATION_ROOTS) expect(callsTo(requestMock, root)).toHaveLength(0);
  });

  it("treats a server without the operator field as having no operators", async () => {
    serve({
      "query ViewerInstanceOperator": () => {
        throw Object.assign(new Error("unknown field"), {
          response: { errors: [{ message: 'Unknown field "instanceOperator"' }] },
        });
      },
    });
    renderPage();
    expect(await screen.findByText("Instance operators only")).toBeInTheDocument();
  });

  it.each(MODERATION_ROOTS)("shows the operators-only state when %s is FORBIDDEN", async (root) => {
    serve({
      [root]: () => {
        throw graphqlError("FORBIDDEN", "instance operators only");
      },
    });
    renderPage();
    expect(await screen.findByText("Instance operators only")).toBeInTheDocument();
    expect(screen.queryByText("Instance moderation")).not.toBeInTheDocument();
  });

  it("lists open reports with subject, reporter and reason", async () => {
    serve();
    renderPage();
    const r1 = await screen.findByTestId("instance-report-r1");
    expect(callsTo(requestMock, "query InstanceReports(")[0]).toEqual({
      openOnly: true,
      after: null,
      limit: 100,
    });
    expect(r1).toHaveTextContent("@mallory");
    expect(r1).toHaveTextContent(MALLORY);
    expect(r1).toHaveTextContent("reported by @alice");
    expect(r1).toHaveTextContent("reason r1");
    const r2 = screen.getByTestId("instance-report-r2");
    expect(r2).toHaveTextContent("rims1_badserver");
    expect(r2).toHaveTextContent("reported by the abuse address");
    expect(within(r2).queryByRole("button", { name: /Block principal/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId("instance-report-r3")).not.toBeInTheDocument();
  });

  it("lists the reports of DMs and groups in the direct space and resolves one", async () => {
    useRelayStore.setState({
      info: { serverId: "rims1_relay", roles: ["relay"], directSpaceId: "direct-1" },
    });
    try {
      serve({
        "query DirectSpaceMessageReports": () => ({
          messageReports: {
            items: [
              {
                id: "dm-r1",
                conversationId: "dm-1",
                messageId: "m-1",
                reporterUserId: "u-alice",
                reason: "threats in a DM",
                status: "OPEN",
                resolvedAt: null,
                createdAt: "2026-10-03T10:00:00Z",
                messageReadable: false,
                messageText: null,
                messageAuthorId: "u-mallory",
                messageSentAt: null,
                frankingVerifiedAt: null,
                frankedSenderDeviceId: null,
                frankedContentExpiresAt: null,
              },
            ],
            next: null,
            pageInfo: { hasNext: false, hasPrev: false },
          },
        }),
        "mutation ResolveReport": (vars) => ({
          resolveReport: { id: vars.reportId, status: vars.outcome },
        }),
      });
      renderPage();
      const row = await screen.findByTestId("report-row-dm-r1");
      expect(screen.getByText("Reported direct messages")).toBeInTheDocument();
      expect(callsTo(requestMock, "query DirectSpaceMessageReports")[0]).toMatchObject({
        serverId: "direct-1",
      });
      expect(row).toHaveTextContent("threats in a DM");
      fireEvent.click(within(row).getByRole("button", { name: "Resolve" }));
      await waitFor(() =>
        expect(callsTo(requestMock, "mutation ResolveReport")).toEqual([
          { serverId: "direct-1", reportId: "dm-r1", outcome: "RESOLVED" },
        ]),
      );
    } finally {
      useRelayStore.setState({ info: null });
    }
  });

  it("shows a reported unencrypted DM message, blocks its author's principal and deletes it", async () => {
    useRelayStore.setState({
      info: { serverId: "rims1_relay", roles: ["relay"], directSpaceId: "direct-1" },
    });
    try {
      serve({
        "query DirectSpaceMessageReports": () => ({
          messageReports: {
            items: [
              {
                id: "dm-r2",
                conversationId: "dm-2",
                messageId: "m-2",
                reporterUserId: "u-alice",
                reason: "spam in a DM",
                status: "OPEN",
                resolvedBy: null,
                resolvedAt: null,
                createdAt: "2026-10-03T10:00:00Z",
                messageReadable: false,
                messageText: "buy cheap stuff",
                messageAuthorId: "u-mallory",
                messageAuthorPrincipalId: MALLORY,
                messageSentAt: "2026-10-03T09:00:00Z",
                frankingVerifiedAt: null,
                frankedSenderDeviceId: null,
                frankedContentExpiresAt: null,
              },
            ],
            next: null,
            pageInfo: { hasNext: false, hasPrev: false },
          },
        }),
        "mutation DeleteReportedMessage": () => ({ deleteMessage: true }),
      });
      renderPage();
      const row = await screen.findByTestId("report-row-dm-r2");
      expect(row).toHaveTextContent("buy cheap stuff");
      expect(row).toHaveTextContent("Only the reported message is shown");
      expect(row).toHaveTextContent(`a message by ${MALLORY}`);
      expect(row).not.toHaveTextContent("u-mallor");
      expect(row).not.toHaveTextContent("message not visible to you");

      fireEvent.click(within(row).getByRole("button", { name: `Block principal ${MALLORY}` }));
      const form = screen.getByRole("form", { name: "Block a principal" });
      expect(within(form).getByLabelText("Principal id")).toHaveValue(MALLORY);
      expect(within(form).getByLabelText("Reason")).toHaveFocus();

      fireEvent.click(within(row).getByRole("button", { name: "Delete message" }));
      const dialog = screen.getByRole("dialog", { name: "Delete this message?" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
      await waitFor(() =>
        expect(callsTo(requestMock, "mutation DeleteReportedMessage")).toEqual([
          { input: { serverId: "direct-1", conversationId: "dm-2", messageId: "m-2" } },
        ]),
      );
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Message deleted"));
    } finally {
      useRelayStore.setState({ info: null });
    }
  });

  it("asks for no direct-space reports before relayInfo answers", async () => {
    serve();
    renderPage();
    await screen.findByTestId("instance-report-r1");
    expect(screen.queryByText("Reported direct messages")).not.toBeInTheDocument();
    expect(callsTo(requestMock, "query DirectSpaceMessageReports")).toHaveLength(0);
  });

  it("pages through the reports with Load more, after the last one shown", async () => {
    world.reports = Array.from({ length: 101 }, (_, i) => abuseReport(`p${i}`));
    serve();
    renderPage();
    await screen.findByTestId("instance-report-p99");
    expect(screen.queryByTestId("instance-report-p100")).not.toBeInTheDocument();
    expect(screen.queryByText(/only the oldest/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByTestId("instance-report-p100")).toBeInTheDocument();
    expect(screen.getByTestId("instance-report-p0")).toBeInTheDocument();
    expect(callsTo(requestMock, "query InstanceReports(")).toEqual([
      { openOnly: true, after: null, limit: 100 },
      { openOnly: true, after: "p99", limit: 100 },
    ]);
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("shows no Load more while the reports fit in one page", async () => {
    serve();
    renderPage();
    await screen.findByTestId("instance-report-r1");
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("shows resolved reports, without Resolve, when asked", async () => {
    serve();
    renderPage();
    await screen.findByTestId("instance-report-r1");
    fireEvent.click(screen.getByRole("switch", { name: "Show resolved reports" }));
    const r3 = await screen.findByTestId("instance-report-r3");
    expect(callsTo(requestMock, "query InstanceReports(").at(-1)).toEqual({
      openOnly: false,
      after: null,
      limit: 100,
    });
    expect(r3).toHaveTextContent("Resolved");
    expect(within(r3).queryByRole("button", { name: "Resolve" })).not.toBeInTheDocument();
  });

  it("resolves a report and drops it from the open list", async () => {
    serve();
    renderPage();
    const r1 = await screen.findByTestId("instance-report-r1");
    fireEvent.click(within(r1).getByRole("button", { name: "Resolve" }));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation InstanceResolveReport")).toEqual([{ id: "r1" }]),
    );
    await waitFor(() => expect(screen.queryByTestId("instance-report-r1")).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith("Report resolved");
  });

  it("toasts the server's message when a resolve fails", async () => {
    serve({
      "mutation InstanceResolveReport": () => {
        throw graphqlError("NOT_FOUND", "no such report");
      },
    });
    renderPage();
    const r1 = await screen.findByTestId("instance-report-r1");
    fireEvent.click(within(r1).getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("no such report"));
  });

  it("blocks a report's principal from the report, with cascade, and shows what it did", async () => {
    world.nextBlockOutcomes = [
      blockOutcome(MALLORY, "mallory"),
      blockOutcome("rimp1_sock", "sock", {
        endedSessions: 1,
        revokedInvites: 0,
        emailBlocked: false,
        newlyBlocked: false,
      }),
    ];
    serve();
    renderPage();
    const r1 = await screen.findByTestId("instance-report-r1");
    fireEvent.click(within(r1).getByRole("button", { name: "Block principal @mallory" }));

    const form = screen.getByRole("form", { name: "Block a principal" });
    expect(within(form).getByLabelText("Principal id")).toHaveValue(MALLORY);
    expect(within(form).getByLabelText("Reason")).toHaveFocus();
    typeInto("Reason", "harassment", form);
    fireEvent.click(within(form).getByLabelText(/Also block the accounts its invites created/));
    fireEvent.click(within(form).getByRole("button", { name: "Block principal" }));

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation InstanceBlockPrincipal")).toEqual([
        { principalId: MALLORY, reason: "harassment", cascade: true },
      ]),
    );
    const outcomes = await within(form).findByRole("list", { name: "Block outcomes" });
    expect(form).toHaveTextContent("Blocked 2 accounts.");
    const [first, second] = within(outcomes).getAllByRole("listitem");
    expect(first).toHaveTextContent(
      "@mallory: blocked · 2 sessions ended · 1 invite revoked · 0 DM requests ignored · email blocked",
    );
    expect(second).toHaveTextContent(
      "@sock: already blocked, reason replaced · 1 session ended · 0 invites revoked",
    );
    expect(second).toHaveTextContent("email not blocked");
    expect(await screen.findByTestId(`principal-block-${MALLORY}`)).toHaveTextContent("harassment");
  });

  it("shows the server's validation message in the block form", async () => {
    serve({
      "mutation InstanceBlockPrincipal": () => {
        throw graphqlError("VALIDATION", "principal id must start with rimp1_");
      },
    });
    renderPage();
    const form = await screen.findByRole("form", { name: "Block a principal" });
    typeInto("Principal id", "nonsense", form);
    typeInto("Reason", "spam", form);
    fireEvent.click(within(form).getByRole("button", { name: "Block principal" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "principal id must start with rimp1_",
    );
  });

  it("unblocks a principal and drops it from the list", async () => {
    serve();
    renderPage();
    const row = await screen.findByTestId(`principal-block-${TROLL}`);
    expect(row).toHaveTextContent("@troll");
    expect(row).toHaveTextContent("spam");
    fireEvent.click(within(row).getByRole("button", { name: "Unblock @troll" }));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation InstanceUnblockPrincipal")).toEqual([
        { principalId: TROLL },
      ]),
    );
    await waitFor(() =>
      expect(screen.queryByTestId(`principal-block-${TROLL}`)).not.toBeInTheDocument(),
    );
    expect(toast.success).toHaveBeenCalledWith("Unblocked @troll and their email");
  });

  it("lists IP blocks with their expiry and the expired flag", async () => {
    serve();
    renderPage();
    const open = await screen.findByTestId("ip-block-198.51.100.0/24");
    expect(open).toHaveTextContent("scraping");
    expect(open).toHaveTextContent("Until removed");
    const expired = screen.getByTestId("ip-block-203.0.113.7/32");
    expect(expired).toHaveTextContent(/Expired.*Expired/);
  });

  it("blocks an address for a number of days and lists it", async () => {
    serve();
    renderPage();
    const form = await screen.findByRole("form", { name: "Block an address" });
    typeInto("Address or CIDR range", " 192.0.2.0/24 ", form);
    typeInto("Reason", "credential stuffing", form);
    typeInto("Days (optional)", "30", form);
    fireEvent.click(within(form).getByRole("button", { name: "Block address" }));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation InstanceBlockIp")).toEqual([
        { cidr: "192.0.2.0/24", reason: "credential stuffing", expiresInDays: 30 },
      ]),
    );
    expect(await screen.findByTestId("ip-block-192.0.2.0/24")).toHaveTextContent("Expires");
    expect(toast.success).toHaveBeenCalledWith("Blocked 192.0.2.0/24");
    expect(within(form).getByLabelText("Address or CIDR range")).toHaveValue("");
  });

  it("blocks an address until removed when no days are given", async () => {
    serve();
    renderPage();
    const form = await screen.findByRole("form", { name: "Block an address" });
    typeInto("Address or CIDR range", "198.51.100.0/24", form);
    typeInto("Reason", "still scraping", form);
    fireEvent.click(within(form).getByRole("button", { name: "Block address" }));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation InstanceBlockIp")).toEqual([
        { cidr: "198.51.100.0/24", reason: "still scraping", expiresInDays: null },
      ]),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Updated the block on 198.51.100.0/24"),
    );
  });

  it.each(["0", "366", "1.5"])("refuses %s days before asking the server", async (days) => {
    serve();
    renderPage();
    const form = await screen.findByRole("form", { name: "Block an address" });
    typeInto("Address or CIDR range", "192.0.2.1", form);
    typeInto("Reason", "spam", form);
    typeInto("Days (optional)", days, form);
    expect(within(form).getByRole("alert")).toHaveTextContent("from 1 to 365");
    expect(within(form).getByRole("button", { name: "Block address" })).toBeDisabled();
  });

  it("unblocks an address and drops it from the list", async () => {
    serve();
    renderPage();
    const row = await screen.findByTestId("ip-block-198.51.100.0/24");
    fireEvent.click(within(row).getByRole("button", { name: "Unblock 198.51.100.0/24" }));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation InstanceUnblockIp")).toEqual([
        { cidr: "198.51.100.0/24" },
      ]),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("ip-block-198.51.100.0/24")).not.toBeInTheDocument(),
    );
    expect(toast.success).toHaveBeenCalledWith("Unblocked 198.51.100.0/24");
  });

  it("re-checks the role when a change is refused with FORBIDDEN", async () => {
    serve({
      "mutation InstanceUnblockIp": () => {
        world.operator = false;
        throw graphqlError("FORBIDDEN", "instance operators only");
      },
    });
    renderPage();
    const row = await screen.findByTestId("ip-block-198.51.100.0/24");
    fireEvent.click(within(row).getByRole("button", { name: "Unblock 198.51.100.0/24" }));
    expect(await screen.findByText("Instance operators only")).toBeInTheDocument();
    expect(callsTo(requestMock, "query ViewerInstanceOperator")).toHaveLength(2);
  });
});
