import { useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

import { buildTerminalTheme } from "../terminalTheme";
import { useTerminalStore } from "../state/useTerminalStore";

const DEFAULT_FONT_FAMILY = "'JetBrainsMono Nerd Font Mono', 'JetBrainsMono NFM', 'FiraCode Nerd Font Mono', 'CaskaydiaCove Nerd Font Mono', 'Hack Nerd Font Mono', 'MesloLGS NF', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Menlo', 'Consolas', monospace";

/** Base64 encode a string to send to PTY. */
function encodeBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

/** Decode base64 string from PTY output to Uint8Array for xterm. */
function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

interface UseTerminalSessionOptions {
  sessionId: string | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Manages one xterm.js terminal instance lifecycle:
 * - Dynamically imports xterm.js
 * - Creates PTY session via Tauri
 * - Wires input/output
 * - Handles resize via FitAddon + ResizeObserver
 * - Cleans up on unmount
 */
export function useTerminalSession({ sessionId, containerRef }: UseTerminalSessionOptions) {
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const handleResize = useCallback(() => {
    const fit = fitAddonRef.current;
    const term = terminalRef.current;
    if (!fit || !term || !sessionId) return;
    try {
      fit.fit();
      const { cols, rows } = term;
      invoke("terminal_resize", { sessionId, cols, rows }).catch(() => {});
    } catch {
      // fit() can throw if container is not visible
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !containerRef.current) return;

    const container = containerRef.current;
    let destroyed = false;

    async function setup() {
      // Dynamic import — xterm.js only loaded when terminal is first used
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);

      if (destroyed) return;

      const theme = buildTerminalTheme();
      const { fontFamily: userFont, fontSize: userFontSize } = useTerminalStore.getState();
      const terminal = new Terminal({
        theme,
        fontFamily: userFont.trim() || DEFAULT_FONT_FAMILY,
        fontSize: userFontSize || 13,
        lineHeight: 1.2,
        cursorBlink: true,
        cursorStyle: "bar",
        allowProposedApi: true,
        scrollback: 5000,
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);

      terminal.open(container);
      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      // Initial fit
      requestAnimationFrame(() => {
        if (destroyed) return;
        try {
          fitAddon.fit();
          const { cols, rows } = terminal;
          invoke("terminal_resize", { sessionId, cols, rows }).catch(() => {});
        } catch {
          // ignore
        }
      });

      // Wire input: xterm → PTY
      const onDataDisposable = terminal.onData((data: string) => {
        const encoded = encodeBase64(data);
        invoke("terminal_write", { sessionId, data: encoded }).catch(() => {});
      });

      // Wire output: PTY → xterm
      const unlisten = await listen<string>(
        `terminal://output/${sessionId}`,
        (event) => {
          if (destroyed) return;
          const bytes = decodeBase64(event.payload);
          terminal.write(bytes);
        },
      );

      // Listen for PTY exit
      const unlistenExit = await listen<number>(
        `terminal://exit/${sessionId}`,
        () => {
          if (destroyed) return;
          terminal.write("\r\n\x1b[90m[Process exited]\x1b[0m\r\n");
        },
      );

      // ResizeObserver for container size changes
      const resizeObserver = new ResizeObserver(() => {
        if (destroyed) return;
        try {
          fitAddon.fit();
          const { cols, rows } = terminal;
          invoke("terminal_resize", { sessionId, cols, rows }).catch(() => {});
        } catch {
          // ignore
        }
      });
      resizeObserver.observe(container);

      cleanupRef.current = () => {
        onDataDisposable.dispose();
        unlisten();
        unlistenExit();
        resizeObserver.disconnect();
        terminal.dispose();
        terminalRef.current = null;
        fitAddonRef.current = null;
      };
    }

    setup().catch((err) => {
      console.error(`[RIM:Terminal] setup failed for session ${sessionId}:`, err);
    });

    return () => {
      destroyed = true;
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [sessionId, containerRef, handleResize]);

  return { terminalRef, fitAddonRef, handleResize };
}
