// STEP 7: live updates. The server pushes "something changed"; we bump a counter,
// and every list/detail that depends on it re-fetches. No page refresh needed.
import { useEffect, useRef, useState } from 'react';

export function useLive(token: string | null): number {
  const [tick, setTick] = useState(0);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!token) return;
    const source = new EventSource(`/api/live?token=${encodeURIComponent(token)}`);
    source.onmessage = () => {
      // Many events can arrive together (60 certificates); refresh at most every 400 ms.
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setTick((t) => t + 1), 400);
    };
    return () => {
      window.clearTimeout(timer.current);
      source.close();
    };
  }, [token]);

  return tick;
}
