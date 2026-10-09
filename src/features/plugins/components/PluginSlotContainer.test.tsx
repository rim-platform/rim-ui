import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({
    capabilities: { pluginHost: true },
  }),
}));

vi.mock("../runtime/pluginBridge", () => ({
  createPluginBridge: vi.fn(() => ({
    sendToPlugin: vi.fn(),
    destroy: vi.fn(),
  })),
  followPanelState: vi.fn(() => ({ load: vi.fn(() => Promise.resolve()), stop: vi.fn() })),
}));

vi.mock("../runtime/pluginThemeBridge", () => ({
  createThemeChangeMessage: vi.fn(() => ({
    type: "theme.changed",
    variables: {},
  })),
  onThemeChange: vi.fn(() => vi.fn()),
}));

vi.mock("../runtime/pluginFocusManager", () => ({
  usePluginFocusManager: vi.fn(() => ({
    focusIframe: vi.fn(),
    onWrapperKeyDown: vi.fn(),
  })),
}));

import { PluginSlotContainer } from "./PluginSlotContainer";
import type { PluginInfo, PluginPanelDef } from "../types";

describe("PluginSlotContainer", () => {
  const mockPlugin: PluginInfo = {
    plugin_id: "test-plugin",
    manifest_id: "test-plugin",
    display_name: "Test Plugin",
    version: "1.0.0",
    description: "A test plugin",
    author: "Test Author",
    enabled: true,
    capabilities: [],
    approved_capabilities: [],
    approved_ai_commands: [],
    ai_callable_commands: [],
    ai_consent_required: false,
    health: "running",
  };

  const mockPanel: PluginPanelDef = {
    id: "main",
    title: "Test Panel",
    slot: "tool_panel",
  };

  it("renders the panel title", () => {
    render(<PluginSlotContainer plugin={mockPlugin} panel={mockPanel} onClose={vi.fn()} />);

    expect(screen.getByText("Test Panel")).toBeInTheDocument();
  });

  it("renders a close button", () => {
    render(<PluginSlotContainer plugin={mockPlugin} panel={mockPanel} onClose={vi.fn()} />);

    expect(screen.getByLabelText("Close plugin panel")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(<PluginSlotContainer plugin={mockPlugin} panel={mockPanel} onClose={onClose} />);

    fireEvent.click(screen.getByLabelText("Close plugin panel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders the PluginPanel iframe for the plugin", () => {
    const { container } = render(
      <PluginSlotContainer plugin={mockPlugin} panel={mockPanel} onClose={vi.fn()} />,
    );

    const iframe = container.querySelector("iframe");
    expect(iframe).toBeInTheDocument();
    expect(iframe?.getAttribute("src")).toContain("test-plugin");
  });
});
