import { useState, type FormEvent, type KeyboardEvent } from "react";
import { ChevronRight } from "lucide-react";

import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import { cn } from "../../../shared/ui/cn";
import {
  defaultFieldValue,
  readFields,
  requiredFirst,
  type FieldValue,
  type FieldValues,
} from "../runtime/argumentValues";
import {
  useCommandArgumentsStore,
  type ArgumentGroup,
  type CommandArgumentsRequest,
} from "../state/useCommandArgumentsStore";
import type { CommandArgumentInfo } from "../types";
import { ArgumentFieldList } from "./ArgumentFields";

/** One group of the form: its command's fields, and the optional ones under "More options". */
interface FormGroup {
  group: ArgumentGroup;
  /** What its values are named by in the answer, or `null` for plain argument names. */
  key: string | null;
  labelPrefix?: string;
  fields: CommandArgumentInfo[];
  more: CommandArgumentInfo[];
}

function groupsOf(request: CommandArgumentsRequest): FormGroup[] {
  const steps = request.steps;
  if (steps && steps.length > 0) {
    return steps.map((step) => ({
      group: step,
      key: step.key,
      labelPrefix: step.labelPrefix,
      fields: requiredFirst(step.arguments),
      more: step.moreArguments ?? [],
    }));
  }
  return [
    {
      group: request,
      key: null,
      fields: requiredFirst(request.arguments),
      more: request.moreArguments ?? [],
    },
  ];
}

function startValues(group: FormGroup): FieldValues {
  return Object.fromEntries(
    [...group.fields, ...group.more].map((field) => [field.name, defaultFieldValue(field)]),
  );
}

/**
 * The form of one request: the fields of each group, prefilled with their defaults, the optional
 * ones folded under "More options", and Run and Cancel.
 */
function ArgumentsForm({ request }: { request: CommandArgumentsRequest }) {
  const submit = useCommandArgumentsStore((s) => s.submit);
  const cancel = useCommandArgumentsStore((s) => s.cancel);
  const [groups] = useState(() => groupsOf(request));
  const [values, setValues] = useState<FieldValues[]>(() => groups.map(startValues));
  const [touched, setTouched] = useState<Set<string>[]>(() => groups.map(() => new Set()));
  const [problems, setProblems] = useState<Record<string, string>[]>(() => groups.map(() => ({})));
  const [moreOpen, setMoreOpen] = useState<boolean[]>(() => groups.map(() => false));

  function run() {
    const answer: Record<string, unknown> = {};
    const found = groups.map(() => ({}) as Record<string, string>);
    groups.forEach((group, index) => {
      const set = group.more.filter((field) => touched[index].has(field.name));
      const read = readFields(
        [...group.fields, ...set],
        values[index],
        true,
        group.group.commandId,
      );
      if (!read.ok) {
        found[index] = read.problems;
        return;
      }
      for (const [name, value] of Object.entries(read.args)) {
        answer[group.key === null ? name : `${group.key}:${name}`] = value;
      }
    });
    if (found.some((groupProblems) => Object.keys(groupProblems).length > 0)) {
      setProblems(found);
      setMoreOpen((open) =>
        open.map(
          (wasOpen, index) =>
            wasOpen || groups[index].more.some((field) => field.name in found[index]),
        ),
      );
      return;
    }
    submit(answer);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    run();
  }

  // Enter on a select or a checkbox runs the form too, as it does in a text field.
  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key !== "Enter" || event.defaultPrevented) return;
    const target = event.target;
    const takesEnter =
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLInputElement && target.type === "checkbox");
    if (!takesEnter) return;
    event.preventDefault();
    run();
  }

  function change(index: number, changes: Readonly<FieldValues>) {
    const names = Object.keys(changes);
    setValues((current) =>
      current.map((groupValues, i) => (i === index ? { ...groupValues, ...changes } : groupValues)),
    );
    setTouched((current) =>
      current.map((seen, i) => (i === index ? new Set([...seen, ...names]) : seen)),
    );
    setProblems((current) =>
      current.map((groupProblems, i) => {
        if (i !== index || !names.some((name) => name in groupProblems)) return groupProblems;
        const next = { ...groupProblems };
        for (const name of names) delete next[name];
        return next;
      }),
    );
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit} onKeyDown={onKeyDown} noValidate>
      {groups.map((group, index) => {
        const listProps = {
          values: values[index],
          onChange: (name: string, value: FieldValue) => change(index, { [name]: value }),
          onChangeFields: (changes: Readonly<FieldValues>) => change(index, changes),
          mode: "ask" as const,
          problems: problems[index],
          workspaceId: group.group.workspaceId,
          commandId: group.group.commandId,
          labelPrefix: group.labelPrefix,
          givenValues: {
            ...group.group.givenValues,
            ...(group.group.conversationId ? { conversation_id: group.group.conversationId } : {}),
          },
          onSubmit: run,
        };
        const moreId = `more-options-${index}`;
        return (
          <div key={group.key ?? "command"} className="space-y-3">
            {group.fields.length > 0 && (
              <ArgumentFieldList
                {...listProps}
                fields={group.fields}
                autoFocusFirst={index === 0}
              />
            )}
            {group.more.length > 0 && (
              <div className="space-y-3">
                <button
                  type="button"
                  aria-expanded={moreOpen[index]}
                  aria-controls={moreId}
                  onClick={() =>
                    setMoreOpen((open) =>
                      open.map((wasOpen, i) => (i === index ? !wasOpen : wasOpen)),
                    )
                  }
                  className="flex items-center gap-1 text-xs text-rim-text-muted transition hover:text-rim-text"
                >
                  <ChevronRight
                    className={cn("h-3.5 w-3.5 transition", moreOpen[index] && "rotate-90")}
                  />
                  More options
                </button>
                {moreOpen[index] && (
                  <div id={moreId}>
                    <ArgumentFieldList {...listProps} fields={group.more} />
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={cancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm">
          Run
        </Button>
      </div>
    </form>
  );
}

/**
 * Asks for the arguments a command run from the palette, a keybind or a quick box still lacks,
 * or those a macro's steps ask for, then runs it with them. Escape, Cancel and the backdrop run
 * nothing.
 */
export function CommandArgumentsDialog() {
  const request = useCommandArgumentsStore((s) => s.request);
  const cancel = useCommandArgumentsStore((s) => s.cancel);
  if (!request) return null;
  return (
    <Dialog open onClose={cancel} title={request.title} maxWidth="max-w-md">
      <ArgumentsForm request={request} />
    </Dialog>
  );
}
