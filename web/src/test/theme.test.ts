// Guards on the design tokens in theme.css. jsdom does not lay anything out, so these read the
// stylesheet itself: the regressions they pin (a monospace money face, a green "live" dot beside red
// losses, gain and loss telling apart by hue alone, .sub unstyled outside rows) are all token-level.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "../theme.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");   // rules, not comments

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const token = (block: string, name: string) => {
  const m = block.match(new RegExp(`--as-${name}:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`--as-${name} not found`);
  return m[1];
};
const light = css.slice(css.indexOf(":root {"), css.indexOf("@media (prefers-color-scheme: dark)"));
const dark = css.slice(css.indexOf(':root[data-theme="dark"] {'));

describe("theme tokens", () => {
  it("money is set in the UI face, never a monospace", () => {
    expect(css).not.toMatch(/Chivo Mono|ui-monospace|monospace/);
    expect(css).toMatch(/--as-font-num:\s*var\(--as-font-ui\)/);
    expect(css).toMatch(/\.num \{[^}]*tabular-nums/);
  });

  it("gain and loss hold 4.5:1 on every ground, and differ in lightness as well as hue", () => {
    for (const [name, block] of [["light", light], ["dark", dark]] as const) {
      const gain = token(block, "gain"), loss = token(block, "loss");
      for (const ground of ["bg", "surface", "hover"]) {
        const g = token(block, ground);
        expect(ratio(gain, g), `${name} gain on ${ground}`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(loss, g), `${name} loss on ${ground}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(ratio(gain, loss), `${name} gain vs loss`).toBeGreaterThanOrEqual(1.4);
    }
  });

  it("form fields have a 3:1 boundary against the surface", () => {
    for (const block of [light, dark]) expect(ratio(token(block, "field-border"), token(block, "surface"))).toBeGreaterThanOrEqual(3);
  });

  it("the session dot: grey closed, green and pulsing live, still under reduced motion", () => {
    const closed = css.match(/\.session-dot \{[^}]*\}/)![0];
    expect(closed).not.toMatch(/--as-gain|--as-loss|animation/);
    const live = css.match(/\.session-dot\.live \{[^}]*\}/)![0];
    expect(live).toMatch(/--as-gain/);
    expect(live).toMatch(/animation: livepulse 2s/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.session-dot\.live \{ animation: none; \}/);
  });

  it(".sub is styled everywhere, not only inside a row", () => {
    expect(css).toMatch(/(^|\n)\.sub \{[^}]*color: var\(--as-muted\)/);
  });
});
