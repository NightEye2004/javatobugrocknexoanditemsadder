import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { encode } from "fast-png";
import { convertPack, readZip } from "../src/index.js";
import { decodePng } from "../src/image/png.js";

/** Vertical strip: N 16x16 frames, each a solid colour. */
function strip(frames: number): Uint8Array {
  const data = new Uint8Array(16 * 16 * frames * 4);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < 16 * 16; i++) {
      data.set([f * 30, 255 - f * 30, 40, 255], (f * 16 * 16 + i) * 4);
    }
  }
  return new Uint8Array(encode({ width: 16, height: 16 * frames, data, channels: 4 }));
}

/** Row-major grid of equal-sized frames, each with a distinct solid color. */
function frameGrid(columns: number, rows: number, frameWidth = 16, frameHeight = 16): Uint8Array {
  const width = columns * frameWidth;
  const height = rows * frameHeight;
  const data = new Uint8Array(width * height * 4);
  for (let frame = 0; frame < columns * rows; frame++) {
    const frameX = (frame % columns) * frameWidth;
    const frameY = Math.floor(frame / columns) * frameHeight;
    const color: [number, number, number, number] = [frame * 40, 255 - frame * 40, 30, 255];
    for (let y = 0; y < frameHeight; y++) {
      for (let x = 0; x < frameWidth; x++) {
        data.set(color, ((frameY + y) * width + frameX + x) * 4);
      }
    }
  }
  return new Uint8Array(encode({ width, height, data, channels: 4 }));
}

function fixtureZip(files: Record<string, Uint8Array | string>): Uint8Array {
  const tree: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    tree[path] = typeof content === "string" ? new TextEncoder().encode(content) : content;
  }
  return zipSync(tree);
}

function findArtifact(
  out: ReturnType<typeof readZip>,
  folder: string,
  stem: string,
  suffix: string,
): string {
  const path = out.list({ prefix: `${folder}/${stem}_`, suffix }).find(
    (candidate) => !/_f\d+\.png$/.test(candidate),
  );
  expect(path).toBeDefined();
  return path!;
}

const MODEL = {
  textures: { body: "custom:item/anim_body" },
  elements: [
    {
      from: [4, 0, 4],
      to: [12, 16, 12],
      faces: {
        north: { uv: [0, 0, 16, 16], texture: "#body" },
        south: { uv: [0, 0, 16, 16], texture: "#body" },
      },
    },
  ],
};

