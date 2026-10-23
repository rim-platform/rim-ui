import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { getWebBaseUrl } from "../../../core/graphql/config";
import { graphqlErrorMessage, isSchemaRefusal } from "../../../core/graphql/errors";
import {
  PublicJoinLinkMode,
  ServerMemberRoleGql,
  type UpdatePublicJoinLinkInput,
} from "../../../core/graphql/generated/schema-types";
import { toast } from "../../../shared/toast";
import { Button } from "../../../shared/ui/Button";
import { ChoiceGroup } from "../../dm-policy/components/ChoiceGroup";
import type { DmChoice } from "../../dm-policy/labels";
import { ToggleSwitch } from "./ToggleSwitch";
import { useIsOwner } from "../../workspaces/api/useMyServerRole";
import { ModerationDialog } from "../../workspaces/components/ModerationDialog";
import {
  usePublicJoinLink,
  useReissuePublicJoinLink,
  useUpdatePublicJoinLink,
  type PublicJoinLinkSettings,
} from "../../workspaces/api/publicJoinLink";
import { useCanHavePublicLink } from "../../workspaces/hooks/useCanHavePublicLink";

interface PublicLinkSettingsProps {
  serverId: string | null;
  /** Opens the workspace's join requests; without it the count is plain text. */
  onOpenRequests?: () => void;
}

const ERROR_BOX =
  "rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger";

/** What the Owner reads before the link admits anyone for the first time. */
export const PUBLIC_LINK_WARNING =
  "Anyone with this link can join. Post it only where you want it public.";

/** What turning the link off does, said under the switch. */
export const PUBLIC_LINK_PAUSE_NOTE =
  "Turning the link off pauses it. Turning it on again brings back the same link.";

/** What issuing a new link does to the current one. */
export const REISSUE_WARNING = "The current link stops working everywhere you posted it.";

const MODES: DmChoice<PublicJoinLinkMode>[] = [
  {
    value: PublicJoinLinkMode.DIRECT,
    label: "Join directly",
    description: "Whoever opens the link joins at once.",
  },
  {
    value: PublicJoinLinkMode.REQUESTS,
    label: "Ask to join",
    description: "Whoever opens the link asks; you or a moderator accept or decline in Moderation.",
  },
];

const ROLES: DmChoice<ServerMemberRoleGql>[] = [
  {
    value: ServerMemberRoleGql.MEMBER,
    label: "Member",
    description: "Reads and writes in public channels from the start.",
  },
  {
    value: ServerMemberRoleGql.GUEST,
    label: "Guest",
    description: "Sees only the conversations someone adds them to.",
  },
];

/**
 * Settings → Workspace → Public link, owner only: one permanent link that lets accounts of this
 * server join the workspace or ask to join. It holds the on/off switch, whose first switch-on
 * asks for a confirmation and whose off only pauses the same link, the mode (join directly or
 * ask to join), the role a joiner gets, the link with Copy while it is on, "Issue a new link"
 * behind a confirmation, and the joins of the last 24 hours and 7 days with the requests
 * waiting. Hidden for everyone else, in the direct space, in the server's default workspace and
 * on a server without public links.
 */
export function PublicLinkSettings({ serverId, onOpenRequests }: PublicLinkSettingsProps) {
  const isOwner = useIsOwner(serverId ?? undefined);
  const canHaveLink = useCanHavePublicLink(serverId);
  if (!serverId || !isOwner || !canHaveLink) return null;
  return <PublicLinkSection serverId={serverId} onOpenRequests={onOpenRequests} />;
}

