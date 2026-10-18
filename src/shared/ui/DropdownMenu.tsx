import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight } from "lucide-react";
import { cn } from "./cn";
import { Z } from "./zIndex";

/** What every row of a {@link DropdownMenu} has, whether it runs an action or opens a submenu. */
interface DropdownMenuItemBase {
  id: string;
  label: string;
  /** Muted text after the label; the item's accessible name joins both. */
  detail?: string;
  icon?: React.ReactNode;
  danger?: boolean;
  /** Marks the item that stands for what is open now. */
  current?: boolean;
  /** Draws a divider above the item, setting it apart from the ones before. */
  separatorBefore?: boolean;
  /**
   * A heading drawn above the item, starting a section. The heading is not an item: it takes
   * no focus and the arrow keys pass over it.
   */
  sectionBefore?: string;
  /**
   * Makes the item one choice of a radio group (`menuitemradio`), `true` on the chosen one.
   * Every such item reserves the check mark's slot, so the labels of a group line up.
   */
  checked?: boolean;
  /** A keybind hint drawn muted at the right edge, such as `Ctrl+K`. */
  shortcut?: string;
}

/** A row that runs `onSelect` when chosen. */
interface DropdownMenuAction extends DropdownMenuItemBase {
  onSelect: () => void;
  submenu?: undefined;
}

/**
 * A row that opens a nested menu beside it, on hover, ArrowRight or Enter. ArrowLeft or Escape
 * closes the nested menu and returns to the row; choosing an action in it closes the whole menu.
 */
interface DropdownMenuSubmenu extends DropdownMenuItemBase {
  submenu: DropdownMenuItem[];
  onSelect?: undefined;
}

/** One row of a {@link DropdownMenu}: an action or a submenu. */
type DropdownMenuItem = DropdownMenuAction | DropdownMenuSubmenu;

interface DropdownMenuProps {
  items: DropdownMenuItem[];
  position: { x: number; y: number };
  onClose: () => void;
  /** Accessible name of the menu. */
  label?: string;
  /** Text above the items, such as a note that there is nothing to pick. */
  header?: React.ReactNode;
  /** The control that toggles the menu: a press on it is left to its own handler. */
  anchorRef?: React.RefObject<HTMLElement | null>;
  /**
   * Whether choosing an action of the top level closes the menu before the action runs. When
   * off, the action closes it itself. Actions in a submenu always close the whole menu.
   */
  closeOnSelect?: boolean;
  /** The layer the menu draws on; a context menu passes `Z.POPOVER` to draw above dialogs. */
  zIndex?: number;
}

export type { DropdownMenuItem, DropdownMenuProps };

/** Gap between the viewport edge and a menu pushed back inside it. */
const VIEWPORT_MARGIN = 8;

/**
 * Moves a menu panel to `x`, `y`, kept inside the viewport. `flipX`, for a submenu, is the
 * parent row's left edge: a panel that does not fit to the right opens to the left of it.
 */
function placePanel(panel: HTMLElement, x: number, y: number, flipX?: number) {
  const rect = panel.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (x + rect.width > vw) {
    x = flipX !== undefined ? flipX - rect.width : vw - rect.width - VIEWPORT_MARGIN;
  }
  if (y + rect.height > vh) y = vh - rect.height - VIEWPORT_MARGIN;
  if (x < 0) x = VIEWPORT_MARGIN;
  if (y < 0) y = VIEWPORT_MARGIN;

  panel.style.left = `${x}px`;
  panel.style.top = `${y}px`;
}

interface OpenSubmenu {
  index: number;
  /** Whether the submenu takes focus: opened from the keyboard or a click, not a hover. */
  focus: boolean;
  x: number;
  y: number;
  flipX: number;
}

