import { describe, expect, it } from "vitest";
import { buildAtlas } from "../src/image/atlas.js";
import type { RgbaImage } from "../src/image/png.js";

function solid(width: number, height: number, color: [number, number, number, number]): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(color, i * 4);
  return { width, height, data };
}

function pixel(image: RgbaImage, x: number, y: number): number[] {
  const start = (y * image.width + x) * 4;
  return [...image.data.subarray(start, start + 4)];
}

describe("texture atlas gutters", () => {
  it("extrudes edge texels around each placement without mixing neighbors", () => {
    const atlas = buildAtlas(
      new Map([
        ["red", solid(2, 2, [255, 0, 0, 255])],
        ["blue", solid(2, 2, [0, 0, 255, 255])],
      ]),
      { padding: 1 },
    );
    const red = atlas.placements.get("red")!;
    const blue = atlas.placements.get("blue")!;

    expect(atlas.image.width).toBe(8);
    expect(atlas.image.height).toBe(4);
    expect(pixel(atlas.image, red.x - 1, red.y - 1)).toEqual([255, 0, 0, 255]);
    expect(pixel(atlas.image, red.x + red.width, red.y + red.height)).toEqual([255, 0, 0, 255]);
    expect(pixel(atlas.image, blue.x - 1, blue.y)).toEqual([0, 0, 255, 255]);
  });
});
