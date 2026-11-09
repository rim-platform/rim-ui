import { useEffect, useRef, useState } from "react";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { MessageReportStatus, ReportOutcome } from "../../../core/graphql/generated/schema-types";
import { asSentence } from "../../../core/graphql/errors";
import { toast } from "../../../shared/toast";
import { ListPickerDialog, type PickerItem } from "../../../shared/ui/ListPickerDialog";
import { formatTime } from "../../../shared/utils/formatTime";
import { personName } from "../../../shared/utils/handles";
import { useShellStore } from "../../../shell/state/useShellStore";
import {
  useBots,
  useDeactivateBot,
  useIncomingWebhooks,
  useRevokeIncomingWebhook,
} from "../../bots/api/botsApi";
import { useAllChannels } from "../../bots/api/useAllChannels";
import { DEACTIVATE_BOT_DESCRIPTION, REVOKE_WEBHOOK_DESCRIPTION } from "../../bots/confirmTexts";
import { ChannelWebhookDialog } from "../../bots/components/ChannelWebhookDialog";
import { ConfirmActionDialog } from "../../conversations/components/ConfirmActionDialog";
import {
  useInstanceIpBlocks,
  useInstancePrincipalBlocks,
  useInstanceReports,
  useIsInstanceOperator,
  useUnblockIpMutation,
  useUnblockPrincipalMutation,
} from "../../instance-moderation/api/instanceModeration";
import { ClearProfileDialog } from "../../instance-moderation/components/ClearProfileDialog";
import { usePluginList } from "../../plugins/api/usePluginList";
import { useRevokeAllAiConsent } from "../../plugins/api/usePluginAiConsent";
import { shortPrincipal } from "../../plugins/registry/model";
import { useContacts, useRemoveContact } from "../../relay/api/useContacts";
import { useBlockedPrincipals, useUnblockPrincipal } from "../../relay/api/useBlockedPrincipals";
import { usePendingDmRequests } from "../../relay/api/useDmRequests";
import type { DmRequestView } from "../../relay/api/relayApi";
import { blockTargetOf } from "../../relay/blocking/blockPerson";
import { askToBlock } from "../../relay/blocking/useBlockPersonStore";
import { blockedName } from "../../relay/blocking/blockedName";
import { REPORT_REASONS, useDmRequestActions } from "../../relay/components/useDmRequestActions";
import { useAddMemberContact } from "../../relay/contacts/useAddMemberContact";
import { useContactStore } from "../../relay/contacts/useContactStore";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { useRevokeInviteMutation } from "../../settings/api/useInviteMutations";
import {
  useWorkspaceInvites,
  type WorkspaceInviteRow,
} from "../../settings/api/useWorkspaceInvites";
import { revokeInviteDescription } from "../../settings/inviteText";
import {
  useAcceptJoinRequest,
  useDeclineJoinRequest,
  useJoinRequests,
} from "../../workspaces/api/publicJoinLink";
import { useMessageReports, useResolveReportMutation } from "../../workspaces/api/useModeration";
import { useServerMembers } from "../../workspaces/api/useServerMembers";
import { ModerationDialog } from "../../workspaces/components/ModerationDialog";
import { publicLinkErrorMessage } from "../../workspaces/publicJoinLink";
import { useManageCommandStore } from "../state/useManageCommandStore";
import { useSettingsIntentStore } from "../state/useSettingsIntentStore";

/** Opens a Settings tab. */
function openSettingsTab(tab: string) {
  useShellStore.getState().setMainSurface({ kind: "settings", tab });
}

/** Whether `error` is set, as the text a picker shows. */
function errorText(error: unknown, fallback: string): string | null {
  return error ? graphqlErrorMessage(error, fallback) : null;
}

interface PickerProps {
  workspaceId: string;
  onClose: () => void;
}

/**
 * The pickers and dialogs the management commands open: the report, join request, invite, bot,
 * webhook, plugin, principal, address, person and message request choices. Mounted once in the
 * app shell, it shows what `useManageCommandStore` holds.
 */
