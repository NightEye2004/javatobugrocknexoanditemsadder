import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { encode } from "fast-png";
import { convertPack, readZip } from "../src/index.js";
import { decodePng } from "../src/image/png.js";

function png(width = 16, height = 16, rgba: [number, number, number, number] = [255, 0, 0, 255]): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
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

const SWORD_MODEL = {
  textures: { blade: "custom:item/blade", handle: "custom:item/handle", particle: "custom:item/blade" },
  elements: [
    {
      from: [7, 0, 7],
      to: [9, 16, 9],
      faces: {
        north: { uv: [0, 0, 2, 16], texture: "#blade" },
        south: { uv: [0, 0, 2, 16], texture: "#blade" },
        east: { uv: [2, 0, 4, 16], texture: "#blade" },
        west: { uv: [2, 0, 4, 16], texture: "#blade" },
        up: { uv: [0, 0, 2, 2], texture: "#handle" },
        down: { uv: [0, 0, 2, 2], texture: "#handle" },
      },
      rotation: { origin: [8, 8, 8], axis: "y", angle: 45 },
    },
  ],
  display: {
    thirdperson_righthand: { rotation: [0, 90, 0], translation: [1, 2, 3], scale: [1.5, 1.5, 1.5] },
  },
};

describe("3D custom items", () => {
  it("emits geometry, attachable, animations, atlas and mapping", async () => {
    const zip = fixtureZip({
      "pack.mcmeta": JSON.stringify({ pack: { pack_format: 15 } }),
      "assets/minecraft/models/item/diamond_sword.json": JSON.stringify({
        parent: "minecraft:item/handheld",
        textures: { layer0: "minecraft:item/diamond_sword" },
        overrides: [{ predicate: { custom_model_data: 10 }, model: "custom:item/big_sword" }],
      }),
      "assets/custom/models/item/big_sword.json": JSON.stringify(SWORD_MODEL),
      "assets/custom/textures/item/blade.png": png(16, 16, [200, 20, 20, 255]),
      "assets/custom/textures/item/handle.png": png(16, 16, [90, 60, 20, 255]),
    });

    const result = await convertPack(zip, { packName: "Swords" });
    const out = readZip(result.mcpack);

    const geoPath = findArtifact(out, "models/entity/geyser_custom", "custom_item_big_sword", ".geo.json");
    const attachablePath = findArtifact(out, "attachables/geyser_custom", "custom_item_big_sword", ".json");
    const animationPath = findArtifact(out, "animations/geyser_custom", "custom_item_big_sword", ".animation.json");
    findArtifact(out, "textures/geyser_custom/atlases", "custom_item_big_sword", ".png");

    const geo = JSON.parse(out.readText(geoPath)!);
    const desc = geo["minecraft:geometry"][0].description;
    expect(desc.identifier).toBe("geometry.geyser_custom.custom_item_big_sword");
    // Two 16x16 textures use two columns with a one-pixel extruded gutter per side.
    expect(desc.texture_width).toBe(36);
    expect(desc.texture_height).toBe(18);

    const bones = geo["minecraft:geometry"][0].bones;
    expect(bones.map((b: { name: string }) => b.name)).toEqual([
      "geysercmd",
      "geysercmd_x",
      "geysercmd_y",
      "geysercmd_z",
    ]);
    const cube = bones[3].cubes[0];
    // origin = [8 - to_x, from_y, from_z - 8] = [8-9, 0, 7-8]
    expect(cube.origin).toEqual([-1, 0, -1]);
    expect(cube.size).toEqual([2, 16, 2]);
    // y-axis rotation → [0, -45, 0], pivot [8-8, 8, 8-8]
    expect(cube.rotation).toEqual([0, -45, 0]);
    expect(cube.pivot).toEqual([0, 8, 8 - 8]);

    const anims = JSON.parse(out.readText(animationPath)!);
    const tp = anims.animations["animation.geyser_custom.custom_item_big_sword.thirdperson_main_hand"];
    expect(tp.bones.geysercmd.rotation).toEqual([90, 0, 0]);
    // base [0,13,-3] + [-tx, ty, tz] = [-1, 15, 0]
    expect(tp.bones.geysercmd.position).toEqual([-1, 15, 0]);
    expect(tp.bones.geysercmd_y.rotation).toEqual([0, -90, 0]);
    expect(tp.bones.geysercmd_z.scale).toEqual([1.5, 1.5, 1.5]);

    const attachable = JSON.parse(out.readText(attachablePath)!);
    expect(attachable["minecraft:attachable"].description.identifier).toBe(
      "geyser_custom:custom_item_big_sword",
    );

    const mappings = JSON.parse(result.geyserMappings!);
    const entry = mappings.items["minecraft:diamond_sword"][0];
    expect(entry).toMatchObject({
      type: "legacy",
      custom_model_data: 10,
      bedrock_identifier: "geyser_custom:custom_item_big_sword",
    });
    // icon registered
    expect(entry.bedrock_options.icon).toBe("custom_item_big_sword_icon");
  });

  it("keeps zero-thickness Java panels renderable in Bedrock geometry", async () => {
    const zip = fixtureZip({
      "pack.mcmeta": JSON.stringify({ pack: { pack_format: 15 } }),
      "assets/minecraft/models/item/paper.json": JSON.stringify({
        overrides: [{ predicate: { custom_model_data: 5 }, model: "custom:item/flat_panel" }],
      }),
      "assets/custom/models/item/flat_panel.json": JSON.stringify({
        textures: { panel: "custom:item/panel" },
        elements: [
          {
            from: [8, 0, 0],
            to: [8, 16, 16],
            faces: {
              north: { uv: [0, 0, 16, 16], texture: "#panel" },
              south: { uv: [0, 0, 16, 16], texture: "#panel" },
            },
          },
        ],
      }),
      "assets/custom/textures/item/panel.png": png(16, 16, [120, 80, 40, 255]),
    });

    const result = await convertPack(zip, { packName: "Flat panel" });
    const out = readZip(result.mcpack);
    const geoPath = findArtifact(out, "models/entity/geyser_custom", "custom_item_flat_panel", ".geo.json");
    const geo = JSON.parse(out.readText(geoPath)!);
    const cube = geo["minecraft:geometry"][0].bones[3].cubes[0];
    const entry = result.report.entries.find(
      (candidate) => candidate.stage === "items-3d" && candidate.source === "custom:item/flat_panel",
    );

    expect(cube.size[0]).toBe(0);
    expect(cube.inflate).toBe(0.05);
    expect(entry?.status).toBe("approximated");
    expect(entry?.detail).toContain("zero-thickness");
  });

  it("resolves underscored texture namespace aliases in real item conversion", async () => {
    const zip = fixtureZip({
      "pack.mcmeta": JSON.stringify({ pack: { pack_format: 15 } }),
      "assets/minecraft/models/item/paper.json": JSON.stringify({
        overrides: [{ predicate: { custom_model_data: 6 }, model: "custom:item/aliased_texture" }],
      }),
      "assets/custom/models/item/aliased_texture.json": JSON.stringify({
        textures: { panel: "_custom:item/panel" },
        elements: [
          {
            from: [4, 0, 7],
            to: [12, 16, 9],
            faces: { north: { uv: [0, 0, 16, 16], texture: "#panel" } },
          },
        ],
      }),
      "assets/custom/textures/item/panel.png": png(16, 16, [70, 100, 130, 255]),
    });

    const result = await convertPack(zip, { packName: "Aliased texture" });
    const out = readZip(result.mcpack);
    const atlasPath = findArtifact(out, "textures/geyser_custom/atlases", "custom_item_aliased_texture", ".png");
    const atlas = decodePng(out.read(atlasPath)!);
    const entry = result.report.entries.find(
      (candidate) => candidate.stage === "items-3d" && candidate.source === "custom:item/aliased_texture",
    );

    expect([atlas.data[0], atlas.data[1], atlas.data[2]]).toEqual([70, 100, 130]);
    expect(entry?.detail).toBeUndefined();
    expect(
      result.report.entries.some(
        (candidate) => candidate.stage === "items-3d" && candidate.detail?.includes("magenta placeholder"),
      ),
    ).toBe(false);
  });

  it("reports a PNG with a corrupt deflate checksum against its model", async () => {
    const broken = png(16, 16, [70, 100, 130, 255]);
    const view = new DataView(broken.buffer, broken.byteOffset, broken.byteLength);
    let offset = 8;
    while (offset + 12 <= broken.length) {
      const length = view.getUint32(offset, false);
      const type = new TextDecoder().decode(broken.subarray(offset + 4, offset + 8));
      if (type === "IDAT") {
        // Damage the zlib Adler checksum while keeping the ZIP entry intact.
        const checksumByte = offset + 8 + length - 1;
        broken[checksumByte] = broken[checksumByte]! ^ 1;
        break;
      }
      offset += length + 12;
    }

    const zip = fixtureZip({
      "pack.mcmeta": JSON.stringify({ pack: { pack_format: 15 } }),
      "assets/minecraft/models/item/paper.json": JSON.stringify({
        overrides: [{ predicate: { custom_model_data: 7 }, model: "custom:item/broken_texture" }],
      }),
      "assets/custom/models/item/broken_texture.json": JSON.stringify({
        textures: { body: "custom:item/broken" },
        elements: [
          {
            from: [4, 0, 4],
            to: [12, 16, 12],
            faces: { north: { texture: "#body" } },
          },
        ],
      }),
      "assets/custom/textures/item/broken.png": broken,
    });

    const result = await convertPack(zip, { packName: "Broken texture" });
    expect(result.report.entries.some(
      (entry) => entry.stage === "items-3d" && entry.source === "custom:item/broken_texture" &&
        entry.status === "error" && entry.detail?.includes("decompress"),
    )).toBe(true);
  });
});
