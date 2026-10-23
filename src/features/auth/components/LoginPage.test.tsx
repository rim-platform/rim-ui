import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

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

// Device key sign-in, device linking and recovery have their own tests; here each renders a
// stand-in button when `keyOptions.value` is set, and nothing otherwise, as in the web app.
const keyOptions = vi.hoisted(() => ({ value: false }));
vi.mock("../../key-identity/components/DeviceKeySignIn", () => ({
  DeviceKeySignIn: () =>
    keyOptions.value ? <button type="button">Device key sign-in</button> : null,
  RecoverAccount: () =>
    keyOptions.value ? <button type="button">Recover an account</button> : null,
}));
vi.mock("../../key-identity/components/LinkThisDevice", () => ({
  LinkThisDevice: () => (keyOptions.value ? <button type="button">Link this device</button> : null),
}));

// Server info comes from each test's query client; one without it stays loading.
vi.mock("../../updater/api/serverInfoApi", async () => {
  const actual = await vi.importActual<typeof import("../../updater/api/serverInfoApi")>(
    "../../updater/api/serverInfoApi",
  );
  return { ...actual, fetchServerInfo: () => new Promise(() => {}) };
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
    keyOptions.value = false;
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

  it("hands Create account where to return, so a signup comes back to a public link", async () => {
    const returnTo = "/join/rim_pjl_AAAAAAAAAAAAAAAAAAAAAA";
    function SignupPage() {
      const location = useLocation();
      return <p data-testid="signup-state">{JSON.stringify(location.state)}</p>;
    }
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[{ pathname: "/login", state: { returnTo } }]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/join" element={<SignupPage />} />
        </Routes>
      </MemoryRouter>,
      { wrapper: withServerInfo() },
    );
    await user.click(screen.getByRole("link", { name: "Create account" }));
    expect(JSON.parse(screen.getByTestId("signup-state").textContent ?? "")).toEqual({ returnTo });
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

  it("says the server is full instead of offering Create account", () => {
    renderPage({}, { registrationFull: true });
    expect(screen.getByText("This server is full")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Create account" })).not.toBeInTheDocument();
    expect(screen.getByText("Log in")).toBeInTheDocument();
  });

  it("shows the server's abuse contact, and none without one", () => {
    const { unmount } = renderPage({}, { abuseContact: "abuse@acme.example" });
    expect(screen.getByRole("link", { name: "abuse@acme.example" })).toHaveAttribute(
      "href",
      "mailto:abuse@acme.example",
    );
    unmount();

    renderPage({}, { abuseContact: null });
    expect(screen.queryByText(/Report abuse/)).not.toBeInTheDocument();
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

  it("leads with the key ways to sign in and folds the password form on a key-only server", async () => {
    keyOptions.value = true;
    const user = userEvent.setup();
    renderPage({}, { signupRequiresKeys: true });

    const keys = screen.getByRole("region", { name: "Sign in with a key" });
    expect(keys).toContainElement(screen.getByRole("button", { name: "Device key sign-in" }));
    expect(keys).toContainElement(screen.getByRole("button", { name: "Link this device" }));
    expect(keys).toContainElement(screen.getByRole("button", { name: "Recover an account" }));
    expect(screen.getByPlaceholderText("password")).not.toBeVisible();
    expect(screen.queryByRole("button", { name: "Log in" })).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: "Sign in with a password (older accounts)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const form = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(form).toContainElement(screen.getByPlaceholderText("password"));

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByPlaceholderText("owner")).toBeVisible();
    expect(screen.getByPlaceholderText("password")).toBeVisible();
    expect(screen.getByRole("link", { name: "Forgot password?" })).toBeVisible();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByPlaceholderText("password")).not.toBeVisible();
  });

  it("leaves the key card empty on a key-only server where no key way renders", () => {
    renderPage({}, { signupRequiresKeys: true });
    expect(screen.getByLabelText("Sign in with a key")).toBeEmptyDOMElement();
    expect(
      screen.getByRole("button", { name: "Sign in with a password (older accounts)" }),
    ).toBeInTheDocument();
  });

  it.each([
    ["takes passwords", false],
    ["has not said yet", undefined],
  ])("shows the password form first when the server %s", (_, signupRequiresKeys) => {
    keyOptions.value = true;
    if (signupRequiresKeys === undefined) {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <MemoryRouter initialEntries={["/login"]}>
          <LoginPage />
        </MemoryRouter>,
        {
          wrapper: ({ children }) => (
            <QueryClientProvider client={client}>{children}</QueryClientProvider>
          ),
        },
      );
    } else {
      renderPage({}, { signupRequiresKeys });
    }
    expect(screen.getByPlaceholderText("password")).toBeVisible();
    expect(screen.getByRole("button", { name: "Log in" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Device key sign-in" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Sign in with a key" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Sign in with a password (older accounts)" }),
    ).not.toBeInTheDocument();
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
