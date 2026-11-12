/** One line of a diff: kept, removed from the old text, or added in the new. */
export interface DiffLine {
  kind: "same" | "removed" | "added";
  text: string;
}

/**
 * The most cells the line table may have; past it the changed middle shows as removed, then
 * added, without matching lines inside it.
 */
const TABLE_LIMIT = 4_000_000;

function linesOf(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r?\n/u);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * The lines of `oldText` and `newText` as a diff: the longest run of lines both share kept, the
 * rest marked removed or added, removals before additions at each change.
 *
 * @param oldText - The text before, or `null` for a new file.
 * @param newText - The text after.
 * @returns Every line of both texts, in order.
 */
export function lineDiff(oldText: string | null, newText: string): DiffLine[] {
  const before = linesOf(oldText ?? "");
  const after = linesOf(newText);
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++;
  }
  const oldMiddle = before.slice(head, before.length - tail);
  const newMiddle = after.slice(head, after.length - tail);
  const same = (text: string): DiffLine => ({ kind: "same", text });
  return [
    ...before.slice(0, head).map(same),
    ...diffMiddle(oldMiddle, newMiddle),
    ...before.slice(before.length - tail).map(same),
  ];
}

/** The diff of two runs of lines that share no first or last line. */
function diffMiddle(before: string[], after: string[]): DiffLine[] {
  const removed = (text: string): DiffLine => ({ kind: "removed", text });
  const added = (text: string): DiffLine => ({ kind: "added", text });
  const n = before.length;
  const m = after.length;
  if (n === 0 || m === 0 || (n + 1) * (m + 1) > TABLE_LIMIT) {
    return [...before.map(removed), ...after.map(added)];
  }
  // lengths[i * (m + 1) + j]: the longest common run of before[i..] and after[j..].
  const width = m + 1;
  const lengths = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengths[i * width + j] =
        before[i] === after[j]
          ? lengths[(i + 1) * width + j + 1] + 1
          : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      lines.push({ kind: "same", text: before[i] });
      i++;
      j++;
    } else if (lengths[(i + 1) * width + j] >= lengths[i * width + j + 1]) {
      lines.push(removed(before[i++]));
    } else {
      lines.push(added(after[j++]));
    }
  }
  while (i < n) lines.push(removed(before[i++]));
  while (j < m) lines.push(added(after[j++]));
  return lines;
}
