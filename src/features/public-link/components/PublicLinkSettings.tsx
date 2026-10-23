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
import { cn } from "../../../shared/ui/cn";
import { ChoiceGroup } from "../../dm-policy/components/ChoiceGroup";
import type { DmChoice } from "../../dm-policy/labels";
import { ToggleSwitch } from "../../settings/components/ToggleSwitch";
import { useIsOwner } from "../../workspaces/api/useMyServerRole";
import { ModerationDialog } from "../../workspaces/components/ModerationDialog";
import {
  usePublicJoinLink,
  useReissuePublicJoinLinkMutation,
  useUpdatePublicJoinLinkMutation,
  type PublicJoinLinkSettings,
} from "../api/publicLink";
import { useCanHavePublicLink } from "../hooks/useCanHavePublicLink";

interface PublicLinkSettingsProps {
  serverId: string | null;
  /** Opens the workspace's join requests; without it the count is plain text. */
  onOpenRequests?: () => void;
}

const ERROR_BOX =
  "rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger";

/** What the Owner reads before the link admits anyone. */
export const PUBLIC_LINK_WARNING =
  "Anyone who has the link can join this workspace, or ask to join, without an invite. Post it only where you want the workspace to be public.";

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
 * server join the workspace or ask to join. It holds the warning shown until the link is on (and
 * confirmed when it is first turned on), the on/off switch, whose off only pauses the same link,
 * the mode (join directly or ask to join), the role a joiner gets, the link with Copy, "Issue a
 * new link" behind a confirmation, and the joins of the last 24 hours and 7 days with the open
 * requests. Hidden for everyone else, in the direct space, in the server's default workspace and
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
  const update = useUpdatePublicJoinLinkMutation();
  const reissue = useReissuePublicJoinLinkMutation();
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
    change(
      { enabled: next },
      next
        ? "Public link turned on"
        : "Public link paused. Turning it on again brings the same link back.",
    );
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
            {!link.enabled && (
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
                <p className="mt-1 text-xs text-rim-text-muted">
                  Turning the link off pauses it: whoever opens it is told &ldquo;This link
                  isn&apos;t valid&rdquo;. Turning it on again brings the same link back, wherever
                  it was posted. Only issuing a new link ends this one for good.
                </p>
              </div>
              <ToggleSwitch
                checked={link.enabled}
                onChange={handleSwitch}
                label="Public link"
                disabled={update.isPending}
              />
            </div>
            {link.token && <LinkField link={link} />}
            <ChoiceGroup
              legend="When someone opens the link"
              choices={MODES}
              value={link.mode}
              disabled={update.isPending}
              onChange={(mode) => change({ mode })}
            />
            <ChoiceGroup
              legend="People who join get the role"
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
                <p className="mt-1 text-xs text-rim-text-muted">
                  The current link stops working at once, everywhere it was posted.
                </p>
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
          description="The current link stops working at once, everywhere it was posted: whoever opens it is told it isn't valid. People who joined with it stay, and open requests stay open. Post the new link where you want people to find it."
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
    <div>
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border border-rim-line bg-rim-void px-3 py-2.5",
          !link.enabled && "opacity-60",
        )}
      >
        <span
          data-testid="public-link-url"
          className="min-w-0 flex-1 truncate text-sm text-rim-text"
        >
          {url}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 rounded p-1 text-rim-text-muted transition hover:text-rim-text"
          aria-label="Copy public link"
        >
          {copied ? <Check className="h-4 w-4 text-rim-success" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
      {!link.enabled && (
        <p className="mt-1 text-xs text-rim-text-muted">
          Paused: nobody can join with this link until you turn it on again.
        </p>
      )}
    </div>
  );
}

function LinkStats({
  link,
  onOpenRequests,
}: {
  link: PublicJoinLinkSettings;
  onOpenRequests?: () => void;
}) {
  const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
  const requests = `${link.openRequests} open request${link.openRequests === 1 ? "" : "s"}`;
  return (
    <div className="grid grid-cols-3 gap-3 text-xs" aria-label="Public link use">
      <div className="rounded-md bg-rim-void px-3 py-2">
        <span className="text-rim-text-faint">Joined, last 24 hours</span>
        <p className="font-medium text-rim-text">{people(link.joinsLastDay)}</p>
      </div>
      <div className="rounded-md bg-rim-void px-3 py-2">
        <span className="text-rim-text-faint">Joined, last 7 days</span>
        <p className="font-medium text-rim-text">{people(link.joinsLastWeek)}</p>
      </div>
      <div className="rounded-md bg-rim-void px-3 py-2">
        <span className="text-rim-text-faint">Waiting</span>
        {onOpenRequests && link.openRequests > 0 ? (
          <button
            type="button"
            onClick={onOpenRequests}
            className="block font-medium text-rim-accent hover:underline"
          >
            {requests}
          </button>
        ) : (
          <p className="font-medium text-rim-text">{requests}</p>
        )}
      </div>
    </div>
  );
}
