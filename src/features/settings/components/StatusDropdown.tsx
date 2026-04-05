import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { useUpdateProfileMutation } from "../api/useUpdateProfile";
import { useCurrentUser } from "../../workspaces/api/useCurrentUser";
import { EmojiPicker } from "../../../shared/ui/EmojiPicker";
import { cn } from "../../../shared/ui/cn";
import { Z } from "../../../shared/ui/zIndex";

const STATUS_EXPIRY_KEY = "rim_status_expires_at";

interface StatusPreset {
  emoji: string;
  text: string;
  durationMinutes: number | null;
}

const STATUS_PRESETS: StatusPreset[] = [
  { emoji: "\u{1F355}", text: "Na ob\u011bd\u011b", durationMinutes: 30 },
  { emoji: "\u{1F507}", text: "Neru\u0161it", durationMinutes: 240 },
  { emoji: "\u{1F4C5}", text: "V meetingu", durationMinutes: 60 },
  { emoji: "\u{1F3E0}", text: "Pracuji z domu", durationMinutes: null },
];

type DurationOption = { label: string; minutes: number | null };

const DURATION_OPTIONS: DurationOption[] = [
  { label: "30 minut", minutes: 30 },
  { label: "1 hodina", minutes: 60 },
  { label: "4 hodiny", minutes: 240 },
  { label: "Dnes", minutes: -1 }, // special: until midnight
  { label: "Nikdy", minutes: null },
];

