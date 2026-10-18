import type { ReactNode, SyntheticEvent } from "react";

function stop(event: SyntheticEvent) {
  event.stopPropagation();
}

/**
 * Holds a context menu rendered inside a row that has handlers of its own, such as a message
 * list's arrow keys or a row's long press. The menu is portaled to the body, but React still
 * bubbles its events to its React parents; this boundary keeps its keys, clicks, presses and
 * focus from reaching them. It draws no box of its own.
 *
 * @param children The controller's `menu`.
 */
export function IsolatedMenu({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <span
      className="contents"
      onKeyDown={stop}
      onClick={stop}
      onMouseDown={stop}
      onContextMenu={stop}
      onTouchStart={stop}
      onTouchMove={stop}
      onTouchEnd={stop}
      onFocus={stop}
      onBlur={stop}
    >
      {children}
    </span>
  );
}
