import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";
import { Z } from "./zIndex";

interface DropdownMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  onSelect: () => void;
}

interface DropdownMenuProps {
  items: DropdownMenuItem[];
  position: { x: number; y: number };
  onClose: () => void;
}

export type { DropdownMenuItem, DropdownMenuProps };

export function DropdownMenu({ items, position, onClose }: DropdownMenuProps) {
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

  // Auto-focus first item
  useEffect(() => {
    setFocusedIndex(0);
    menuRef.current?.focus();
  }, []);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

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
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="fixed min-w-[180px] rounded-lg border border-rim-line bg-rim-panel py-1 shadow-xl outline-none"
      style={{ top: position.y, left: position.x, zIndex: Z.DROPDOWN }}
    >
      {items.length === 0 ? (
        <div className="px-3 py-2 text-xs text-rim-text-muted">No actions available</div>
      ) : (
        items.map((item, index) => (
          <button
            key={item.id}
            role="menuitem"
            type="button"
            tabIndex={-1}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors",
              item.danger
                ? focusedIndex === index
                  ? "bg-rim-danger/10 text-rim-danger"
                  : "text-rim-danger hover:bg-rim-danger/10"
                : focusedIndex === index
                  ? "bg-rim-accent/10 text-rim-text"
                  : "text-rim-text hover:bg-white/5",
            )}
            onMouseEnter={() => setFocusedIndex(index)}
            onClick={() => item.onSelect()}
          >
            {item.icon}
            <span className="flex-1 truncate">{item.label}</span>
          </button>
        ))
      )}
    </div>,
    document.body,
  );
}
