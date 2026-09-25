// One number input as every form uses it: decimal keypad, the error for THIS field right under it
// (announced, and tied to the input for screen readers), and no autocorrect mangling digits.
export function AmountField({ id, label, value, onChange, error, placeholder, autoFocus }: {
  id: string; label: string; value: string; onChange: (v: string) => void;
  error?: string | null; placeholder?: string; autoFocus?: boolean;
}) {
  const errId = `${id}-err`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="num" inputMode="decimal" enterKeyHint="done" autoComplete="off" autoCorrect="off" spellCheck={false}
        value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus}
        aria-invalid={error ? true : undefined} aria-describedby={error ? errId : undefined} />
      {error && <p className="field-error" id={errId} role="alert">{error}</p>}
    </div>
  );
}

/** The live echo under the fields ("10 shares × $400.00 = $4,000.00"). */
export function EntryPreview({ text }: { text: string | null }) {
  if (!text) return null;
  return <p className="entry-preview num" data-testid="entry-preview" aria-live="polite">{text}</p>;
}
