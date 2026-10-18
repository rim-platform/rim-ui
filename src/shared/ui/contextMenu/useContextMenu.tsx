import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { DropdownMenu, type DropdownMenuItem } from "../DropdownMenu";
import { Z } from "../zIndex";

/** Builds a menu's items when it opens, so they reflect the state at that moment. */
type ContextMenuItems = () => DropdownMenuItem[];

interface ContextMenuOptions {
  /** Accessible name of the menu. */
  label?: string;
}

/** The handlers {@link ContextMenuController.bind} gives a target element, to spread on it. */
interface ContextMenuBindings {
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onTouchStart: (event: React.TouchEvent<HTMLElement>) => void;
  onTouchMove: (event: React.TouchEvent<HTMLElement>) => void;
  onTouchEnd: (event: React.TouchEvent<HTMLElement>) => void;
  onTouchCancel: () => void;
}

/** What {@link useContextMenu} returns. */
interface ContextMenuController {
  /** The open menu, or `null`: render it once in the surface, outside the bound elements. */
  menu: ReactNode;
  /**
   * Handlers that open the menu on a target: a right click at the pointer, the ContextMenu key
   * or Shift+F10 under the element, and a touch held still for half a second at the finger.
   * Spread them on the element; a row that has its own `onKeyDown` calls this one from it.
   */
  bind: (getItems: ContextMenuItems, options?: ContextMenuOptions) => ContextMenuBindings;
  /**
   * Opens the menu at the pointer of a `contextmenu` event, for a handler shared by many rows.
   *
   * @returns Whether a menu opened. It does not when the event was already handled or there
   *   are no items; the event then keeps its default.
   */
  openFromEvent: (
    event: React.MouseEvent | MouseEvent,
    getItems: ContextMenuItems,
    options?: ContextMenuOptions,
  ) => boolean;
  /**
   * Opens the menu under an element, as the keyboard does.
   *
   * @returns Whether a menu opened: not when there are no items.
   */
  openUnder: (
    element: Element,
    getItems: ContextMenuItems,
    options?: ContextMenuOptions,
  ) => boolean;
  /**
   * Opens the menu with its corner at a viewport point.
   *
   * @returns Whether a menu opened: not when there are no items.
   */
  openAt: (
    position: { x: number; y: number },
    getItems: ContextMenuItems,
    options?: ContextMenuOptions,
  ) => boolean;
  close: () => void;
}

export type { ContextMenuBindings, ContextMenuController, ContextMenuItems, ContextMenuOptions };

/** How long a touch is held before the menu opens. */
export const LONG_PRESS_MS = 500;
/** How far a held touch may move before it counts as a scroll or drag instead. */
export const LONG_PRESS_SLOP_PX = 10;

/** Whether a keydown is the ContextMenu key or Shift+F10, which open a context menu. */
export function isContextMenuKey(event: { key: string; shiftKey: boolean }): boolean {
  return event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
}

/** The context menu open anywhere in the app, so that opening one closes the other. */
let active: { owner: object; close: () => void } | null = null;

interface OpenMenu {
  /** Counts the opens, so each one mounts a fresh menu with its own focus to return to. */
  serial: number;
  items: DropdownMenuItem[];
  position: { x: number; y: number };
  label?: string;
}

interface Press {
  x: number;
  y: number;
  timer: ReturnType<typeof setTimeout>;
  /** Whether a menu opened during this touch, which then swallows the tap it ends with. */
  opened: boolean;
}

/**
 * A right-click menu for a surface. Only one context menu is open in the app at a time;
 * choosing an action closes the menu before the action runs, and an empty item list opens
 * nothing and leaves the browser's own menu alone.
 *
 * ```tsx
 * function ChannelRow({ channel }: { channel: Channel }) {
 *   const contextMenu = useContextMenu();
 *   return (
 *     <>
 *       <div {...contextMenu.bind(() => channelMenuItems(channel))}>{channel.name}</div>
 *       {contextMenu.menu}
 *     </>
 *   );
 * }
 * ```
 *
 * The menu goes beside the bound element, not inside it: React events from the menu reach
 * its React parents, and a click on an item would also reach the row.
 *
 * A long list keeps one controller for all its rows and calls `openFromEvent` and `openUnder`
 * from its shared, stable handlers instead of `bind`.
 */
