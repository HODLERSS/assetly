import { useRef, useState } from "react";
import { isNative } from "../lib/native";

/** The keyboard's Done, for a field whose keypad has none. The decimal pad has no return key and the WebKit
 *  accessory bar is off app-wide (lib/shell.ts), so without this the only way out of the keypad was a tap on
 *  empty space, with Add position under it (r5 native m1). It shows only while the keyboard is up (.kb-open),
 *  docked on the keyboard. Pointer-down keeps the field's focus from moving before the tap lands. */
export function KeyboardDone({ testId = "kb-done" }: { testId?: string }) {
  return (
    <div className="kb-done-bar">
      <button type="button" className="chip" data-testid={testId} onPointerDown={(e) => e.preventDefault()}
        onClick={() => { const el = document.activeElement; if (el instanceof HTMLElement) el.blur(); }}>Done</button>
    </div>
  );
}

// One number input as every form uses it: decimal keypad, the error for THIS field right under it
// (announced, and tied to the input for screen readers), no autocorrect mangling digits, and a Done while the
// keypad is up. Inside a sheet the sheet carries its own Done (Position's lot sheet), so this one stays out.
export function AmountField({ id, label, value, onChange, error, placeholder, autoFocus }: {
  id: string; label: string; value: string; onChange: (v: string) => void;
  error?: string | null; placeholder?: string; autoFocus?: boolean;
}) {
  const errId = `${id}-err`;
  const box = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  // app only: a browser's keyboard brings its own Done (and the WebKit bar), so a second one was noise on the
  // web form ("Cost per share | Done | Use today's price" beside the header's Done; r7 newcomer m8)
  const ownDone = focused && isNative() && !box.current?.closest(".sheet");
  return (
    <div className="field" ref={box}>
      <label htmlFor={id}>{label}</label>
      <input id={id} className="num" inputMode="decimal" enterKeyHint="done" autoComplete="off" autoCorrect="off" spellCheck={false}
        value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        aria-invalid={error ? true : undefined} aria-describedby={error ? errId : undefined} />
      {error && <p className="field-error" id={errId} role="alert">{error}</p>}
      {ownDone && <KeyboardDone />}
    </div>
  );
}

/** An optional date. Empty, WebKit paints today's date in grey ("09/25/2026"), which reads as already filled
 *  (r5 power-user): the empty field says "No date" instead, until it has one. */
export function DateField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="field"><label htmlFor={id}>{label}</label>
      <span className="date-wrap" data-empty={!value || undefined}>
        <input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} />
        {!value && <span className="date-empty" aria-hidden="true">No date</span>}
      </span>
    </div>
  );
}

/** The live echo under the fields ("10 shares × $400.00 = $4,000.00"). */
export function EntryPreview({ text }: { text: string | null }) {
  if (!text) return null;
  return <p className="entry-preview num" data-testid="entry-preview" aria-live="polite">{text}</p>;
}
