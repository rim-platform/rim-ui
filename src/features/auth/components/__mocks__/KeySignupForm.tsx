/**
 * Stand-in for `KeySignupForm` in the join page tests (it has tests of its own): shows the
 * token, workspace and readiness it got, and finishes the way the real one does, with a server
 * id only for a workspace invite; "refuse key signup" offers the page the server's refusal of
 * an expired token, as a failed signup does.
 */
export function KeySignupForm({
  tokens,
  workspaceId,
  onSuccess,
  onBusyChange,
  ready = true,
  onFailure,
}: {
  tokens: Record<string, string>;
  workspaceId?: string;
  onSuccess: (userId: string, serverId: string | null) => void;
  onBusyChange?: (busy: boolean) => void;
  ready?: boolean;
  onFailure?: (err: unknown) => boolean;
}) {
  return (
    <div data-testid="key-signup">
      <span data-testid="key-signup-tokens">{JSON.stringify(tokens)}</span>
      <span data-testid="key-signup-workspace">{workspaceId ?? ""}</span>
      <span data-testid="key-signup-ready">{String(ready)}</span>
      <button type="button" onClick={() => onBusyChange?.(true)}>
        start key signup
      </button>
      <button
        type="button"
        onClick={() => onSuccess("user-key", tokens.workspaceInviteToken ? "server-key" : null)}
      >
        finish key signup
      </button>
      <button
        type="button"
        onClick={() =>
          onFailure?.({
            response: {
              errors: [{ message: "token has expired", extensions: { code: "EXPIRED_TOKEN" } }],
            },
          })
        }
      >
        refuse key signup
      </button>
    </div>
  );
}
