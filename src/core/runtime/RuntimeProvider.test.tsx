import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RuntimeProvider, useRuntime } from "./RuntimeProvider";

function RuntimeConsumer() {
  const { platform, capabilities, osType } = useRuntime();
  return (
    <div>
      <span data-testid="platform">{platform}</span>
      <span data-testid="os">{osType}</span>
      <span data-testid="multi-pane">{String(capabilities.multiPaneShell)}</span>
    </div>
  );
}

describe("RuntimeProvider", () => {
  it("provides runtime context to children", () => {
    render(
      <RuntimeProvider>
        <RuntimeConsumer />
      </RuntimeProvider>,
    );
    expect(screen.getByTestId("platform")).toHaveTextContent(/web|desktop|mobile/);
    expect(screen.getByTestId("os")).toHaveTextContent(/macos|windows|linux|unknown/);
  });

  it("capabilities are available", () => {
    render(
      <RuntimeProvider>
        <RuntimeConsumer />
      </RuntimeProvider>,
    );
    // In jsdom, platform should be "web" (no __TAURI_INTERNALS__)
    expect(screen.getByTestId("multi-pane").textContent).toBe("true");
  });
});

describe("useRuntime", () => {
  it("throws when used outside of RuntimeProvider", () => {
    // Suppress the expected error output
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => {
      render(<RuntimeConsumer />);
    }).toThrow("useRuntime must be used within RuntimeProvider");

    spy.mockRestore();
  });
});
