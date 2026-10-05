import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import { renderWithProviders as render } from "../../../test/utils";
import { useToastStore } from "../../../shared/toast";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useLensStore } from "../state/useLensStore";
import { FilterField, FilterLogic, FilterOp } from "../api/useLenses";
import type { ChannelLens } from "../api/useLenses";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import { LensPicker } from "./LensPicker";

function operationName(doc: unknown): string {
  return /(?:query|mutation)\s+(\w+)/.exec(String(doc))?.[1] ?? "unknown";
}

function makeLens(id: string, name: string, overrides: Partial<ChannelLens> = {}): ChannelLens {
  return {
    id,
    serverId: "ws-1",
    conversationId: "conv-1",
    createdBy: "me",
    name,
    filterSpec: {
      conditions: [{ field: FilterField.HAS_LINKS, op: FilterOp.EQ, value: true }],
      logic: FilterLogic.AND,
    },
    isShared: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const mine = makeLens("lens-1", "Links");
const shared = makeLens("lens-2", "Team pins", { createdBy: "bob", isShared: true });

let lensesResponse: () => Promise<unknown>;

beforeEach(() => {
  requestMock.mockReset();
  lensesResponse = () => Promise.resolve({ channelLenses: [mine, shared] });
  requestMock.mockImplementation((doc: unknown) => {
    switch (operationName(doc)) {
      case "ChannelLenses":
        return lensesResponse();
      case "DeleteChannelLens":
        return Promise.resolve({ deleteChannelLens: true });
      default:
        return Promise.reject(new Error(`unexpected ${operationName(doc)}`));
    }
  });
  useLensStore.setState({ activeLenses: {}, lensPickerOpen: false });
  useAuthStore.setState({ session: { userId: "me" } });
  useToastStore.setState({ toasts: [] });
});

function renderPicker() {
  render(<LensPicker serverId="ws-1" conversationId="conv-1" />);
}

function openPicker() {
  renderPicker();
  fireEvent.click(screen.getByLabelText("Channel lenses"));
}

describe("LensPicker", () => {
  it("is closed until the trigger is clicked", () => {
    renderPicker();
    expect(screen.queryByText("Create lens")).not.toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Channel lenses"));
    expect(screen.getByText("Create lens")).toBeInTheDocument();
    expect(useLensStore.getState().lensPickerOpen).toBe(true);
  });

  it("shows loading, then the conversation's lenses", async () => {
    openPicker();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(await screen.findByText("Links")).toBeInTheDocument();
    expect(screen.getByText("Team pins")).toBeInTheDocument();
  });

  it("shows the empty state", async () => {
    lensesResponse = () => Promise.resolve({ channelLenses: [] });
    openPicker();
    expect(await screen.findByText("No lenses yet")).toBeInTheDocument();
  });

  it("shows an error when lenses fail to load", async () => {
    lensesResponse = () => Promise.reject(new Error("down"));
    openPicker();
    expect(await screen.findByText("Failed to load lenses")).toBeInTheDocument();
    expect(screen.queryByText("No lenses yet")).not.toBeInTheDocument();
  });

  it("offers edit and delete only on the user's own lenses", async () => {
    openPicker();
    await screen.findByText("Links");
    expect(screen.getByLabelText("Edit Links")).toBeInTheDocument();
    expect(screen.getByLabelText("Delete Links")).toBeInTheDocument();
    expect(screen.queryByLabelText("Edit Team pins")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Delete Team pins")).not.toBeInTheDocument();
  });

  it("applies a lens to this conversation and closes", async () => {
    openPicker();
    fireEvent.click(await screen.findByText("Team pins"));

    expect(useLensStore.getState().activeLenses["conv-1"]).toBe("lens-2");
    expect(useLensStore.getState().lensPickerOpen).toBe(false);
  });

  it("clears the active lens", async () => {
    useLensStore.setState({ activeLenses: { "conv-1": "lens-1" } });
    openPicker();
    fireEvent.click(await screen.findByText("Clear lens"));

    expect(useLensStore.getState().activeLenses["conv-1"]).toBeNull();
    expect(useLensStore.getState().lensPickerOpen).toBe(false);
  });

  it("supports keyboard selection and Escape", async () => {
    openPicker();
    await screen.findByText("Links");
    const menu = screen.getByText("Create lens").closest("[tabindex='-1']") as HTMLElement;

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: "Enter" });
    expect(useLensStore.getState().activeLenses["conv-1"]).toBe("lens-2");

    fireEvent.click(screen.getByLabelText("Channel lenses"));
    await screen.findByText("Links");
    const reopened = screen.getByText("Create lens").closest("[tabindex='-1']") as HTMLElement;
    fireEvent.keyDown(reopened, { key: "Escape" });
    expect(useLensStore.getState().lensPickerOpen).toBe(false);
  });

  it("deletes an own lens and clears it when it was active", async () => {
    useLensStore.setState({ activeLenses: { "conv-1": "lens-1" } });
    openPicker();
    fireEvent.click(await screen.findByLabelText("Delete Links"));

    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.title)).toContain("Lens deleted"),
    );
    const deleteCall = requestMock.mock.calls.find(
      ([doc]) => operationName(doc) === "DeleteChannelLens",
    );
    expect(deleteCall?.[1]).toEqual({ serverId: "ws-1", lensId: "lens-1" });
    expect(useLensStore.getState().activeLenses["conv-1"]).toBeNull();
  });

  it("opens the editor to create a lens", async () => {
    openPicker();
    await screen.findByText("Links");
    fireEvent.click(screen.getByText("Create lens"));
    expect(screen.getByText("Create Lens")).toBeInTheDocument();
  });

  it("opens the editor prefilled to edit an own lens", async () => {
    openPicker();
    fireEvent.click(await screen.findByLabelText("Edit Links"));
    expect(screen.getByText("Edit Lens")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Links")).toBeInTheDocument();
  });
});
