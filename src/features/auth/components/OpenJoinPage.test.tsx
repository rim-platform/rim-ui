import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

vi.mock("../state/useAuthStore", () => ({
  useAuthStore: (
    selector: (s: { session: null; setSession: (s: { userId: string }) => void }) => unknown,
  ) => selector({ session: null, setSession: vi.fn() }),
}));

const mockUseServerConfig = vi.fn();

vi.mock("../api/useServerConfig", () => ({
  useServerConfig: () => mockUseServerConfig(),
}));

import { OpenJoinPage } from "./OpenJoinPage";

describe("OpenJoinPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
