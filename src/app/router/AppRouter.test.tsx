import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Stubs every route component, so the tests exercise routing in isolation.
vi.mock("../../shell/layouts/AppShell", () => ({
  AppShell: () => <div data-testid="app-shell" />,
}));
vi.mock("../../features/auth/components/LoginPage", () => ({
  LoginPage: () => <div data-testid="login-page" />,
}));
vi.mock("../../features/auth/components/JoinPage", () => ({
  JoinPage: () => <div data-testid="join-page" />,
}));
vi.mock("../../features/auth/components/PublicLinkJoin", () => ({
  PublicLinkJoin: ({ token }: { token: string }) => (
    <div data-testid="public-link-join">{token}</div>
  ),
}));
vi.mock("../../features/auth/components/OpenJoinPage", () => ({
  OpenJoinPage: () => <div data-testid="open-join-page" />,
}));

import { JoinTokenRoute } from "./AppRouter";

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
        <Route path="/join/:token" element={<JoinTokenRoute />} />
        <Route path="/join" element={<div data-testid="open-join-page" />} />
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

  it("/join/:token with a public link resolves to PublicLinkJoin, never the invite flow", () => {
    renderAtPath("/join/rim_pjl_AAAAAAAAAAAAAAAAAAAAAA");
    expect(screen.getByTestId("public-link-join")).toHaveTextContent(
      "rim_pjl_AAAAAAAAAAAAAAAAAAAAAA",
    );
    expect(screen.queryByTestId("join-page")).not.toBeInTheDocument();
  });

  it.each(["rim_inv_abc", "rim_iinv_abc"])("/join/%s keeps the invite flow", (token) => {
    renderAtPath(`/join/${token}`);
    expect(screen.getByTestId("join-page")).toBeInTheDocument();
    expect(screen.queryByTestId("public-link-join")).not.toBeInTheDocument();
  });

  it("/join (no token) resolves to OpenJoinPage, not JoinPage", () => {
    renderAtPath("/join");
    expect(screen.getByTestId("open-join-page")).toBeInTheDocument();
    expect(screen.queryByTestId("join-page")).not.toBeInTheDocument();
  });

  it("unknown paths fall through to AppShell", () => {
    renderAtPath("/some/deep/path");
    expect(screen.getByTestId("app-shell")).toBeInTheDocument();
  });
});
