import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const mockLoginMutate = vi.fn();
const mockNavigate = vi.fn();
const mockSetSession = vi.fn();

vi.mock("../api/useAuthMutations", () => ({
  useLoginMutation: () => ({
    mutate: mockLoginMutate,
    isPending: false,
    error: null,
  }),
}));

vi.mock("../../system/api/useHealthCheck", () => ({
  useHealthCheck: () => ({ isSuccess: true, isError: false, isPending: false }),
}));

vi.mock("../../../core/graphql/config", () => ({
  getGraphqlEndpoint: () => "http://localhost:8080/api",
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

// Not hydrating, no existing session
vi.mock("../api/useSessionHydration", () => ({
  useSessionHydration: () => ({ isHydrating: false, isAuthenticated: false }),
}));

// Auth store: always null session to avoid redirect-to-login side effects.
// The LoginPage component renders null when session is truthy, so keeping it
// consistently null ensures the form is always rendered during tests.
const sessionEnded = vi.hoisted(() => ({ value: false }));
vi.mock("../state/useAuthStore", () => ({
  useAuthStore: (
    selector: (s: {
      session: null;
      sessionEnded: boolean;
      setSession: typeof mockSetSession;
    }) => unknown,
  ) => selector({ session: null, sessionEnded: sessionEnded.value, setSession: mockSetSession }),
}));

// Default server config: INVITE_ONLY
const mockUseServerConfig = vi.fn(() => ({
  data: { registrationMode: "INVITE_ONLY" },
  isPending: false,
  isError: false,
}));

vi.mock("../api/useServerConfig", () => ({
  useServerConfig: () => mockUseServerConfig(),
}));

const desktop = vi.hoisted(() => ({ value: false }));
vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({ capabilities: { identityKeys: desktop.value } }),
}));

// Device key sign-in and device linking have their own tests; here it renders nothing, as in the web app.
vi.mock("../../key-identity/components/DeviceKeySignIn", () => ({
  DeviceKeySignIn: () => null,
  RecoverAccount: () => null,
}));
vi.mock("../../key-identity/components/LinkThisDevice", () => ({
  LinkThisDevice: () => null,
}));

