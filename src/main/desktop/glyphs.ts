/**
 * Small icons of the taskbar (thumbnail toolbar, downloads badge), drawn in code (ADR-048): no image
 * file to ship, crisp at 16 px. Pure: a BGRA bitmap for `nativeImage.createFromBitmap`.
 */

export const GLYPH_SIZE = 16;

type Point = readonly [number, number];
type Segment = readonly [Point, Point];
type Rgb = readonly [number, number, number];

export type GlyphName = "back" | "forward" | "new-tab" | "download";

const STROKES: Record<GlyphName, readonly Segment[]> = {
  back: [
    [[12.5, 8], [3.5, 8]],
    [[3.5, 8], [7.5, 4]],
    [[3.5, 8], [7.5, 12]],
  ],
  forward: [
    [[3.5, 8], [12.5, 8]],
    [[12.5, 8], [8.5, 4]],
    [[12.5, 8], [8.5, 12]],
  ],
  "new-tab": [
    [[8, 3], [8, 13]],
    [[3, 8], [13, 8]],
  ],
  download: [
    [[8, 3.5], [8, 10.5]],
    [[5, 7.5], [8, 10.5]],
    [[11, 7.5], [8, 10.5]],
    [[4.5, 12.5], [11.5, 12.5]],
  ],
};

function distanceToSegment(x: number, y: number, [[ax, ay], [bx, by]]: Segment): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/**
 * The glyph as BGRA pixels (premultiplied, as Windows wants them): `color` strokes, on a `badge`
 * disc when given (the downloads overlay icon).
 */
export function drawGlyph(name: GlyphName, color: Rgb = [255, 255, 255], badge?: Rgb): Buffer {
  const pixels = Buffer.alloc(GLYPH_SIZE * GLYPH_SIZE * 4);
  const half = GLYPH_SIZE / 2;
  for (let y = 0; y < GLYPH_SIZE; y++) {
    for (let x = 0; x < GLYPH_SIZE; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      const disc = badge ? clamp01(half - Math.hypot(cx - half, cy - half) + 0.5) : 0;
      const nearest = Math.min(...STROKES[name].map((segment) => distanceToSegment(cx, cy, segment)));
      const stroke = clamp01(1.4 - nearest);
      const alpha = stroke + disc * (1 - stroke);
      if (alpha <= 0) continue;
      const mix = (channel: number) => Math.round((color[channel] * stroke + (badge?.[channel] ?? 0) * disc * (1 - stroke)));
      const offset = (y * GLYPH_SIZE + x) * 4;
      pixels[offset] = mix(2);
      pixels[offset + 1] = mix(1);
      pixels[offset + 2] = mix(0);
      pixels[offset + 3] = Math.round(alpha * 255);
    }
  }
  return pixels;
}
