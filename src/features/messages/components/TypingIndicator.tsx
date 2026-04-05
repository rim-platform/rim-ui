import { useEffect } from "react";
import { useTypingStore } from "../state/useTypingStore";

const EMPTY_ENTRIES: { userId: string; username: string; expiresAt: number }[] = [];

interface TypingIndicatorProps {
  conversationId: string;
}

export function TypingIndicator({ conversationId }: TypingIndicatorProps) {
  const rawEntries = useTypingStore((s) => s.typingByConversation[conversationId]);
  const entries = rawEntries ?? EMPTY_ENTRIES;
  const removeExpired = useTypingStore((s) => s.removeExpired);

  // Periodically clean up expired typing entries
  useEffect(() => {
    if (entries.length === 0) return;
    const interval = setInterval(removeExpired, 1000);
    return () => clearInterval(interval);
  }, [entries.length, removeExpired]);

  if (entries.length === 0) return null;

  const names = entries.map((e) => e.username);
  let label: string;
  if (names.length === 1) {
    label = `${names[0]} is typing...`;
  } else if (names.length === 2) {
    label = `${names[0]} and ${names[1]} are typing...`;
  } else {
    label = `${names[0]} and ${names.length - 1} others are typing...`;
  }

  return (
    <div className="px-4 py-1 text-xs text-rim-text-muted">
      {label}
    </div>
  );
}
