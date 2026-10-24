const DOCUMENT_TYPES = new Set([
  "application/pdf",
  "application/json",
  "application/zip",
  "application/gzip",
]);

const EXTENSION_TYPES: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  pdf: "application/pdf",
  zip: "application/zip",
  gz: "application/gzip",
};

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** The browser's media type, or a known document extension when the browser supplies none. */
export function attachmentContentType(file: File): string {
  return (
    file.type ||
    EXTENSION_TYPES[file.name.split(".").pop()?.toLowerCase() ?? ""] ||
    "application/octet-stream"
  );
}

/** Why a selected file cannot be sent, or `null` when it fits the upload contract. */
export function attachmentProblem(file: File, encrypted: boolean): string | null {
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size + (encrypted ? 16 : 0) > MAX_ATTACHMENT_BYTES)
    return `${file.name} is larger than 25 MiB.`;
  const type = attachmentContentType(file).split(";")[0].trim().toLowerCase();
  const supported =
    ["image/", "text/", "audio/", "video/"].some(
      (prefix) => type.startsWith(prefix) && type.length > prefix.length,
    ) || DOCUMENT_TYPES.has(type);
  return encrypted || supported
    ? null
    : `${file.name} has an unsupported file type. Choose an image, audio, video, text, PDF, JSON, ZIP or GZIP file.`;
}