interface MenuPanelProps {
  items: DropdownMenuItem[];
  position: { x: number; y: number };
  flipX?: number;
  label?: string;
  header?: React.ReactNode;
  panelRef: React.RefObject<HTMLDivElement | null>;
  /** Whether the panel takes focus when it opens or when this turns on. */
  autoFocus: boolean;
  closeOnSelect: boolean;
  /** Closes the whole menu. */
  onClose: () => void;
  /** Closes this panel only, for a submenu. */
  onBack?: () => void;
  /** Whether this is the top level, which shows the header or a note when there are no items. */
  root: boolean;
  /** The layer of the top-level panel; a submenu sits inside it. */
  zIndex?: number;
}

/** One level of a menu: its rows, their keyboard handling, and the submenu open beside it. */
function MenuPanel({
  items,
  position,
  flipX,
  label,
  header,
  panelRef,
  autoFocus,
  closeOnSelect,
  onClose,
  onBack,
  root,
  zIndex = Z.DROPDOWN,
}: MenuPanelProps) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [submenu, setSubmenu] = useState<OpenSubmenu | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const submenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (panelRef.current) placePanel(panelRef.current, position.x, position.y, flipX);
  }, [panelRef, position.x, position.y, flipX]);

  useEffect(() => {
    if (autoFocus) panelRef.current?.focus();
  }, [autoFocus, panelRef]);

  const openSubmenu = useCallback((index: number, focus: boolean) => {
    const rect = itemRefs.current[index]?.getBoundingClientRect();
    if (!rect) return;
    // The panel's top padding: the submenu's first row lines up with its parent row.
    setSubmenu({ index, focus, x: rect.right, y: rect.top - 4, flipX: rect.left });
  }, []);

  const closeSubmenu = useCallback(() => {
    setSubmenu(null);
    panelRef.current?.focus();
  }, [panelRef]);

  function activate(index: number) {
    const item = items[index];
    if (!item) return;
    if (item.submenu) {
      openSubmenu(index, true);
      return;
    }
    if (closeOnSelect) onClose();
    item.onSelect();
  }

  function handleHover(index: number) {
    setFocusedIndex(index);
    if (items[index]?.submenu) {
      if (submenu?.index !== index) openSubmenu(index, false);
      return;
    }
    if (submenu) setSubmenu(null);
    panelRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // A submenu sits inside its parent's panel: its keys stay with it.
    if (!root) e.stopPropagation();
    if (items.length === 0 && e.key !== "Escape") return;
    // Moving to another row closes the submenu of the one left.
    if (submenu && ["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) setSubmenu(null);
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setFocusedIndex((prev) => (prev + 1) % items.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setFocusedIndex((prev) => (prev - 1 + items.length) % items.length);
        break;
      case "Home":
        e.preventDefault();
        setFocusedIndex(0);
        break;
      case "End":
        e.preventDefault();
        setFocusedIndex(items.length - 1);
        break;
      case "ArrowRight":
        if (items[focusedIndex]?.submenu) {
          e.preventDefault();
          openSubmenu(focusedIndex, true);
        }
        break;
      case "ArrowLeft":
        if (onBack) {
          e.preventDefault();
          onBack();
        }
        break;
      case "Enter":
        e.preventDefault();
        activate(focusedIndex);
        break;
      case "Escape":
        e.preventDefault();
        if (submenu) closeSubmenu();
        else if (onBack) onBack();
        else onClose();
        break;
    }
  }

  const openItem = submenu ? items[submenu.index] : undefined;

  return (
    <div
      ref={panelRef}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed min-w-[180px] rounded-lg border border-rim-line bg-rim-panel py-1 shadow-xl outline-none"
      style={{ top: position.y, left: position.x, zIndex }}
    >
      {root && header}
      {items.length === 0 ? (
        root && !header ? (
          <div className="px-3 py-2 text-xs text-rim-text-muted">No actions available</div>
        ) : null
      ) : (
        items.map((item, index) => {
          const focused = focusedIndex === index;
          const radio = item.checked !== undefined;
          return [
            item.separatorBefore && index > 0 && (
              <div
                key={`${item.id}-separator`}
                role="separator"
                className="mx-2 my-1 h-px bg-rim-line"
              />
            ),
            item.sectionBefore && (
              <div
                key={`${item.id}-section`}
                role="presentation"
                className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wider text-rim-text-muted"
              >
                {item.sectionBefore}
              </div>
            ),
            <button
              key={item.id}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              role={radio ? "menuitemradio" : "menuitem"}
              type="button"
              tabIndex={-1}
              aria-label={item.detail ? `${item.label}: ${item.detail}` : undefined}
              aria-current={item.current ? "true" : undefined}
              aria-checked={radio ? item.checked : undefined}
              aria-haspopup={item.submenu ? "menu" : undefined}
              aria-expanded={item.submenu ? submenu?.index === index : undefined}
              aria-keyshortcuts={item.shortcut}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors",
                item.danger
                  ? focused
                    ? "bg-rim-danger/10 text-rim-danger"
                    : "text-rim-danger hover:bg-rim-danger/10"
                  : focused
                    ? cn("bg-rim-accent/10", item.current ? "text-rim-accent" : "text-rim-text")
                    : cn("hover:bg-white/5", item.current ? "text-rim-accent" : "text-rim-text"),
              )}
              onMouseEnter={() => handleHover(index)}
              onClick={() => activate(index)}
            >
              {radio && (
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  {item.checked && <Check aria-hidden="true" className="h-4 w-4 text-rim-accent" />}
                </span>
              )}
              {item.icon}
              <span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left">
                <span className="min-w-0 truncate">{item.label}</span>
                {item.detail && (
                  <span className="min-w-0 truncate text-xs text-rim-text-muted">
                    {item.detail}
                  </span>
                )}
              </span>
              {item.shortcut && (
                <span aria-hidden="true" className="shrink-0 pl-4 text-xs text-rim-text-muted">
                  {item.shortcut}
                </span>
              )}
              {item.submenu && (
                <ChevronRight
                  aria-hidden="true"
                  className="h-3.5 w-3.5 shrink-0 text-rim-text-muted"
                />
              )}
            </button>,
          ];
        })
      )}
      {submenu && openItem?.submenu && (
        <MenuPanel
          key={openItem.id}
          items={openItem.submenu}
          position={{ x: submenu.x, y: submenu.y }}
          flipX={submenu.flipX}
          label={openItem.label}
          panelRef={submenuRef}
          autoFocus={submenu.focus}
          closeOnSelect
          onClose={onClose}
          onBack={closeSubmenu}
          root={false}
        />
      )}
    </div>
  );
}

export function DropdownMenu({
  items,
  position,
  onClose,
  label,
  header,
  anchorRef,
  closeOnSelect = false,
  zIndex,
}: DropdownMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Focus the menu; on close, focus goes back where it was unless something else took it.
  useEffect(() => {
    const previous = document.activeElement;
    const menu = menuRef.current;
    menu?.focus();
    return () => {
      const active = document.activeElement;
      const focusLost = !active || active === document.body || Boolean(menu?.contains(active));
      if (focusLost && previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  // Close on click outside; a submenu is inside the menu's element.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (anchorRef?.current?.contains(target)) return;
      if (menuRef.current && !menuRef.current.contains(target)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose, anchorRef]);

  // Close on scroll
  useEffect(() => {
    function handleScroll() {
      onClose();
    }
    document.addEventListener("scroll", handleScroll, true);
    return () => document.removeEventListener("scroll", handleScroll, true);
  }, [onClose]);

  return createPortal(
    <MenuPanel
      items={items}
      position={position}
      label={label}
      header={header}
      panelRef={menuRef}
      autoFocus={false}
      closeOnSelect={closeOnSelect}
      onClose={onClose}
      root
      zIndex={zIndex}
    />,
    document.body,
  );
}