export function ManageCommandHost() {
  // Warms the answer that decides whether instance moderation commands are offered.
  useIsInstanceOperator();
  const request = useManageCommandStore((s) => s.request);
  const workspaceId = useManageCommandStore((s) => s.workspaceId);
  const close = useManageCommandStore((s) => s.close);
  if (!request) return null;
  if (request.kind === "request") {
    return <RequestCommand requestId={request.requestId} action={request.action} onClose={close} />;
  }
  if (request.kind === "unblock-principal") return <UnblockPrincipalPicker onClose={close} />;
  if (request.kind === "unblock-ip") return <UnblockIpPicker onClose={close} />;
  if (request.kind === "principal") {
    return <PrincipalPicker purpose={request.purpose} onClose={close} />;
  }
  if (request.kind === "plugin") return <PluginPicker action={request.action} onClose={close} />;
  if (request.kind === "unblock-person") return <UnblockPersonPicker onClose={close} />;
  if (request.kind === "new-webhook") {
    return <ChannelWebhookDialog conversation={request.conversation} onClose={close} />;
  }
  if (!workspaceId) return null;
  const props = { workspaceId, onClose: close };
  switch (request.kind) {
    case "report":
      return <ReportPicker {...props} resolve={request.outcome === "resolve"} />;
    case "join-request":
      return <JoinRequestPicker {...props} accept={request.accept} />;
    case "revoke-invite":
      return <InvitePicker {...props} />;
    case "bot":
      return <BotPicker {...props} action={request.action} />;
    case "revoke-webhook":
      return <WebhookPicker {...props} />;
    case "person":
      return <PersonCommand {...props} purpose={request.purpose} userId={request.userId} />;
  }
}

function ReportPicker({ workspaceId, onClose, resolve }: PickerProps & { resolve: boolean }) {
  const reports = useMessageReports(workspaceId, MessageReportStatus.OPEN);
  const mutation = useResolveReportMutation();
  const items: PickerItem[] = (reports.data?.pages.flatMap((p) => p.items) ?? []).map((r) => ({
    id: r.id,
    label: r.reason || "No reason given",
    detail: [r.messageText?.slice(0, 80), formatTime(r.createdAt)].filter(Boolean).join(" · "),
  }));
  function pick(item: PickerItem) {
    onClose();
    mutation
      .mutateAsync({
        serverId: workspaceId,
        reportId: item.id,
        outcome: resolve ? ReportOutcome.RESOLVED : ReportOutcome.DISMISSED,
      })
      .then(() => toast.success(resolve ? "Report resolved" : "Report dismissed"))
      .catch((err: unknown) =>
        toast.error(graphqlErrorMessage(err, "Could not update the report")),
      );
  }
  return (
    <ListPickerDialog
      title={resolve ? "Resolve a report" : "Dismiss a report"}
      items={items}
      loading={reports.isPending}
      error={errorText(reports.error, "Could not load the reports")}
      emptyText="No open reports."
      onPick={pick}
      onClose={onClose}
    />
  );
}

function JoinRequestPicker({ workspaceId, onClose, accept }: PickerProps & { accept: boolean }) {
  const requests = useJoinRequests(workspaceId);
  const acceptRequest = useAcceptJoinRequest();
  const declineRequest = useDeclineJoinRequest();
  const rows = requests.data?.pages.flatMap((p) => p.items) ?? [];
  const nameOf = (id: string) => {
    const row = rows.find((r) => r.id === id);
    return row?.user ? personName(row.user, row.userId, null) : "A deleted account";
  };
  const items: PickerItem[] = rows.map((r) => ({
    id: r.id,
    label: nameOf(r.id),
    detail: r.message ?? "No message",
  }));
  function pick(item: PickerItem) {
    const name = nameOf(item.id);
    onClose();
    (accept ? acceptRequest : declineRequest)
      .mutateAsync({ serverId: workspaceId, requestId: item.id })
      .then(() =>
        toast.success(accept ? `${name} joined the workspace` : `Declined ${name}'s request`),
      )
      .catch((err: unknown) =>
        toast.error(
          publicLinkErrorMessage(
            err,
            accept ? "Could not accept the request" : "Could not decline the request",
          ),
        ),
      );
  }
  return (
    <ListPickerDialog
      title={accept ? "Accept a join request" : "Decline a join request"}
      items={items}
      loading={requests.isPending}
      error={errorText(requests.error, "Failed to load join requests.")}
      emptyText="No one is waiting to join."
      onPick={pick}
      onClose={onClose}
    />
  );
}

