export type MediaKind = "image" | "video";

/** Whether an attachment of `contentType` renders as an inline image, video or neither. */
export function mediaKindOf(contentType: string): MediaKind | null {
  const type = contentType.toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  return null;
}
