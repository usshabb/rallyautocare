'use client';

import { useState } from 'react';

/** A link shown in full with a button that copies it — for texting a pay link to a client. */
export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="inline-form" style={{ flexWrap: 'nowrap' }}>
      <input className="rly-input rly-input--sm rly-data" style={{ minWidth: 0, fontSize: 12 }} readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        className="rly-btn rly-btn--secondary rly-btn--sm"
        onClick={async () => {
          await navigator.clipboard.writeText(value).catch(() => undefined);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  );
}
