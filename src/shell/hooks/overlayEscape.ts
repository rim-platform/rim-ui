import type { KeyboardEvent } from "react";

import { hostDialogOpen } from "../../shared/ui/hostDialogs";

/**
 * Runs `close` for an Escape that nothing else took: not one a text field's suggestions or an
 * inline prompt own, not one already handled, and not one meant for an open dialog.
 *
 * @param event - The key event that reached the overlay.
 * @param close - Closes the overlay.
 */
export function closeOnEscape(event: KeyboardEvent, close: () => void): void {
  if (event.key !== "Escape" || event.defaultPrevented || hostDialogOpen()) return;
  if (
    event.target instanceof Element &&
    event.target.closest("[data-suggestions-open], [data-owns-escape]")
  ) {
    return;
  }
  event.preventDefault();
  close();
}
