import { showInvisibleCharacters } from "../../../agents/runtime/invisibleCharacters";
import { useArgIdentity, type IdKind } from "./argIdentity";

interface IdArgRowProps {
  argName: string;
  kind: IdKind;
  id: string;
  /** The workspace the command names, when it names one. */
  workspaceId: string | null;
}

/**
 * One argument holding an id: what it is, its name when the client knows it, else "Unknown", and
 * always the id itself, since two channels or workspaces can share a name.
 */
export function IdArgRow({ argName, kind, id, workspaceId }: IdArgRowProps) {
  const identity = useArgIdentity(kind, id, workspaceId);
  const known = identity.name !== null;
  return (
    <>
      <dt className="break-words text-xs text-rim-text-muted" title={argName}>
        {identity.label}
      </dt>
      <dd className="min-w-0 text-xs" data-testid={`id-arg-${argName}`}>
        <span className={known ? "break-words text-rim-text" : "text-rim-warm"}>
          {identity.name ?? (identity.loading ? "Looking up…" : "Unknown")}
        </span>
        {identity.elsewhere && (
          <span className="break-words text-rim-text-muted"> {identity.elsewhere}</span>
        )}
        <span className="block break-all font-mono text-[10px] text-rim-text-faint">
          {showInvisibleCharacters(id)}
        </span>
      </dd>
    </>
  );
}
