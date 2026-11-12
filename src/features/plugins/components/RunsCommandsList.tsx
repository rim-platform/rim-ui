import { showInvisibleCharacters } from "../../agents/runtime/invisibleCharacters";
import { runsCommandNote, useRunsCommandRows } from "./runsCommands";

interface RunsCommandsListProps {
  /** The ids a manifest lists in `runs_commands`. */
  ids: readonly string[];
  /** The ids the person granted; left out where nothing is granted yet, before an install. */
  granted?: readonly string[];
}

/**
 * The built-in and app commands a plugin asks to run, each with its title and category and
 * whether a plugin can run it here, and whether it is granted when `granted` is given. For
 * the views that show a plugin without changing its grants. Nothing when it asks for none.
 */
export function RunsCommandsList({ ids, granted }: RunsCommandsListProps) {
  // The command lists are fetched only for a plugin that asks to run commands.
  return ids.length === 0 ? null : <RunsCommandRows ids={ids} granted={granted} />;
}

function RunsCommandRows({ ids, granted }: RunsCommandsListProps) {
  const rows = useRunsCommandRows(ids);
  return (
    <section className="space-y-1" aria-label="Commands it can run">
      <h4 className="text-xs font-medium text-rim-text">Commands it can run</h4>
      <ul className="space-y-0.5 text-xs">
        {rows.map((row) => {
          const grantable = row.kind === "runs" || row.kind === "asks";
          const isGranted = granted?.includes(row.id) ?? false;
          const note = grantable && granted ? (isGranted ? "Granted" : "Not granted") : null;
          const rule = runsCommandNote(row);
          return (
            <li key={row.id} className="flex items-center justify-between gap-3">
              <span className={grantable ? "text-rim-text" : "text-rim-text-faint"}>
                {showInvisibleCharacters(row.title)}
                {row.category && <span className="ml-1 text-rim-text-faint">· {row.category}</span>}
                {rule && <span className="ml-1 text-rim-text-faint">({rule})</span>}
              </span>
              {note && (
                <span
                  className={
                    isGranted ? "shrink-0 text-rim-success" : "shrink-0 text-rim-text-faint"
                  }
                >
                  {note}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