function PublicLinkSection({
  serverId,
  onOpenRequests,
}: {
  serverId: string;
  onOpenRequests?: () => void;
}) {
  const { data: link, isPending, isError, error } = usePublicJoinLink(serverId);
  const update = useUpdatePublicJoinLink();
  const reissue = useReissuePublicJoinLink();
  const [confirmingOn, setConfirmingOn] = useState(false);
  const [confirmingReissue, setConfirmingReissue] = useState(false);

  if (isError && isSchemaRefusal(error)) return null;

  function change(patch: Omit<UpdatePublicJoinLinkInput, "serverId">, done?: string) {
    update.mutate(
      { serverId, ...patch },
      {
        onSuccess: () => done && toast.success(done),
        onError: (err) => toast.error(graphqlErrorMessage(err, "Could not change the public link")),
      },
    );
  }

  function handleSwitch(next: boolean) {
    if (!link) return;
    if (next && !link.token) {
      setConfirmingOn(true);
      return;
    }
    change({ enabled: next }, next ? "Public link turned on" : "Public link paused");
  }

  return (
    <section className="space-y-4" aria-labelledby="public-link-heading">
      <div>
        <h2 id="public-link-heading" className="text-base font-semibold text-rim-text">
          Public link
        </h2>
        <p className="mt-1 text-sm text-rim-text-muted">
          One permanent link to this workspace, for a website, a README or a profile. It lets people
          who already have an account on this server join, or ask to join; it never creates an
          account. Only the owner sees these settings.
        </p>
      </div>
      <div className="space-y-5 rounded-lg border border-rim-line bg-rim-panel p-4">
        {isPending && <p className="text-sm text-rim-text-muted">Loading the public link…</p>}
        {isError && (
          <p role="alert" className={ERROR_BOX}>
            {graphqlErrorMessage(error, "Failed to load the public link.")}
          </p>
        )}
        {link && (
          <>
            {!link.token && (
              <p
                role="note"
                className="rounded-lg border border-rim-warm/30 bg-rim-warm/10 px-3 py-2 text-sm text-rim-text"
              >
                {PUBLIC_LINK_WARNING}
              </p>
            )}
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-rim-text">
                  {link.enabled ? "The link is on" : link.token ? "The link is paused" : "Off"}
                </p>
                <p className="mt-1 text-xs text-rim-text-muted">{PUBLIC_LINK_PAUSE_NOTE}</p>
              </div>
              <ToggleSwitch
                checked={link.enabled}
                onChange={handleSwitch}
                label="Public link"
                disabled={update.isPending}
              />
            </div>
            {link.enabled && link.token && <LinkField link={link} />}
            <ChoiceGroup
              legend="Mode"
              choices={MODES}
              value={link.mode}
              disabled={update.isPending}
              onChange={(mode) => change({ mode })}
            />
            <ChoiceGroup
              legend="Role"
              choices={ROLES}
              value={link.role}
              disabled={update.isPending}
              onChange={(role) => change({ role })}
            />
            {link.token && <LinkStats link={link} onOpenRequests={onOpenRequests} />}
            {link.token && (
              <div className="border-t border-rim-line pt-4">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setConfirmingReissue(true)}
                >
                  Issue a new link
                </Button>
                <p className="mt-1 text-xs text-rim-text-muted">{REISSUE_WARNING}</p>
              </div>
            )}
          </>
        )}
      </div>
      {confirmingOn && (
        <ModerationDialog
          title="Turn on the public link?"
          description={PUBLIC_LINK_WARNING}
          tone="warm"
          chips={["OWNER"]}
          confirmLabel="Turn on"
          errorFallback="Could not turn on the public link"
          onConfirm={() => update.mutateAsync({ serverId, enabled: true })}
          onDone={() => {
            setConfirmingOn(false);
            toast.success("Public link turned on");
          }}
          onClose={() => setConfirmingOn(false)}
        />
      )}
      {confirmingReissue && (
        <ModerationDialog
          title="Issue a new link?"
          description={REISSUE_WARNING}
          tone="danger"
          chips={["OWNER"]}
          confirmLabel="Issue a new link"
          errorFallback="Could not issue a new link"
          onConfirm={() => reissue.mutateAsync(serverId)}
          onDone={() => {
            setConfirmingReissue(false);
            toast.success("New link issued. The old one no longer works.");
          }}
          onClose={() => setConfirmingReissue(false)}
        />
      )}
    </section>
  );
}

/** The link's address: the server's, else this app's own origin with the token. */
function publicLinkUrl(link: PublicJoinLinkSettings): string | null {
  if (!link.token) return null;
  return link.url ?? `${getWebBaseUrl()}/join/${link.token}`;
}

function LinkField({ link }: { link: PublicJoinLinkSettings }) {
  const [copied, setCopied] = useState(false);
  const url = publicLinkUrl(link);
  if (!url) return null;

  function handleCopy() {
    navigator.clipboard
      .writeText(url!)
      .then(() => {
        setCopied(true);
        toast.success("Public link copied");
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => toast.error("Couldn't copy — copy manually"));
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-rim-line bg-rim-void px-3 py-2.5">
      <input
        readOnly
        value={url}
        aria-label="Public link"
        data-testid="public-link-url"
        onFocus={(e) => e.currentTarget.select()}
        className="min-w-0 flex-1 truncate bg-transparent text-sm text-rim-text outline-none"
      />
      <button
        type="button"
        onClick={handleCopy}
        className="shrink-0 rounded p-1 text-rim-text-muted transition hover:text-rim-text"
        aria-label="Copy public link"
      >
        {copied ? <Check className="h-4 w-4 text-rim-success" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

/**
 * The link's use in one line: "N joined in the last 24 hours · M in the last 7 days · K requests
 * waiting", the requests opening Moderation when there are any and `onOpenRequests` is given.
 */
function LinkStats({
  link,
  onOpenRequests,
}: {
  link: PublicJoinLinkSettings;
  onOpenRequests?: () => void;
}) {
  const waiting = `${link.openRequests} request${link.openRequests === 1 ? "" : "s"} waiting`;
  return (
    <p data-testid="public-link-stats" className="text-xs text-rim-text-muted">
      {link.joinsLastDay} joined in the last 24 hours · {link.joinsLastWeek} in the last 7 days ·{" "}
      {onOpenRequests && link.openRequests > 0 ? (
        <button
          type="button"
          onClick={onOpenRequests}
          className="font-medium text-rim-accent hover:underline"
        >
          {waiting}
        </button>
      ) : (
        waiting
      )}
    </p>
  );
}
