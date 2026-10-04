import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../api/useCreateConversation", () => ({
  useCreateConversationMutation: () => ({
    mutate: mockMutate,
    isPending: false,
    error: null,
  }),
}));

vi.mock("../../workspaces/state/useWorkspaceStore", () => ({
  useWorkspaceStore: vi.fn((selector: (s: { workspaceId: string }) => unknown) =>
    selector({ workspaceId: "ws-1" }),
  ),
}));

vi.mock("../../../shell/state/useShellStore", () => ({
  useShellStore: vi.fn((selector: (s: { setSelectedConversationId: () => void }) => unknown) =>
    selector({ setSelectedConversationId: vi.fn() }),
  ),
}));

const mockMutate = vi.fn();

import { NewChannelDialog } from "./NewChannelDialog";

describe("NewChannelDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the dialog with title", () => {
    render(<NewChannelDialog onClose={vi.fn()} />);
    expect(screen.getByText("New channel")).toBeInTheDocument();
  });

  it("renders an input field for channel name", () => {
    render(<NewChannelDialog onClose={vi.fn()} />);
    expect(screen.getByPlaceholderText("general")).toBeInTheDocument();
  });

  it("renders a disabled Create button when input is empty", () => {
    render(<NewChannelDialog onClose={vi.fn()} />);
    const createBtn = screen.getByRole("button", { name: /create/i });
    expect(createBtn).toBeDisabled();
  });

  it("enables Create button when title is entered", () => {
    render(<NewChannelDialog onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText("general");
    fireEvent.change(input, { target: { value: "my-channel" } });

    const createBtn = screen.getByRole("button", { name: /create/i });
    expect(createBtn).not.toBeDisabled();
  });

  it("calls mutate with correct args on form submit", () => {
    render(<NewChannelDialog onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText("general");
    fireEvent.change(input, { target: { value: "my-channel" } });

    const form = input.closest("form")!;
    fireEvent.submit(form);

    expect(mockMutate).toHaveBeenCalledWith(
      {
        serverId: "ws-1",
        title: "my-channel",
        isChannel: true,
      },
      expect.any(Object),
    );
  });

  it("trims whitespace from channel name", () => {
    render(<NewChannelDialog onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText("general");
    fireEvent.change(input, { target: { value: "  spaced  " } });

    const form = input.closest("form")!;
    fireEvent.submit(form);

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ title: "spaced" }),
      expect.any(Object),
    );
  });

  it("does not submit when title is only whitespace", () => {
    render(<NewChannelDialog onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText("general");
    fireEvent.change(input, { target: { value: "   " } });

    const form = input.closest("form")!;
    fireEvent.submit(form);

    expect(mockMutate).not.toHaveBeenCalled();
  });
});
