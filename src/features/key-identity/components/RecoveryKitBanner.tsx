import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { queryKeys } from "../../../core/query/keys";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import { useCurrentUser } from "../../workspaces/api/useCurrentUser";
import { unsavedRecoveryKit, type RecoveryKitText } from "../api/keyIdentity";
import { RecoveryKitScreen } from "./RecoveryKitScreen";

/**
 * Across the top of the app while this device keeps the signed-in account's recovery kit
 * unconfirmed: "Show recovery kit" opens it, and the bar goes once the person confirms saving
 * it. The kit itself is read only when shown and dropped when closed.
 */
export function RecoveryKitBanner() {
  const { platform, capabilities } = useRuntime();
  const { data: user } = useCurrentUser();
  const principalId = user?.principalId ?? null;
  const unsaved = useQuery({
    queryKey: queryKeys.unsavedRecoveryKit(principalId ?? ""),
    queryFn: async () => principalId !== null && (await unsavedRecoveryKit(principalId)) !== null,
    enabled: capabilities.identityKeys && principalId !== null,
    retry: false,
  });
  const [kit, setKit] = useState<RecoveryKitText | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The kit screen stays open after a confirmation, which takes the bar away, to say so.
  if ((!principalId || !unsaved.data) && !kit) return null;
  const data = platform === "web" ? "this browser's data" : "this device's data";

  async function show(id: string) {
    setError(null);
    try {
      const found = await unsavedRecoveryKit(id);
      if (found) setKit(found);
      else void unsaved.refetch();
    } catch (err) {
      setError(graphqlErrorMessage(err, "Could not read the recovery kit."));
    }
  }

  return (
    <>
      {principalId && unsaved.data && (
        <div
          role="status"
          data-testid="recovery-kit-banner"
          className="flex flex-wrap items-center justify-center gap-2 bg-rim-warm/10 px-3 py-1.5 text-xs text-rim-warm"
        >
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
          <span>
            Save your recovery kit. Losing {data} can permanently remove your ability to manage this
            account.
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void show(principalId)}
          >
            Show recovery kit
          </Button>
          {error && <span role="alert">{error}</span>}
        </div>
      )}
      <Dialog
        open={kit !== null}
        onClose={() => setKit(null)}
        title="Recovery kit"
        maxWidth="max-w-xl"
      >
        {kit && <RecoveryKitScreen kit={kit} onClose={() => setKit(null)} />}
      </Dialog>
    </>
  );
}
