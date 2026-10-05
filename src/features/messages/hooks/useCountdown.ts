import { useEffect, useState } from "react";

/** Whole seconds left until `deadline` (a `Date.now()` value), ticking once a second. */
export function useCountdown(deadline: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  const remaining = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;

  useEffect(() => {
    if (!deadline) return;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      if (current >= deadline) clearInterval(timer);
    };
    // Resync at once (the clock may be stale from an earlier countdown), then every second.
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [deadline]);

  return remaining;
}
