/**
 * Captcha image generator in plain TypeScript: a small stroke font, random
 * per letter rotation and scale, a wave distortion, noise curves in the same
 * colors as the letters, and a minimal PNG encoder on top of node:zlib.
 * No native modules, so it runs anywhere Bun runs (Pelican, Docker, Windows).
 */
import { randomInt } from 'node:crypto';
import { deflateSync } from 'node:zlib';

/** Letters that are hard to confuse with each other (no O/0, I/1, S/5, B/8, Z/2, G/6). */
const GLYPHS: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
};

export const CAPTCHA_ALPHABET = Object.keys(GLYPHS).join('');
export const CAPTCHA_LENGTH = 6;

const WIDTH = 360;
const HEIGHT = 120;
/** Font cell size in pixels before the random per letter scale. */
const CELL = 8;

type Rgb = [number, number, number];

const BACKGROUND_TOP: Rgb = [24, 26, 43];
const BACKGROUND_BOTTOM: Rgb = [36, 32, 58];
const PALETTE: Rgb[] = [
  [155, 232, 192],
  [139, 197, 255],
  [255, 196, 140],
  [233, 160, 255],
  [255, 236, 150],
  [255, 160, 180],
];

export function randomCaptchaCode(length = CAPTCHA_LENGTH): string {
  let code = '';
  for (let i = 0; i < length; i++) code += CAPTCHA_ALPHABET[randomInt(CAPTCHA_ALPHABET.length)];
  return code;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;

/** Stroke segments of each glyph in cell coordinates: links between neighboring filled cells. */
type Segment = [number, number, number, number];
const STROKES: Record<string, Segment[]> = Object.fromEntries(
  Object.entries(GLYPHS).map(([char, rows]) => {
    const filled = (x: number, y: number) => rows[y]?.[x] === '#';
    const segments: Segment[] = [];
    rows.forEach((row, y) =>
      [...row].forEach((cell, x) => {
        if (cell !== '#') return;
        let linked = false;
        for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]] as const) {
          if (!filled(x + dx, y + dy)) continue;
          // Skip a diagonal when an L shaped path already connects the two cells.
          if (dx !== 0 && dy !== 0 && (filled(x + dx, y) || filled(x, y + dy))) continue;
          segments.push([x + 0.5, y + 0.5, x + dx + 0.5, y + dy + 0.5]);
          linked = true;
        }
        if (!linked) segments.push([x + 0.5, y + 0.5, x + 0.5, y + 0.5]);
      }),
    );
    return [char, segments];
  }),
);

/** Squared distance from a point to a segment. Hot path: no allocations, no Math.hypot. */
function distanceSqToSegment(px: number, py: number, segment: Segment): number {
  const x1 = segment[0];
  const y1 = segment[1];
  const dx = segment[2] - x1;
  const dy = segment[3] - y1;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lengthSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = px - (x1 + t * dx);
  const ey = py - (y1 + t * dy);
  return ex * ex + ey * ey;
}

/** True when the font point (fx, fy), in cells, is inside the glyph's strokes. */
function insideGlyph(segments: Segment[], fx: number, fy: number, thicknessSq: number): boolean {
  if (fx < -1 || fy < -1 || fx > 6 || fy > 8) return false;
  for (let i = 0; i < segments.length; i++) {
    if (distanceSqToSegment(fx, fy, segments[i]!) <= thicknessSq) return true;
  }
  return false;
}

class Canvas {
  readonly pixels = new Uint8Array(WIDTH * HEIGHT * 3);

  constructor() {
    for (let y = 0; y < HEIGHT; y++) {
      const t = y / (HEIGHT - 1);
      for (let x = 0; x < WIDTH; x++) {
        const i = (y * WIDTH + x) * 3;
        for (let c = 0; c < 3; c++) {
          this.pixels[i + c] = Math.round(BACKGROUND_TOP[c]! + (BACKGROUND_BOTTOM[c]! - BACKGROUND_TOP[c]!) * t);
        }
      }
    }
  }

  blend(x: number, y: number, color: Rgb, alpha: number) {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT || alpha <= 0) return;
    const i = (y * WIDTH + x) * 3;
    for (let c = 0; c < 3; c++) {
      this.pixels[i + c] = Math.round(this.pixels[i + c]! * (1 - alpha) + color[c]! * alpha);
    }
  }

  /** Filled, antialiased disc. */
  dot(cx: number, cy: number, radius: number, color: Rgb, alpha = 1) {
    for (let y = Math.floor(cy - radius - 1); y <= Math.ceil(cy + radius + 1); y++) {
      for (let x = Math.floor(cx - radius - 1); x <= Math.ceil(cx + radius + 1); x++) {
        const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        this.blend(x, y, color, alpha * Math.min(1, Math.max(0, radius - distance + 0.5)));
      }
    }
  }
}

