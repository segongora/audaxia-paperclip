const NORMALIZE_HEX_RE_3 = /^[0-9a-fA-F]{3}$/;
const NORMALIZE_HEX_RE_6 = /^[0-9a-fA-F]{6}$/;

function normalizeHexColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const hex = value.startsWith("#") ? value.slice(1) : value;
  if (NORMALIZE_HEX_RE_3.test(hex)) {
    return `#${hex.split("").map((char) => `${char}${char}`).join("").toLowerCase()}`;
  }
  if (NORMALIZE_HEX_RE_6.test(hex)) {
    return `#${hex.toLowerCase()}`;
  }
  return null;
}

export function hexToRgb(color: string): { r: number; g: number; b: number } {
  const normalized = normalizeHexColor(color) ?? "#000000";
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function relativeLuminanceChannel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(r: number, g: number, b: number): number {
  return (
    0.2126 * relativeLuminanceChannel(r) +
    0.7152 * relativeLuminanceChannel(g) +
    0.0722 * relativeLuminanceChannel(b)
  );
}

function pickTextColor(luminance: number): string {
  const whiteContrast = 1.05 / (luminance + 0.05);
  const blackContrast = (luminance + 0.05) / 0.05;
  return whiteContrast >= blackContrast ? "#f8fafc" : "#111827";
}

/**
 * Pick a readable text color for a pill/badge that uses `color` as its
 * background at `opacity` blended over white.
 */
export function pickTextColorForPillBg(color: string, opacity = 1): string {
  const { r, g, b } = hexToRgb(color);
  // Blend with white (255, 255, 255) at the given opacity
  const br = Math.round(r * opacity + 255 * (1 - opacity));
  const bg = Math.round(g * opacity + 255 * (1 - opacity));
  const bb = Math.round(b * opacity + 255 * (1 - opacity));
  return pickTextColor(relativeLuminance(br, bg, bb));
}

/**
 * Pick a readable text color for a solid (fully opaque) background.
 * Returns undefined when `color` is null/undefined/invalid.
 */
export function pickTextColorForSolidBg(color: string | null | undefined): string | undefined {
  if (!color) return undefined;
  const normalized = normalizeHexColor(color);
  if (!normalized) return undefined;
  const { r, g, b } = hexToRgb(normalized);
  return pickTextColor(relativeLuminance(r, g, b));
}
