import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import {
  JoinRequestStatus,
  PublicJoinLinkMode,
  PublicJoinLinkViewer,
} from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import {
  callsTo,
  graphqlError,
  routeRequests,
} from "../../conversations/__fixtures__/conversations";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import type {
  JoinRequestRow,
  PublicJoinLinkPreviewData,
} from "../../workspaces/api/publicJoinLink";
import { useAuthStore } from "../state/useAuthStore";
import { PENDING_PUBLIC_LINK_KEY } from "../pendingPublicLink";
import { usePendingPublicLinkReturn } from "../hooks/usePendingPublicLinkReturn";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

const mockNavigate = vi.hoisted(() => vi.fn());
const routing = vi.hoisted(() => ({ real: false }));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => (routing.real ? actual.useNavigate() : mockNavigate),
  };
});

// Whether the session cookie is still being checked; the session itself is the auth store's.
const hydration = vi.hoisted(() => ({ isHydrating: false }));
vi.mock("../api/useSessionHydration", () => ({
  useSessionHydration: () => ({ isHydrating: hydration.isHydrating, isAuthenticated: false }),
}));

import { PublicLinkJoin } from "./PublicLinkJoin";

const TOKEN = "rim_pjl_AAAAAAAAAAAAAAAAAAAAAA";

function preview(overrides: Partial<PublicJoinLinkPreviewData> = {}): PublicJoinLinkPreviewData {
  return {
    serverId: "ws-acme",
    name: "Acme Community",
    mode: PublicJoinLinkMode.DIRECT,
    viewer: PublicJoinLinkViewer.NOT_MEMBER,
    joinRequestId: null,
    ...overrides,
  };
}

const filed: JoinRequestRow = {
  id: "jr-1",
  serverId: "ws-acme",
  workspaceName: "Acme Community",
  userId: "u1",
  message: "Hi there",
  status: JoinRequestStatus.OPEN,
  createdAt: "2026-10-23T10:00:00Z",
  expiresAt: "2026-11-22T10:00:00Z",
  user: null,
};

type Handler = (vars: Record<string, unknown>) => unknown;

function serve(answer: () => PublicJoinLinkPreviewData, extra: Record<string, Handler> = {}) {
  routeRequests(requestMock, {
    "query PublicJoinLinkPreview": () => ({ publicJoinLinkPreview: answer() }),
    "query RegistrationMode": () => ({ registrationMode: "INVITE_ONLY" }),
    ...extra,
  });
}

function renderPage({
  userId = "u1",
  isHydrating = false,
}: { userId?: string | null; isHydrating?: boolean } = {}) {
  hydration.isHydrating = isHydrating;
  useAuthStore.setState({ session: userId ? { userId } : null });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <PublicLinkJoin token={TOKEN} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return qc;
}

