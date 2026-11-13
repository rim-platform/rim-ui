import { useState, useCallback, useMemo } from "react";
import { Plus, Pencil, Trash2, Power, ChevronDown, X } from "lucide-react";

import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useCanModerate } from "../../workspaces/api/useMyServerRole";
import { useAuthStore } from "../../auth/state/useAuthStore";
import {
  usePipelines,
  useCreatePipelineMutation,
  useUpdatePipelineMutation,
  useDeletePipelineMutation,
} from "../api/usePipelines";
import type { Pipeline, CreatePipelineInput, UpdatePipelineInput } from "../api/usePipelines";
import { useCommands } from "../../commands/api/useCommands";
import { PresetArgumentsSection } from "../../commands/components/ArgumentFields";
import type { FieldValues } from "../../commands/runtime/argumentValues";
import { actionArgs, actionForm } from "../actionArguments";
import { CommandIdInput } from "../../commands/components/CommandIdInput";
import {
  runsOnServer,
  skippedUnattended,
  unknownCommandError,
} from "../../commands/runtime/serverRunnable";
import type { CommandDefinition } from "../../commands/types";
import {
  PipelineTriggerKindGql,
  type PipelineActionInput,
} from "../../../core/graphql/generated/schema-types";
import { cn } from "../../../shared/ui/cn";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { runCommandFromClick } from "../../commands/runtime/runFromClick";
import { toast } from "../../../shared/toast";
import { LimitNote } from "../../limits/components/LimitNote";
import { limitView } from "../../limits/limits";
import { botsFeatureEnabled } from "../../bots/availability";
import { PIPELINE_POST_AS_BOT } from "../../updater/api/serverCapabilities";
import { useServerInfo } from "../../updater/hooks/useServerInfo";
import { useSpaceHasCapability } from "../../updater/hooks/useSpaceHasCapability";
import { POST_AS_BOT_COMMAND, postAsBotOf, type PostAsBot } from "../postAsBot";
import { ConversationSelect } from "./ConversationSelect";
import { PostAsBotFields, PostAsBotSummary, usePostAsBotNames } from "./PostAsBotAction";
import { hourCycleOptions } from "../../../shared/utils/formatTime";

const TRIGGER_OPTIONS: { value: PipelineTriggerKindGql; label: string }[] = [
  { value: PipelineTriggerKindGql.NEW_MESSAGE, label: "New Message" },
  { value: PipelineTriggerKindGql.MESSAGE_UPDATED, label: "Message Updated" },
  { value: PipelineTriggerKindGql.MESSAGE_DELETED, label: "Message Deleted" },
  { value: PipelineTriggerKindGql.REACTIONS_UPDATED, label: "Reactions Updated" },
  { value: PipelineTriggerKindGql.MEMBER_JOINED, label: "Member Joined" },
  { value: PipelineTriggerKindGql.WORKSPACE_STATE_CHANGED, label: "Workspace State Changed" },
];

/** Shown under a text condition: the server cannot read encrypted messages. */
const MESSAGE_CONTAINS_NOTE =
  "Never matches messages in end-to-end encrypted DMs and groups: the server cannot read them. Other triggers still fire there, on metadata only.";

/** Shown above the actions: why the command picker offers only some commands. */
const ACTIONS_NOTE =
  "Nobody is there to confirm a pipeline's actions, so commands that change data or need a confirmation are skipped when it fires and are not offered here.";

/**
 * The warning shown under an action whose command a firing pipeline does not run.
 *
 * @param command - The action's command, when the registry knows it.
 * @returns The warning, or `null` when the command runs.
 */
function actionWarning(command: CommandDefinition | undefined): string | null {
  if (!command) return null;
  if (!runsOnServer(command)) return "This command only runs in the app, so this action fails.";
  if (skippedUnattended(command))
    return "This command needs a confirmation, so this action is skipped.";
  return null;
}

const CONDITION_TYPES = [
  { value: "MessageContains", label: "Message contains pattern" },
  { value: "MessageFromUser", label: "Message from user" },
  { value: "ConversationIs", label: "In conversation" },
];

