import { useId, useRef, useState } from "react";

import { Button } from "../../../shared/ui/Button";
import { blankCondition, type DraftCondition, type DraftRule } from "../formats/draft";

const FIELD_CLASS =
  "w-full min-w-0 rounded-lg border border-rim-line bg-rim-void px-2.5 py-2 text-sm text-rim-text outline-none focus:border-rim-accent/40";
const LABEL_CLASS = "mb-1 block text-xs font-medium text-rim-text-faint";

interface RuleCardProps {
  rule: DraftRule;
  /** Its place, counted from 1. */
  number: number;
  count: number;
  /** The id of the `<datalist>` of field names from the sample. */
  pathsListId: string;
  /** Why the server refuses this rule, if it does. */
  refusal?: string;
  onChange: (rule: DraftRule) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}

/**
 * One rule of a format: its conditions as rows, the text it posts and an optional link, with
 * buttons to move and remove it. Native controls only, so it works from the keyboard alone.
 */
export function RuleCard({
  rule,
  number,
  count,
  pathsListId,
  refusal,
  onChange,
  onMove,
  onRemove,
}: RuleCardProps) {
  const id = useId();
  const postRef = useRef<HTMLTextAreaElement>(null);
  const [insert, setInsert] = useState("");
  const setCondition = (key: string, change: Partial<DraftCondition>) =>
    onChange({
      ...rule,
      conditions: rule.conditions.map((c) => (c.key === key ? { ...c, ...change } : c)),
    });

  function insertPlaceholder() {
    const path = insert.trim();
    if (!path) return;
    const area = postRef.current;
    const at = area?.selectionStart ?? rule.post.length;
    const end = area?.selectionEnd ?? at;
    onChange({ ...rule, post: `${rule.post.slice(0, at)}{${path}}${rule.post.slice(end)}` });
    setInsert("");
    area?.focus();
  }

  return (
    <li
      className="space-y-3 rounded-lg border border-rim-line bg-rim-panel p-3"
      aria-labelledby={`${id}-title`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={`${id}-title`} className="text-sm font-semibold text-rim-text">
          Rule {number}
        </h4>
        <div className="flex flex-wrap gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={number === 1}
            onClick={() => onMove(-1)}
            aria-label={`Move rule ${number} up`}
          >
            Move up
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={number === count}
            onClick={() => onMove(1)}
            aria-label={`Move rule ${number} down`}
          >
            Move down
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onRemove}
            aria-label={`Remove rule ${number}`}
          >
            Remove
          </Button>
        </div>
      </div>
      {refusal && (
        <p
          role="alert"
          className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger"
        >
          {refusal}
        </p>
      )}
      <fieldset className="space-y-2">
        <legend className={LABEL_CLASS}>
          {rule.conditions.length === 0 ? "When: always" : "When all of these hold"}
        </legend>
        {rule.conditions.map((c, at) => (
          <div key={c.key} className="grid grid-cols-1 gap-2 sm:grid-cols-[7rem_1fr_1fr_auto]">
            <select
              aria-label={`Rule ${number}, condition ${at + 1}: what it tests`}
              value={c.kind}
              onChange={(e) =>
                setCondition(c.key, { kind: e.currentTarget.value as DraftCondition["kind"] })
              }
              className={FIELD_CLASS}
            >
              <option value="field">Field</option>
              <option value="header">Header</option>
            </select>
            <input
              aria-label={`Rule ${number}, condition ${at + 1}: ${c.kind === "header" ? "header name" : "field"}`}
              value={c.name}
              list={c.kind === "field" ? pathsListId : undefined}
              placeholder={c.kind === "header" ? "X-GitHub-Event" : "action"}
              onChange={(e) => setCondition(c.key, { name: e.currentTarget.value })}
              className={FIELD_CLASS}
            />
            <input
              aria-label={`Rule ${number}, condition ${at + 1}: equals`}
              value={c.equals}
              placeholder="equals"
              onChange={(e) => setCondition(c.key, { equals: e.currentTarget.value })}
              className={FIELD_CLASS}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() =>
                onChange({ ...rule, conditions: rule.conditions.filter((x) => x.key !== c.key) })
              }
              aria-label={`Remove condition ${at + 1} of rule ${number}`}
            >
              Remove
            </Button>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={rule.conditions.length >= 5}
          onClick={() => onChange({ ...rule, conditions: [...rule.conditions, blankCondition()] })}
        >
          Add condition
        </Button>
      </fieldset>
      <label className="block">
        <span className={LABEL_CLASS}>Post</span>
        <textarea
          ref={postRef}
          value={rule.post}
          rows={3}
          placeholder="{repository.full_name}: {sender.login} opened #{issue.number}"
          onChange={(e) => onChange({ ...rule, post: e.currentTarget.value })}
          className={`${FIELD_CLASS} font-mono`}
        />
      </label>
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className={LABEL_CLASS}>Insert a field</span>
          <input
            value={insert}
            list={pathsListId}
            placeholder="pull_request.title"
            onChange={(e) => setInsert(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                insertPlaceholder();
              }
            }}
            className={FIELD_CLASS}
          />
        </label>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!insert.trim()}
          onClick={insertPlaceholder}
        >
          Insert
        </Button>
      </div>
      <label className="flex items-center gap-2 text-sm text-rim-text">
        <input
          type="checkbox"
          checked={rule.link !== null}
          onChange={(e) =>
            onChange({
              ...rule,
              link: e.currentTarget.checked ? { value: "", origin: "https://" } : null,
            })
          }
        />
        Add a link after the text
      </label>
      {rule.link && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="block min-w-0">
            <span className={LABEL_CLASS}>Link</span>
            <input
              value={rule.link.value}
              placeholder="{pull_request.html_url}"
              onChange={(e) =>
                onChange({ ...rule, link: { ...rule.link!, value: e.currentTarget.value } })
              }
              className={`${FIELD_CLASS} font-mono`}
            />
          </label>
          <label className="block min-w-0">
            <span className={LABEL_CLASS}>Only under</span>
            <input
              value={rule.link.origin}
              placeholder="https://github.com/"
              onChange={(e) =>
                onChange({ ...rule, link: { ...rule.link!, origin: e.currentTarget.value } })
              }
              className={FIELD_CLASS}
            />
          </label>
        </div>
      )}
    </li>
  );
}
