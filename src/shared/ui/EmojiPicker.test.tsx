import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// Mock emoji-mart so the test exercises our wrapper (positioning, portal,
// escape/click-outside handlers, prop forwarding) without depending on the
// library's web-component / shadow-DOM internals — those are not reachable
// through @testing-library queries.
const pickerSpy = vi.fn();

vi.mock("@emoji-mart/react", () => ({
  default: (props: Record<string, unknown>) => {
    pickerSpy(props);
    return (
      <div data-testid="emoji-mart-picker">
        <button
          type="button"
          data-testid="emit-native"
          onClick={() => {
            const onSelect = props.onEmojiSelect as
              ((e: { native?: string; id?: string; name?: string }) => void) | undefined;
            onSelect?.({ native: "👍" });
          }}
        >
          native
        </button>
        <button
          type="button"
          data-testid="emit-custom"
          onClick={() => {
            const onSelect = props.onEmojiSelect as
              ((e: { native?: string; id?: string; name?: string }) => void) | undefined;
            onSelect?.({ id: "custom_e1", name: "tada" });
          }}
        >
          custom
        </button>
      </div>
    );
  },
}));

vi.mock("@emoji-mart/data", () => ({ default: {} }));

import { EmojiPicker } from "./EmojiPicker";

// Helper: render EmojiPicker and wait for the React.lazy() Suspense boundary
// to resolve (emoji-mart is dynamically imported, so we poll until mounted).
async function renderPicker(props: Parameters<typeof EmojiPicker>[0]) {
  render(<EmojiPicker {...props} />);
  // findByTestId retries until the lazy chunk resolves and Suspense commits
  await screen.findByTestId("emoji-mart-picker");
}

describe("EmojiPicker", () => {
  const defaultProps = {
    position: { x: 100, y: 100 },
    onSelect: vi.fn(),
    onClose: vi.fn(),
  };

  beforeEach(() => {
    pickerSpy.mockClear();
  });

  it("renders the emoji-mart picker into a portal", async () => {
    await renderPicker(defaultProps);
    expect(screen.getByTestId("emoji-mart-picker")).toBeInTheDocument();
  });

  it("forwards dark theme and emoji-mart config", async () => {
    await renderPicker(defaultProps);
    expect(pickerSpy).toHaveBeenCalled();
    const props = pickerSpy.mock.lastCall![0] as Record<string, unknown>;
    expect(props.theme).toBe("dark");
    expect(props.set).toBe("native");
  });

  it("emits the native unicode value on standard emoji selection", async () => {
    const onSelect = vi.fn();
    await renderPicker({ ...defaultProps, onSelect });
    fireEvent.click(screen.getByTestId("emit-native"));
    expect(onSelect).toHaveBeenCalledWith("👍");
  });

  it("emits :name: shortcode for custom emojis", async () => {
    const onSelect = vi.fn();
    await renderPicker({ ...defaultProps, onSelect });
    fireEvent.click(screen.getByTestId("emit-custom"));
    expect(onSelect).toHaveBeenCalledWith(":tada:");
  });

  it("forwards a Custom category when customEmojis is provided", async () => {
    const customEmojis = [
      { id: "e1", name: "tada", imageUrl: "https://example.com/tada.png" },
      { id: "e2", name: "wave", imageUrl: "https://example.com/wave.png" },
    ];
    await renderPicker({ ...defaultProps, customEmojis });
    const props = pickerSpy.mock.lastCall![0] as { custom?: unknown };
    expect(props.custom).toEqual([
      {
        id: "custom",
        name: "Custom",
        emojis: [
          {
            id: "custom_e1",
            name: "tada",
            keywords: ["tada"],
            skins: [{ src: "https://example.com/tada.png" }],
          },
          {
            id: "custom_e2",
            name: "wave",
            keywords: ["wave"],
            skins: [{ src: "https://example.com/wave.png" }],
          },
        ],
      },
    ]);
  });

  it("does not forward a custom category when no customEmojis are provided", async () => {
    await renderPicker(defaultProps);
    const props = pickerSpy.mock.lastCall![0] as { custom?: unknown };
    expect(props.custom).toBeUndefined();
  });

  it("calls onClose when Escape is pressed anywhere", async () => {
    const onClose = vi.fn();
    await renderPicker({ ...defaultProps, onClose });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on outside click after the click-outside listener is attached", async () => {
    // Install fake timers BEFORE render so the wrapper's setTimeout(..., 0)
    // (deferring the mousedown listener to avoid the opening click immediately
    // closing the picker) is captured from the start.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onClose = vi.fn();
    try {
      render(<EmojiPicker {...defaultProps} onClose={onClose} />);
      // Flush the lazy import promise (real async) then advance fake timers
      await vi.runAllTimersAsync();
      fireEvent.mouseDown(document.body);
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not call onClose when mousedown happens inside the picker", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onClose = vi.fn();
    try {
      render(<EmojiPicker {...defaultProps} onClose={onClose} />);
      await vi.runAllTimersAsync();
      fireEvent.mouseDown(screen.getByTestId("emoji-mart-picker"));
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
