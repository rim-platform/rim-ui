import { Fragment } from "react";

import { INLINE_CODE } from "./codeMarks";

/** `text` with its backtick-quoted runs as `<code>`; an unpaired backtick stays as written. */
export function InlineCodeText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE_CODE)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(
      <code
        key={match.index}
        className="rounded bg-rim-panel-soft px-1 font-mono text-[0.92em] text-rim-text"
      >
        {match[1]}
      </code>,
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>{part}</Fragment>
      ))}
    </>
  );
}
