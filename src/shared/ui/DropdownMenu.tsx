import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";
import { Z } from "./zIndex";

interface DropdownMenuItem {
  id: string;
  label: string;
  /** Muted text after the label; the item's accessible name joins both. */
  detail?: string;
  icon?: React.ReactNode;
  danger?: boolean;
  /** Marks the item that stands for what is open now. */
  current?: boolean;
  onSelect: () => void;
}

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
}

export type { DropdownMenuItem, DropdownMenuProps };

export function DropdownMenu({
  items,
  position,
  onClose,
  label,
  header,
  anchorRef,
}: DropdownMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);

  // Adjust position so the menu stays within the viewport
  const adjustPosition = useCallback(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let x = position.x;
    let y = position.y;

    if (x + rect.width > vw) x = vw - rect.width - 8;
    if (y + rect.height > vh) y = vh - rect.height - 8;
    if (x < 0) x = 8;
    if (y < 0) y = 8;

    menuRef.current.style.left = `${x}px`;
    menuRef.current.style.top = `${y}px`;
  }, [position.x, position.y]);

  useEffect(() => {
    adjustPosition();
  }, [adjustPosition]);

  // Auto-focus first item; on close, focus goes back where it was unless something else took it.
  useEffect(() => {
    const previous = document.activeElement;
    const menu = menuRef.current;
    setFocusedIndex(0);
    menu?.focus();
    return () => {
      const active = document.activeElement;
      const focusLost = !active || active === document.body || Boolean(menu?.contains(active));
      if (focusLost && previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  // Close on click outside
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

  function handleKeyDown(e: React.KeyboardEvent) {
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
      case "Enter": {
        e.preventDefault();
        const item = items[focusedIndex];
        if (item) item.onSelect();
        break;
      }
      case "Escape":
        e.preventDefault();
        onClose();
        break;
    }
  }

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="fixed min-w-[180px] rounded-lg border border-rim-line bg-rim-panel py-1 shadow-xl outline-none"
      style={{ top: position.y, left: position.x, zIndex: Z.DROPDOWN }}
    >
      {header}
      {items.length === 0 ? (
        header ? null : (
          <div className="px-3 py-2 text-xs text-rim-text-muted">No actions available</div>
        )
      ) : (
        items.map((item, index) => (
          <button
            key={item.id}
            role="menuitem"
            type="button"
            tabIndex={-1}
            aria-label={item.detail ? `${item.label}: ${item.detail}` : undefined}
            aria-current={item.current ? "true" : undefined}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors",
              item.danger
                ? focusedIndex === index
                  ? "bg-rim-danger/10 text-rim-danger"
                  : "text-rim-danger hover:bg-rim-danger/10"
                : focusedIndex === index
                  ? cn("bg-rim-accent/10", item.current ? "text-rim-accent" : "text-rim-text")
                  : cn("hover:bg-white/5", item.current ? "text-rim-accent" : "text-rim-text"),
            )}
            onMouseEnter={() => setFocusedIndex(index)}
            onClick={() => item.onSelect()}
          >
            {item.icon}
            <span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left">
              <span className="min-w-0 truncate">{item.label}</span>
              {item.detail && (
                <span className="min-w-0 truncate text-xs text-rim-text-muted">{item.detail}</span>
              )}
            </span>
          </button>
        ))
      )}
    </div>,
    document.body,
  );
}
