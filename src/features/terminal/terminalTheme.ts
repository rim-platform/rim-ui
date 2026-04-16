import type { ITheme } from "@xterm/xterm";

/**
 * Reads rim-* CSS custom properties from :root and maps them to xterm.js ITheme.
 * Called once per terminal mount and on theme changes.
 */
export function buildTerminalTheme(): ITheme {
  const style = getComputedStyle(document.documentElement);

  function get(varName: string, fallback: string): string {
    return style.getPropertyValue(varName).trim() || fallback;
  }

  const accent = get("--color-rim-accent", "#22d3ee");

  return {
    background: get("--color-rim-void", "#0b1120"),
    foreground: get("--color-rim-text", "#e2e8f0"),
    cursor: accent,
    cursorAccent: get("--color-rim-void", "#0b1120"),
    selectionBackground: hexToRgba(accent, 0.2),
    selectionForeground: undefined,

    // ANSI colors — sensible defaults that work on dark backgrounds
    black: get("--color-rim-void", "#0b1120"),
    red: "#f87171",
    green: "#4ade80",
    yellow: "#facc15",
    blue: "#60a5fa",
    magenta: "#c084fc",
    cyan: accent,
    white: get("--color-rim-text", "#e2e8f0"),

    brightBlack: get("--color-rim-text-faint", "#475569"),
    brightRed: "#fca5a5",
    brightGreen: "#86efac",
    brightYellow: "#fde047",
    brightBlue: "#93c5fd",
    brightMagenta: "#d8b4fe",
    brightCyan: "#67e8f9",
    brightWhite: "#f8fafc",
  };
}

function hexToRgba(hex: string, alpha: number): string {
  // Handle both #rgb and #rrggbb
  const cleaned = hex.replace("#", "");
  const r = parseInt(cleaned.substring(0, 2), 16);
  const g = parseInt(cleaned.substring(2, 4), 16);
  const b = parseInt(cleaned.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(34, 211, 238, ${alpha})`;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
