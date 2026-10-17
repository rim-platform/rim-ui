import { useId } from "react";

import { graphqlErrorMessage, isSchemaRefusal } from "../../../core/graphql/errors";
import { DmMembers, DmOutside } from "../../../core/graphql/generated/schema-types";
import { toast } from "../../../shared/toast";
import { cn } from "../../../shared/ui/cn";
import { useMyServers } from "../../workspaces/api/useMyServers";
import { useMyDmSettings, useSetMyDmSettings, useSetMyWorkspaceDmSetting } from "../api/dmPolicy";
import { MEMBER_CHOICES, OUTSIDE_CHOICES, choiceOf, floorSourceText } from "../labels";
import { ChoiceGroup } from "./ChoiceGroup";

/**
 * Settings → Direct messages: who can message this person. Their choice for people outside
 * their workspaces, held to a floor the operator or a workspace may set, and their choice for
 * each workspace's members, with the workspace's default beside it.
 */
export function DmSettings() {
  const settings = useMyDmSettings();
  const setOutside = useSetMyDmSettings();

  function chooseOutside(outside: DmOutside) {
    setOutside.mutate(outside, {
      onError: (err) => toast.error(graphqlErrorMessage(err, "Could not save your choice")),
    });
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-base font-semibold text-rim-text">Who can message me</h2>
        <p className="mt-1 text-sm text-rim-text-muted">
          Whether a first DM reaches you directly, as a request you accept, ignore, block or report,
          or not at all. Your contacts always reach you directly, and so do the owners and
          moderators of a workspace you share.
        </p>
      </div>

      {settings.isPending && <p className="text-sm text-rim-text-muted">Loading…</p>}
      {settings.isError && (
        <p role="alert" className="text-sm text-rim-danger">
          {isSchemaRefusal(settings.error)
            ? "Your server does not offer these settings yet."
            : graphqlErrorMessage(settings.error, "Could not load your settings.")}
        </p>
      )}

      {settings.data && (
        <>
          <section aria-labelledby="dm-outside-heading" className="space-y-2">
            <h3 id="dm-outside-heading" className="text-sm font-semibold text-rim-text">
              Outside your workspaces
            </h3>
            <ChoiceGroup
              legend="People who share no workspace with you"
              hint={
                settings.data.outsideFloorFrom
                  ? `${floorSourceText(settings.data.outsideFloorFrom)}: nobody outside your workspaces can message you.`
                  : undefined
              }
              choices={OUTSIDE_CHOICES}
              value={settings.data.effectiveOutside}
              onChange={chooseOutside}
              disabled={setOutside.isPending || Boolean(settings.data.outsideFloorFrom)}
            />
          </section>

          <section aria-labelledby="dm-members-heading" className="space-y-2">
            <h3 id="dm-members-heading" className="text-sm font-semibold text-rim-text">
              Members of your workspaces
            </h3>
            <p className="text-xs text-rim-text-muted">
              {choiceOf(MEMBER_CHOICES, DmMembers.DIRECT).description}{" "}
              {choiceOf(MEMBER_CHOICES, DmMembers.REQUESTS).description} Someone you share several
              workspaces with reaches you directly when one of them says Direct.
            </p>
            {settings.data.workspaces.length === 0 ? (
              <p className="text-sm text-rim-text-muted">You are not in a workspace yet.</p>
            ) : (
              <WorkspaceChoices workspaces={settings.data.workspaces} />
            )}
          </section>
        </>
      )}
    </div>
  );
}

function WorkspaceChoices({
  workspaces,
}: {
  workspaces: { workspaceId: string; members: DmMembers; memberDefault: DmMembers }[];
}) {
  const { data: servers } = useMyServers();
  const setMembers = useSetMyWorkspaceDmSetting();
  const nameOf = (id: string) => servers?.find((s) => s.id === id)?.name ?? "Workspace";

  function choose(workspaceId: string, members: DmMembers) {
    setMembers.mutate(
      { workspaceId, members },
      { onError: (err) => toast.error(graphqlErrorMessage(err, "Could not save your choice")) },
    );
  }

  return (
    <ul className="divide-y divide-rim-line rounded-lg border border-rim-line bg-rim-panel">
      {workspaces.map((ws) => (
        <li key={ws.workspaceId} className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-rim-text">{nameOf(ws.workspaceId)}</p>
            <p className="text-xs text-rim-text-faint">
              Workspace default: {choiceOf(MEMBER_CHOICES, ws.memberDefault).label}
            </p>
          </div>
          <CompactChoice
            label={`DMs from members of ${nameOf(ws.workspaceId)}`}
            value={ws.members}
            disabled={setMembers.isPending}
            onChange={(members) => choose(ws.workspaceId, members)}
          />
        </li>
      ))}
    </ul>
  );
}

/** Direct or Requests as a pair of radio pills. */
function CompactChoice({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: DmMembers;
  disabled: boolean;
  onChange: (value: DmMembers) => void;
}) {
  const name = useId();
  return (
    <fieldset disabled={disabled} className="flex shrink-0 gap-1">
      <legend className="sr-only">{label}</legend>
      {MEMBER_CHOICES.map((choice) => (
        <label
          key={choice.value}
          className={cn(
            "cursor-pointer rounded-md border px-2.5 py-1 text-xs transition has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-rim-accent",
            value === choice.value
              ? "border-rim-accent/60 bg-rim-accent/10 text-rim-text"
              : "border-rim-line text-rim-text-muted hover:bg-white/5 hover:text-rim-text",
          )}
        >
          <input
            type="radio"
            name={name}
            value={choice.value}
            checked={value === choice.value}
            onChange={() => onChange(choice.value)}
            className="sr-only"
          />
          {choice.label}
        </label>
      ))}
    </fieldset>
  );
}
