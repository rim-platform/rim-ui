import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useToastStore } from "../toast";
import { SurfaceErrorBoundary } from "./SurfaceErrorBoundary";

/** Throws on render when `shouldThrow` is true; otherwise renders normally. */
function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("boom");
  }
  return <div>safe content</div>;
}

// Module-level flag so a Retry can flip the "transient failure" condition:
// the error boundary discards its subtree on catch, so a fresh Bomb instance
// mounts on every Retry — internal component state can't carry the flag.
let flakyShouldThrow = true;

/** Reads the module-level flag on each render, simulating a transient failure. */
function FlakyBomb() {
  return <Bomb shouldThrow={flakyShouldThrow} />;
}

describe("SurfaceErrorBoundary", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // React logs the caught error to console.error; expected noise here.
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    flakyShouldThrow = true;
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it("renders children when there is no error", () => {
    render(
      <SurfaceErrorBoundary surface="Conversation">
        <div>hello world</div>
      </SurfaceErrorBoundary>,
    );
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  it("shows the fallback with the surface name and Retry/Report actions when a child throws", () => {
    render(
      <SurfaceErrorBoundary surface="Conversation">
        <Bomb shouldThrow />
      </SurfaceErrorBoundary>,
    );
    expect(screen.getByText("Conversation failed to load")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Report" })).toBeInTheDocument();
  });

  it("shows the raw error.message in dev builds", () => {
    // import.meta.env.DEV defaults to true under vitest.
    render(
      <SurfaceErrorBoundary surface="Conversation">
        <Bomb shouldThrow />
      </SurfaceErrorBoundary>,
    );
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("hides the raw error.message and shows a generic message in production builds", () => {
    vi.stubEnv("DEV", false as unknown as string);
    render(
      <SurfaceErrorBoundary surface="Conversation">
        <Bomb shouldThrow />
      </SurfaceErrorBoundary>,
    );
    expect(screen.queryByText("boom")).not.toBeInTheDocument();
    expect(
      screen.getByText("An unexpected error occurred. Details have been logged."),
    ).toBeInTheDocument();
  });

  it("Retry clears the error and renders a non-throwing child afterward", async () => {
    const user = userEvent.setup();
    render(
      <SurfaceErrorBoundary surface="Conversation">
        <FlakyBomb />
      </SurfaceErrorBoundary>,
    );
    expect(screen.getByText("Conversation failed to load")).toBeInTheDocument();

    // Simulate the failure clearing (e.g. a transient error) before retrying.
    flakyShouldThrow = false;
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(screen.getByText("safe content")).toBeInTheDocument();
    expect(screen.queryByText("Conversation failed to load")).not.toBeInTheDocument();
  });

  it("clicking Report calls the provided onReport handler", async () => {
    const user = userEvent.setup();
    const onReport = vi.fn();
    render(
      <SurfaceErrorBoundary surface="Conversation" onReport={onReport}>
        <Bomb shouldThrow />
      </SurfaceErrorBoundary>,
    );

    await user.click(screen.getByRole("button", { name: "Report" }));

    expect(onReport).toHaveBeenCalledTimes(1);
    expect(onReport.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onReport.mock.calls[0][0].message).toBe("boom");
  });

  it("Report shows a toast that doesn't claim the error was transmitted anywhere", async () => {
    const user = userEvent.setup();
    render(
      <SurfaceErrorBoundary surface="Conversation">
        <Bomb shouldThrow />
      </SurfaceErrorBoundary>,
    );

    await user.click(screen.getByRole("button", { name: "Report" }));

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].title).toMatch(/logged/i);
    expect(toasts[0].title).not.toMatch(/reported/i);
  });

  it("changing a resetKeys value clears the error without clicking Retry", () => {
    const { rerender } = render(
      <SurfaceErrorBoundary surface="Conversation" resetKeys={["conv-1"]}>
        <Bomb shouldThrow />
      </SurfaceErrorBoundary>,
    );
    expect(screen.getByText("Conversation failed to load")).toBeInTheDocument();

    rerender(
      <SurfaceErrorBoundary surface="Conversation" resetKeys={["conv-2"]}>
        <Bomb shouldThrow={false} />
      </SurfaceErrorBoundary>,
    );

    expect(screen.getByText("safe content")).toBeInTheDocument();
    expect(screen.queryByText("Conversation failed to load")).not.toBeInTheDocument();
  });

  it("does not clear the error when resetKeys stays the same", () => {
    const { rerender } = render(
      <SurfaceErrorBoundary surface="Conversation" resetKeys={["conv-1"]}>
        <Bomb shouldThrow />
      </SurfaceErrorBoundary>,
    );
    expect(screen.getByText("Conversation failed to load")).toBeInTheDocument();

    rerender(
      <SurfaceErrorBoundary surface="Conversation" resetKeys={["conv-1"]}>
        <Bomb shouldThrow={false} />
      </SurfaceErrorBoundary>,
    );

    // resetKeys unchanged — boundary should still show the fallback.
    expect(screen.getByText("Conversation failed to load")).toBeInTheDocument();
  });

  it("offers Reload, not Retry, when a chunk could not be fetched", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    try {
      function ChunkBomb(): never {
        throw new TypeError(
          "Failed to fetch dynamically imported module: https://x/assets/native-a.js",
        );
      }
      const user = userEvent.setup();
      render(
        <SurfaceErrorBoundary surface="Conversation">
          <ChunkBomb />
        </SurfaceErrorBoundary>,
      );
      expect(screen.getByText("This part of the app could not load")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Report" })).toBeNull();
      await user.click(screen.getByRole("button", { name: "Reload" }));
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