export function useContextMenu(): ContextMenuController {
  const [owner] = useState(() => ({}));
  const [open, setOpen] = useState<OpenMenu | null>(null);
  const serialRef = useRef(0);
  const pressRef = useRef<Press | null>(null);

  const close = useCallback(() => {
    if (active?.owner === owner) active = null;
    setOpen(null);
  }, [owner]);

  const show = useCallback(
    (
      position: { x: number; y: number },
      items: DropdownMenuItem[],
      options?: ContextMenuOptions,
    ) => {
      if (active && active.owner !== owner) active.close();
      active = { owner, close };
      serialRef.current += 1;
      setOpen({ serial: serialRef.current, items, position, label: options?.label });
    },
    [owner, close],
  );

  useEffect(
    () => () => {
      if (active?.owner === owner) active = null;
      if (pressRef.current) clearTimeout(pressRef.current.timer);
    },
    [owner],
  );

  const openFromEvent = useCallback(
    (
      event: React.MouseEvent | MouseEvent,
      getItems: ContextMenuItems,
      options?: ContextMenuOptions,
    ) => {
      if (event.defaultPrevented) return false;
      const press = pressRef.current;
      // A held touch already opened the menu; some browsers follow it with this event.
      if (press?.opened) {
        event.preventDefault();
        return false;
      }
      const items = getItems();
      if (items.length === 0) return false;
      event.preventDefault();
      if (press) {
        clearTimeout(press.timer);
        press.opened = true;
      }
      show({ x: event.clientX, y: event.clientY }, items, options);
      return true;
    },
    [show],
  );

  const openAt = useCallback(
    (
      position: { x: number; y: number },
      getItems: ContextMenuItems,
      options?: ContextMenuOptions,
    ) => {
      const items = getItems();
      if (items.length === 0) return false;
      show(position, items, options);
      return true;
    },
    [show],
  );

  const openUnder = useCallback(
    (element: Element, getItems: ContextMenuItems, options?: ContextMenuOptions) => {
      const rect = element.getBoundingClientRect();
      return openAt({ x: rect.left + 16, y: rect.bottom }, getItems, options);
    },
    [openAt],
  );

  const cancelPress = useCallback(() => {
    if (pressRef.current) clearTimeout(pressRef.current.timer);
    pressRef.current = null;
  }, []);

  const bind = useCallback(
    (getItems: ContextMenuItems, options?: ContextMenuOptions): ContextMenuBindings => ({
      onContextMenu: (event) => {
        openFromEvent(event, getItems, options);
      },
      onKeyDown: (event) => {
        if (event.defaultPrevented || !isContextMenuKey(event)) return;
        if (openUnder(event.currentTarget, getItems, options)) event.preventDefault();
      },
      onTouchStart: (event) => {
        cancelPress();
        const touch = event.touches[0];
        if (event.touches.length !== 1 || !touch) return;
        const press: Press = {
          x: touch.clientX,
          y: touch.clientY,
          opened: false,
          timer: setTimeout(() => {
            const items = getItems();
            if (items.length === 0) return;
            press.opened = true;
            show({ x: press.x, y: press.y }, items, options);
          }, LONG_PRESS_MS),
        };
        pressRef.current = press;
      },
      onTouchMove: (event) => {
        const press = pressRef.current;
        const touch = event.touches[0];
        if (!press || press.opened || !touch) return;
        if (Math.hypot(touch.clientX - press.x, touch.clientY - press.y) > LONG_PRESS_SLOP_PX) {
          cancelPress();
        }
      },
      onTouchEnd: (event) => {
        if (pressRef.current?.opened) event.preventDefault();
        cancelPress();
      },
      onTouchCancel: cancelPress,
    }),
    [openFromEvent, openUnder, cancelPress, show],
  );

  const menu = open ? (
    <DropdownMenu
      key={open.serial}
      items={open.items}
      position={open.position}
      label={open.label}
      onClose={close}
      closeOnSelect
      zIndex={Z.POPOVER}
    />
  ) : null;

  return { menu, bind, openFromEvent, openUnder, openAt, close };
}
