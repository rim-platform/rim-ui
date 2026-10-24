import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { renderWithServerInfo } from "../../../test/serverInfo";

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("../../workspaces/state/useWorkspaceStore", () => ({
  useWorkspaceStore: (
    selector: (s: { workspaceId: string | null; setWorkspaceId: (id: string) => void }) => unknown,
  ) => selector({ workspaceId: null, setWorkspaceId: vi.fn() }),
}));

const mockSetSession = vi.fn();
// The session restored from the cookie, and whether that check is still running.
const auth = vi.hoisted(() => ({
  session: null as { userId: string } | null,
  isHydrating: false,
}));

vi.mock("../state/useAuthStore", () => ({
  useAuthStore: (
    selector: (s: {
      session: { userId: string } | null;
      setSession: (s: { userId: string }) => void;
    }) => unknown,
  ) => selector({ session: auth.session, setSession: mockSetSession }),
}));

vi.mock("../api/useSessionHydration", () => ({
  useSessionHydration: () => ({ isHydrating: auth.isHydrating, isAuthenticated: false }),
}));

const mockUseServerConfig = vi.fn();

vi.mock("../api/useServerConfig", () => ({
  useServerConfig: () => mockUseServerConfig(),
}));

const desktop = vi.hoisted(() => ({ value: true }));

vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({ capabilities: { deviceKeys: desktop.value, identityKeys: desktop.value } }),
}));

// The key form has its own tests; the stand-in is in `__mocks__`.
vi.mock("./KeySignupForm");

import { OpenJoinPage } from "./OpenJoinPage";
import { expectReachableByKeyboard } from "../../../test/keyboard";
import { NO_KEYS_HERE_MESSAGE } from "./NoKeysHere";

describe("OpenJoinPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    desktop.value = true;
    auth.session = null;
    auth.isHydrating = false;
  });

  function renderPage() {
    return renderWithServerInfo(
      <MemoryRouter>
        <OpenJoinPage />
      </MemoryRouter>,
    );
  }

  it("renders the signup form when registrationMode is OPEN", () => {
    mockUseServerConfig.mockReturnValue({
      data: { registrationMode: "OPEN" },
      isPending: false,
    });

    renderPage();

    expect(screen.getByTestId("key-signup")).toBeInTheDocument();
  });

  it("waits for the session cookie, then sends a signed-in account on to the app", () => {
    mockUseServerConfig.mockReturnValue({ data: { registrationMode: "OPEN" }, isPending: false });
    auth.isHydrating = true;
    const { rerender } = renderPage();
    expect(screen.getByText("Restoring session...")).toBeInTheDocument();
    expect(screen.queryByTestId("key-signup")).not.toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();

    auth.isHydrating = false;
    auth.session = { userId: "existing-user" };
    rerender(
      <MemoryRouter>
        <OpenJoinPage />
      </MemoryRouter>,
    );
    expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
    expect(screen.queryByTestId("key-signup")).not.toBeInTheDocument();
  });

  it("renders the signup form with a required invite code when registrationMode is INVITE_ONLY", () => {
    mockUseServerConfig.mockReturnValue({
      data: { registrationMode: "INVITE_ONLY" },
      isPending: false,
    });

    renderPage();

    expect(screen.getByPlaceholderText("Invite code or link")).toBeRequired();
    expect(screen.getByText("Invite code")).toBeInTheDocument();
    expect(screen.getByTestId("key-signup")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("asks for an optional invite code when registrationMode is OPEN", () => {
    mockUseServerConfig.mockReturnValue({ data: { registrationMode: "OPEN" }, isPending: false });

    renderPage();

    expect(screen.getByPlaceholderText("Invite code or link")).not.toBeRequired();
    expect(screen.getByText("Invite code (optional)")).toBeInTheDocument();
  });

  it("says so and goes back to sign-in when the registration mode cannot be read", () => {
    mockUseServerConfig.mockReturnValue({ data: undefined, isPending: false });

    renderPage();

    expect(
      screen.getByText("Could not read how this server creates accounts."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("key-signup")).not.toBeInTheDocument();
  });

  it("renders loading state and does not redirect while isPending", () => {
    mockUseServerConfig.mockReturnValue({
      data: undefined,
      isPending: true,
    });

    renderPage();

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    // No redirect should have fired yet
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("offers a key signup, with no token, and signs the new account in", async () => {
    mockUseServerConfig.mockReturnValue({
      data: { registrationMode: "OPEN" },
      isPending: false,
    });
    const user = userEvent.setup();
    renderPage();

    expect(JSON.parse(screen.getByTestId("key-signup-tokens").textContent ?? "")).toEqual({});
    await user.click(screen.getByRole("button", { name: /finish key signup/i }));

    expect(mockSetSession).toHaveBeenCalledWith({ userId: "user-key" });
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });

  it("offers the key signup in the desktop app when registrationMode is POW", () => {
    mockUseServerConfig.mockReturnValue({ data: { registrationMode: "POW" }, isPending: false });
    renderPage();
    expect(screen.getByTestId("key-signup")).toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId("key-signup-tokens").textContent ?? "")).toEqual({});
    expect(screen.queryByPlaceholderText("password")).toBeNull();
  });

  it("points the web app to the desktop app or an invite when registrationMode is POW", () => {
    desktop.value = false;
    mockUseServerConfig.mockReturnValue({ data: { registrationMode: "POW" }, isPending: false });
    renderPage();
    expect(
      screen.getByText("Signing up here takes the RIM desktop app, or an invite."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("key-signup")).toBeNull();
  });

  it("says a browser that cannot create keys cannot sign up, with no form", () => {
    desktop.value = false;
    mockUseServerConfig.mockReturnValue({
      data: { registrationMode: "OPEN" },
      isPending: false,
    });
    renderPage();
    expect(screen.getByText(NO_KEYS_HERE_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByTestId("key-signup")).toBeNull();
    expect(screen.queryByPlaceholderText("password")).toBeNull();
  });

  it("reaches its primary actions by keyboard", async () => {
    const user = userEvent.setup();
    mockUseServerConfig.mockReturnValue({
      data: { registrationMode: "OPEN" },
      isPending: false,
    });
    renderPage();
    await expectReachableByKeyboard(user, [
      screen.getByPlaceholderText("Invite code or link"),
      screen.getByRole("button", { name: /start key signup/i }),
      screen.getByRole("button", { name: /finish key signup/i }),
    ]);
  });
});
