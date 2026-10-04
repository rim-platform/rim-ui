import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../api/useOnCallSchedules", () => ({
  useCreateOnCallSchedule: vi.fn(),
  useUpdateOnCallSchedule: vi.fn(),
  useAddRotationLayer: vi.fn(),
  useUpdateRotationLayer: vi.fn(),
  useRemoveRotationLayer: vi.fn(),
  useSetRotationParticipants: vi.fn(),
}));

vi.mock("../../workspaces/api/useServerMembers", () => ({
  useServerMembers: vi.fn(),
}));

import {
  useCreateOnCallSchedule,
  useUpdateOnCallSchedule,
  useAddRotationLayer,
  useUpdateRotationLayer,
  useRemoveRotationLayer,
  useSetRotationParticipants,
} from "../api/useOnCallSchedules";
import { useServerMembers } from "../../workspaces/api/useServerMembers";
import { ScheduleEditor } from "./ScheduleEditor";
import { RotationKindGql } from "../../../core/graphql/generated/schema-types";

const members = [
  { userId: "u1", username: "alice", displayName: "Alice", memberRole: "OWNER", joinedAt: "" },
];

function mockMutation(mutateAsync: ReturnType<typeof vi.fn>) {
  return { mutateAsync, isPending: false } as unknown;
}

function mockAllMutations({
  create = vi.fn(),
  update = vi.fn(),
  addLayer = vi.fn(),
  updateLayer = vi.fn(),
  removeLayer = vi.fn(),
  setParticipants = vi.fn(),
}: {
  create?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
  addLayer?: ReturnType<typeof vi.fn>;
  updateLayer?: ReturnType<typeof vi.fn>;
  removeLayer?: ReturnType<typeof vi.fn>;
  setParticipants?: ReturnType<typeof vi.fn>;
} = {}) {
  vi.mocked(useCreateOnCallSchedule).mockReturnValue(
    mockMutation(create) as ReturnType<typeof useCreateOnCallSchedule>,
  );
  vi.mocked(useUpdateOnCallSchedule).mockReturnValue(
    mockMutation(update) as ReturnType<typeof useUpdateOnCallSchedule>,
  );
  vi.mocked(useAddRotationLayer).mockReturnValue(
    mockMutation(addLayer) as ReturnType<typeof useAddRotationLayer>,
  );
  vi.mocked(useUpdateRotationLayer).mockReturnValue(
    mockMutation(updateLayer) as ReturnType<typeof useUpdateRotationLayer>,
  );
  vi.mocked(useRemoveRotationLayer).mockReturnValue(
    mockMutation(removeLayer) as ReturnType<typeof useRemoveRotationLayer>,
  );
  vi.mocked(useSetRotationParticipants).mockReturnValue(
    mockMutation(setParticipants) as ReturnType<typeof useSetRotationParticipants>,
  );
}