describe("PublicLinkJoin", () => {
  beforeEach(() => {
    requestMock.mockReset();
    mockNavigate.mockReset();
    sessionStorage.clear();
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useAuthStore.setState({ session: null });
  });

  it("sends no referrer while it is open", () => {
    serve(() => preview());
    renderPage();
    expect(document.querySelector("meta[name='referrer']")).toHaveAttribute(
      "content",
      "no-referrer",
    );
  });

  it("waits for the session check before looking the link up", () => {
    serve(() => preview());
    renderPage({ isHydrating: true });
    expect(screen.getByText("Restoring session...")).toBeInTheDocument();
    expect(callsTo(requestMock, "query PublicJoinLinkPreview")).toHaveLength(0);
  });

  it("says the link isn't valid, the same for every cause", async () => {
    serve(() => {
      throw graphqlError("NOT_FOUND", "not found");
    });
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent(/^This link isn't valid\.$/);
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(callsTo(requestMock, "query PublicJoinLinkPreview")).toEqual([{ token: TOKEN }]);
  });

  it("says when to try again after too many invalid links", async () => {
    serve(() => {
      throw Object.assign(new Error("rate limited"), {
        response: {
          errors: [
            {
              message: "too many requests",
              extensions: { code: "RATE_LIMITED", retryAfterSeconds: 3420 },
            },
          ],
        },
      });
    });
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many tries from this network. Try again in 57 minutes.",
    );
  });

  it("offers to try again when the link could not be read", async () => {
    let fail = true;
    serve(() => {
      if (fail) throw new Error("network down");
      return preview();
    });
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load this link.");
    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Join Acme Community" })).toBeInTheDocument();
  });

  it.each([
    ["Sign in", "/login"],
    ["Create an account", "/join"],
  ])("keeps the link for after %s and goes to %s", async (button, path) => {
    serve(() => preview({ viewer: PublicJoinLinkViewer.SIGNED_OUT }));
    const user = userEvent.setup();
    renderPage({ userId: null });

    expect(await screen.findByRole("heading", { name: "Acme Community" })).toBeInTheDocument();
    expect(await screen.findByText(/only with an invite from someone on it/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: button }));
    expect(sessionStorage.getItem(PENDING_PUBLIC_LINK_KEY)).toBe(TOKEN);
    expect(mockNavigate).toHaveBeenCalledWith(path);
    expect(callsTo(requestMock, "mutation")).toHaveLength(0);
    expect(callsTo(requestMock, "PreviewInviteToken")).toHaveLength(0);
  });

  it("opens the workspace for a member", async () => {
    serve(() => preview({ viewer: PublicJoinLinkViewer.MEMBER }));
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText("You're already a member.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    expect(useWorkspaceStore.getState().workspaceId).toBe("ws-acme");
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });

  it("tells a banned person they are banned and offers nothing", async () => {
    serve(() => preview({ viewer: PublicJoinLinkViewer.BANNED }));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /^You are banned from this workspace\.$/,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("joins directly and opens the workspace in the rail", async () => {
    serve(() => preview(), {
      "mutation JoinByPublicLink": () => ({
        joinByPublicLink: { outcome: "JOINED", serverId: "ws-acme", joinRequest: null },
      }),
    });
    const user = userEvent.setup();
    const qc = renderPage();
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    expect(await screen.findByText("You can join")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Join Acme Community" }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/"));
    expect(useWorkspaceStore.getState().workspaceId).toBe("ws-acme");
    expect(callsTo(requestMock, "mutation JoinByPublicLink")).toEqual([
      { token: TOKEN, message: null },
    ]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.myServers() });
  });

  it.each([
    [
      "CONFLICT",
      "already a member of this workspace",
      "You are already a member of this workspace.",
    ],
    ["FORBIDDEN", "you are banned from this workspace", "You are banned from this workspace."],
    [
      "VALIDATION",
      "this instance allows 50 members per workspace",
      "This instance allows 50 members per workspace.",
    ],
    ["NOT_FOUND", "not found", "This link isn't valid."],
  ])("says why a %s join was refused and reads the link again", async (code, message, shown) => {
    serve(() => preview(), {
      "mutation JoinByPublicLink": () => {
        throw graphqlError(code, message);
      },
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Join Acme Community" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(shown);
    await waitFor(() =>
      expect(callsTo(requestMock, "query PublicJoinLinkPreview")).toHaveLength(2),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("asks to join with a message, then waits for the moderators", async () => {
    let asked = false;
    serve(
      () =>
        preview({
          mode: PublicJoinLinkMode.REQUESTS,
          viewer: asked ? PublicJoinLinkViewer.REQUEST_OPEN : PublicJoinLinkViewer.NOT_MEMBER,
          joinRequestId: asked ? "jr-1" : null,
        }),
      {
        "mutation JoinByPublicLink": () => {
          asked = true;
          return {
            joinByPublicLink: { outcome: "REQUESTED", serverId: "ws-acme", joinRequest: filed },
          };
        },
      },
    );
    const user = userEvent.setup();
    const qc = renderPage();

    expect(await screen.findByText("You can ask to join")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Message (optional)"), "  Hi there ");
    await user.click(screen.getByRole("button", { name: "Ask to join" }));

    expect(await screen.findByText("Waiting for the moderators")).toBeInTheDocument();
    expect(callsTo(requestMock, "mutation JoinByPublicLink")).toEqual([
      { token: TOKEN, message: "Hi there" },
    ]);
    expect(qc.getQueryData(queryKeys.myJoinRequests())).toEqual([filed]);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("sends no message for a blank one and holds one over 500 characters", async () => {
    serve(() => preview({ mode: PublicJoinLinkMode.REQUESTS }), {
      "mutation JoinByPublicLink": () => ({
        joinByPublicLink: { outcome: "REQUESTED", serverId: "ws-acme", joinRequest: filed },
      }),
    });
    const user = userEvent.setup();
    renderPage();
    const field = await screen.findByLabelText("Message (optional)");
    await user.click(field);
    await user.paste("x".repeat(501));
    expect(screen.getByText("501 / 500")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask to join" })).toBeDisabled();
    await user.clear(field);
    await user.type(field, "   ");
    await user.click(screen.getByRole("button", { name: "Ask to join" }));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation JoinByPublicLink")).toEqual([
        { token: TOKEN, message: null },
      ]),
    );
  });

  it.each([
    [
      "VALIDATION",
      "your request was declined; you can ask to join this workspace again in 5 hours",
      "Your request was declined; you can ask to join this workspace again in 5 hours.",
    ],
    [
      "VALIDATION",
      "you can have at most 20 open join requests; withdraw one first",
      "You can have at most 20 open join requests; withdraw one first.",
    ],
    [
      "VALIDATION",
      "a join request message is at most 500 characters",
      "A join request message is at most 500 characters.",
    ],
    [
      "CONFLICT",
      "you already asked to join this workspace",
      "Your request to join was already sent.",
    ],
  ])("says why a %s request was refused: %s", async (code, message, shown) => {
    serve(() => preview({ mode: PublicJoinLinkMode.REQUESTS }), {
      "mutation JoinByPublicLink": () => {
        throw graphqlError(code, message);
      },
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Ask to join" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(shown);
  });

  it("withdraws an open request and offers to ask again", async () => {
    let open = true;
    serve(
      () =>
        preview({
          mode: PublicJoinLinkMode.REQUESTS,
          viewer: open ? PublicJoinLinkViewer.REQUEST_OPEN : PublicJoinLinkViewer.NOT_MEMBER,
          joinRequestId: open ? "jr-1" : null,
        }),
      {
        "mutation WithdrawJoinRequest": (vars) => {
          open = false;
          return { withdrawJoinRequest: { id: vars.requestId, serverId: "ws-acme" } };
        },
        "query MyJoinRequests": () => ({ myJoinRequests: [] }),
      },
    );
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("Waiting for the moderators")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Withdraw request" }));

    expect(await screen.findByRole("button", { name: "Ask to join" })).toBeInTheDocument();
    expect(callsTo(requestMock, "mutation WithdrawJoinRequest")).toEqual([{ requestId: "jr-1" }]);
  });

  it("opens the app from the waiting state", async () => {
    serve(() =>
      preview({
        mode: PublicJoinLinkMode.REQUESTS,
        viewer: PublicJoinLinkViewer.REQUEST_OPEN,
        joinRequestId: "jr-1",
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Open RIM" }));
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });
});

describe("returning to a public link after sign-in", () => {
  function Landing({ signedIn }: { signedIn: boolean }) {
    usePendingPublicLinkReturn(signedIn);
    return <p data-testid="landed">{useLocation().pathname}</p>;
  }

  function renderLanding(signedIn: boolean) {
    routing.real = true;
    return render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="*" element={<Landing signedIn={signedIn} />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  beforeEach(() => sessionStorage.clear());
  afterEach(() => {
    routing.real = false;
  });

  it("opens the kept link once the account is signed in, and forgets it", () => {
    sessionStorage.setItem(PENDING_PUBLIC_LINK_KEY, TOKEN);
    renderLanding(true);
    expect(screen.getByTestId("landed")).toHaveTextContent(`/join/${TOKEN}`);
    expect(sessionStorage.getItem(PENDING_PUBLIC_LINK_KEY)).toBeNull();
  });

  it("keeps the link while nobody is signed in", () => {
    sessionStorage.setItem(PENDING_PUBLIC_LINK_KEY, TOKEN);
    renderLanding(false);
    expect(screen.getByTestId("landed")).toHaveTextContent(/^\/$/);
    expect(sessionStorage.getItem(PENDING_PUBLIC_LINK_KEY)).toBe(TOKEN);
  });

  it("drops anything kept that is no public link", () => {
    sessionStorage.setItem(PENDING_PUBLIC_LINK_KEY, "rim_inv_abc");
    renderLanding(true);
    expect(screen.getByTestId("landed")).toHaveTextContent(/^\/$/);
    expect(sessionStorage.getItem(PENDING_PUBLIC_LINK_KEY)).toBeNull();
  });

  it("stays where it landed without a kept link", () => {
    renderLanding(true);
    expect(screen.getByTestId("landed")).toHaveTextContent(/^\/$/);
  });
});
