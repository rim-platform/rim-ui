import { boxKind } from "./registry";
import type { HomeBox } from "../layout/homeLayout";

/** The grid's classes: one column under 760 px of room, two from there. */
export const GRID_CLASS = "grid grid-cols-1 gap-3 @min-[760px]:grid-cols-2";

/** The classes that make a box take one column or both. */
export function widthClass(box: HomeBox): string {
  return box.width === "full" ? "@min-[760px]:col-span-2" : "";
}

/** What a box says instead of its content: it needs a newer app, or this device cannot run it. */
export function boxLimit(box: HomeBox): string | null {
  const kind = boxKind(box.kind);
  if (!kind) return "This box needs a newer version of RIM";
  return kind.unavailableReason();
}
