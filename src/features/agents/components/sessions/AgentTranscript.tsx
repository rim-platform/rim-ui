import { useId, useMemo, useState } from "react";
import {
  ArrowRightLeft,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDot,
  FileText,
  Globe,
  Pencil,
  Repeat,
  Search,
  Terminal,
  Trash2,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { cn } from "../../../../shared/ui/cn";
import { MarkdownRenderer } from "../../../../shared/ui/MarkdownRenderer";
import type {
  ContentBlock,
  PlanEntry,
  ToolCall,
  ToolCallContent,
  ToolCallStatus,
  ToolKind,
} from "../../acp/acpClient";
import type { TranscriptItem } from "../../acp/agentSession";
import { showInvisibleCharacters } from "../../runtime/invisibleCharacters";
import { lineDiff, type DiffLine } from "./lineDiff";
import { DIFF_LINE_LIMIT, KIND_LABELS, rawInputPreview } from "./sessionText";

/** The icon of each kind of tool call. */
const KIND_ICONS: Record<ToolKind, LucideIcon> = {
  read: FileText,
  edit: Pencil,
  delete: Trash2,
  move: ArrowRightLeft,
  search: Search,
  execute: Terminal,
  think: Brain,
  fetch: Globe,
  switch_mode: Repeat,
  other: Wrench,
};

const TOOL_STATUS: Record<ToolCallStatus, { label: string; className: string }> = {
  pending: { label: "Pending", className: "border-rim-line text-rim-text-muted" },
  in_progress: { label: "Running", className: "border-rim-accent/30 text-rim-accent" },
  completed: { label: "Done", className: "border-rim-success/30 text-rim-success" },
  failed: { label: "Failed", className: "border-rim-danger/30 text-rim-danger" },
  cancelled: { label: "Cancelled", className: "border-rim-line text-rim-text-faint" },
};

/** The plain text of a content block, or a short note of what it is. */
function blockText(block: ContentBlock): string {
  switch (block.type) {
    case "text":
      return block.text;
    case "resource_link":
      return `${block.title ?? block.name} (${block.uri})`;
    case "resource":
      return block.text ?? block.uri;
    case "image":
      return "[An image]";
    case "audio":
      return "[Audio]";
    case "unknown":
      return "[Content RIM can't show]";
  }
}

/** The transcript of a session: the person's prompts and everything the agent showed. */
export function AgentTranscript({
  items,
  agentName,
}: {
  items: readonly TranscriptItem[];
  agentName: string;
}) {
  return (
    <ol className="space-y-3" aria-label="Transcript">
      {items.map((item) => (
        <li key={item.id}>
          <TranscriptEntry item={item} agentName={agentName} />
        </li>
      ))}
    </ol>
  );
}

function TranscriptEntry({ item, agentName }: { item: TranscriptItem; agentName: string }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="rounded-lg border border-rim-line bg-rim-panel-soft px-3 py-2">
          <p className="text-xs font-medium text-rim-text-faint">You</p>
          {item.about !== undefined && (
            <p className="text-xs text-rim-text-muted">{showInvisibleCharacters(item.about)}</p>
          )}
          <p className="whitespace-pre-wrap break-words text-sm text-rim-text">{item.text}</p>
        </div>
      );
    case "agent_message":
      return (
        <div className="px-1">
          <p className="text-xs font-medium text-rim-text-faint">
            {showInvisibleCharacters(agentName)}
          </p>
          <AgentContent content={item.content} />
        </div>
      );
    case "thought":
      return <Thought content={item.content} />;
    case "tool_call":
      return <ToolCallCard call={item.call} />;
    case "plan":
      return <PlanList entries={item.entries} />;
    case "notice":
      return (
        <p
          role={item.tone === "error" ? "alert" : undefined}
          className={cn(
            "px-1 text-xs",
            item.tone === "error" ? "text-rim-danger" : "text-rim-text-muted",
          )}
        >
          {item.text}
        </p>
      );
  }
}

/** The agent's message: text through the safe markdown renderer, other blocks as plain text. */
function AgentContent({ content }: { content: ContentBlock[] }) {
  return (
    <div className="space-y-1 text-sm text-rim-text">
      {content.map((block, index) =>
        block.type === "text" ? (
          <MarkdownRenderer key={index} content={block.text} showInlineMedia={false} />
        ) : (
          <p key={index} className="whitespace-pre-wrap break-words text-xs text-rim-text-muted">
            {blockText(block)}
          </p>
        ),
      )}
    </div>
  );
}

function Thought({ content }: { content: ContentBlock[] }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <div className="px-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded text-xs text-rim-text-faint hover:text-rim-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-rim-accent"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Thinking
      </button>
      {open && (
        <p
          id={bodyId}
          className="mt-1 whitespace-pre-wrap break-words border-l border-rim-line pl-3 text-xs text-rim-text-muted"
        >
          {content.map(blockText).join("")}
        </p>
      )}
    </div>
  );
}

/** A tool call's status as a small chip. */
export function ToolStatusChip({ status }: { status: ToolCallStatus }) {
  const { label, className } = TOOL_STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2 text-xs",
        className,
      )}
    >
      {label}
    </span>
  );
}