function drawGlyph(canvas: Canvas, char: string, centerX: number, centerY: number, color: Rgb) {
  const scale = CELL * rand(0.9, 1.1);
  const thickness = rand(0.38, 0.5);
  const thicknessSq = thickness * thickness;
  const segments = STROKES[char]!;
  const angle = rand(-0.35, 0.35);
  const shear = rand(-0.2, 0.2);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const half = Math.ceil(scale * 5);
  const SAMPLES = [0.25, 0.75];

  for (let py = Math.floor(centerY - half); py <= centerY + half; py++) {
    for (let px = Math.floor(centerX - half); px <= centerX + half; px++) {
      let covered = 0;
      for (const sy of SAMPLES) {
        for (const sx of SAMPLES) {
          // Inverse transform: canvas pixel -> font cell coordinates.
          const dx = px + sx - centerX;
          const dy = py + sy - centerY;
          const rx = (dx * cos + dy * sin) / scale;
          const ry = (-dx * sin + dy * cos) / scale;
          const fx = rx - shear * ry + 2.5;
          const fy = ry + 3.5;
          if (insideGlyph(segments, fx, fy, thicknessSq)) covered++;
        }
      }
      canvas.blend(px, py, color, covered / 4);
    }
  }
}

/** A wobbly line across the image, drawn in a letter color so color filtering does not remove it. */
function drawNoiseCurve(canvas: Canvas, color: Rgb, width: number) {
  const y0 = rand(HEIGHT * 0.2, HEIGHT * 0.8);
  const amplitude = rand(8, 26);
  const period = rand(60, 160);
  const phase = rand(0, Math.PI * 2);
  const slope = rand(-0.15, 0.15);
  for (let x = -5; x <= WIDTH + 5; x += 1.5) {
    canvas.dot(x, y0 + slope * x + amplitude * Math.sin(x / period * Math.PI * 2 + phase), width, color, 0.85);
  }
}

/** Shift rows and columns along sine waves, which breaks the straight baseline OCR relies on. */
function wave(canvas: Canvas): Uint8Array {
  const source = canvas.pixels;
  const out = new Uint8Array(source.length);
  const ax = rand(2, 4);
  const ay = rand(2, 4);
  const px = rand(40, 70);
  const py = rand(50, 90);
  const phase = rand(0, Math.PI * 2);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const sx = Math.min(WIDTH - 1, Math.max(0, Math.round(x + ax * Math.sin(y / py * Math.PI * 2 + phase))));
      const sy = Math.min(HEIGHT - 1, Math.max(0, Math.round(y + ay * Math.sin(x / px * Math.PI * 2))));
      const from = (sy * WIDTH + sx) * 3;
      const to = (y * WIDTH + x) * 3;
      out[to] = source[from]!;
      out[to + 1] = source[from + 1]!;
      out[to + 2] = source[from + 2]!;
    }
  }
  return out;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** Encodes 8 bit RGB pixels as a PNG file. */
export function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filter: none
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // color type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array()),
  ]);
}

/** Renders the code as a PNG image. */
export function renderCaptcha(code: string): Buffer {
  const canvas = new Canvas();

  for (let i = 0; i < 70; i++) canvas.dot(rand(0, WIDTH), rand(0, HEIGHT), rand(0.6, 1.8), pick(PALETTE), rand(0.25, 0.6));
  drawNoiseCurve(canvas, pick(PALETTE), rand(0.8, 1.4));

  const step = (WIDTH - 40) / code.length;
  [...code].forEach((char, index) => {
    if (!GLYPHS[char]) throw new Error(`Captcha cannot draw "${char}"`);
    drawGlyph(canvas, char, 20 + step * (index + 0.5) + rand(-4, 4), HEIGHT / 2 + rand(-10, 10), pick(PALETTE));
  });

  drawNoiseCurve(canvas, pick(PALETTE), rand(1.1, 1.6));
  drawNoiseCurve(canvas, pick(PALETTE), rand(0.8, 1.4));

  return encodePng(WIDTH, HEIGHT, wave(canvas));
}