function InvitePicker({ workspaceId, onClose }: PickerProps) {
  const invites = useWorkspaceInvites(workspaceId);
  const revoke = useRevokeInviteMutation();
  const [chosen, setChosen] = useState<WorkspaceInviteRow | null>(null);
  const active = (invites.data?.pages.flatMap((p) => p.items) ?? []).filter(
    (i) => i.state === "ACTIVE",
  );
  if (chosen) {
    return (
      <ModerationDialog
        title="Revoke this invite?"
        description={revokeInviteDescription(chosen)}
        tone="danger"
        confirmLabel="Revoke invite"
        errorFallback="Could not revoke the invite"
        onConfirm={() => revoke.mutateAsync({ serverId: workspaceId, inviteId: chosen.id })}
        onDone={() => {
          onClose();
          toast.success("Invite revoked");
        }}
        onClose={onClose}
      />
    );
  }
  return (
    <ListPickerDialog
      title="Revoke an invite"
      items={active.map((i) => ({
        id: i.id,
        label: `${i.role.toLowerCase()} invite`,
        detail: `Created ${formatTime(i.createdAt)} · used ${i.useCount} times`,
      }))}
      loading={invites.isPending}
      error={errorText(invites.error, "Failed to load invites.")}
      emptyText="No active invites."
      onPick={(item) => setChosen(active.find((i) => i.id === item.id) ?? null)}
      onClose={onClose}
    />
  );
}

function BotPicker({
  workspaceId,
  onClose,
  action,
}: PickerProps & { action: "edit" | "deactivate" }) {
  const bots = useBots(workspaceId);
  const deactivate = useDeactivateBot(workspaceId);
  const [chosen, setChosen] = useState<{ userId: string; name: string } | null>(null);
  const active = (bots.data ?? []).filter((b) => !b.deactivatedAt);
  if (chosen) {
    return (
      <ConfirmActionDialog
        title={`Deactivate ${chosen.name}?`}
        description={DEACTIVATE_BOT_DESCRIPTION}
        confirmLabel="Deactivate"
        danger
        isPending={deactivate.isPending}
        onClose={onClose}
        onConfirm={() => {
          deactivate
            .mutateAsync(chosen.userId)
            .catch((err: unknown) =>
              toast.error(graphqlErrorMessage(err, "Could not deactivate the bot")),
            );
          onClose();
        }}
      />
    );
  }
  return (
    <ListPickerDialog
      title={action === "edit" ? "Edit a bot" : "Deactivate a bot"}
      items={active.map((b) => ({ id: b.userId, label: b.name, detail: b.runBy }))}
      loading={bots.isPending}
      error={errorText(bots.error, "Could not load the bots")}
      emptyText="No bots yet."
      onPick={(item) => {
        if (action === "edit") {
          useSettingsIntentStore.getState().set({ kind: "bot-edit", botUserId: item.id });
          openSettingsTab("bots");
          onClose();
        } else {
          setChosen({ userId: item.id, name: item.label });
        }
      }}
      onClose={onClose}
    />
  );
}

