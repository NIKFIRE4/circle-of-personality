"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Guards an async action (a form submit, typically) against re-entrancy.
 * `pending` state alone cannot prevent a fast double click/double-submit:
 * the disabled-button re-render always lands a tick after the second click
 * already fired, so two "create" requests can land before either resolves.
 * The ref is checked synchronously, before any state update, so the second
 * call is dropped instead of creating a duplicate record.
 */
export function useSubmitGuard() {
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);

  const guard = useCallback((task: () => Promise<void>) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    void task().finally(() => {
      pendingRef.current = false;
      setPending(false);
    });
  }, []);

  return { pending, guard };
}
