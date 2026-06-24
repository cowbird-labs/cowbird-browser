import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// A color control that lives entirely inside the popup DOM. We deliberately avoid
// the native <input type="color">: its OS color-chooser opens in a separate
// window, which blurs and closes the toolbar popup in Firefox. Clicking the
// swatch instead opens an in-page picker (H/S/L sliders) rendered with
// position:fixed so it escapes the surrounding card's overflow clipping while
// remaining anchored to the swatch. A hex field is kept for exact entry.

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const DEFAULT_HSL: Hsl = { h: 217, s: 91, l: 60 }; // ~#3b82f6

export function isHexColor(s: string): boolean {
  return HEX.test(s);
}

interface Hsl {
  h: number; // 0-360
  s: number; // 0-100
  l: number; // 0-100
}

function expand(hex: string): string {
  if (hex.length === 4) return '#' + [...hex.slice(1)].map((c) => c + c).join('');
  return hex;
}

function hexToHsl(hex: string): Hsl {
  const h = expand(hex);
  const r = parseInt(h.slice(1, 3), 16) / 255;
  const g = parseInt(h.slice(3, 5), 16) / 255;
  const b = parseInt(h.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let hue = 0;
  if (d !== 0) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h: Math.round(hue), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToHex({ h, s, l }: Hsl): string {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const hx = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

export function ColorField({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  // The slider state is held separately from `value` so dragging doesn't jitter
  // from repeated hex<->hsl rounding; it's seeded from `value` when the picker opens.
  const [hsl, setHsl] = useState<Hsl>(() => (HEX.test(value) ? hexToHsl(value) : DEFAULT_HSL));
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const swatchRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => setText(value), [value]);

  // Place the picker just under the swatch (flipping above if it would run off
  // the bottom of the popup), in viewport coordinates for position:fixed.
  useLayoutEffect(() => {
    if (!open || !swatchRef.current) return;
    const r = swatchRef.current.getBoundingClientRect();
    const W = 208;
    const H = 150;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - W - 8));
    const top = r.bottom + H + 8 > window.innerHeight ? Math.max(8, r.top - H - 6) : r.bottom + 6;
    setPos({ left, top });
  }, [open]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !swatchRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const valid = isHexColor(text);

  const openPicker = () => {
    if (isHexColor(text)) setHsl(hexToHsl(text));
    setOpen((o) => !o);
  };

  const applyHsl = (patch: Partial<Hsl>) => {
    const next = { ...hsl, ...patch };
    setHsl(next);
    const hex = hslToHex(next);
    setText(hex);
    onChange(hex);
  };

  const onHexInput = (v: string) => {
    setText(v);
    if (isHexColor(v)) {
      setHsl(hexToHsl(v));
      onChange(v);
    }
  };

  return (
    <span className="color-field">
      <button
        ref={swatchRef}
        type="button"
        className="color-preview"
        style={{ background: valid ? text : 'transparent' }}
        title="Choose color"
        aria-label="Choose color"
        onClick={openPicker}
      />
      <input
        className="search color-hex"
        value={text}
        spellCheck={false}
        placeholder="#3b82f6"
        aria-label="Hex color"
        aria-invalid={!valid}
        onChange={(e) => onHexInput(e.target.value)}
      />
      {open && pos && (
        <div ref={popRef} className="color-popover" style={{ left: pos.left, top: pos.top }}>
          <label className="color-slider">
            <span>Hue</span>
            <input
              type="range"
              min={0}
              max={360}
              value={hsl.h}
              className="hue-slider"
              onChange={(e) => applyHsl({ h: Number(e.target.value) })}
            />
          </label>
          <label className="color-slider">
            <span>Saturation</span>
            <input
              type="range"
              min={0}
              max={100}
              value={hsl.s}
              style={{
                background: `linear-gradient(to right, ${hslToHex({ ...hsl, s: 0 })}, ${hslToHex({ ...hsl, s: 100 })})`,
              }}
              onChange={(e) => applyHsl({ s: Number(e.target.value) })}
            />
          </label>
          <label className="color-slider">
            <span>Lightness</span>
            <input
              type="range"
              min={0}
              max={100}
              value={hsl.l}
              style={{
                background: `linear-gradient(to right, #000, ${hslToHex({ ...hsl, l: 50 })}, #fff)`,
              }}
              onChange={(e) => applyHsl({ l: Number(e.target.value) })}
            />
          </label>
        </div>
      )}
    </span>
  );
}
