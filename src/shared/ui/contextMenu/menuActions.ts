import { toast } from "../../toast";
import type { DropdownMenuItem } from "../DropdownMenu";
import { isSafeLinkUrl } from "../markdown/safeUrl";

/** Copies `text` to the clipboard and says whether it worked. */
export function copyToClipboard(text: string): void {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (!clipboard) {
    toast.error("The clipboard is not available");
    return;
  }
  clipboard.writeText(text).then(
    () => toast.success("Copied to clipboard"),
    () => toast.error("Could not copy to the clipboard"),
  );
}

/** Opens a link outside the app: the system browser on the desktop, a new tab on the web. */
export function openExternalUrl(url: string): void {
  import("@tauri-apps/plugin-opener")
    .then(({ openUrl }) => openUrl(url))
    .catch(() => window.open(url, "_blank"));
}

/**
 * Follows `href` as a click on a link would, through a detached anchor: opened in a new
 * window, or saved as `download` when that is given.
 */
export function followLink(href: string, download?: string): void {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  if (download !== undefined) anchor.download = download;
  anchor.click();
}

/**
 * The menu of a link: Open link and Copy link address.
 *
 * @returns No items when the link may not be opened, which leaves the right click to the
 *   element around it.
 */
export function linkMenuItems(href: string): DropdownMenuItem[] {
  if (!isSafeLinkUrl(href)) return [];
  return [
    { id: "open-link", label: "Open link", onSelect: () => openExternalUrl(href) },
    { id: "copy-link", label: "Copy link address", onSelect: () => copyToClipboard(href) },
  ];
}
