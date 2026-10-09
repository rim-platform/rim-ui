/** How the Settings panel words an export or a restore. */

import type { ExportReport, RestoreReport } from "../api/historyArchive";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function describeExport(report: ExportReport): string {
  if (report.messages === 0 && report.conversations === 0) return "Already up to date.";
  return `Backed up ${plural(report.messages, "message change")} in ${plural(report.segments, "file")}.`;
}

export function describeRestore(report: RestoreReport): string {
  let text = `Restored ${plural(report.messages, "message")} in ${plural(
    report.conversations,
    "new conversation",
  )} from ${plural(report.devices, "device")}.`;
  const { segmentsMissing: missing, segmentsDamaged: damaged } = report;
  if (missing > 0) {
    text += ` ${plural(missing, "file")} ${missing === 1 ? "has" : "have"} not synced to this folder yet; restore again later to pick ${missing === 1 ? "it" : "them"} up.`;
  }
  if (damaged > 0) {
    text += ` ${plural(damaged, "file")} could not be read and ${damaged === 1 ? "was" : "were"} skipped.`;
  }
  return text;
}
