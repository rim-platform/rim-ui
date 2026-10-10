import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("../api/useSignupWithInviteMutation", () => ({
  useSignupWithInviteMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  }),
}));

vi.mock("../../workspaces/state/useWorkspaceStore", () => ({
  useWorkspaceStore: (
    selector: (s: { workspaceId: string | null; setWorkspaceId: (id: string) => void }) => unknown,
  ) => selector({ workspaceId: null, setWorkspaceId: vi.fn() }),
}));

const mockSetSession = vi.fn();

vi.mock("../state/useAuthStore", () => ({
  useAuthStore: (
    selector: (s: { session: null; setSession: (s: { userId: string }) => void }) => unknown,
  ) => selector({ session: null, setSession: mockSetSession }),
}));

const mockUseServerConfig = vi.fn();

vi.mock("../api/useServerConfig", () => ({
  useServerConfig: () => mockUseServerConfig(),
}));

const desktop = vi.hoisted(() => ({ value: false }));

vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({ capabilities: { deviceKeys: desktop.value, identityKeys: desktop.value } }),
}));

// The key form has its own tests; the stand-in is in `__mocks__`.
vi.mock("./KeySignupForm");

import { OpenJoinPage } from "./OpenJoinPage";
import { expectReachableByKeyboard } from "../../../test/keyboard";

describe("OpenJoinPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    desktop.value = false;
  });

  function renderPage() {
    return render(
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

    expect(screen.getByText("Create account")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("yourname")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("password")).toBeInTheDocument();
  });

  it("renders invite-only forbidden state when registrationMode is INVITE_ONLY", () => {
    mockUseServerConfig.mockReturnValue({
      data: { registrationMode: "INVITE_ONLY" },
      isPending: false,
    });

    renderPage();

    expect(
      screen.getByText("Registration is invite-only on this RIM instance."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Create account")).not.toBeInTheDocument();
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

  it("offers a key signup on the desktop, with no token, and signs the new account in", async () => {
    desktop.value = true;
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

  it("offers only the key signup in the desktop app when registrationMode is POW", () => {
    desktop.value = true;
    mockUseServerConfig.mockReturnValue({ data: { registrationMode: "POW" }, isPending: false });
    renderPage();
    expect(screen.getByTestId("key-signup")).toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId("key-signup-tokens").textContent ?? "")).toEqual({});
    expect(screen.queryByPlaceholderText("password")).toBeNull();
  });

  it("points the web app to the desktop app or an invite when registrationMode is POW", () => {
    mockUseServerConfig.mockReturnValue({ data: { registrationMode: "POW" }, isPending: false });
    renderPage();
    expect(
      screen.getByText("Signing up here takes the RIM desktop app, or an invite."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("key-signup")).toBeNull();
  });

  it("does not offer a key signup in the web app", () => {
    mockUseServerConfig.mockReturnValue({
      data: { registrationMode: "OPEN" },
      isPending: false,
    });
    renderPage();
    expect(screen.queryByRole("button", { name: /create account with a key/i })).toBeNull();
  });

  it("reaches its primary actions by keyboard", async () => {
    const user = userEvent.setup();
    mockUseServerConfig.mockReturnValue({
      data: { registrationMode: "OPEN" },
      isPending: false,
    });
    renderPage();
    const username = screen.getByPlaceholderText("yourname");
    const email = screen.getByPlaceholderText("you@example.com");
    const password = screen.getByPlaceholderText("password");
    await expectReachableByKeyboard(user, [username, email, password]);
    username.focus();
    await user.keyboard("alice");
    email.focus();
    await user.keyboard("alice@example.com");
    password.focus();
    await user.keyboard("password123");
    await expectReachableByKeyboard(user, [screen.getByRole("button", { name: "Create account" })]);
  });
});