describe("flipbook item animation", () => {
  it("emits per-frame atlases and a time-indexed render controller", async () => {
    const zip = fixtureZip({
      "pack.mcmeta": JSON.stringify({ pack: { pack_format: 15 } }),
      "assets/minecraft/models/item/stick.json": JSON.stringify({
        parent: "minecraft:item/handheld",
        textures: { layer0: "minecraft:item/stick" },
        overrides: [{ predicate: { custom_model_data: 1 }, model: "custom:item/anim_wand" }],
      }),
      "assets/custom/models/item/anim_wand.json": JSON.stringify(MODEL),
      "assets/custom/textures/item/anim_body.png": strip(4),
      "assets/custom/textures/item/anim_body.png.mcmeta": JSON.stringify({ animation: { frametime: 5 } }),
    });

    const result = await convertPack(zip, { packName: "Anim" });
    const out = readZip(result.mcpack);
    const base = findArtifact(out, "textures/geyser_custom/atlases", "custom_item_anim_wand", ".png").replace(/\.png$/, "");
    expect(out.has(base + ".png")).toBe(true);
    expect(out.has(base + "_f1.png")).toBe(true);
    expect(out.has(base + "_f3.png")).toBe(true);
    expect(out.has(base + "_f4.png")).toBe(false); // 4 frames total

    const rc = JSON.parse(
      out.readText(findArtifact(out, "render_controllers/geyser_custom", "custom_item_anim_wand", ".render_controllers.json"))!,
    );
    const controller = rc.render_controllers["controller.render.gc_custom_item_anim_wand"];
    expect(controller.arrays.textures["Array.frames"]).toEqual([
      "Texture.default",
      "Texture.frame1",
      "Texture.frame2",
      "Texture.frame3",
    ]);
    // frametime 5 ticks → 4 fps
    expect(controller.textures[0]).toBe("Array.frames[math.mod(math.floor(q.life_time * 4), 4)]");

    const attachable = JSON.parse(out.readText(findArtifact(out, "attachables/geyser_custom", "custom_item_anim_wand", ".json"))!);
    const desc = attachable["minecraft:attachable"].description;
    expect(desc.render_controllers).toEqual(["controller.render.gc_custom_item_anim_wand"]);
    expect(desc.textures.frame2).toBe(base + "_f2");

    // Report marks it converted with animation info, not approximated.
    const entry = result.report.entries.find(
      (e) => e.stage === "items-3d" && e.source === "custom:item/anim_wand" && e.status === "converted",
    );
    expect(entry).toBeDefined();
    expect(entry!.outputs!.some((o) => o.includes("animated: 4 frames"))).toBe(true);
  });

  it("blends interpolated animations on a 1-tick grid", async () => {
    const zip = fixtureZip({
      "pack.mcmeta": JSON.stringify({ pack: { pack_format: 15 } }),
      "assets/minecraft/models/item/stick.json": JSON.stringify({
        parent: "minecraft:item/handheld",
        textures: { layer0: "minecraft:item/stick" },
        overrides: [{ predicate: { custom_model_data: 1 }, model: "custom:item/lerp_wand" }],
      }),
      "assets/custom/models/item/lerp_wand.json": JSON.stringify({
        textures: { body: "custom:item/lerp_body" },
        elements: MODEL.elements,
      }),
      "assets/custom/textures/item/lerp_body.png": strip(2),
      "assets/custom/textures/item/lerp_body.png.mcmeta": JSON.stringify({
        animation: { frametime: 2, interpolate: true },
      }),
    });

    const result = await convertPack(zip, { packName: "Lerp" });
    // 2 frames × 2 ticks resampled per-tick → 4 timeline frames @ 20 fps.
    const entry = result.report.entries.find(
      (e) => e.stage === "items-3d" && e.source === "custom:item/lerp_wand",
    );
    expect(entry).toBeDefined();
    expect(entry!.outputs!.some((o) => o.includes("animated: 4 frames @ 20.0 fps"))).toBe(true);

    const out = readZip(result.mcpack);
    // Blended intermediates exist; the two halfway blends are identical, so
    // frame 3 dedupes onto frame 1's atlas.
    const base = findArtifact(out, "textures/geyser_custom/atlases", "custom_item_lerp_wand", ".png").replace(/\.png$/, "");
    expect(out.has(base + "_f1.png")).toBe(true);
    expect(out.has(base + "_f2.png")).toBe(true);
    expect(out.has(base + "_f3.png")).toBe(false);
    const attachable = JSON.parse(out.readText(findArtifact(out, "attachables/geyser_custom", "custom_item_lerp_wand", ".json"))!);
    expect(attachable["minecraft:attachable"].description.textures.frame3).toBe(
      base + "_f1",
    );
  });

  it("plays multi-strip items at correct per-texture speeds (no 2x bug)", async () => {
    const zip = fixtureZip({
      "pack.mcmeta": JSON.stringify({ pack: { pack_format: 15 } }),
      "assets/minecraft/models/item/stick.json": JSON.stringify({
        parent: "minecraft:item/handheld",
        textures: { layer0: "minecraft:item/stick" },
        overrides: [{ predicate: { custom_model_data: 1 }, model: "custom:item/dual" }],
      }),
      "assets/custom/models/item/dual.json": JSON.stringify({
        textures: { a: "custom:item/fast", b: "custom:item/slow" },
        elements: [
          {
            from: [4, 0, 4],
            to: [12, 16, 12],
            faces: {
              north: { uv: [0, 0, 16, 16], texture: "#a" },
              south: { uv: [0, 0, 16, 16], texture: "#b" },
            },
          },
        ],
      }),
      // fast: 2 frames @ 1 tick (cycle 2); slow: 2 frames @ 2 ticks (cycle 4)
      "assets/custom/textures/item/fast.png": strip(2),
      "assets/custom/textures/item/fast.png.mcmeta": JSON.stringify({ animation: { frametime: 1 } }),
      "assets/custom/textures/item/slow.png": strip(2),
      "assets/custom/textures/item/slow.png.mcmeta": JSON.stringify({ animation: { frametime: 2 } }),
    });
    const result = await convertPack(zip, { packName: "Dual" });
    const out = readZip(result.mcpack);
    const rc = JSON.parse(
      out.readText(findArtifact(out, "render_controllers/geyser_custom", "custom_item_dual", ".render_controllers.json"))!,
    );
    const controller = rc.render_controllers["controller.render.gc_custom_item_dual"];
    // timeline = longest cycle (4 ticks) on 1-tick grid = 4 slots at 20 fps —
    // NOT the fast texture's rate applied to everything.
    expect(controller.arrays.textures["Array.frames"]).toHaveLength(4);
    expect(controller.textures[0]).toContain("q.life_time * 20");
  });

  it("loops multi-strip items only after every texture completes its cycle", async () => {
    const zip = fixtureZip({
      "pack.mcmeta": JSON.stringify({ pack: { pack_format: 15 } }),
      "assets/minecraft/models/item/stick.json": JSON.stringify({
        parent: "minecraft:item/handheld",
        textures: { layer0: "minecraft:item/stick" },
        overrides: [{ predicate: { custom_model_data: 1 }, model: "custom:item/combined" }],
      }),
      "assets/custom/models/item/combined.json": JSON.stringify({
        textures: { fast: "custom:item/fast", slow: "custom:item/slow" },
        elements: [
          {
            from: [4, 0, 4],
            to: [12, 16, 12],
            faces: {
              north: { uv: [0, 0, 16, 16], texture: "#fast" },
              south: { uv: [0, 0, 16, 16], texture: "#slow" },
            },
          },
        ],
      }),
      "assets/custom/textures/item/fast.png": strip(2),
      "assets/custom/textures/item/fast.png.mcmeta": JSON.stringify({ animation: { frametime: 2 } }),
      "assets/custom/textures/item/slow.png": strip(3),
      "assets/custom/textures/item/slow.png.mcmeta": JSON.stringify({ animation: { frametime: 2 } }),
    });

    const result = await convertPack(zip, { packName: "Combined" });
    const out = readZip(result.mcpack);
    const rc = JSON.parse(
      out.readText(findArtifact(out, "render_controllers/geyser_custom", "custom_item_combined", ".render_controllers.json"))!,
    );
    const controller = rc.render_controllers["controller.render.gc_custom_item_combined"];

    // The two source cycles are 4 and 6 ticks. Their combined 12-tick cycle
    // needs six 2-tick timeline slots to return both textures to frame zero.
    expect(controller.arrays.textures["Array.frames"]).toHaveLength(6);
    expect(controller.textures[0]).toBe("Array.frames[math.mod(math.floor(q.life_time * 10), 6)]");
  });

  it("reads custom frame dimensions and frame order from a grid sheet", async () => {
    const zip = fixtureZip({
      "pack.mcmeta": JSON.stringify({ pack: { pack_format: 15 } }),
      "assets/minecraft/models/item/stick.json": JSON.stringify({
        parent: "minecraft:item/handheld",
        textures: { layer0: "minecraft:item/stick" },
        overrides: [{ predicate: { custom_model_data: 1 }, model: "custom:item/grid_anim" }],
      }),
      "assets/custom/models/item/grid_anim.json": JSON.stringify({
        textures: { body: "custom:item/grid_anim" },
        elements: [
          {
            from: [4, 0, 4],
            to: [12, 16, 12],
            faces: {
              north: { uv: [0, 0, 16, 8], texture: "#body" },
              south: { uv: [0, 0, 16, 8], texture: "#body" },
            },
          },
        ],
      }),
      "assets/custom/textures/item/grid_anim.png": frameGrid(2, 2, 16, 8),
      "assets/custom/textures/item/grid_anim.png.mcmeta": JSON.stringify({
        animation: { width: 16, height: 8, frames: [3, 1] },
      }),
    });

    const out = readZip((await convertPack(zip, { packName: "Grid animation" })).mcpack);
    const base = findArtifact(out, "textures/geyser_custom/atlases", "custom_item_grid_anim", ".png").replace(/\.png$/, "");
    const firstFrame = decodePng(out.read(base + ".png")!);
    const secondFrame = decodePng(out.read(base + "_f1.png")!);

    expect(firstFrame.width).toBe(18);
    expect(firstFrame.height).toBe(10);
    expect([firstFrame.data[0], firstFrame.data[1], firstFrame.data[2]]).toEqual([120, 135, 30]);
    expect([secondFrame.data[0], secondFrame.data[1], secondFrame.data[2]]).toEqual([40, 215, 30]);
  });

  it("reports out-of-range animation indices instead of silently changing them", async () => {
    const zip = fixtureZip({
      "pack.mcmeta": JSON.stringify({ pack: { pack_format: 15 } }),
      "assets/minecraft/models/item/stick.json": JSON.stringify({
        parent: "minecraft:item/handheld",
        textures: { layer0: "minecraft:item/stick" },
        overrides: [{ predicate: { custom_model_data: 1 }, model: "custom:item/invalid_anim" }],
      }),
      "assets/custom/models/item/invalid_anim.json": JSON.stringify({
        ...MODEL,
        textures: { body: "custom:item/invalid_anim" },
      }),
      "assets/custom/textures/item/invalid_anim.png": strip(2),
      "assets/custom/textures/item/invalid_anim.png.mcmeta": JSON.stringify({
        animation: { frames: [0, 9] },
      }),
    });

    const result = await convertPack(zip, { packName: "Invalid animation" });
    expect(
      result.report.entries.some(
        (entry) => entry.stage === "items-3d" && entry.status === "approximated" && entry.detail?.includes("outside 0..1"),
      ),
    ).toBe(true);
  });

  it("honours per-frame time values in mcmeta", async () => {
    const zip = fixtureZip({
      "pack.mcmeta": JSON.stringify({ pack: { pack_format: 15 } }),
      "assets/minecraft/models/item/stick.json": JSON.stringify({
        parent: "minecraft:item/handheld",
        textures: { layer0: "minecraft:item/stick" },
        overrides: [{ predicate: { custom_model_data: 1 }, model: "custom:item/timed" }],
      }),
      "assets/custom/models/item/timed.json": JSON.stringify({
        ...MODEL,
        textures: { body: "custom:item/timed_body" },
      }),
      "assets/custom/textures/item/timed_body.png": strip(2),
      // each frame lasts 2 ticks even though frametime defaults to 1
      "assets/custom/textures/item/timed_body.png.mcmeta": JSON.stringify({
        animation: { frames: [{ index: 0, time: 2 }, { index: 1, time: 2 }] },
      }),
    });
    const result = await convertPack(zip, { packName: "Timed" });
    const out = readZip(result.mcpack);
    const rc = JSON.parse(
      out.readText(findArtifact(out, "render_controllers/geyser_custom", "custom_item_timed", ".render_controllers.json"))!,
    );
    const controller = rc.render_controllers["controller.render.gc_custom_item_timed"];
    // 2 frames × 2 ticks = 4-tick cycle → 10 fps, not 20 (the 2x-speed bug).
    expect(controller.textures[0]).toBe("Array.frames[math.mod(math.floor(q.life_time * 10), 2)]");
  });

  it("keeps full animations by default (no cap)", async () => {
    const zip = fixtureZip({
      "pack.mcmeta": JSON.stringify({ pack: { pack_format: 15 } }),
      "assets/minecraft/models/item/stick.json": JSON.stringify({
        parent: "minecraft:item/handheld",
        textures: { layer0: "minecraft:item/stick" },
        overrides: [{ predicate: { custom_model_data: 1 }, model: "custom:item/full_anim" }],
      }),
      "assets/custom/models/item/full_anim.json": JSON.stringify({
        ...MODEL,
        textures: { body: "custom:item/full_body" },
      }),
      "assets/custom/textures/item/full_body.png": strip(30),
      "assets/custom/textures/item/full_body.png.mcmeta": JSON.stringify({ animation: { frametime: 1 } }),
    });
    const result = await convertPack(zip, { packName: "Full" });
    const out = readZip(result.mcpack);
    expect(out.list({ prefix: "textures/geyser_custom/atlases/" }).length).toBe(30);
    const entry = result.report.entries.find((e) => e.source === "custom:item/full_anim");
    expect(entry!.outputs!.some((o) => o.includes("animated: 30 frames"))).toBe(true);
  });

  it("subsamples very long flipbooks when a frame cap is set", async () => {
    const zip = fixtureZip({
      "pack.mcmeta": JSON.stringify({ pack: { pack_format: 15 } }),
      "assets/minecraft/models/item/stick.json": JSON.stringify({
        parent: "minecraft:item/handheld",
        textures: { layer0: "minecraft:item/stick" },
        overrides: [{ predicate: { custom_model_data: 1 }, model: "custom:item/long_anim" }],
      }),
      "assets/custom/models/item/long_anim.json": JSON.stringify({
        ...MODEL,
        textures: { body: "custom:item/long_body" },
      }),
      "assets/custom/textures/item/long_body.png": strip(60),
      "assets/custom/textures/item/long_body.png.mcmeta": JSON.stringify({ animation: { frametime: 1 } }),
    });
    const result = await convertPack(zip, { packName: "Long", maxAnimationFrames: 20 });
    const out = readZip(result.mcpack);
    const frames = out.list({ prefix: "textures/geyser_custom/atlases/" }).length;
    expect(frames).toBe(20); // capped
    const entry = result.report.entries.find((e) => e.source === "custom:item/long_anim");
    expect(entry?.status).toBe("approximated");
    expect(entry?.detail).toContain("subsampled from 60 to 20 timeline frames");
  });
});
