import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { PluginErrorBoundary } from "./PluginErrorBoundary";
import type { PluginHealth } from "../types";

describe("PluginErrorBoundary", () => {
  const defaultProps = {
    pluginId: "test-plugin",
    pluginName: "Test Plugin",
    health: "running" as PluginHealth,
    onRestart: vi.fn(),
    onDisable: vi.fn(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders children when health is 'running' and no timer has elapsed", () => {
    render(
      <PluginErrorBoundary {...defaultProps}>
        <div data-testid="child">Plugin content</div>
      </PluginErrorBoundary>,
    );

    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("renders children when health is 'stopped'", () => {
    render(
      <PluginErrorBoundary {...defaultProps} health="stopped">
        <div data-testid="child">Plugin content</div>
      </PluginErrorBoundary>,
    );

    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("shows loading state after 2 seconds when running", () => {
    render(
      <PluginErrorBoundary {...defaultProps}>
        <div data-testid="child">Plugin content</div>
      </PluginErrorBoundary>,
    );

    act(() => {
      vi.advanceTimersByTime(2001);
    });

    expect(screen.getByText(/Loading Test Plugin/)).toBeInTheDocument();
  });

  it("shows slow state after 15 seconds when running", () => {
    render(
      <PluginErrorBoundary {...defaultProps}>
        <div data-testid="child">Plugin content</div>
      </PluginErrorBoundary>,
    );

    act(() => {
      vi.advanceTimersByTime(15001);
    });

    expect(screen.getByText(/taking longer than expected/)).toBeInTheDocument();
  });

  it("shows cancel button in slow state", () => {
    render(
      <PluginErrorBoundary {...defaultProps}>
        <div>content</div>
      </PluginErrorBoundary>,
    );

    act(() => {
      vi.advanceTimersByTime(15001);
    });

    const cancelBtn = screen.getByText("Cancel");
    expect(cancelBtn).toBeInTheDocument();

    fireEvent.click(cancelBtn);
    expect(defaultProps.onDisable).toHaveBeenCalled();
  });

  it("shows crashed state with restart and disable buttons", () => {
    render(
      <PluginErrorBoundary {...defaultProps} health="crashed">
        <div>content</div>
      </PluginErrorBoundary>,
    );

    expect(screen.getByText(/Test Plugin crashed/)).toBeInTheDocument();
    expect(screen.getByText("Restart")).toBeInTheDocument();
    expect(screen.getByText("Disable")).toBeInTheDocument();
  });

  it("shows timeout state with restart and disable buttons", () => {
    render(
      <PluginErrorBoundary {...defaultProps} health="timeout">
        <div>content</div>
      </PluginErrorBoundary>,
    );

    expect(screen.getByText(/Test Plugin timed out/)).toBeInTheDocument();
    expect(screen.getByText("Restart")).toBeInTheDocument();
    expect(screen.getByText("Disable")).toBeInTheDocument();
  });

  it("calls onRestart when restart button is clicked", () => {
    render(
      <PluginErrorBoundary {...defaultProps} health="crashed">
        <div>content</div>
      </PluginErrorBoundary>,
    );

    fireEvent.click(screen.getByText("Restart"));
    expect(defaultProps.onRestart).toHaveBeenCalledTimes(1);
  });

  it("calls onDisable when disable button is clicked", () => {
    render(
      <PluginErrorBoundary {...defaultProps} health="crashed">
        <div>content</div>
      </PluginErrorBoundary>,
    );

    fireEvent.click(screen.getByText("Disable"));
    expect(defaultProps.onDisable).toHaveBeenCalledTimes(1);
  });

  it("resets timer state when health changes from running to crashed", () => {
    const { rerender } = render(
      <PluginErrorBoundary {...defaultProps} health="running">
        <div data-testid="child">content</div>
      </PluginErrorBoundary>,
    );

    // Advance to loading state
    act(() => {
      vi.advanceTimersByTime(2001);
    });
    expect(screen.getByText(/Loading/)).toBeInTheDocument();

    // Now switch to crashed
    rerender(
      <PluginErrorBoundary {...defaultProps} health="crashed">
        <div data-testid="child">content</div>
      </PluginErrorBoundary>,
    );

    expect(screen.getByText(/crashed/)).toBeInTheDocument();
  });
});
