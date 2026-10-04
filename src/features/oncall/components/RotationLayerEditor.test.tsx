import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../workspaces/api/useServerMembers", () => ({
  useServerMembers: vi.fn(),
}));

import { useServerMembers } from "../../workspaces/api/useServerMembers";
import { RotationLayerEditor } from "./RotationLayerEditor";
import { makeEmptyDraftLayer, type DraftRotationLayer } from "../utils/rotationLayer";
import { RotationKindGql } from "../../../core/graphql/generated/schema-types";

const members = [
  { userId: "u1", username: "alice", displayName: "Alice", memberRole: "OWNER", joinedAt: "" },
  { userId: "u2", username: "bob", displayName: "Bob", memberRole: "GUEST", joinedAt: "" },
  { userId: "u3", username: "carol", displayName: "Carol", memberRole: "GUEST", joinedAt: "" },
];

function setup(layer: DraftRotationLayer, onChange = vi.fn()) {
  vi.mocked(useServerMembers).mockReturnValue({ data: members } as ReturnType<
    typeof useServerMembers
  >);
  render(
    <RotationLayerEditor serverId="srv-1" layer={layer} onChange={onChange} onRemove={vi.fn()} />,
  );
  return { onChange };
}

describe("RotationLayerEditor", () => {
  beforeEach(() => vi.mocked(useServerMembers).mockReset());

  it("adds a participant via the picker", () => {
    const layer = makeEmptyDraftLayer(0);
    const { onChange } = setup(layer);

    fireEvent.change(screen.getByLabelText("Add participant"), { target: { value: "u1" } });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ participantIds: ["u1"] }));
  });

  it("removes a participant inline", () => {
    const layer = { ...makeEmptyDraftLayer(0), participantIds: ["u1", "u2"] };
    const { onChange } = setup(layer);

    fireEvent.click(screen.getByLabelText("Remove Bob"));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ participantIds: ["u1"] }));
  });

  it("reorders participants via the move-down button", () => {
    const layer = { ...makeEmptyDraftLayer(0), participantIds: ["u1", "u2", "u3"] };
    const { onChange } = setup(layer);

    fireEvent.click(screen.getByLabelText("Move Alice down"));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ participantIds: ["u2", "u1", "u3"] }),
    );
  });

  it("reorders participants via the j/k keyboard shortcut on a focused row", () => {
    const layer = { ...makeEmptyDraftLayer(0), participantIds: ["u1", "u2", "u3"] };
    const { onChange } = setup(layer);

    const rows = screen.getAllByRole("listitem");
    fireEvent.keyDown(rows[0], { key: "j" });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ participantIds: ["u2", "u1", "u3"] }),
    );

    onChange.mockClear();
    fireEvent.keyDown(rows[1], { key: "k" });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ participantIds: ["u2", "u1", "u3"] }),
    );
  });

  it("does not move the first participant up or the last one down", () => {
    const layer = { ...makeEmptyDraftLayer(0), participantIds: ["u1", "u2"] };
    const { onChange } = setup(layer);

    expect(screen.getByLabelText("Move Alice up")).toBeDisabled();
    expect(screen.getByLabelText("Move Bob down")).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows handoff-time and handoff-weekday fields only for WEEKLY", () => {
    const layer = { ...makeEmptyDraftLayer(0), kind: RotationKindGql.WEEKLY };
    setup(layer);
    expect(screen.getByLabelText("Handoff day")).toBeInTheDocument();
  });

  it("shows an interval field for CUSTOM instead of handoff fields", () => {
    const layer = { ...makeEmptyDraftLayer(0), kind: RotationKindGql.CUSTOM };
    setup(layer);
    expect(screen.getByLabelText("Interval (seconds)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Handoff day")).not.toBeInTheDocument();
  });
});
