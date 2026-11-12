import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(join(__dirname, "globals.css"), "utf8");

/** The `#rrggbb` value of the theme token `--color-rim-<name>`. */
function token(name: string): string {
  const match = new RegExp(`--color-rim-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(CSS);
  if (!match) throw new Error(`token ${name} is not a #rrggbb value in globals.css`);
  return match[1];
}

/** The WCAG relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio between two `#rrggbb` colours. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const GROUNDS = ["void", "panel", "panel-soft"];
const FOREGROUNDS = ["text", "text-muted", "text-faint", "accent", "danger", "success", "warm"];

describe("colour tokens", () => {
  for (const foreground of FOREGROUNDS) {
    for (const ground of GROUNDS) {
      it(`rim-${foreground} reads on rim-${ground} at 4.5:1`, () => {
        expect(contrast(token(foreground), token(ground))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("white reads on rim-danger-solid at 4.5:1", () => {
    expect(contrast("#ffffff", token("danger-solid"))).toBeGreaterThanOrEqual(4.5);
  });

  it("rim-void reads on rim-accent fills at 4.5:1", () => {
    expect(contrast(token("void"), token("accent"))).toBeGreaterThanOrEqual(4.5);
  });

  const CARD_TITLES: Record<string, string> = {
    running: "text",
    confirm: "warm",
    denied: "danger",
    failed: "warm",
    done: "success",
    ended: "text-muted",
  };
  for (const [state, title] of Object.entries(CARD_TITLES)) {
    for (const foreground of new Set(["text", "text-muted", title])) {
      it(`rim-${foreground} reads on rim-card-${state} at 4.5:1`, () => {
        expect(contrast(token(foreground), token(`card-${state}`))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("rim-panel reads on rim-signal fills at 4.5:1", () => {
    expect(contrast(token("panel"), token("signal"))).toBeGreaterThanOrEqual(4.5);
  });
});
