import { useState } from "react";

import { Button } from "../../../shared/ui/Button";
import { cn } from "../../../shared/ui/cn";
import { toast } from "../../../shared/toast";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { DigestFrequency, NotificationLevel } from "../../../core/graphql/generated/schema-types";
import { ToggleSwitch } from "../../settings/components/ToggleSwitch";
import { FeatureOffNotice } from "../../updater/components/FeatureOffNotice";
import { useServerFeature } from "../../updater/hooks/useServerFeature";
import {
  useUpdateNotificationSettings,
  type NotificationSettingsData,
} from "../api/useNotificationSettings";
import {
  addKeywords,
  browserTimeZone,
  isValidTimeZone,
  timeZoneOptions,
  toTimeInput,
} from "../rules";
import { KeywordEditor } from "./KeywordEditor";

const LEVEL_OPTIONS: { level: NotificationLevel; label: string; description: string }[] = [
  { level: NotificationLevel.ALL, label: "All messages", description: "Every new message." },
  {
    level: NotificationLevel.MENTIONS,
    label: "Mentions",
    description: "Direct messages, mentions, keyword alerts and replies in your threads.",
  },
  { level: NotificationLevel.NONE, label: "None", description: "Nothing, mentions included." },
];

const DIGEST_OPTIONS: { value: DigestFrequency; label: string }[] = [
  { value: DigestFrequency.OFF, label: "Off" },
  { value: DigestFrequency.HOURLY, label: "Hourly" },
  { value: DigestFrequency.DAILY, label: "Daily" },
];

const DEFAULT_DND_START = "22:00";
const DEFAULT_DND_END = "08:00";

interface Draft {
  defaultLevel: NotificationLevel;
  keywords: string[];
  dndEnabled: boolean;
  dndStart: string;
  dndEnd: string;
  dndTimezone: string;
  digest: DigestFrequency;
}

