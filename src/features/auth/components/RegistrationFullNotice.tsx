import { ExternalLink } from "./ExternalLink";

/** How to run a RIM server, for someone a full server turned away. */
export const SELF_HOSTING_URL = "https://rim-platform.org/docs/self-hosting.html";

/** "This server is full", with a pointer to running a server or signing up on another one. */
export function RegistrationFullNotice() {
  return (
    <div
      role="status"
      className="space-y-1 rounded-lg border border-rim-warm/30 bg-rim-warm/10 px-3 py-2 text-sm text-rim-text"
    >
      <p className="font-medium">This server is full</p>
      <p className="text-xs text-rim-text-muted">
        It takes no new accounts. Run your own server, or sign up on another one.{" "}
        <ExternalLink
          href={SELF_HOSTING_URL}
          className="text-rim-accent underline underline-offset-2 hover:text-rim-text"
        >
          How to run a server
        </ExternalLink>
      </p>
    </div>
  );
}
