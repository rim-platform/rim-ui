/**
 * Centralized z-index scale for floating UI layers.
 * Use these constants instead of magic numbers.
 *
 * Layer order (lowest to highest):
 * - DROPDOWN: dropdowns
 * - OVERLAY_BACKDROP: dim backdrop behind modals
 * - OVERLAY_CONTENT: modal/dialog panels, command palette
 * - POPOVER: context menus, emoji pickers, tooltips, suggestions
 * - TOAST: notifications (future)
 */
export const Z = {
  DROPDOWN: 100,
  OVERLAY_BACKDROP: 200,
  OVERLAY_CONTENT: 300,
  POPOVER: 400,
  TOAST: 500,
} as const;