function draftFrom(settings: NotificationSettingsData, fallbackZone: string): Draft {
  return {
    defaultLevel: settings.defaultLevel,
    keywords: settings.keywords,
    dndEnabled: settings.dnd !== null,
    dndStart: settings.dnd ? toTimeInput(settings.dnd.start) : DEFAULT_DND_START,
    dndEnd: settings.dnd ? toTimeInput(settings.dnd.end) : DEFAULT_DND_END,
    dndTimezone: settings.dnd?.timezone ?? fallbackZone,
    digest: settings.digest,
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  if (a.defaultLevel !== b.defaultLevel || a.digest !== b.digest) return false;
  if (a.keywords.join("\n") !== b.keywords.join("\n")) return false;
  if (a.dndEnabled !== b.dndEnabled) return false;
  if (!a.dndEnabled) return true;
  return a.dndStart === b.dndStart && a.dndEnd === b.dndEnd && a.dndTimezone === b.dndTimezone;
}

interface NotificationRulesFormProps {
  serverId: string;
  settings: NotificationSettingsData;
}

/**
 * The editable, server-backed notification rules of one workspace: default level, keyword
 * alerts, the daily do-not-disturb window and the email digest. Saved together with an explicit
 * Save; the server's message is shown when it refuses.
 */
export function NotificationRulesForm({ serverId, settings }: NotificationRulesFormProps) {
  // A new window starts in the browser's zone: the user profile exposes no time zone.
  const fallbackZone = browserTimeZone();
  const [baseline, setBaseline] = useState(() => draftFrom(settings, fallbackZone));
  const [draft, setDraft] = useState(baseline);
  const [keywordDraft, setKeywordDraft] = useState("");
  const [keywordError, setKeywordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const update = useUpdateNotificationSettings();
  // Without email on the server no digest is sent; the stored choice is kept as it is.
  const email = useServerFeature("email");

  const dirty = !sameDraft(draft, baseline) || keywordDraft.trim() !== "";

  function patch(next: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...next }));
    setFormError(null);
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    let keywords = draft.keywords;
    if (keywordDraft.trim()) {
      const result = addKeywords(keywords, keywordDraft);
      if (!result.ok) {
        setKeywordError(result.error);
        return;
      }
      keywords = result.keywords;
      setKeywordDraft("");
      setKeywordError(null);
      patch({ keywords });
    }

    if (draft.dndEnabled) {
      if (draft.dndStart === draft.dndEnd) {
        setFormError("Quiet hours must start and end at different times.");
        return;
      }
      if (!isValidTimeZone(draft.dndTimezone)) {
        setFormError("Pick a valid time zone for quiet hours.");
        return;
      }
    }

    update.mutate(
      {
        serverId,
        input: {
          defaultLevel: draft.defaultLevel,
          keywords,
          dnd: draft.dndEnabled
            ? { start: draft.dndStart, end: draft.dndEnd, timezone: draft.dndTimezone }
            : null,
          digest: draft.digest,
        },
      },
      {
        onSuccess: (saved) => {
          const next = draftFrom(saved, fallbackZone);
          setBaseline(next);
          setDraft(next);
          toast.success("Notification settings saved");
        },
        onError: (err) => {
          setFormError(graphqlErrorMessage(err, "Could not save notification settings."));
        },
      },
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-6" aria-label="Workspace notification rules">
      <fieldset>
        <legend className="text-sm font-medium text-rim-text">Default level</legend>
        <p className="mt-0.5 text-xs text-rim-text-muted">
          Applies to every conversation without its own level (set one from a conversation&apos;s
          menu).
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {LEVEL_OPTIONS.map((option) => (
            <label
              key={option.level}
              className={cn(
                "flex cursor-pointer flex-col rounded-md border px-3 py-2 transition",
                draft.defaultLevel === option.level
                  ? "border-rim-accent/60 bg-rim-accent/10"
                  : "border-rim-line hover:bg-white/5",
              )}
            >
              <span className="flex items-center gap-2 text-sm text-rim-text">
                <input
                  type="radio"
                  name="default-level"
                  value={option.level}
                  checked={draft.defaultLevel === option.level}
                  onChange={() => patch({ defaultLevel: option.level })}
                  aria-label={option.label}
                  aria-describedby={`default-level-${option.level}`}
                  className="accent-rim-accent"
                />
                {option.label}
              </span>
              <span
                id={`default-level-${option.level}`}
                className="mt-0.5 text-xs text-rim-text-muted"
              >
                {option.description}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <KeywordEditor
        keywords={draft.keywords}
        onChange={(keywords) => patch({ keywords })}
        draft={keywordDraft}
        onDraftChange={setKeywordDraft}
        error={keywordError}
        onErrorChange={setKeywordError}
      />

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-rim-text">Quiet hours</p>
            <p className="mt-0.5 text-xs text-rim-text-muted">
              A daily do-not-disturb window. Notifications still reach your inbox, without a toast
              or sound.
            </p>
          </div>
          <ToggleSwitch
            checked={draft.dndEnabled}
            onChange={(dndEnabled) => patch({ dndEnabled })}
            label="Quiet hours"
          />
        </div>
        {draft.dndEnabled && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-rim-text-muted">
              From
              <input
                type="time"
                value={draft.dndStart}
                onChange={(e) => patch({ dndStart: e.target.value })}
                className="mt-1 block rounded-md border border-rim-line bg-rim-void px-2 py-1 text-sm text-rim-text outline-none focus:border-rim-accent/40"
              />
            </label>
            <label className="text-xs text-rim-text-muted">
              To
              <input
                type="time"
                value={draft.dndEnd}
                onChange={(e) => patch({ dndEnd: e.target.value })}
                className="mt-1 block rounded-md border border-rim-line bg-rim-void px-2 py-1 text-sm text-rim-text outline-none focus:border-rim-accent/40"
              />
            </label>
            <label className="text-xs text-rim-text-muted">
              Time zone
              <select
                value={draft.dndTimezone}
                onChange={(e) => patch({ dndTimezone: e.target.value })}
                className="mt-1 block max-w-[16rem] rounded-md border border-rim-line bg-rim-void px-2 py-1 text-sm text-rim-text outline-none focus:border-rim-accent/40"
              >
                {timeZoneOptions(draft.dndTimezone).map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>

      {!email.enabled ? (
        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-rim-text">Email digest</span>
          <FeatureOffNotice feature="email" view={email} hideReason />
        </div>
      ) : (
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-medium text-rim-text">Email digest</span>
            <span className="mt-0.5 block text-xs text-rim-text-muted">
              Unread notifications by email while you are away.
            </span>
          </span>
          <select
            aria-label="Email digest"
            value={draft.digest}
            onChange={(e) => patch({ digest: e.target.value as DigestFrequency })}
            className="rounded-md border border-rim-line bg-rim-void px-2 py-1 text-sm text-rim-text outline-none focus:border-rim-accent/40"
          >
            {DIGEST_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {formError && (
        <p
          role="alert"
          className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger"
        >
          {formError}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={!dirty} isLoading={update.isPending}>
          Save
        </Button>
      </div>
    </form>
  );
}
