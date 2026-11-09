import { useState, type FormEvent, type KeyboardEvent } from "react";

import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import {
  defaultFieldValue,
  readFields,
  requiredFirst,
  type FieldValue,
  type FieldValues,
} from "../runtime/argumentValues";
import {
  useCommandArgumentsStore,
  type CommandArgumentsRequest,
} from "../state/useCommandArgumentsStore";
import { ArgumentFieldList } from "./ArgumentFields";

/** The form of one request: its fields, prefilled with their defaults, and Run and Cancel. */
function ArgumentsForm({ request }: { request: CommandArgumentsRequest }) {
  const submit = useCommandArgumentsStore((s) => s.submit);
  const cancel = useCommandArgumentsStore((s) => s.cancel);
  const fields = requiredFirst(request.arguments);
  const [values, setValues] = useState<FieldValues>(() =>
    Object.fromEntries(fields.map((field) => [field.name, defaultFieldValue(field)])),
  );
  const [problems, setProblems] = useState<Record<string, string>>({});

  function run() {
    const read = readFields(fields, values, true);
    if (!read.ok) {
      setProblems(read.problems);
      return;
    }
    submit(read.args);
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

  function change(name: string, value: FieldValue) {
    setValues((current) => ({ ...current, [name]: value }));
    setProblems((current) => {
      if (!(name in current)) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit} onKeyDown={onKeyDown} noValidate>
      <ArgumentFieldList
        fields={fields}
        values={values}
        onChange={change}
        mode="ask"
        problems={problems}
        workspaceId={request.workspaceId}
        autoFocusFirst
        onSubmit={run}
      />
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
 * then runs it with them. Escape, Cancel and the backdrop run nothing.
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
