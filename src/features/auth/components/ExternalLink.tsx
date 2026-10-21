import type { ReactNode } from "react";

import { detectPlatform } from "../../../core/runtime/runtime";
import { openExternalUrl } from "../../../shared/ui/contextMenu/menuActions";

/**
 * A link that leaves the app: the system browser or mail app opens it on the desktop, a new tab
 * on the web.
 */
export function ExternalLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  function openOnDesktop(e: React.MouseEvent<HTMLAnchorElement>) {
    if (detectPlatform() !== "desktop") return;
    e.preventDefault();
    openExternalUrl(href);
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={openOnDesktop}
      className={className}
    >
      {children}
    </a>
  );
}