interface CommandDraft {
  kind: "command";
  commandId: string;
  /** The arguments the action was saved with. */
  saved: unknown;
  /** The fields changed since it loaded. */
  edited: FieldValues;
  /** Whether the saved arguments the fields cannot show were removed. */
  removed: boolean;
  /** Why each field cannot be saved; the empty name holds a problem of the whole form. */
  problems: Record<string, string>;
}

interface PostDraft extends PostAsBot {
  kind: "post";
  /** The `args` the server listed it with, which keep it unchanged when sent back. */
  listedArgs: unknown;
}

type ActionDraft = CommandDraft | PostDraft;

/** A command action with nothing in it, which a save leaves out. */
const EMPTY_COMMAND: CommandDraft = {
  kind: "command",
  commandId: "",
  saved: undefined,
  edited: {},
  removed: false,
  problems: {},
};

/** Whether a command draft has been left empty. */
function isEmptyCommand(action: ActionDraft): boolean {
  return action.kind === "command" && action.commandId.trim() === "";
}

interface ConditionDraft {
  conditionType: string;
  pattern: string;
  userId: string;
  conversationId: string;
}

interface PipelineEditorProps {
  initial?: Pipeline;
  serverId: string;
  /** Whether the workspace's host has Post as bot actions. */
  hasPostAsBot: boolean;
  onSave: () => void;
  onCancel: () => void;
}

interface ActionArgumentsProps {
  action: CommandDraft;
  command: CommandDefinition | undefined;
  /** Whether the command registry has loaded, so the action's command is known or unknown. */
  loaded: boolean;
  triggerKind: PipelineTriggerKindGql;
  serverId: string;
  onEdit: (change: (action: CommandDraft) => CommandDraft) => void;
}

/**
 * The arguments of one pipeline action: a field for each its command takes, and the saved
 * arguments the fields cannot show, as JSON with a button that removes them.
 */
function ActionArguments({
  action,
  command,
  loaded,
  triggerKind,
  serverId,
  onEdit,
}: ActionArgumentsProps) {
  if (!loaded) return null;
  const form = actionForm(command, action.saved, action.edited, action.removed, triggerKind);
  return (
    <>
      {form.fields.length > 0 && (
        <PresetArgumentsSection
          fields={form.fields}
          commandId={command?.id}
          values={form.values}
          problems={action.problems}
          workspaceId={serverId}
          emptyNote=""
          intro="Nobody is there to ask when this runs, so a field marked Required must be filled. Other fields use the trigger's conversation or the command's default."
          onChange={(name, value) =>
            onEdit((a) => {
              const problems = { ...a.problems };
              delete problems[name];
              return { ...a, edited: { ...a.edited, [name]: value }, problems };
            })
          }
        />
      )}
      {form.extras !== undefined && (
        <div className="space-y-1 text-xs text-rim-text-muted">
          <p>
            Saved arguments the form can&apos;t show:{" "}
            <code className="break-all font-mono text-rim-text">{JSON.stringify(form.extras)}</code>
          </p>
          <button
            type="button"
            onClick={() => onEdit((a) => ({ ...a, removed: true }))}
            className="rounded border border-rim-line px-2 py-0.5 text-rim-text transition hover:text-rim-danger"
          >
            Remove
          </button>
        </div>
      )}
      {action.problems[""] && <p className="text-xs text-rim-danger">{action.problems[""]}</p>}
    </>
  );
}