function computeExpiresAt(minutes: number | null): string | null {
  if (minutes === null) return null;
  if (minutes === -1) {
    // Until midnight
    const midnight = new Date();
    midnight.setHours(23, 59, 59, 999);
    return midnight.toISOString();
  }
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export function saveStatusExpiry(expiresAt: string | null) {
  if (expiresAt) {
    localStorage.setItem(STATUS_EXPIRY_KEY, expiresAt);
  } else {
    localStorage.removeItem(STATUS_EXPIRY_KEY);
  }
}

export function getStatusExpiry(): string | null {
  return localStorage.getItem(STATUS_EXPIRY_KEY);
}

export function clearStatusExpiry() {
  localStorage.removeItem(STATUS_EXPIRY_KEY);
}

interface StatusDropdownProps {
  position: { x: number; y: number };
  onClose: () => void;
}

export function StatusDropdown({ position, onClose }: StatusDropdownProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const { data: user } = useCurrentUser();
  const updateProfile = useUpdateProfileMutation();
  const [showCustom, setShowCustom] = useState(false);
  const [customText, setCustomText] = useState("");
  const [customEmoji, setCustomEmoji] = useState("");
  const [customDuration, setCustomDuration] = useState<number | null>(null);
  const [emojiPickerPos, setEmojiPickerPos] = useState<{ x: number; y: number } | null>(null);

  const hasStatus = !!user?.statusText;

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        // Don't close if clicking the emoji picker (it's in a portal)
        const target = e.target as HTMLElement;
        if (target.closest("[role='listbox']")) return;
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (emojiPickerPos) {
          setEmojiPickerPos(null);
        } else if (showCustom) {
          setShowCustom(false);
        } else {
          onClose();
        }
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, showCustom, emojiPickerPos]);

  // Viewport adjustment
  useEffect(() => {
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
  }, [position.x, position.y, showCustom]);

  function applyStatus(statusText: string, durationMinutes: number | null) {
    const expiresAt = computeExpiresAt(durationMinutes);
    saveStatusExpiry(expiresAt);
    updateProfile.mutate({ statusText }, { onSuccess: () => onClose() });
  }

  function handlePresetClick(preset: StatusPreset) {
    applyStatus(`${preset.emoji} ${preset.text}`, preset.durationMinutes);
  }

  function handleClearStatus() {
    clearStatusExpiry();
    updateProfile.mutate({ statusText: "" }, { onSuccess: () => onClose() });
  }

  function handleCustomSave() {
    const text = customEmoji ? `${customEmoji} ${customText}` : customText;
    if (!text.trim()) return;
    applyStatus(text.trim(), customDuration);
  }

  function handleEmojiButtonClick(e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setEmojiPickerPos({ x: rect.right + 4, y: rect.top });
  }

  function handleEmojiSelect(emoji: string) {
    setCustomEmoji(emoji);
    setEmojiPickerPos(null);
  }

  return createPortal(
    <div
      ref={menuRef}
      className="fixed min-w-[240px] rounded-lg border border-rim-line bg-rim-panel shadow-lg outline-none"
      style={{ top: position.y, left: position.x, zIndex: Z.DROPDOWN }}
    >
      {!showCustom ? (
        <>
          {/* Header */}
          <div className="px-3 py-2 text-xs font-medium text-rim-text-muted">
            Set status...
          </div>

          <div className="h-px bg-rim-line" />

          {/* Presets */}
          <div className="py-1">
            {STATUS_PRESETS.map((preset) => (
              <button
                key={preset.text}
                type="button"
                onClick={() => handlePresetClick(preset)}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-rim-text transition hover:bg-white/5 cursor-pointer"
              >
                <span>{preset.emoji}</span>
                <span className="flex-1 text-left">{preset.text}</span>
                <span className="text-xs text-rim-text-muted">
                  {preset.durationMinutes
                    ? preset.durationMinutes >= 60
                      ? `${preset.durationMinutes / 60}h`
                      : `${preset.durationMinutes}m`
                    : "\u2014"}
                </span>
              </button>
            ))}
          </div>

          <div className="h-px bg-rim-line" />

          {/* Custom */}
          <button
            type="button"
            onClick={() => setShowCustom(true)}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-rim-text transition hover:bg-white/5 cursor-pointer"
          >
            <span>{"\u270F\uFE0F"}</span>
            <span>Custom status...</span>
          </button>

          {/* Clear */}
          {hasStatus && (
            <>
              <div className="h-px bg-rim-line" />
              <button
                type="button"
                onClick={handleClearStatus}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-rim-danger transition hover:bg-rim-danger/10 cursor-pointer"
              >
                <X className="h-4 w-4" />
                <span>Clear status</span>
              </button>
            </>
          )}
        </>
      ) : (
        /* Custom status editor */
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleEmojiButtonClick}
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded border border-rim-line bg-rim-void text-sm transition hover:border-rim-accent/40",
                customEmoji ? "" : "text-rim-text-muted",
              )}
            >
              {customEmoji || "\u{1F600}"}
            </button>
            <input
              type="text"
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              placeholder="What's your status?"
              autoFocus
              className="flex-1 rounded border border-rim-line bg-rim-void px-2 py-1.5 text-sm text-rim-text outline-none placeholder:text-rim-text-muted focus:border-rim-accent/40"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCustomSave();
              }}
            />
          </div>

          {/* Duration select */}
          <select
            value={customDuration === null ? "null" : String(customDuration)}
            onChange={(e) => {
              const v = e.target.value;
              setCustomDuration(v === "null" ? null : Number(v));
            }}
            className="w-full rounded border border-rim-line bg-rim-void px-2 py-1.5 text-xs text-rim-text outline-none focus:border-rim-accent/40"
          >
            {DURATION_OPTIONS.map((opt) => (
              <option key={opt.label} value={opt.minutes === null ? "null" : String(opt.minutes)}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={handleCustomSave}
              disabled={!customText.trim() || updateProfile.isPending}
              className="flex-1 rounded bg-rim-accent px-2 py-1.5 text-xs font-medium text-rim-void transition hover:bg-rim-accent/90 disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setShowCustom(false)}
              className="rounded px-2 py-1.5 text-xs text-rim-text-muted transition hover:text-rim-text"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Emoji picker portal */}
      {emojiPickerPos && (
        <EmojiPicker
          position={emojiPickerPos}
          onSelect={handleEmojiSelect}
          onClose={() => setEmojiPickerPos(null)}
        />
      )}
    </div>,
    document.body,
  );
}
