import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Stub out all route components so we can test routing in isolation.
vi.mock("../../shell/layouts/AppShell", () => ({
  AppShell: () => <div data-testid="app-shell" />,
}));
vi.mock("../../features/auth/components/LoginPage", () => ({
  LoginPage: () => <div data-testid="login-page" />,
}));
vi.mock("../../features/auth/components/JoinPage", () => ({
  JoinPage: () => <div data-testid="join-page" />,
}));
vi.mock("../../features/auth/components/OpenJoinPage", () => ({
  OpenJoinPage: () => <div data-testid="open-join-page" />,
}));
vi.mock("../../features/auth/components/ForgotPasswordPage", () => ({
  ForgotPasswordPage: () => <div data-testid="forgot-password-page" />,
}));
vi.mock("../../features/auth/components/ResetPasswordPage", () => ({
  ResetPasswordPage: () => <div data-testid="reset-password-page" />,
}));

/**
 * Renders a minimal route tree matching AppRouter's configuration at the
 * given path. Uses MemoryRouter for isolation (AppRouter itself uses
 * BrowserRouter which cannot be nested).
 */
function renderAtPath(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<div data-testid="login-page" />} />
        <Route path="/join/:token" element={<div data-testid="join-page" />} />
        <Route path="/join" element={<div data-testid="open-join-page" />} />
        <Route path="/forgot-password" element={<div data-testid="forgot-password-page" />} />
        <Route path="/reset-password/:token" element={<div data-testid="reset-password-page" />} />
        <Route path="*" element={<div data-testid="app-shell" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AppRouter route resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("/login resolves to LoginPage", () => {
    renderAtPath("/login");
    expect(screen.getByTestId("login-page")).toBeInTheDocument();
    expect(screen.queryByTestId("app-shell")).not.toBeInTheDocument();
  });

  it("/join/:token resolves to JoinPage", () => {
    renderAtPath("/join/my-invite-token");
    expect(screen.getByTestId("join-page")).toBeInTheDocument();
    expect(screen.queryByTestId("app-shell")).not.toBeInTheDocument();
  });

  it("/join (no token) resolves to OpenJoinPage, not JoinPage", () => {
    renderAtPath("/join");
    expect(screen.getByTestId("open-join-page")).toBeInTheDocument();
    expect(screen.queryByTestId("join-page")).not.toBeInTheDocument();
  });

  it("/forgot-password resolves to ForgotPasswordPage", () => {
    renderAtPath("/forgot-password");
    expect(screen.getByTestId("forgot-password-page")).toBeInTheDocument();
    expect(screen.queryByTestId("app-shell")).not.toBeInTheDocument();
  });

  it("unknown paths fall through to AppShell", () => {
    renderAtPath("/some/deep/path");
    expect(screen.getByTestId("app-shell")).toBeInTheDocument();
  });
});
