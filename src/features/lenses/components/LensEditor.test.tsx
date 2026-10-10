import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import { renderWithProviders as render } from "../../../test/utils";
import { useToastStore } from "../../../shared/toast";
import { FilterField, FilterLogic, FilterOp } from "../api/useLenses";
import type { ChannelLens } from "../api/useLenses";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import { LensEditor } from "./LensEditor";

function toastTitles(): string[] {
  return useToastStore.getState().toasts.map((t) => t.title);
}

function lastInput(): Record<string, unknown> {
  const call = requestMock.mock.calls.at(-1);
  return (call?.[1] as { input: Record<string, unknown> }).input;
}

const existing: ChannelLens = {
  id: "lens-1",
  serverId: "ws-1",
  conversationId: "conv-1",
  createdBy: "me",
  name: "From Bob",
  filterSpec: {
    conditions: [
      { field: FilterField.AUTHOR_ID, op: FilterOp.IN, value: ["bob"] },
      { field: FilterField.IS_PINNED, op: FilterOp.EQ, value: true },
    ],
    logic: FilterLogic.OR,
  },
  isShared: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function renderEditor(props: { existingLens?: ChannelLens | null; onClose?: () => void } = {}) {
  const onClose = props.onClose ?? vi.fn();
  render(
    <LensEditor
      open
      onClose={onClose}
      serverId="ws-1"
      conversationId="conv-1"
      existingLens={props.existingLens}
    />,
  );
  return { onClose };
}

beforeEach(() => {
  requestMock.mockReset();
  useToastStore.setState({ toasts: [] });
});

describe("LensEditor create", () => {
  it("starts with one 'Has Links = Yes' condition and AND logic", () => {
    renderEditor();
    // Links are read from the text, so the condition says encrypted messages never match.
    expect(screen.getByText(/^Text and link conditions never match messages/)).toBeInTheDocument();
    expect(screen.getByText("Create Lens")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Has Links")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Yes")).toBeInTheDocument();
    // The only condition cannot be removed.
    expect(screen.queryByLabelText("Remove condition")).not.toBeInTheDocument();
  });

  it("requires a name", async () => {
    const { onClose } = renderEditor();
    fireEvent.change(screen.getByPlaceholderText("e.g. Messages with links"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(toastTitles()).toContain("Lens name is required"));
    expect(requestMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("caps the name at 100 characters", () => {
    renderEditor();
    const input = screen.getByPlaceholderText("e.g. Messages with links") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "x".repeat(150) } });
    expect(input.value).toHaveLength(100);
  });

  it("builds the filter spec from the condition rows and creates the lens", async () => {
    requestMock.mockResolvedValue({ createChannelLens: existing });
    const { onClose } = renderEditor();

    fireEvent.change(screen.getByPlaceholderText("e.g. Messages with links"), {
      target: { value: " Deploys " },
    });
    fireEvent.click(screen.getByText("Any condition (OR)"));

    // Row 1: text contains "sev1" (switching field resets op and value).
    fireEvent.change(screen.getByDisplayValue("Has Links"), {
      target: { value: FilterField.TEXT_CONTAINS },
    });
    fireEvent.change(screen.getByPlaceholderText("Search text..."), { target: { value: "sev1" } });

    // Row 2: author in [alice, bob].
    fireEvent.click(screen.getByText("Add condition"));
    const fieldSelects = screen.getAllByDisplayValue("Has Links");
    fireEvent.change(fieldSelects[fieldSelects.length - 1], {
      target: { value: FilterField.AUTHOR_ID },
    });
    fireEvent.change(screen.getByPlaceholderText("User IDs (comma-separated)"), {
      target: { value: "alice, bob,," },
    });

    // Row 3: attachments = No.
    fireEvent.click(screen.getByText("Add condition"));
    fireEvent.change(screen.getAllByDisplayValue("Has Links")[0], {
      target: { value: FilterField.HAS_ATTACHMENTS },
    });
    fireEvent.change(screen.getByDisplayValue("Yes"), { target: { value: "false" } });

    fireEvent.click(screen.getByLabelText("Share with channel members"));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(requestMock.mock.calls[0][0]).toContain("mutation CreateChannelLens");
    expect(lastInput()).toEqual({
      serverId: "ws-1",
      conversationId: "conv-1",
      name: "Deploys",
      filterSpec: {
        conditions: [
          { field: FilterField.TEXT_CONTAINS, op: FilterOp.CONTAINS, value: "sev1" },
          { field: FilterField.AUTHOR_ID, op: FilterOp.IN, value: ["alice", "bob"] },
          { field: FilterField.HAS_ATTACHMENTS, op: FilterOp.EQ, value: false },
        ],
        logic: FilterLogic.OR,
      },
      isShared: true,
    });
    expect(toastTitles()).toContain("Lens created");
  });

  it("removes a condition row", () => {
    renderEditor();
    fireEvent.click(screen.getByText("Add condition"));
    expect(screen.getAllByLabelText("Remove condition")).toHaveLength(2);
    fireEvent.click(screen.getAllByLabelText("Remove condition")[0]);
    expect(screen.queryByLabelText("Remove condition")).not.toBeInTheDocument();
  });

  it("stays open and reports a failed create", async () => {
    requestMock.mockRejectedValue(new Error("nope"));
    const { onClose } = renderEditor();
    fireEvent.change(screen.getByPlaceholderText("e.g. Messages with links"), {
      target: { value: "Links" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(toastTitles()).toContain("Failed to create lens"));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("LensEditor edit", () => {
  it("prefills from the existing lens and sends an update", async () => {
    requestMock.mockResolvedValue({ updateChannelLens: existing });
    const { onClose } = renderEditor({ existingLens: existing });

    expect(screen.getByText("Edit Lens")).toBeInTheDocument();
    expect(screen.getByDisplayValue("From Bob")).toBeInTheDocument();
    expect(screen.getByDisplayValue("bob")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Is Pinned")).toBeInTheDocument();
    expect(screen.getByLabelText("Share with channel members")).toBeChecked();

    fireEvent.change(screen.getByDisplayValue("From Bob"), { target: { value: "Bob" } });
    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(requestMock.mock.calls[0][0]).toContain("mutation UpdateChannelLens");
    expect(lastInput()).toEqual({
      serverId: "ws-1",
      lensId: "lens-1",
      name: "Bob",
      filterSpec: existing.filterSpec,
      isShared: true,
    });
    expect(toastTitles()).toContain("Lens updated");
  });

  it("reports a failed update", async () => {
    requestMock.mockRejectedValue(new Error("nope"));
    renderEditor({ existingLens: existing });
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    await waitFor(() => expect(toastTitles()).toContain("Failed to update lens"));
  });
});
