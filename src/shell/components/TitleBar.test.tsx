import "../../test/mocks/tauri";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TitleBar } from "./TitleBar";
import { RuntimeProvider } from "../../core/runtime/RuntimeProvider";

describe("TitleBar", () => {
  it("renders without crashing", () => {
    const { container } = render(
      <RuntimeProvider>
        <TitleBar />
      </RuntimeProvider>,
    );
    expect(container.firstElementChild).toBeInTheDocument();
  });

  it("has data-tauri-drag-region attribute", () => {
    const { container } = render(
      <RuntimeProvider>
        <TitleBar />
      </RuntimeProvider>,
    );
    expect(container.querySelector("[data-tauri-drag-region]")).toBeInTheDocument();
  });

  it("renders WindowControls for non-macOS (jsdom defaults to non-macOS)", () => {
    render(
      <RuntimeProvider>
        <TitleBar />
      </RuntimeProvider>,
    );
    // In jsdom the user agent includes "jsdom" which maps to "unknown" os
    // so WindowControls should be rendered (only hidden on macOS)
    expect(screen.getByLabelText("Minimize")).toBeInTheDocument();
    expect(screen.getByLabelText("Maximize")).toBeInTheDocument();
    expect(screen.getByLabelText("Close")).toBeInTheDocument();
  });
});
