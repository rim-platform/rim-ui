import { useEffect } from "react";
import { useCurrentUser } from "../../workspaces/api/useCurrentUser";
import { useUpdateProfileMutation } from "../api/useUpdateProfile";
import { getStatusExpiry, clearStatusExpiry } from "../components/StatusDropdown";

const CHECK_INTERVAL_MS = 60_000;

export function useStatusExpiration() {
  const { data: user } = useCurrentUser();
  const updateProfile = useUpdateProfileMutation();

  useEffect(() => {
    function checkExpiry() {
      const expiresAt = getStatusExpiry();
      if (!expiresAt) return;

      if (new Date(expiresAt).getTime() <= Date.now()) {
        clearStatusExpiry();
        if (user?.statusText) {
          updateProfile.mutate({ statusText: "" });
        }
      }
    }

    checkExpiry();
    const interval = setInterval(checkExpiry, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [user?.statusText]); // eslint-disable-line react-hooks/exhaustive-deps
}
