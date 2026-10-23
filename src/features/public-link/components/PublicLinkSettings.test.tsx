import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";

import {
  PublicJoinLinkMode,
  ServerMemberRoleGql,
} from "../../../core/graphql/generated/schema-types";
import { serverInfoQueryClient, type FakeServerDetails } from "../../../test/serverInfo";
import {
  callsTo,
  graphqlError,
  routeRequests,
} from "../../conversations/__fixtures__/conversations";
import { DIRECT_SPACE_ID, startRelayWithDirectSpace } from "../../../test/directSpace";
import { useRelayStore } from "../../relay/state/useRelayStore";
import type { PublicJoinLinkSettings as Link } from "../api/publicLink";

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
import { PUBLIC_LINK_WARNING, PublicLinkSettings } from "./PublicLinkSettings";

const TOKEN = "rim_pjl_AAAAAAAAAAAAAAAAAAAAAA";
const NEW_TOKEN = "rim_pjl_BBBBBBBBBBBBBBBBBBBBBB";

function link(overrides: Partial<Link> = {}): Link {
  return {
    serverId: "ws-1",
    enabled: false,
    mode: PublicJoinLinkMode.DIRECT,
    role: ServerMemberRoleGql.MEMBER,
    enabledAt: null,
    issuedAt: null,
    token: null,
    url: null,
    joinsLastDay: 0,
    joinsLastWeek: 0,
    openRequests: 0,
    ...overrides,
  };
}

const issued = (overrides: Partial<Link> = {}) =>
  link({
    enabled: true,
    enabledAt: "2026-10-20T10:00:00Z",
    issuedAt: "2026-10-20T10:00:00Z",
    token: TOKEN,
    url: `https://rim.example.org/join/${TOKEN}`,
    joinsLastDay: 2,
    joinsLastWeek: 9,
    openRequests: 3,
    ...overrides,
  });

/** A server holding `start` as the link, applying updates and new tokens to it. */
function serve(
  start: Link,
  viewerRole: ServerMemberRoleGql = ServerMemberRoleGql.OWNER,
  extra: Record<string, (vars: Record<string, unknown>) => unknown> = {},
) {
  let current = start;
  routeRequests(requestMock, {
    "query Server(": (vars) => ({ server: { id: vars.serverId, name: "Acme", viewerRole } }),
    "query PublicJoinLink": () => ({ publicJoinLink: current }),
    "mutation UpdatePublicJoinLink": (vars) => {
      const { serverId: _serverId, ...patch } = vars.input as Record<string, unknown>;
      const turnedOn = patch.enabled === true && !current.token;
      current = {
        ...current,
        ...patch,
        ...(turnedOn
          ? { token: TOKEN, url: `https://rim.example.org/join/${TOKEN}`, issuedAt: "now" }
          : {}),
      } as Link;
      return { updatePublicJoinLink: current };
    },
    "mutation ReissuePublicJoinLink": () => {
      current = { ...current, token: NEW_TOKEN, url: `https://rim.example.org/join/${NEW_TOKEN}` };
      return { reissuePublicJoinLink: current };
    },
    ...extra,
  });
}

function renderSettings(
  serverId = "ws-1",
  details: FakeServerDetails = { defaultWorkspace: "ws-default" },
  onOpenRequests?: () => void,
) {
  const qc = serverInfoQueryClient({}, details);
  render(
    <QueryClientProvider client={qc}>
      <PublicLinkSettings serverId={serverId} onOpenRequests={onOpenRequests} />
    </QueryClientProvider>,
  );
  return qc;
}

const linkSwitch = () => screen.getByRole("switch", { name: "Public link" });

