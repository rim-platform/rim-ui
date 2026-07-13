import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { RotationPreviewStrip } from "./RotationPreviewStrip";
import type { OnCallShift } from "../api/useOnCallShifts";

const alice = { id: "u1", username: "alice", displayName: "Alice", avatarUrl: null };
const bob = { id: "u2", username: "bob", displayName: "Bob", avatarUrl: null };

describe("RotationPreviewStrip", () => {
  it("renders exactly the fixed shift list it's given — no client-side rotation computation", () => {
    // A 4-day window: Alice days 0-2, Bob days 2-4 — both base-rotation (non-override) shifts.
    const windowStart = "2026-07-01T00:00:00Z";
    const windowEnd = "2026-07-05T00:00:00Z";
    const shifts: OnCallShift[] = [
      {
        startAt: "2026-07-01T00:00:00Z",
        endAt: "2026-07-03T00:00:00Z",
        isOverride: false,
        user: alice,
      },
      {
        startAt: "2026-07-03T00:00:00Z",
        endAt: "2026-07-05T00:00:00Z",
        isOverride: false,
        user: bob,
      },
    ];

    render(
      <RotationPreviewStrip shifts={shifts} windowStart={windowStart} windowEnd={windowEnd} />,
    );

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);

    // Each segment occupies exactly the percentage its given interval represents of the
    // window — nothing here is derived from a rotation spec, only from startAt/endAt math.
    expect(items[0]).toHaveStyle({ left: "0%", width: "50%" });
    expect(items[1]).toHaveStyle({ left: "50%", width: "50%" });
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("clamps a shift that starts before the window to the window start", () => {
    const shifts: OnCallShift[] = [
      {
        startAt: "2026-06-30T00:00:00Z",
        endAt: "2026-07-02T00:00:00Z",
        isOverride: false,
        user: alice,
      },
    ];
    render(
      <RotationPreviewStrip
        shifts={shifts}
        windowStart="2026-07-01T00:00:00Z"
        windowEnd="2026-07-05T00:00:00Z"
      />,
    );
    const item = screen.getByRole("listitem");
    expect(item).toHaveStyle({ left: "0%", width: "25%" });
  });

  it("renders the empty state when there is no coverage in the window", () => {
    render(
      <RotationPreviewStrip
        shifts={[]}
        windowStart="2026-07-01T00:00:00Z"
        windowEnd="2026-07-05T00:00:00Z"
      />,
    );
    expect(screen.getByText("No on-call coverage in this window.")).toBeInTheDocument();
  });

  it("shows Unassigned for a shift with no resolved user", () => {
    const shifts: OnCallShift[] = [
      {
        startAt: "2026-07-01T00:00:00Z",
        endAt: "2026-07-02T00:00:00Z",
        isOverride: false,
        user: null,
      },
    ];
    render(
      <RotationPreviewStrip
        shifts={shifts}
        windowStart="2026-07-01T00:00:00Z"
        windowEnd="2026-07-05T00:00:00Z"
      />,
    );
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("styles override segments distinctly (server-flagged `isOverride`, not client-derived)", () => {
    const shifts: OnCallShift[] = [
      {
        startAt: "2026-07-01T00:00:00Z",
        endAt: "2026-07-03T00:00:00Z",
        isOverride: false,
        user: alice,
      },
      {
        startAt: "2026-07-03T00:00:00Z",
        endAt: "2026-07-05T00:00:00Z",
        isOverride: true,
        user: bob,
      },
    ];
    render(
      <RotationPreviewStrip
        shifts={shifts}
        windowStart="2026-07-01T00:00:00Z"
        windowEnd="2026-07-05T00:00:00Z"
      />,
    );

    const items = screen.getAllByRole("listitem");
    expect(items[0].className).toContain("bg-rim-accent/20");
    expect(items[0].className).not.toContain("bg-rim-warm/20");
    expect(items[1].className).toContain("bg-rim-warm/20");
    expect(items[1].className).not.toContain("bg-rim-accent/20");
  });
});
