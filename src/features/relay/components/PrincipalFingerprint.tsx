import { useEffect, useState } from "react";

import { principalFingerprint } from "../contacts/fingerprint";

/** A principal's fingerprint, to compare with what the person sees on their own device. */
export function PrincipalFingerprint({ principalId }: { principalId: string }) {
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void principalFingerprint(principalId).then((value) => {
      if (current) setFingerprint(value);
    });
    return () => {
      current = false;
    };
  }, [principalId]);
  return (
    <span aria-label="Fingerprint" className="font-mono text-xs tracking-wider text-rim-text-muted">
      {fingerprint ?? "…"}
    </span>
  );
}