describe("PublicLinkSettings", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  afterEach(() => useRelayStore.getState().reset());

  describe("who sees it", () => {
    it("shows the section to the Owner", async () => {
      serve(link());
      renderSettings();
      expect(await screen.findByRole("heading", { name: "Public link" })).toBeInTheDocument();
    });

    it.each([ServerMemberRoleGql.MODERATOR, ServerMemberRoleGql.MEMBER, ServerMemberRoleGql.GUEST])(
      "hides it from a %s and never asks for the link",
      async (role) => {
        serve(link(), role);
        renderSettings();
        await waitFor(() => expect(callsTo(requestMock, "query Server(")).toHaveLength(1));
        expect(screen.queryByRole("heading", { name: "Public link" })).not.toBeInTheDocument();
        expect(callsTo(requestMock, "query PublicJoinLink")).toHaveLength(0);
      },
    );

    it("hides it in the direct space", async () => {
      startRelayWithDirectSpace();
      serve(link());
      renderSettings(DIRECT_SPACE_ID);
      await waitFor(() => expect(callsTo(requestMock, "query Server(")).toHaveLength(1));
      expect(screen.queryByRole("heading", { name: "Public link" })).not.toBeInTheDocument();
      expect(callsTo(requestMock, "query PublicJoinLink")).toHaveLength(0);
    });

    it("hides it in the server's default workspace", async () => {
      serve(link());
      renderSettings("ws-default");
      await waitFor(() => expect(callsTo(requestMock, "query Server(")).toHaveLength(1));
      expect(screen.queryByRole("heading", { name: "Public link" })).not.toBeInTheDocument();
      expect(callsTo(requestMock, "query PublicJoinLink")).toHaveLength(0);
    });

    it("hides it on a server without public links", async () => {
      serve(link(), ServerMemberRoleGql.OWNER, {
        "query PublicJoinLink": () => {
          throw Object.assign(new Error("unknown field"), {
            response: { errors: [{ message: 'Unknown field "publicJoinLink"' }] },
          });
        },
      });
      renderSettings();
      await waitFor(() => expect(callsTo(requestMock, "query PublicJoinLink")).toHaveLength(1));
      await waitFor(() =>
        expect(screen.queryByRole("heading", { name: "Public link" })).not.toBeInTheDocument(),
      );
    });
  });

  it("warns before the first switch-on and turns the link on only after the confirmation", async () => {
    serve(link());
    const user = userEvent.setup();
    renderSettings();

    expect(await screen.findByRole("note")).toHaveTextContent(PUBLIC_LINK_WARNING);
    expect(screen.queryByRole("button", { name: "Copy public link" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Issue a new link" })).not.toBeInTheDocument();

    await user.click(linkSwitch());
    const dialog = screen.getByTestId("moderation-dialog");
    expect(screen.getByRole("dialog", { name: "Turn on the public link?" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent(PUBLIC_LINK_WARNING);
    expect(callsTo(requestMock, "mutation UpdatePublicJoinLink")).toHaveLength(0);

    await user.click(within(dialog).getByRole("button", { name: "Turn on" }));

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation UpdatePublicJoinLink")).toEqual([
        { input: { serverId: "ws-1", enabled: true } },
      ]),
    );
    expect(await screen.findByTestId("public-link-url")).toHaveTextContent(
      `https://rim.example.org/join/${TOKEN}`,
    );
    expect(linkSwitch()).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("does not turn the link on when the warning is cancelled", async () => {
    serve(link());
    const user = userEvent.setup();
    renderSettings();
    await user.click(await screen.findByRole("switch", { name: "Public link" }));
    await user.click(
      within(screen.getByTestId("moderation-dialog")).getByRole("button", { name: "Cancel" }),
    );
    expect(callsTo(requestMock, "mutation UpdatePublicJoinLink")).toHaveLength(0);
    expect(linkSwitch()).toHaveAttribute("aria-checked", "false");
  });

  it("explains that off pauses the link and the same link comes back", async () => {
    serve(issued());
    const user = userEvent.setup();
    renderSettings();

    expect(await screen.findByText(/Turning it on again brings the same link back/)).toBeVisible();
    expect(screen.getByText(/Only issuing a new link ends this one for good/)).toBeVisible();

    await user.click(linkSwitch());
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation UpdatePublicJoinLink")).toEqual([
        { input: { serverId: "ws-1", enabled: false } },
      ]),
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Public link paused. Turning it on again brings the same link back.",
    );
    expect(await screen.findByText(/Paused: nobody can join with this link/)).toBeVisible();
    expect(screen.getByTestId("public-link-url")).toHaveTextContent(TOKEN);

    // On again: no warning dialog, the same link.
    await user.click(linkSwitch());
    expect(screen.queryByTestId("moderation-dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(linkSwitch()).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByTestId("public-link-url")).toHaveTextContent(TOKEN);
  });

  it("changes the mode and the role", async () => {
    serve(issued());
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole("radio", { name: /Ask to join/ }));
    await waitFor(() => expect(screen.getByRole("radio", { name: /Ask to join/ })).toBeChecked());
    await user.click(screen.getByRole("radio", { name: /Guest/ }));
    await waitFor(() => expect(screen.getByRole("radio", { name: /Guest/ })).toBeChecked());

    expect(callsTo(requestMock, "mutation UpdatePublicJoinLink")).toEqual([
      { input: { serverId: "ws-1", mode: PublicJoinLinkMode.REQUESTS } },
      { input: { serverId: "ws-1", role: ServerMemberRoleGql.GUEST } },
    ]);
    expect(screen.getByRole("radio", { name: /Join directly/ })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /Member/ })).not.toBeChecked();
  });

  it("shows the server's refusal of a change", async () => {
    serve(issued(), ServerMemberRoleGql.OWNER, {
      "mutation UpdatePublicJoinLink": () => {
        throw graphqlError("FORBIDDEN", "only the owner can change the public link");
      },
    });
    const user = userEvent.setup();
    renderSettings();
    await user.click(await screen.findByRole("radio", { name: /Guest/ }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("only the owner can change the public link"),
    );
  });

  it("copies the link", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    serve(issued());
    // After `setup`, which installs a clipboard of its own.
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderSettings();

    await user.click(await screen.findByRole("button", { name: "Copy public link" }));

    expect(writeText).toHaveBeenCalledWith(`https://rim.example.org/join/${TOKEN}`);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Public link copied"));
  });

  it("builds the address from this app's origin when the server gives none", async () => {
    serve(issued({ url: null }));
    renderSettings();
    expect(await screen.findByTestId("public-link-url")).toHaveTextContent(
      `${window.location.origin}/join/${TOKEN}`,
    );
  });

  it("issues a new link only after a confirmation that the old one stops everywhere", async () => {
    serve(issued());
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole("button", { name: "Issue a new link" }));
    const dialog = screen.getByTestId("moderation-dialog");
    expect(screen.getByRole("dialog", { name: "Issue a new link?" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      "The current link stops working at once, everywhere it was posted",
    );
    expect(callsTo(requestMock, "mutation ReissuePublicJoinLink")).toHaveLength(0);

    await user.click(within(dialog).getByRole("button", { name: "Issue a new link" }));

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation ReissuePublicJoinLink")).toEqual([
        { serverId: "ws-1" },
      ]),
    );
    expect(await screen.findByTestId("public-link-url")).toHaveTextContent(NEW_TOKEN);
    expect(toast.success).toHaveBeenCalledWith("New link issued. The old one no longer works.");
  });

  it("keeps the old link when the new one is cancelled", async () => {
    serve(issued());
    const user = userEvent.setup();
    renderSettings();
    await user.click(await screen.findByRole("button", { name: "Issue a new link" }));
    await user.click(
      within(screen.getByTestId("moderation-dialog")).getByRole("button", { name: "Cancel" }),
    );
    expect(callsTo(requestMock, "mutation ReissuePublicJoinLink")).toHaveLength(0);
    expect(screen.getByTestId("public-link-url")).toHaveTextContent(TOKEN);
  });

  it("shows the joins of the last day and week and the open requests, which open Moderation", async () => {
    serve(issued());
    const onOpenRequests = vi.fn();
    const user = userEvent.setup();
    renderSettings("ws-1", { defaultWorkspace: "ws-default" }, onOpenRequests);

    const stats = await screen.findByLabelText("Public link use");
    expect(stats).toHaveTextContent("Joined, last 24 hours2 people");
    expect(stats).toHaveTextContent("Joined, last 7 days9 people");
    await user.click(within(stats).getByRole("button", { name: "3 open requests" }));
    expect(onOpenRequests).toHaveBeenCalled();
  });

  it("says one person and no requests in the singular and plain", async () => {
    serve(issued({ joinsLastDay: 1, joinsLastWeek: 1, openRequests: 0 }));
    renderSettings("ws-1", { defaultWorkspace: "ws-default" }, vi.fn());
    const stats = await screen.findByLabelText("Public link use");
    expect(stats).toHaveTextContent("Joined, last 24 hours1 person");
    expect(within(stats).queryByRole("button")).not.toBeInTheDocument();
    expect(stats).toHaveTextContent("0 open requests");
  });
});