function WebhookPicker({ workspaceId, onClose }: PickerProps) {
  const webhooks = useIncomingWebhooks(workspaceId, true);
  const channels = useAllChannels(workspaceId);
  const bots = useBots(workspaceId);
  const revoke = useRevokeIncomingWebhook(workspaceId);
  const [chosen, setChosen] = useState<string | null>(null);
  const active = (webhooks.data ?? []).filter((w) => !w.revokedAt);
  if (chosen) {
    return (
      <ConfirmActionDialog
        title="Revoke this webhook?"
        description={REVOKE_WEBHOOK_DESCRIPTION}
        confirmLabel="Revoke"
        danger
        isPending={revoke.isPending}
        onClose={onClose}
        onConfirm={() => {
          revoke
            .mutateAsync(chosen)
            .catch((err: unknown) =>
              toast.error(graphqlErrorMessage(err, "Could not revoke the webhook")),
            );
          onClose();
        }}
      />
    );
  }
  return (
    <ListPickerDialog
      title="Revoke a webhook"
      items={active.map((w) => ({
        id: w.id,
        label:
          channels.data?.items.find((c) => c.id === w.conversationId)?.title ??
          "A channel you are not in",
        detail: bots.data?.find((b) => b.userId === w.botUserId)?.name ?? "A removed bot",
      }))}
      loading={webhooks.isPending}
      error={errorText(webhooks.error, "Could not load the webhooks")}
      emptyText="No incoming webhooks."
      onPick={(item) => setChosen(item.id)}
      onClose={onClose}
    />
  );
}

function UnblockPrincipalPicker({ onClose }: { onClose: () => void }) {
  const blocks = useInstancePrincipalBlocks();
  const unblock = useUnblockPrincipalMutation();
  const items: PickerItem[] = (blocks.data ?? []).map((b) => {
    const name = b.username ? `@${b.username}` : b.principalId;
    return { id: b.principalId, label: name, detail: b.reason };
  });
  function pick(item: PickerItem) {
    onClose();
    unblock
      .mutateAsync({ principalId: item.id })
      .then((outcome) => {
        if (!outcome.lifted) toast.info(`${item.label} was not blocked`);
        else if (outcome.emailUnblocked) toast.success(`Unblocked ${item.label} and their email`);
        else toast.success(`Unblocked ${item.label}`);
      })
      .catch((err: unknown) => toast.error(graphqlErrorMessage(err, "Could not lift the block")));
  }
  return (
    <ListPickerDialog
      title="Unblock a principal"
      items={items}
      loading={blocks.isPending}
      error={errorText(blocks.error, "Failed to load blocked principals.")}
      emptyText="No blocked principals."
      onPick={pick}
      onClose={onClose}
    />
  );
}

function UnblockIpPicker({ onClose }: { onClose: () => void }) {
  const blocks = useInstanceIpBlocks();
  const unblock = useUnblockIpMutation();
  function pick(item: PickerItem) {
    onClose();
    unblock
      .mutateAsync({ cidr: item.id })
      .then((lifted) =>
        lifted ? toast.success(`Unblocked ${item.id}`) : toast.info(`${item.id} was not blocked`),
      )
      .catch((err: unknown) => toast.error(graphqlErrorMessage(err, "Could not lift the block")));
  }
  return (
    <ListPickerDialog
      title="Unblock an address"
      items={(blocks.data ?? []).map((b) => ({ id: b.cidr, label: b.cidr, detail: b.reason }))}
      loading={blocks.isPending}
      error={errorText(blocks.error, "Failed to load blocked addresses.")}
      emptyText="No blocked addresses."
      onPick={pick}
      onClose={onClose}
    />
  );
}

function PrincipalPicker({
  purpose,
  onClose,
}: {
  purpose: "block" | "clear-profile";
  onClose: () => void;
}) {
  const reports = useInstanceReports(true);
  const [chosen, setChosen] = useState<string | null>(null);
  const seen = new Set<string>();
  const items: PickerItem[] = [];
  for (const report of reports.data?.pages.flat() ?? []) {
    const id = report.subjectPrincipalId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    items.push({
      id,
      label: report.subjectUsername ? `@${report.subjectUsername}` : id,
      detail: report.reason,
    });
  }
  if (chosen) return <ClearProfileDialog principalId={chosen} onClose={onClose} />;
  return (
    <ListPickerDialog
      title={purpose === "block" ? "Block a principal" : "Clear a profile"}
      items={items}
      loading={reports.isPending}
      emptyText="Type a principal id."
      custom={(query) => ({ id: query, label: `Use ${query}` })}
      onPick={(item) => {
        if (purpose === "block") {
          useSettingsIntentStore.getState().set({ kind: "block-principal", principalId: item.id });
          openSettingsTab("moderation");
          onClose();
        } else {
          setChosen(item.id);
        }
      }}
      onClose={onClose}
    />
  );
}

