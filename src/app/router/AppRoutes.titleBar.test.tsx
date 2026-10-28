import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { RuntimeProvider } from "../../core/runtime/RuntimeProvider";
import { useAuthStore } from "../../features/auth/state/useAuthStore";

vi.mock("../../features/auth/components/LoginPage", () => ({
  LoginPage: () => <div data-testid="login-page" />,
}));
vi.mock("../../features/auth/components/JoinPage", () => ({
  JoinPage: () => <div data-testid="join-page" />,
}));
vi.mock("../../features/auth/components/PublicLinkJoin", () => ({
  PublicLinkJoin: () => <div data-testid="public-link-join" />,
}));
vi.mock("../../features/auth/components/OpenJoinPage", () => ({
  OpenJoinPage: () => <div data-testid="open-join-page" />,
}));
vi.mock("../../features/auth/api/useSessionHydration", () => ({
  useSessionHydration: () => ({ isHydrating: false }),
}));
vi.mock("../../features/auth/runtime/signOut", () => ({ useSessionEndedSignOut: () => {} }));
vi.mock("../../features/auth/runtime/unlockGate", () => ({
  useUnlockGate: () => "unlocked",
  principalOf: async () => "rimp1_alice",
}));

import { AppRoutes } from "./AppRouter";

function renderAt(path: string) {
  return render(
    <RuntimeProvider>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </RuntimeProvider>,
  );
}

function setDesktop(on: boolean) {
  if (on) Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  else delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
}

describe("title bar on the routes outside the app shell", () => {
  afterEach(() => {
    setDesktop(false);
    useAuthStore.setState({ session: null });
  });

  it.each(["/login", "/join", "/join/rim_inv_abc", "/join/rim_pjl_AAAAAAAAAAAAAAAAAAAAAA"])(
    "%s shows one title bar on desktop",
    (path) => {
      setDesktop(true);
      renderAt(path);
      expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(1);
      expect(screen.getAllByRole("button", { name: "Minimize" })).toHaveLength(1);
    },
  );

  it.each(["/login", "/join"])("%s shows none on the web", (path) => {
    setDesktop(false);
    renderAt(path);
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });

  it("/ signed out redirects to /login with a single title bar", async () => {
    setDesktop(true);
    renderAt("/");
    expect(await screen.findByTestId("login-page")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(1);
  });
});
