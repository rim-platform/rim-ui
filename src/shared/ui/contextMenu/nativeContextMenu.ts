import { useEffect } from "react";

import type { AppPlatform } from "../../../core/runtime/runtime";

/** Elements whose own menu (cut, copy, paste, spelling) stays available. */
const EDITABLE = 'input, textarea, [contenteditable]:not([contenteditable="false"])';

/**
 * Whether a right click on `target` keeps the webview's own menu: in a text field or an
 * editable element, or while text is selected, so that copy and paste stay reachable.
 */
export function keepsNativeContextMenu(target: EventTarget | null): boolean {
  if (target instanceof Element && target.closest(EDITABLE)) return true;
  const selection = window.getSelection();
  return selection !== null && selection.rangeCount > 0 && !selection.isCollapsed;
}

/** Cancels the webview's own menu for a `contextmenu` event no app menu took. */
export function suppressNativeContextMenu(event: MouseEvent): void {
  if (event.defaultPrevented || keepsNativeContextMenu(event.target)) return;
  event.preventDefault();
}

/**
 * Hides the webview's default menu (reload, inspect, back) in the desktop app wherever the app
 * opens no menu of its own, except over editable text and a text selection. The web app keeps
 * the browser's menu.
 */
export function useNativeContextMenuPolicy(platform: AppPlatform): void {
  useEffect(() => {
    if (platform !== "desktop") return;
    document.addEventListener("contextmenu", suppressNativeContextMenu);
    return () => document.removeEventListener("contextmenu", suppressNativeContextMenu);
  }, [platform]);
}
