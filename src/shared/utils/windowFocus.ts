/**
 * Whether the person is at this window: it has focus and is not hidden. A window hidden to the
 * tray may still report focus, so focus alone does not say it.
 */
export function windowHasFocus(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}