function PluginPicker({
  action,
  onClose,
}: {
  action: "toggle" | "update" | "uninstall" | "revoke-ai";
  onClose: () => void;
}) {
  const plugins = usePluginList();
  const revoke = useRevokeAllAiConsent();
  const eligible = (plugins.data ?? []).filter((p) =>
    action === "update"
      ? p.source?.kind === "git"
      : action === "revoke-ai"
        ? p.approved_ai_commands.length > 0
        : true,
  );
  const titles = {
    toggle: "Turn a plugin on or off",
    update: "Update a plugin",
    uninstall: "Uninstall a plugin",
    "revoke-ai": "Revoke a plugin's AI access",
  };
  function pick(item: PickerItem) {
    onClose();
    if (action === "revoke-ai") {
      const plugin = eligible.find((p) => p.plugin_id === item.id);
      if (!plugin) return;
      revoke
        .mutateAsync({ pluginId: plugin.plugin_id, commandIds: plugin.approved_ai_commands })
        .then(({ failed }) => {
          if (failed.length > 0) {
            toast.error("Some commands could not be revoked", {
              description: `Failed: ${failed.join(", ")}`,
            });
          }
        })
        .catch(() => toast.error("Failed to revoke AI access"));
      return;
    }
    useSettingsIntentStore.getState().set({ kind: "plugin", action, pluginId: item.id });
    openSettingsTab("plugins");
  }
  return (
    <ListPickerDialog
      title={titles[action]}
      items={eligible.map((p) => ({
        id: p.plugin_id,
        label: p.display_name || p.plugin_id,
        detail: `v${p.version}${p.enabled ? " · on" : " · off"}`,
      }))}
      loading={plugins.isPending}
      emptyText="No plugins to choose from."
      onPick={pick}
      onClose={onClose}
    />
  );
}

function UnblockPersonPicker({ onClose }: { onClose: () => void }) {
  const blocked = useBlockedPrincipals();
  const unblock = useUnblockPrincipal();
  const aliases = useContactStore((s) => s.aliases);
  const items: PickerItem[] = (blocked.data ?? []).map((entry) => ({
    id: entry.principalId,
    label: blockedName(entry, aliases),
  }));
  function pick(item: PickerItem) {
    onClose();
    unblock
      .mutateAsync(item.id)
      .then(() =>
        toast.success(asSentence(`Unblocked ${item.label}`), {
          description:
            "They can message you again. A conversation they started comes back as a request when they next write in it.",
        }),
      )
      .catch((err: unknown) =>
        toast.error(graphqlErrorMessage(err, `Could not unblock ${item.label}`)),
      );
  }
  return (
    <ListPickerDialog
      title="Unblock someone"
      items={items}
      loading={blocked.isPending}
      error={errorText(blocked.error, "Could not load the people you blocked.")}
      emptyText="You haven't blocked anyone."
      onPick={pick}
      onClose={onClose}
    />
  );
}

/** Someone a contact or block command acts on. */
interface Person {
  principalId: string;
  name: string;
  userId?: string;
}

