import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { AppErrorBoundary } from "./AppErrorBoundary";

function Boom(): never {
  throw new Error("boom");
}

function renderCrash() {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <AppErrorBoundary>
      <Boom />
    </AppErrorBoundary>,
  );
  spy.mockRestore();
}

describe("AppErrorBoundary fallback", () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("shows the window controls on desktop", () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (X11; Linux x86_64)");
    renderCrash();
    expect(screen.getByText("UI ERROR")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("shows no title bar on the web", () => {
    renderCrash();
    expect(screen.getByText("UI ERROR")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });
});
