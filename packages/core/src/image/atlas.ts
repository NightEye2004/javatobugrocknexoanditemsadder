import { createImage, type RgbaImage } from "./png.js";
import { timeOp } from "../report/timings.js";

export interface AtlasPlacement {
  /** Pixel offset of this texture's tile in the atlas. */
  x: number;
  y: number;
  /** Original texture size in pixels. */
  width: number;
  height: number;
}

export interface Atlas {
  image: RgbaImage;
  placements: Map<string, AtlasPlacement>;
}

export interface AtlasOptions {
  /** Extrude texture edges this many pixels to prevent linear-filter seams. */
  padding?: number;
}

/**
 * Packs textures into a square-ish grid atlas. Bedrock geometry references a
 * single texture, so multi-texture Java models get their textures stitched and
 * UVs remapped into atlas pixel space.
 *
 * Tiles use the max texture dimensions so grid math stays trivial; smaller
 * textures sit in the top-left of their tile (UVs reference original size).
 */
export function buildAtlas(textures: Map<string, RgbaImage>, options: AtlasOptions = {}): Atlas {
  return timeOp("atlas.build", () => buildAtlasUntimed(textures, options));
}

function buildAtlasUntimed(textures: Map<string, RgbaImage>, options: AtlasOptions): Atlas {
  const ids = [...textures.keys()];
  if (ids.length === 0) throw new Error("atlas needs at least one texture");

  const tileW = Math.max(...[...textures.values()].map((t) => t.width));
  const tileH = Math.max(...[...textures.values()].map((t) => t.height));
  const padding = Math.max(0, Math.floor(options.padding ?? 0));
  const cellW = tileW + padding * 2;
  const cellH = tileH + padding * 2;
  const columns = Math.ceil(Math.sqrt(ids.length));
  const rows = Math.ceil(ids.length / columns);

  const image = createImage(columns * cellW, rows * cellH);
  const placements = new Map<string, AtlasPlacement>();

  ids.forEach((id, index) => {
    const tex = textures.get(id)!;
    const cellX = (index % columns) * cellW;
    const cellY = Math.floor(index / columns) * cellH;
    const x = cellX + padding;
    const y = cellY + padding;
    blit(image, tex, x, y);
    if (padding > 0) extrudeEdgePixels(image, tex, x, y, padding);
    placements.set(id, { x, y, width: tex.width, height: tex.height });
  });

  return { image, placements };
}

function blit(dst: RgbaImage, src: RgbaImage, dx: number, dy: number): void {
  for (let y = 0; y < src.height; y++) {
    const srcRow = y * src.width * 4;
    const dstRow = ((dy + y) * dst.width + dx) * 4;
    dst.data.set(src.data.subarray(srcRow, srcRow + src.width * 4), dstRow);
  }
}

/** Extend each texture's border texels into its gutter for filtered UV sampling. */
function extrudeEdgePixels(dst: RgbaImage, src: RgbaImage, x: number, y: number, padding: number): void {
  for (let row = 0; row < src.height; row++) {
    const left = (row * src.width) * 4;
    const right = (row * src.width + src.width - 1) * 4;
    for (let p = 1; p <= padding; p++) {
      const leftTarget = ((y + row) * dst.width + x - p) * 4;
      const rightTarget = ((y + row) * dst.width + x + src.width - 1 + p) * 4;
      dst.data.set(src.data.subarray(left, left + 4), leftTarget);
      dst.data.set(src.data.subarray(right, right + 4), rightTarget);
    }
  }

  for (let column = -padding; column < src.width + padding; column++) {
    const sourceColumn = Math.max(0, Math.min(src.width - 1, column));
    const topSource = (sourceColumn * 4);
    const bottomSource = ((src.height - 1) * src.width + sourceColumn) * 4;
    for (let p = 1; p <= padding; p++) {
      const topTarget = ((y - p) * dst.width + x + column) * 4;
      const bottomTarget = ((y + src.height - 1 + p) * dst.width + x + column) * 4;
      dst.data.set(src.data.subarray(topSource, topSource + 4), topTarget);
      dst.data.set(src.data.subarray(bottomSource, bottomSource + 4), bottomTarget);
    }
  }
}