function PersonCommand({
  workspaceId,
  onClose,
  purpose,
  userId,
}: PickerProps & {
  purpose: "add-contact" | "remove-contact" | "block";
  userId?: string;
}) {
  const members = useServerMembers(workspaceId);
  const contacts = useContacts();
  const aliases = useContactStore((s) => s.aliases);
  const me = useRelayStore((s) => s.account?.principalId ?? null);
  const { addContact } = useAddMemberContact();
  const removeContact = useRemoveContact();
  const [chosen, setChosen] = useState<Person | null>(null);
  const contactIds = new Set((contacts.data ?? []).map((c) => c.principalId));

  const people: Person[] =
    purpose === "remove-contact"
      ? (contacts.data ?? []).map((c) => ({
          principalId: c.principalId,
          name: aliases[c.principalId] || shortPrincipal(c.principalId),
        }))
      : (members.data ?? [])
          .filter(
            (m) =>
              m.principalId &&
              m.principalId !== me &&
              !m.isBot &&
              (purpose === "add-contact"
                ? !contactIds.has(m.principalId)
                : blockTargetOf(m.userId, workspaceId) !== null),
          )
          .map((m) => ({
            principalId: m.principalId as string,
            name: aliases[m.principalId as string] || m.displayName || m.username,
            userId: m.userId,
          }));

  // A person named by the context is acted on without asking, once the lists have loaded.
  const loaded = !members.isPending && !contacts.isPending;
  const contextMember = userId ? (members.data ?? []).find((m) => m.userId === userId) : undefined;
  const contextPerson =
    userId && loaded
      ? people.find((p) => p.userId === userId || p.principalId === contextMember?.principalId)
      : undefined;
  const target = chosen ?? contextPerson ?? null;
  useEffect(() => {
    if (!userId || !loaded || contextPerson) return;
    toast.info(
      purpose === "block"
        ? "You can't block this person"
        : purpose === "add-contact"
          ? "This person is already a contact or has no identity here"
          : "This person is not one of your contacts",
    );
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, loaded]);

  const acted = useRef(false);
  useEffect(() => {
    if (!target || acted.current) return;
    acted.current = true;
    if (purpose === "block") {
      askToBlock({ principalId: target.principalId, name: target.name });
    } else if (purpose === "add-contact") {
      void addContact(target.principalId, target.name);
    } else {
      removeContact
        .mutateAsync(target.principalId)
        .then(() => toast.success(`Removed ${target.name} from your contacts`))
        .catch((err: unknown) =>
          toast.error(graphqlErrorMessage(err, `Could not remove ${target.name}`)),
        );
    }
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  if (userId) return null;
  const titles = {
    "add-contact": "Add to contacts",
    "remove-contact": "Remove from contacts",
    block: "Block someone",
  };
  return (
    <ListPickerDialog
      title={titles[purpose]}
      items={people.map((p) => ({ id: p.principalId, label: p.name }))}
      loading={!loaded}
      emptyText="There is no one to choose."
      onPick={(item) => setChosen(people.find((p) => p.principalId === item.id) ?? null)}
      onClose={onClose}
    />
  );
}

function RequestCommand({
  requestId,
  action,
  onClose,
}: {
  requestId: string;
  action: "accept" | "ignore" | "read-first" | "report";
  onClose: () => void;
}) {
  const pending = usePendingDmRequests();
  const request = pending.data?.find((r) => r.id === requestId);
  useEffect(() => {
    if (!pending.isPending && !request) onClose();
  }, [pending.isPending, request, onClose]);
  if (!request) return null;
  return <RequestRunner request={request} action={action} onClose={onClose} />;
}

function RequestRunner({
  request,
  action,
  onClose,
}: {
  request: DmRequestView;
  action: "accept" | "ignore" | "read-first" | "report";
  onClose: () => void;
}) {
  const actions = useDmRequestActions(request, { closeOnDismiss: true });
  const ran = useRef(false);
  useEffect(() => {
    if (action === "report" || ran.current) return;
    ran.current = true;
    const run =
      action === "accept"
        ? actions.accept
        : action === "ignore"
          ? actions.ignore
          : actions.readFirst;
    void run().finally(onClose);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (action !== "report") return null;
  return (
    <ListPickerDialog
      title="Report this message request"
      items={REPORT_REASONS.map((reason) => ({ id: reason, label: reason }))}
      emptyText="No reasons."
      onPick={(item) => void actions.report(item.id).then(() => onClose())}
      onClose={onClose}
    />
  );
}
