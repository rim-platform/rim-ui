import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EmojiPicker } from "./EmojiPicker";

describe("EmojiPicker", () => {
  const defaultProps = {
    position: { x: 100, y: 100 },
    onSelect: vi.fn(),
    onClose: vi.fn(),
  };

  it("renders with role='listbox'", () => {
    render(<EmojiPicker {...defaultProps} />);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("renders default emoji options", () => {
    render(<EmojiPicker {...defaultProps} />);
    const options = screen.getAllByRole("option");
    expect(options.length).toBe(10); // EMOJI_OPTIONS has 10 items
  });

  it("calls onSelect when emoji is clicked", () => {
    const onSelect = vi.fn();
    render(<EmojiPicker {...defaultProps} onSelect={onSelect} />);
    const options = screen.getAllByRole("option");
    fireEvent.click(options[0]);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape key", () => {
    const onClose = vi.fn();
    render(<EmojiPicker {...defaultProps} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("navigates with arrow keys", () => {
    const onSelect = vi.fn();
    render(<EmojiPicker {...defaultProps} onSelect={onSelect} />);
    const listbox = screen.getByRole("listbox");
    fireEvent.keyDown(listbox, { key: "ArrowRight" });
    fireEvent.keyDown(listbox, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("renders custom emojis when provided", () => {
    const customEmojis = [
      { id: "e1", name: "tada", imageUrl: "https://example.com/tada.png" },
      { id: "e2", name: "wave", imageUrl: "https://example.com/wave.png" },
    ];
    render(<EmojiPicker {...defaultProps} customEmojis={customEmojis} />);
    expect(screen.getByText("Custom")).toBeInTheDocument();
    expect(screen.getByAltText("tada")).toBeInTheDocument();
    expect(screen.getByAltText("wave")).toBeInTheDocument();
  });

  it("selects custom emoji with shortcode format", () => {
    const onSelect = vi.fn();
    const customEmojis = [
      { id: "e1", name: "tada", imageUrl: "https://example.com/tada.png" },
    ];
    render(<EmojiPicker {...defaultProps} onSelect={onSelect} customEmojis={customEmojis} />);
    fireEvent.click(screen.getByAltText("tada"));
    expect(onSelect).toHaveBeenCalledWith(":tada:");
  });

  it("closes on click outside", () => {
    const onClose = vi.fn();
    render(<EmojiPicker {...defaultProps} onClose={onClose} />);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });
});
