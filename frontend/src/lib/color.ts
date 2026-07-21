const DARK_INK = "#2C2520";
const LIGHT_INK = "#FFFFFF";

type Rgb = [number, number, number];

function parseHex(color: string): Rgb | null {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return null;
  return [0, 2, 4].map((offset) => parseInt(match[1].slice(offset, offset + 2), 16)) as Rgb;
}

function toHex(rgb: Rgb): string {
  return `#${rgb
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

function luminance(rgb: Rgb): number {
  const linear = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Preserve a scenario color's identity while making it safe for normal-size
 * text on a white or parchment card. Decorative fills should keep using the
 * original color; this helper is specifically for text and icon ink.
 */
export function readableInk(color: string, minimumRatio = 5.7): string {
  const source = parseHex(color);
  const background = parseHex(LIGHT_INK)!;
  const target = parseHex(DARK_INK)!;
  if (!source) return "var(--text-secondary)";
  if (contrastRatio(source, background) >= minimumRatio) return color;

  for (let step = 1; step <= 20; step += 1) {
    const amount = step / 20;
    const mixed = source.map((channel, index) => (
      channel + (target[index] - channel) * amount
    )) as Rgb;
    if (contrastRatio(mixed, background) >= minimumRatio) return toHex(mixed);
  }
  return DARK_INK;
}

/** Pick readable dark/light text without changing a branded background. */
export function textOnColor(background: string): string {
  const rgb = parseHex(background);
  if (!rgb) return DARK_INK;
  const dark = parseHex(DARK_INK)!;
  const light = parseHex(LIGHT_INK)!;
  return contrastRatio(dark, rgb) >= contrastRatio(light, rgb) ? DARK_INK : LIGHT_INK;
}
