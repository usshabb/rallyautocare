'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ActionState } from '@/app/actions/result';
import { ActionForm, Submit } from './ActionForm';

/** Modal dialog with the apex cut. Portalled to <body> so clipped ancestors can't cut it off. */
export function Dialog({ title, children, actions, onClose }: { title: string; children: React.ReactNode; actions?: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!mounted) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button');
    (first ?? ref.current)?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previous?.focus?.();
    };
  }, [mounted]);

  if (!mounted) return null;
  return createPortal(
    <div className="rly-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rly-dialog" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="rly-dialog__body">
          <h2 className="rly-dialog__title">{title}</h2>
          {children}
        </div>
        {actions && <div className="rly-dialog__actions">{actions}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** A button that asks before running a server action — for cancelling and other things that can't be undone. */
export function ConfirmAction({
  action,
  fields,
  label,
  className = 'rly-btn rly-btn--secondary rly-btn--sm',
  title,
  text,
  confirmLabel,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  fields: Record<string, string>;
  label: string;
  className?: string;
  title: string;
  text: string;
  confirmLabel: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <Dialog title={title} onClose={() => setOpen(false)}>
          <p className="rly-dialog__text">{text}</p>
          <ActionForm action={action} onDone={() => setOpen(false)} className="wrap-row" >
            {Object.entries(fields).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <div className="wrap-row" style={{ marginTop: 12, justifyContent: 'flex-end', flexBasis: '100%' }}>
              <button type="button" className="rly-btn rly-btn--ghost rly-btn--sm" onClick={() => setOpen(false)}>
                Keep it
              </button>
              <Submit className="rly-btn rly-btn--dark rly-btn--sm" pending="Working…">
                {confirmLabel}
              </Submit>
            </div>
          </ActionForm>
        </Dialog>
      )}
    </>
  );
}