import { LoginPage } from "./LoginPage";
import { expectReachableByKeyboard } from "../../../test/keyboard";
import {
  withServerInfo,
  type FakeFeatures,
  type FakeServerDetails,
} from "../../../test/serverInfo";
import { useEdgeStore } from "../../../core/graphql/edgeRefusals";
import { ServerFeatureState } from "../../../core/graphql/generated/schema-types";

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    desktop.value = false;
    sessionEnded.value = false;
    mockUseServerConfig.mockReturnValue({
      data: { registrationMode: "INVITE_ONLY" },
      isPending: false,
      isError: false,
    });
  });

  function renderPage(features: FakeFeatures = {}, details: FakeServerDetails = {}) {
    return render(
      <MemoryRouter initialEntries={["/login"]}>
        <LoginPage />
      </MemoryRouter>,
      { wrapper: withServerInfo(features, details) },
    );
  }

  it("renders the login form with no signup affordances in default state", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "RIM" })).toBeInTheDocument();
    expect(screen.getByText("Sign in to your workspace")).toBeInTheDocument();
    expect(screen.getByText("Log in")).toBeInTheDocument();
  });

  it("offers Create account, which takes an invite code, when registrationMode is INVITE_ONLY", () => {
    renderPage();
    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/join");
    expect(
      screen.getByText(
        "Creating an account here takes an invite code or link from someone on this server.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No account? Ask your workspace admin for an invite."),
    ).not.toBeInTheDocument();
  });

  it("says nothing about invite codes when registrationMode is OPEN", () => {
    mockUseServerConfig.mockReturnValue({
      data: { registrationMode: "OPEN" },
      isPending: false,
      isError: false,
    });
    renderPage();
    expect(screen.queryByText(/takes an invite code/)).not.toBeInTheDocument();
  });

  it("renders the Create account link when registrationMode is OPEN", () => {
    mockUseServerConfig.mockReturnValue({
      data: { registrationMode: "OPEN" },
      isPending: false,
      isError: false,
    });
    renderPage();
    const link = screen.getByRole("link", { name: "Create account" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/join");
  });

  it("renders the Create account link in the desktop app when registrationMode is POW", () => {
    desktop.value = true;
    mockUseServerConfig.mockReturnValue({
      data: { registrationMode: "POW" },
      isPending: false,
      isError: false,
    });
    renderPage();
    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/join");
  });

  it("points the web app to the desktop app or an invite when registrationMode is POW", () => {
    mockUseServerConfig.mockReturnValue({
      data: { registrationMode: "POW" },
      isPending: false,
      isError: false,
    });
    renderPage();
    expect(
      screen.getByText("No account? Create one in the RIM desktop app, or ask for an invite."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Create account" })).not.toBeInTheDocument();
  });

  it.each(["OPEN", "INVITE_ONLY"])(
    "points a browser without keys to the desktop app on a %s server that takes key signups only",
    (registrationMode) => {
      mockUseServerConfig.mockReturnValue({
        data: { registrationMode },
        isPending: false,
        isError: false,
      });
      const { unmount } = renderPage({}, { signupRequiresKeys: true });
      expect(screen.getByText(/signs up new accounts with a key/i)).toHaveTextContent(
        /RIM desktop app/,
      );
      expect(screen.queryByRole("link", { name: "Create account" })).not.toBeInTheDocument();
      unmount();

      desktop.value = true;
      renderPage({}, { signupRequiresKeys: true });
      expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/join");
    },
  );

  it("hides the Create account link while registrationMode is loading — defaults to invite-only", () => {
    mockUseServerConfig.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    });
    renderPage();
    expect(
      screen.getByText("No account? Ask your workspace admin for an invite."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Create account" })).not.toBeInTheDocument();
  });

  it("calls login mutation on submit and navigates on success", async () => {
    mockLoginMutate.mockImplementation(
      (_: unknown, opts: { onSuccess: (d: { login: { userId: string } }) => void }) => {
        opts.onSuccess({ login: { userId: "user-123" } });
      },
    );

    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByPlaceholderText("owner"), "admin");
    await user.type(screen.getByPlaceholderText("password"), "pass123");
    await user.click(screen.getByText("Log in"));

    expect(mockLoginMutate).toHaveBeenCalledWith(
      { username: "admin", password: "pass123" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
  });

  it("renders the Forgot password? link", () => {
    renderPage();
    expect(screen.getByText("Forgot password?")).toBeInTheDocument();
  });

  it("leaves out the Forgot password? link while the server sends no email", () => {
    renderPage({ email: { state: ServerFeatureState.UNAVAILABLE, reason: "no SMTP" } });
    expect(screen.getByText("Log in")).toBeInTheDocument();
    expect(screen.queryByText("Forgot password?")).not.toBeInTheDocument();
  });

  it("reaches its primary actions by keyboard and signs in with Enter", async () => {
    const user = userEvent.setup();
    renderPage();
    const username = screen.getByPlaceholderText("owner");
    const password = screen.getByPlaceholderText("password");
    await expectReachableByKeyboard(user, [
      username,
      password,
      screen.getByRole("link", { name: "Forgot password?" }),
    ]);

    username.focus();
    await user.keyboard("alice");
    password.focus();
    await user.keyboard("secret");
    await expectReachableByKeyboard(user, [screen.getByRole("button", { name: "Log in" })]);
    password.focus();
    await user.keyboard("{Enter}");
    expect(mockLoginMutate).toHaveBeenCalled();
  });

  it("shows the server's instance notice at the top, as plain text", () => {
    renderPage({}, { instanceNotice: "Run by **Acme**.\nBe kind." });
    const notice = screen.getByRole("note", { name: "Notice from this server" });
    expect(notice).toHaveTextContent("Run by **Acme**. Be kind.");
    expect(notice.querySelector("strong")).toBeNull();
  });

  it.each([null, undefined, "  "])("shows no notice when the server gives %j", (notice) => {
    renderPage({}, { instanceNotice: notice });
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("says the address is blocked when the server refused it", () => {
    useEdgeStore.setState({ blocked: true });
    try {
      renderPage();
      expect(screen.getByRole("alert")).toHaveTextContent("This address is blocked on this server");
      expect(screen.getByText("Address blocked")).toBeInTheDocument();
    } finally {
      useEdgeStore.setState({ blocked: false });
    }
  });

  it("shows no blocked state otherwise", () => {
    renderPage();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says the session ended when the server ended it, and nothing otherwise", () => {
    const { unmount } = renderPage();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    unmount();

    sessionEnded.value = true;
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Your session ended. Sign in again.");
  });
});
