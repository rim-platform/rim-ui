import { Bot } from "lucide-react";

import { cn } from "./cn";

/**
 * The mark of a bot account, shown in place of a role: a bot is always a Guest, which says
 * nothing about it.
 */
export function BotBadge({ className }: { className?: string }) {
  return (
    <span
      data-testid="bot-badge"
      title="A bot, not a person"
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded border border-rim-accent/40 px-1 text-[10px] uppercase tracking-wider leading-4 text-rim-accent",
        className,
      )}
    >
      <Bot aria-hidden className="h-2.5 w-2.5" />
      Bot
    </span>
  );
}
