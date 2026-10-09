import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "fake-indexeddb/auto";
import { RuntimeProvider, useRuntime } from "./RuntimeProvider";

function RuntimeConsumer() {
  const { platform, capabilities, osType, deviceKeyStore } = useRuntime();
  return (
    <div>
      <span data-testid="platform">{platform}</span>
      <span data-testid="os">{osType}</span>
      <span data-testid="docked-thread-pane">{String(capabilities.dockedThreadPane)}</span>
      <span data-testid="device-keys">{String(capabilities.deviceKeys)}</span>
      <span data-testid="device-key-store">{deviceKeyStore}</span>
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
    expect(screen.getByTestId("docked-thread-pane").textContent).toBe("true");
  });
});

describe("RuntimeProvider in the web app", () => {
  it("turns device keys on once the browser shows it has Ed25519 and IndexedDB", async () => {
    render(
      <RuntimeProvider>
        <RuntimeConsumer />
      </RuntimeProvider>,
    );
    expect(await screen.findByText("browser")).toBeInTheDocument();
    expect(screen.getByTestId("device-keys").textContent).toBe("true");
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
