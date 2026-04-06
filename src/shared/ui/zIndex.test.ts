import { describe, it, expect } from "vitest";
import { Z } from "./zIndex";

describe("zIndex constants", () => {
  it("has expected layer values", () => {
    expect(Z.DROPDOWN).toBe(100);
    expect(Z.OVERLAY_BACKDROP).toBe(200);
    expect(Z.OVERLAY_CONTENT).toBe(300);
    expect(Z.POPOVER).toBe(400);
    expect(Z.TOAST).toBe(500);
  });

  it("layers are in ascending order", () => {
    expect(Z.DROPDOWN).toBeLessThan(Z.OVERLAY_BACKDROP);
    expect(Z.OVERLAY_BACKDROP).toBeLessThan(Z.OVERLAY_CONTENT);
    expect(Z.OVERLAY_CONTENT).toBeLessThan(Z.POPOVER);
    expect(Z.POPOVER).toBeLessThan(Z.TOAST);
  });
});