describe("ScheduleEditor", () => {
  beforeEach(() => {
    vi.mocked(useServerMembers).mockReturnValue({ data: members } as ReturnType<
      typeof useServerMembers
    >);
  });

  it("creates a new schedule then adds a layer and sets participants, in that order", async () => {
    const create = vi.fn().mockResolvedValue({ id: "sched-1", serverId: "srv-1" });
    const addLayer = vi.fn().mockResolvedValue({ id: "layer-1" });
    const setParticipants = vi.fn().mockResolvedValue({ id: "layer-1" });
    mockAllMutations({ create, addLayer, setParticipants });

    const onClose = vi.fn();
    render(<ScheduleEditor open serverId="srv-1" onClose={onClose} />);

    fireEvent.change(screen.getByPlaceholderText("e.g. Primary on-call"), {
      target: { value: "Primary" },
    });
    fireEvent.change(screen.getByLabelText("Add participant"), { target: { value: "u1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());

    expect(create).toHaveBeenCalledWith({
      serverId: "srv-1",
      name: "Primary",
      timezone: expect.any(String),
    });
    expect(addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: "srv-1", scheduleId: "sched-1" }),
    );
    expect(setParticipants).toHaveBeenCalledWith({
      serverId: "srv-1",
      layerId: "layer-1",
      userIds: ["u1"],
    });

    // Order matters: create -> addLayer -> setParticipants.
    const createOrder = create.mock.invocationCallOrder[0];
    const addLayerOrder = addLayer.mock.invocationCallOrder[0];
    const setParticipantsOrder = setParticipants.mock.invocationCallOrder[0];
    expect(createOrder).toBeLessThan(addLayerOrder);
    expect(addLayerOrder).toBeLessThan(setParticipantsOrder);
  });

  it("blocks save entirely (no mutations fired) when a layer has zero participants", async () => {
    const create = vi.fn();
    const addLayer = vi.fn();
    mockAllMutations({ create, addLayer });

    render(<ScheduleEditor open serverId="srv-1" onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("e.g. Primary on-call"), {
      target: { value: "Primary" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await screen.findByText(
      "A rotation layer needs at least one participant. Remove the layer to disable it.",
    );
    // Not just the layer mutations — the schedule-level mutation is blocked too, so the
    // UI never diverges from server state (no partial save, no false-success close).
    expect(create).not.toHaveBeenCalled();
    expect(addLayer).not.toHaveBeenCalled();
  });

  const existingSchedule = {
    id: "sched-1",
    serverId: "srv-1",
    name: "Primary",
    timezone: "UTC",
    createdBy: "u1",
    createdAt: "",
    updatedAt: "",
    rotationLayers: [
      {
        id: "layer-1",
        scheduleId: "sched-1",
        name: "Layer A",
        priority: 0,
        kind: RotationKindGql.WEEKLY,
        handoffTime: "09:00:00",
        handoffWeekday: 0,
        intervalSeconds: null,
        anchorAt: "2026-07-01T09:00:00Z",
        createdAt: "",
        participants: ["u1"],
      },
    ],
  };

  it("prefills existing rotation layers, sorted as returned by the backend", () => {
    mockAllMutations();
    render(<ScheduleEditor open serverId="srv-1" onClose={vi.fn()} existing={existingSchedule} />);

    expect(screen.getByText("Rotation layers (1/5)")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Layer A")).toBeInTheDocument();
  });

  it("editing an existing schedule updates name/timezone and updates its existing layer", async () => {
    const update = vi.fn().mockResolvedValue({ id: "sched-1" });
    const updateLayer = vi.fn().mockResolvedValue({ id: "layer-1" });
    const setParticipants = vi.fn().mockResolvedValue({ id: "layer-1" });
    const addLayer = vi.fn();
    const removeLayer = vi.fn();
    mockAllMutations({ update, updateLayer, setParticipants, addLayer, removeLayer });

    const onClose = vi.fn();
    render(<ScheduleEditor open serverId="srv-1" onClose={onClose} existing={existingSchedule} />);

    fireEvent.change(screen.getByPlaceholderText("e.g. Primary on-call"), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(update).toHaveBeenCalledWith({
      serverId: "srv-1",
      scheduleId: "sched-1",
      name: "Renamed",
      timezone: "UTC",
    });
    expect(updateLayer).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: "srv-1", layerId: "layer-1", name: "Layer A" }),
    );
    expect(setParticipants).toHaveBeenCalledWith({
      serverId: "srv-1",
      layerId: "layer-1",
      userIds: ["u1"],
    });
    expect(addLayer).not.toHaveBeenCalled();
    expect(removeLayer).not.toHaveBeenCalled();
  });

  it("removes a layer no longer present in the draft list on save", async () => {
    const update = vi.fn().mockResolvedValue({ id: "sched-1" });
    const removeLayer = vi.fn().mockResolvedValue({ removeRotationLayer: true });
    mockAllMutations({ update, removeLayer });

    const onClose = vi.fn();
    render(<ScheduleEditor open serverId="srv-1" onClose={onClose} existing={existingSchedule} />);

    fireEvent.click(screen.getByLabelText("Remove layer"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(removeLayer).toHaveBeenCalledWith({ serverId: "srv-1", layerId: "layer-1" });
  });

  it("adds a brand-new layer to an existing schedule via the create-flow mutations", async () => {
    const update = vi.fn().mockResolvedValue({ id: "sched-1" });
    const updateLayer = vi.fn().mockResolvedValue({ id: "layer-1" });
    const addLayer = vi.fn().mockResolvedValue({ id: "layer-2" });
    const setParticipants = vi.fn().mockResolvedValue({ id: "layer-2" });
    mockAllMutations({ update, updateLayer, addLayer, setParticipants });

    const onClose = vi.fn();
    render(<ScheduleEditor open serverId="srv-1" onClose={onClose} existing={existingSchedule} />);

    fireEvent.click(screen.getByRole("button", { name: "Add layer" }));
    const addParticipantSelects = screen.getAllByLabelText("Add participant");
    fireEvent.change(addParticipantSelects[addParticipantSelects.length - 1], {
      target: { value: "u1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: "srv-1", scheduleId: "sched-1" }),
    );
    expect(setParticipants).toHaveBeenCalledWith({
      serverId: "srv-1",
      layerId: "layer-2",
      userIds: ["u1"],
    });
  });

  it("blocks save when an EXISTING layer's participants are emptied out — it must not be silently accepted", async () => {
    const update = vi.fn();
    const updateLayer = vi.fn();
    const removeLayer = vi.fn();
    mockAllMutations({ update, updateLayer, removeLayer });

    render(<ScheduleEditor open serverId="srv-1" onClose={vi.fn()} existing={existingSchedule} />);

    // Empty out the existing layer's only participant.
    fireEvent.click(screen.getByLabelText("Remove Alice"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText(
      "A rotation layer needs at least one participant. Remove the layer to disable it.",
    );
    expect(update).not.toHaveBeenCalled();
    expect(updateLayer).not.toHaveBeenCalled();
    expect(removeLayer).not.toHaveBeenCalled();
  });

  it("removing the empty layer entirely (not emptying its participants) is the way to disable it, and unblocks save", async () => {
    const update = vi.fn().mockResolvedValue({ id: "sched-1" });
    const removeLayer = vi.fn().mockResolvedValue({ removeRotationLayer: true });
    const updateLayer = vi.fn();
    mockAllMutations({ update, removeLayer, updateLayer });

    const onClose = vi.fn();
    render(<ScheduleEditor open serverId="srv-1" onClose={onClose} existing={existingSchedule} />);

    // Remove the layer's only participant first (would otherwise block save)...
    fireEvent.click(screen.getByLabelText("Remove Alice"));
    // ...then remove the layer itself instead of trying to save it empty.
    fireEvent.click(screen.getByLabelText("Remove layer"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(removeLayer).toHaveBeenCalledWith({ serverId: "srv-1", layerId: "layer-1" });
    expect(updateLayer).not.toHaveBeenCalled();
    expect(
      screen.queryByText(
        "A rotation layer needs at least one participant. Remove the layer to disable it.",
      ),
    ).not.toBeInTheDocument();
  });
});