/** A tool call: its kind, title and status, opening to what it changed and was called with. */
export function ToolCallCard({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const Icon = KIND_ICONS[call.kind];
  const title = call.title.trim() === "" ? "Tool call" : call.title;
  return (
    <div className="rounded-lg border border-rim-line bg-rim-panel">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(!open)}
        className="flex w-full min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-rim-accent"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-rim-text-faint" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-rim-text-faint" />
        )}
        <Icon
          className="h-3.5 w-3.5 shrink-0 text-rim-text-muted"
          aria-label={KIND_LABELS[call.kind]}
        />
        <span className="min-w-0 flex-1 truncate text-sm text-rim-text">
          {showInvisibleCharacters(title)}
        </span>
        <ToolStatusChip status={call.status} />
      </button>
      {open && (
        <div id={bodyId} className="space-y-3 border-t border-rim-line px-3 py-2">
          <ToolCallDetails call={call} />
        </div>
      )}
    </div>
  );
}

/** What a tool call shows: its diffs, text, files and input, all as plain text. */
export function ToolCallDetails({ call }: { call: ToolCall }) {
  const input = rawInputPreview(call.rawInput);
  const nothing = call.content.length === 0 && call.locations.length === 0 && input === null;
  return (
    <>
      {call.content.map((content, index) => (
        <ToolContent key={index} content={content} />
      ))}
      {call.locations.length > 0 && (
        <ul className="space-y-0.5" aria-label="Files">
          {call.locations.map((location, index) => (
            <li key={index} className="break-all font-mono text-xs text-rim-text-muted">
              {location.line !== null ? `${location.path}:${location.line}` : location.path}
            </li>
          ))}
        </ul>
      )}
      {input !== null && (
        <div>
          <p className="text-xs font-medium text-rim-text-faint">Input</p>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-rim-void px-2 py-1 font-mono text-xs text-rim-text-muted">
            {input}
          </pre>
        </div>
      )}
      {nothing && <p className="text-xs text-rim-text-faint">The agent sent nothing more.</p>}
    </>
  );
}

function ToolContent({ content }: { content: ToolCallContent }) {
  switch (content.type) {
    case "diff":
      return <DiffView path={content.path} oldText={content.oldText} newText={content.newText} />;
    case "content":
      return (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-rim-void px-2 py-1 font-mono text-xs text-rim-text">
          {blockText(content.content)}
        </pre>
      );
    case "terminal":
      return (
        <p className="text-xs text-rim-text-faint">
          A terminal of the agent&apos;s own, which RIM doesn&apos;t show.
        </p>
      );
  }
}

const DIFF_LINE_CLASSES: Record<DiffLine["kind"], string> = {
  same: "text-rim-text-muted",
  removed: "bg-rim-danger/10 text-rim-danger",
  added: "bg-rim-success/10 text-rim-success",
};

const DIFF_MARKS: Record<DiffLine["kind"], string> = { same: " ", removed: "-", added: "+" };

/** A file's change as lines, removed and added ones marked; plain text, never markup. */
export function DiffView({
  path,
  oldText,
  newText,
}: {
  path: string;
  oldText: string | null;
  newText: string;
}) {
  const [all, setAll] = useState(false);
  const lines = useMemo(() => lineDiff(oldText, newText), [oldText, newText]);
  const shown = all ? lines : lines.slice(0, DIFF_LINE_LIMIT);
  return (
    <div className="space-y-1">
      <p className="break-all font-mono text-xs text-rim-text">{path}</p>
      <pre
        aria-label={`Changes to ${path}`}
        className="max-h-96 overflow-auto rounded bg-rim-void py-1 font-mono text-xs"
      >
        {shown.map((line, index) => (
          <div
            key={index}
            data-diff={line.kind}
            className={cn("whitespace-pre px-2", DIFF_LINE_CLASSES[line.kind])}
          >
            <span aria-hidden="true">{DIFF_MARKS[line.kind]} </span>
            {line.kind !== "same" && (
              <span className="sr-only">{line.kind === "added" ? "Added: " : "Removed: "}</span>
            )}
            {line.text}
          </div>
        ))}
      </pre>
      {!all && lines.length > DIFF_LINE_LIMIT && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="rounded text-xs text-rim-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-rim-accent"
        >
          Show all {lines.length} lines
        </button>
      )}
    </div>
  );
}

const PLAN_ICONS = { pending: Circle, in_progress: CircleDot, completed: Check } as const;
const PLAN_LABELS = { pending: "To do", in_progress: "Doing", completed: "Done" } as const;

/** The agent's plan as a checklist. */
function PlanList({ entries }: { entries: PlanEntry[] }) {
  return (
    <div className="rounded-lg border border-rim-line bg-rim-panel px-3 py-2">
      <p className="text-xs font-medium text-rim-text-faint">Plan</p>
      <ul className="mt-1 space-y-1">
        {entries.map((entry, index) => {
          const Icon = PLAN_ICONS[entry.status];
          return (
            <li key={index} className="flex items-start gap-2 text-sm">
              <Icon
                className={cn(
                  "mt-0.5 h-3.5 w-3.5 shrink-0",
                  entry.status === "completed"
                    ? "text-rim-success"
                    : entry.status === "in_progress"
                      ? "text-rim-accent"
                      : "text-rim-text-faint",
                )}
                aria-label={PLAN_LABELS[entry.status]}
              />
              <span
                className={cn(
                  "min-w-0 break-words",
                  entry.status === "completed" ? "text-rim-text-muted" : "text-rim-text",
                )}
              >
                {entry.content}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