function PipelineEditor({
  initial,
  serverId,
  hasPostAsBot,
  onSave,
  onCancel,
}: PipelineEditorProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [triggerKind, setTriggerKind] = useState<PipelineTriggerKindGql>(
    initial?.trigger.kind ?? PipelineTriggerKindGql.NEW_MESSAGE,
  );
  const [triggerConversationId, setTriggerConversationId] = useState(
    initial?.trigger.conversationId ?? "",
  );
  const [cooldownSecs, setCooldownSecs] = useState<string>(
    initial?.cooldownSecs != null ? String(initial.cooldownSecs) : "",
  );
  const [conditions, setConditions] = useState<ConditionDraft[]>(() => {
    if (!initial?.filter?.conditions.length) return [];
    return initial.filter.conditions.map((c) => ({
      conditionType: c.conditionType,
      pattern: c.pattern ?? "",
      userId: c.userId ?? "",
      conversationId: c.conversationId ?? "",
    }));
  });
  const canModerate = useCanModerate(serverId);
  const { info } = useServerInfo();
  const mayEditPosts = canModerate && hasPostAsBot;
  const [actions, setActions] = useState<ActionDraft[]>(() => {
    if (!initial?.actions.length) return [EMPTY_COMMAND];
    return initial.actions.map((a): ActionDraft => {
      const post = postAsBotOf(a);
      if (post) return { kind: "post", ...post, listedArgs: a.args };
      return {
        kind: "command",
        commandId: a.commandId ?? "",
        saved: a.args ?? undefined,
        edited: {},
        removed: false,
        problems: {},
      };
    });
  });
  const [postError, setPostError] = useState<string | null>(null);

  const { data: allCommands } = useCommands("PALETTE");
  const { data: pickerCommands } = useCommands("KEYBIND_PICKER");
  const actionCommands = useMemo(
    () => allCommands?.filter((cmd) => runsOnServer(cmd) && !skippedUnattended(cmd)),
    [allCommands],
  );
  const commandsById = useMemo(
    () => new Map(allCommands?.map((cmd) => [cmd.id, cmd])),
    [allCommands],
  );
  const createPipeline = useCreatePipelineMutation();
  const updatePipeline = useUpdatePipelineMutation();

  const addAction = useCallback(() => {
    if (actions.length >= 10) return;
    setActions((prev) => [...prev, EMPTY_COMMAND]);
  }, [actions.length]);

  const addPostAction = useCallback(() => {
    if (actions.length >= 10) return;
    const post: PostDraft = {
      kind: "post",
      botUserId: "",
      conversationId: "",
      text: "",
      listedArgs: null,
    };
    setActions((prev) => [...prev.filter((a) => !isEmptyCommand(a)), post]);
  }, [actions.length]);

  const removeAction = useCallback((index: number) => {
    setActions((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateAction = useCallback((index: number, commandId: string) => {
    setActions((prev) =>
      prev.map((a, i) =>
        i === index && a.kind === "command" ? { ...EMPTY_COMMAND, commandId } : a,
      ),
    );
  }, []);

  const editAction = useCallback((index: number, change: (a: CommandDraft) => CommandDraft) => {
    setActions((prev) => prev.map((a, i) => (i === index && a.kind === "command" ? change(a) : a)));
  }, []);

  const updatePost = useCallback((index: number, next: PostAsBot) => {
    setActions((prev) =>
      prev.map((a, i) => (i === index && a.kind === "post" ? { ...a, ...next } : a)),
    );
  }, []);

  const addCondition = useCallback(() => {
    if (conditions.length >= 5) return;
    setConditions((prev) => [
      ...prev,
      { conditionType: "MessageContains", pattern: "", userId: "", conversationId: "" },
    ]);
  }, [conditions.length]);

  const removeCondition = useCallback((index: number) => {
    setConditions((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateCondition = useCallback(
    (index: number, field: keyof ConditionDraft, value: string) => {
      setConditions((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
    },
    [],
  );

  const handleSave = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const validActions = actions.filter((a) => !isEmptyCommand(a));
    if (validActions.length === 0) {
      toast.error("Add at least one action with a command");
      return;
    }
    if (
      validActions.some(
        (a) =>
          a.kind === "command" && unknownCommandError(a.commandId, allCommands, pickerCommands),
      )
    ) {
      toast.error("Fix the actions marked in red before saving.");
      return;
    }
    setPostError(null);
    if (
      validActions.some(
        (a) =>
          a.kind === "post" && mayEditPosts && !(a.botUserId && a.conversationId && a.text.trim()),
      )
    ) {
      setPostError("Choose a bot and a channel, and write what it posts.");
      return;
    }

    const trigger = {
      kind: triggerKind,
      conversationId: triggerConversationId.trim() || undefined,
    };

    const filter =
      conditions.length > 0
        ? {
            conditions: conditions.map((c) => ({
              conditionType: c.conditionType,
              pattern: c.pattern.trim() || undefined,
              userId: c.userId.trim() || undefined,
              conversationId: c.conversationId.trim() || undefined,
            })),
          }
        : undefined;

    const unsaved = new Map<ActionDraft, Record<string, string>>();
    const savedArgs = new Map<ActionDraft, unknown>();
    for (const a of validActions) {
      if (a.kind !== "command") continue;
      const command = commandsById.get(a.commandId.trim());
      const form = actionForm(command, a.saved, a.edited, a.removed, triggerKind);
      const result = actionArgs(command, form, serverId);
      if (result.ok) savedArgs.set(a, result.args);
      else unsaved.set(a, result.problems);
    }
    if (unsaved.size > 0) {
      setActions((prev) =>
        prev.map((a) => (unsaved.has(a) ? { ...a, problems: unsaved.get(a)! } : a)),
      );
      toast.error("Fix the actions marked in red before saving.");
      return;
    }

    const mappedActions: PipelineActionInput[] = [];
    for (const a of validActions) {
      if (a.kind === "post") {
        mappedActions.push(
          !mayEditPosts
            ? { commandId: POST_AS_BOT_COMMAND, args: a.listedArgs }
            : {
                commandId: POST_AS_BOT_COMMAND,
                postAsBot: {
                  botUserId: a.botUserId,
                  conversationId: a.conversationId,
                  text: a.text,
                },
              },
        );
        continue;
      }
      const args = savedArgs.get(a);
      mappedActions.push({ commandId: a.commandId.trim(), args });
    }

    const parsedCd = cooldownSecs.trim() ? parseInt(cooldownSecs, 10) : undefined;
    const cd =
      parsedCd !== undefined && !Number.isNaN(parsedCd) && parsedCd >= 0 ? parsedCd : undefined;

    try {
      if (initial) {
        const input: UpdatePipelineInput = {
          pipelineId: initial.id,
          name: trimmedName,
          description: description.trim() || undefined,
          trigger,
          filter,
          actions: mappedActions,
          cooldownSecs: cd,
        };
        await updatePipeline.mutateAsync(input);
      } else {
        const input: CreatePipelineInput = {
          serverId,
          name: trimmedName,
          description: description.trim() || undefined,
          trigger,
          filter,
          actions: mappedActions,
          cooldownSecs: cd,
        };
        await createPipeline.mutateAsync(input);
      }
      onSave();
    } catch (err: unknown) {
      const message = graphqlErrorMessage(err, "Failed to save pipeline");
      if (message.includes("Post as bot")) setPostError(message);
      else toast.error(message);
    }
  }, [
    name,
    description,
    triggerKind,
    triggerConversationId,
    cooldownSecs,
    conditions,
    actions,
    allCommands,
    pickerCommands,
    commandsById,
    mayEditPosts,
    initial,
    serverId,
    createPipeline,
    updatePipeline,
    onSave,
  ]);

  const isSaving = createPipeline.isPending || updatePipeline.isPending;
  const offersPost =
    mayEditPosts &&
    botsFeatureEnabled(info) &&
    triggerKind === PipelineTriggerKindGql.MEMBER_JOINED;
  const firstPostIndex = actions.findIndex((a) => a.kind === "post");

  return (
    <div className="space-y-5">
      {/* Name */}
      <div>
        <label className="mb-1 block text-sm font-medium text-rim-text">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My pipeline"
          className="w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none focus:border-rim-accent"
        />
      </div>

      {/* Description */}
      <div>
        <label className="mb-1 block text-sm font-medium text-rim-text">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What does this pipeline do?"
          rows={2}
          className="w-full resize-none rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none focus:border-rim-accent"
        />
      </div>

      {/* Trigger */}
      <div>
        <label className="mb-1 block text-sm font-medium text-rim-text">Trigger</label>
        <div className="space-y-2">
          <div className="relative">
            <select
              value={triggerKind}
              onChange={(e) => setTriggerKind(e.target.value as PipelineTriggerKindGql)}
              className="w-full appearance-none rounded-lg border border-rim-line bg-rim-void px-3 py-2 pr-8 text-sm text-rim-text outline-none focus:border-rim-accent"
            >
              {TRIGGER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-rim-text-muted" />
          </div>
          <ConversationSelect
            serverId={serverId}
            value={triggerConversationId}
            onChange={setTriggerConversationId}
            emptyLabel="Any conversation"
            ariaLabel="Scope to conversation"
          />
        </div>
      </div>

      {/* Filter conditions */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-medium text-rim-text">
            Filters ({conditions.length}/5)
          </label>
          <button
            type="button"
            onClick={addCondition}
            disabled={conditions.length >= 5}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-rim-accent transition hover:bg-rim-accent/10 disabled:opacity-40"
          >
            <Plus className="h-3 w-3" /> Add filter
          </button>
        </div>
        {conditions.length === 0 && (
          <p className="text-xs text-rim-text-faint">
            No filters — pipeline will fire on every matching trigger.
          </p>
        )}
        <div className="space-y-2">
          {conditions.map((cond, index) => (
            <div
              key={index}
              className="flex items-start gap-2 rounded-lg border border-rim-line bg-rim-void p-3"
            >
              <div className="flex-1 space-y-2">
                <div className="relative">
                  <select
                    value={cond.conditionType}
                    onChange={(e) => updateCondition(index, "conditionType", e.target.value)}
                    className="w-full appearance-none rounded border border-rim-line bg-rim-panel px-2 py-1.5 pr-8 text-sm text-rim-text outline-none focus:border-rim-accent"
                  >
                    {CONDITION_TYPES.map((ct) => (
                      <option key={ct.value} value={ct.value}>
                        {ct.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-rim-text-muted" />
                </div>
                {cond.conditionType === "MessageContains" && (
                  <>
                    <input
                      type="text"
                      value={cond.pattern}
                      onChange={(e) => updateCondition(index, "pattern", e.target.value)}
                      placeholder="Pattern (e.g. urgent)"
                      className="w-full rounded border border-rim-line bg-rim-panel px-2 py-1.5 text-sm text-rim-text outline-none focus:border-rim-accent"
                    />
                    <p className="text-[11px] text-rim-text-faint">{MESSAGE_CONTAINS_NOTE}</p>
                  </>
                )}
                {cond.conditionType === "MessageFromUser" && (
                  <input
                    type="text"
                    value={cond.userId}
                    onChange={(e) => updateCondition(index, "userId", e.target.value)}
                    placeholder="User ID"
                    className="w-full rounded border border-rim-line bg-rim-panel px-2 py-1.5 text-sm text-rim-text outline-none focus:border-rim-accent"
                  />
                )}
                {cond.conditionType === "ConversationIs" && (
                  <ConversationSelect
                    serverId={serverId}
                    value={cond.conversationId}
                    onChange={(id) => updateCondition(index, "conversationId", id)}
                    emptyLabel="Choose a channel"
                    ariaLabel="Conversation"
                  />
                )}
              </div>
              <button
                type="button"
                onClick={() => removeCondition(index)}
                className="mt-1 rounded p-0.5 text-rim-text-muted transition hover:text-rim-danger"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-medium text-rim-text">Actions ({actions.length}/10)</label>
          <div className="flex flex-wrap justify-end gap-1">
            {offersPost && (
              <button
                type="button"
                onClick={addPostAction}
                disabled={actions.length >= 10}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-rim-accent transition hover:bg-rim-accent/10 disabled:opacity-40"
              >
                <Plus className="h-3 w-3" /> Post as bot
              </button>
            )}
            <button
              type="button"
              onClick={addAction}
              disabled={actions.length >= 10}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-rim-accent transition hover:bg-rim-accent/10 disabled:opacity-40"
            >
              <Plus className="h-3 w-3" /> Add action
            </button>
          </div>
        </div>
        <p className="mb-2 text-xs text-rim-text-muted">{ACTIONS_NOTE}</p>
        <div className="space-y-2">
          {actions.map((action, index) => {
            if (action.kind === "post") {
              return (
                <PostAsBotFields
                  key={index}
                  serverId={serverId}
                  index={index}
                  action={action}
                  lockedNote={
                    mayEditPosts
                      ? null
                      : canModerate
                        ? "This workspace's server doesn't let this app change it. You can keep it or remove it."
                        : "Only an Owner or Moderator can change this. You can keep it or remove it."
                  }
                  triggerFits={triggerKind === PipelineTriggerKindGql.MEMBER_JOINED}
                  error={index === firstPostIndex ? postError : null}
                  onChange={(next) => {
                    setPostError(null);
                    updatePost(index, next);
                  }}
                  onRemove={() => removeAction(index)}
                />
              );
            }
            const warning = actionWarning(commandsById.get(action.commandId));
            return (
              <div
                key={index}
                className="flex items-start gap-2 rounded-lg border border-rim-line bg-rim-void p-3"
              >
                <span className="mt-1 font-mono text-xs text-rim-text-muted">{index + 1}.</span>
                <div className="flex-1 space-y-2">
                  <CommandIdInput
                    value={action.commandId}
                    onChange={(v) => updateAction(index, v)}
                    commands={actionCommands}
                    error={
                      warning
                        ? null
                        : unknownCommandError(action.commandId, allCommands, pickerCommands)
                    }
                  />
                  {warning && <p className="text-xs text-rim-danger">{warning}</p>}
                  <ActionArguments
                    action={action}
                    command={commandsById.get(action.commandId.trim())}
                    loaded={allCommands !== undefined}
                    triggerKind={triggerKind}
                    serverId={serverId}
                    onEdit={(change) => editAction(index, change)}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeAction(index)}
                  disabled={actions.length <= 1}
                  className="mt-1 rounded p-0.5 text-rim-text-muted transition hover:text-rim-danger disabled:opacity-30"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Cooldown */}
      <div>
        <label className="mb-1 block text-sm font-medium text-rim-text">
          Cooldown (seconds, optional)
        </label>
        <input
          type="number"
          min={0}
          value={cooldownSecs}
          onChange={(e) => setCooldownSecs(e.target.value)}
          placeholder="e.g. 60"
          className="w-32 rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none focus:border-rim-accent"
        />
      </div>

      {/* Save / Cancel */}
      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving || !name.trim()}
          className="rounded-lg bg-rim-text px-4 py-2 text-sm font-medium text-rim-panel transition hover:bg-rim-text/90 disabled:opacity-50"
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-rim-line px-4 py-2 text-sm text-rim-text-muted transition hover:bg-rim-void/50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function triggerLabel(kind: PipelineTriggerKindGql): string {
  return TRIGGER_OPTIONS.find((o) => o.value === kind)?.label ?? kind;
}

/**
 * What a pipeline's Post as bot actions do, for the list. Every member sees it, with a channel they
 * can't see named only as that.
 *
 * @param serverId - The workspace.
 * @param posts - The pipeline's Post as bot actions.
 */
function PipelinePosts({ serverId, posts }: { serverId: string; posts: PostAsBot[] }) {
  const names = usePostAsBotNames(serverId);
  return (
    <div className="mt-1 space-y-1">
      {posts.map((post, index) => (
        <PostAsBotSummary key={index} action={post} names={names} />
      ))}
    </div>
  );
}

export function PipelineSettings() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const currentUserId = useAuthStore((s) => s.session?.userId);
  const canModerate = useCanModerate(workspaceId ?? undefined);
  const { data: pipelines, isLoading, isError } = usePipelines(workspaceId ?? undefined);
  const deletePipeline = useDeletePipelineMutation();
  const hasPostAsBot = useSpaceHasCapability(workspaceId, PIPELINE_POST_AS_BOT);
  const pipelineLimit = limitView(
    useServerInfo().limits?.pipelinesPerWorkspace,
    pipelines?.length,
    ["pipeline", "pipelines"],
    "pipelines per workspace",
  );

  const [editing, setEditing] = useState<Pipeline | "new" | null>(null);

  const handleDelete = useCallback(
    async (pipelineId: string, pipelineName: string) => {
      if (!workspaceId) return;
      const confirmed = window.confirm(`Delete pipeline "${pipelineName}"? This cannot be undone.`);
      if (!confirmed) return;
      try {
        await deletePipeline.mutateAsync({ pipelineId, serverId: workspaceId });
      } catch (err: unknown) {
        toast.error(graphqlErrorMessage(err, "Failed to delete pipeline"));
      }
    },
    [deletePipeline, workspaceId],
  );

  /** Runs `app.toggle_pipeline` on a pipeline, as the palette's command does. */
  const handleToggle = useCallback((pipelineId: string) => {
    void runCommandFromClick("app.toggle_pipeline", { pipeline_id: pipelineId });
  }, []);

  if (editing !== null) {
    const isNew = editing === "new";
    return (
      <div>
        <h2 className="mb-4 text-base font-semibold text-rim-text">
          {isNew ? "Create Pipeline" : `Edit: ${editing.name}`}
        </h2>
        <PipelineEditor
          initial={isNew ? undefined : editing}
          serverId={workspaceId ?? ""}
          hasPostAsBot={hasPostAsBot}
          onSave={() => setEditing(null)}
          onCancel={() => setEditing(null)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-rim-text">Pipelines</h2>
        <button
          type="button"
          onClick={() => setEditing("new")}
          disabled={pipelineLimit?.full}
          className="flex items-center gap-1 rounded-lg bg-rim-text px-3 py-1.5 text-sm font-medium text-rim-panel transition hover:bg-rim-text/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> New Pipeline
        </button>
      </div>

      <p className="text-sm text-rim-text-muted">
        A pipeline does something when something happens in this workspace. When a new message
        matches a filter, someone joins or a state entry changes, it runs commands that need no
        confirmation, or posts a welcome as a bot. A cooldown keeps it from running too often. Any
        member can create a pipeline, and it runs as the person who created it.
      </p>

      <LimitNote limit={pipelineLimit} />

      {isLoading && <p className="text-sm text-rim-text-muted">Loading pipelines...</p>}

      {isError && <p className="text-sm text-rim-danger">Failed to load pipelines.</p>}

      {!isLoading && !isError && (!pipelines || pipelines.length === 0) && (
        <p className="text-sm text-rim-text-muted">
          No pipelines yet. Create one to react to workspace events automatically.
        </p>
      )}

      {pipelines && pipelines.length > 0 && (
        <div className="divide-y divide-rim-line rounded-lg border border-rim-line">
          {pipelines.map((pipeline) => (
            <div key={pipeline.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-rim-text">{pipeline.name}</span>
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                      pipeline.enabled
                        ? "bg-rim-success/15 text-rim-success"
                        : "bg-rim-text-faint/15 text-rim-text-faint",
                    )}
                  >
                    {pipeline.enabled ? "Active" : "Disabled"}
                  </span>
                </div>
                {pipeline.description && (
                  <div className="truncate text-xs text-rim-text-muted">{pipeline.description}</div>
                )}
                <div className="flex items-center gap-3 text-xs text-rim-text-faint">
                  <span>Trigger: {triggerLabel(pipeline.trigger.kind)}</span>
                  <span>
                    {pipeline.actions.length} action{pipeline.actions.length !== 1 ? "s" : ""}
                  </span>
                  {pipeline.lastFiredAt && (
                    <span>
                      Last fired:{" "}
                      {new Date(pipeline.lastFiredAt).toLocaleString(undefined, hourCycleOptions())}
                    </span>
                  )}
                </div>
                {workspaceId && pipeline.actions.some((a) => postAsBotOf(a)) && (
                  <PipelinePosts
                    serverId={workspaceId}
                    posts={pipeline.actions.flatMap((a) => postAsBotOf(a) ?? [])}
                  />
                )}
              </div>
              {/* Only the creator, an Owner or a Moderator may change a pipeline. */}
              {(canModerate || pipeline.createdBy === currentUserId) && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleToggle(pipeline.id)}
                    title={pipeline.enabled ? "Disable pipeline" : "Enable pipeline"}
                    className={cn(
                      "rounded-md p-1.5 transition",
                      pipeline.enabled
                        ? "text-rim-success hover:bg-rim-success/10"
                        : "text-rim-text-muted hover:bg-rim-void/50",
                    )}
                  >
                    <Power className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(pipeline)}
                    title="Edit pipeline"
                    className="rounded-md p-1.5 text-rim-text-muted transition hover:bg-rim-void/50 hover:text-rim-text"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(pipeline.id, pipeline.name)}
                    title="Delete pipeline"
                    className="rounded-md p-1.5 text-rim-text-muted transition hover:bg-rim-danger/10 hover:text-rim-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
