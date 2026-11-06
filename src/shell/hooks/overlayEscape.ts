import type { KeyboardEvent } from "react";

import { hostDialogOpen } from "../../shared/ui/hostDialogs";

/**
 * Runs `close` for an Escape that nothing else took: not one a text field's suggestions or an
 * inline prompt own, not one already handled, not one meant for an open dialog, and not one from
 * a portal whose DOM lies outside the overlay.
 *
 * @param event - The key event that reached the overlay.
 * @param close - Closes the overlay.
 */
export function closeOnEscape(event: KeyboardEvent, close: () => void): void {
  if (event.key !== "Escape" || event.defaultPrevented || hostDialogOpen()) return;
  // React events bubble through portals: an Escape from a picker or menu rendered elsewhere in
  // the document belongs to that one.
  if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
  if (
    event.target instanceof Element &&
    event.target.closest("[data-suggestions-open], [data-owns-escape]")
  ) {
    return;
  }
  event.preventDefault();
  close();
}
