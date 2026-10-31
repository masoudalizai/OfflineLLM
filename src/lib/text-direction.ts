export type TextDirection = "ltr" | "rtl";

const RTL_RANGES = [
  [0x0590, 0x08ff],
  [0xfb1d, 0xfdff],
  [0xfe70, 0xfeff],
] as const;

function isRtlCodePoint(codePoint: number) {
  return RTL_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
}

/** Resolves a message from its first strong directional character. */
export function getTextDirection(text: string): TextDirection {
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    if (isRtlCodePoint(codePoint)) return "rtl";
    if (/\p{L}/u.test(character)) return "ltr";
  }
  return "ltr";
}
