import { useId, useState } from "react";

import { Button } from "../../../shared/ui/Button";
import { pickAgentFolder } from "../acp/agentRunner";
import { isFullPath } from "../acp/agentPrograms";

const FIELD_CLASS =
  "w-full min-w-0 flex-1 rounded-lg border border-rim-line bg-rim-void px-3 py-2.5 font-mono text-sm text-rim-text outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40";
const LABEL_CLASS = "mb-1 block text-xs font-medium uppercase tracking-wider text-rim-text-faint";

/** What the field says when the system's folder dialog could not be used. */
const PICK_FAILED = "The folder dialog did not open. Write the folder's full path instead.";

/**
 * A field for the folder an agent works in: its full path, typed, or chosen with Browse… in the
 * system's folder dialog, which opens at the folder written there.
 */
export function AgentFolderField({
  label,
  value,
  onChange,
  hint,
  invalid = false,
  describedBy,
}: {
  label: string;
  value: string;
  /** Hears each change, typed or chosen. */
  onChange: (value: string) => void;
  /** The line under the field. */
  hint: React.ReactNode;
  /** Whether the dialog found the folder unusable. */
  invalid?: boolean;
  /** The id of what says why it is unusable. */
  describedBy?: string;
}) {
  const id = useId();
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);

  const browse = async () => {
    setPicking(true);
    setPickError(null);
    try {
      const written = value.trim();
      const picked = await pickAgentFolder(isFullPath(written) ? written : null);
      if (picked !== null) onChange(picked);
    } catch (error) {
      setPickError(error instanceof Error && error.message !== "" ? error.message : PICK_FAILED);
    } finally {
      setPicking(false);
    }
  };

  return (
    <div>
      <label htmlFor={id} className={LABEL_CLASS}>
        {label}
      </label>
      <div className="flex items-stretch gap-2">
        <input
          id={id}
          type="text"
          value={value}
          onChange={(event) => {
            setPickError(null);
            onChange(event.target.value);
          }}
          placeholder="/home/you/project"
          spellCheck={false}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className={FIELD_CLASS}
        />
        <Button
          type="button"
          variant="secondary"
          isLoading={picking}
          onClick={() => void browse()}
          aria-label={`Browse for the ${label.toLowerCase()}`}
        >
          Browse…
        </Button>
      </div>
      <span className="mt-1 block text-xs text-rim-text-muted">{hint}</span>
      {pickError !== null && (
        <p role="alert" className="mt-1 text-xs text-rim-danger">
          {pickError}
        </p>
      )}
    </div>
  );
}
