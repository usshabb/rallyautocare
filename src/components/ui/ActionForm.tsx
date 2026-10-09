'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import type { ActionState } from '@/app/actions/result';

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** A form bound to a server action. Shows the action's error message and can reset or notify on success. */
export function ActionForm({
  action,
  children,
  className,
  onDone,
  reset,
  saved,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  onDone?: () => void;
  reset?: boolean;
  /** Message shown after a successful save, for forms that otherwise look unchanged. */
  saved?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (!state.ok) return;
    if (reset) ref.current?.reset();
    done.current?.();
  }, [state, reset]);

  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {state.error && (
        <p className="error" role="alert" style={{ flexBasis: '100%' }}>
          {state.error}
        </p>
      )}
      {state.ok && saved && (
        <p className="note" role="status" style={{ flexBasis: '100%' }}>
          {saved}
        </p>
      )}
    </form>
  );
}

export function Submit({ children, className = 'rly-btn rly-btn--dark rly-btn--sm', pending: pendingLabel }: { children: React.ReactNode; className?: string; pending?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
