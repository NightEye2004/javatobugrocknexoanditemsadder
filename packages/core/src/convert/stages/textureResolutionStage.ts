import type { ConversionContext, PipelineStage } from "../context.js";
import { decodePng, encodePng, scaleDownToMax, type RgbaImage } from "../../image/png.js";
import { parseLenientJson } from "../../java/json.js";

interface Dimensions {
  width: number;
  height: number;
}

function unreadableTexturePlaceholder(): Uint8Array {
  const data = new Uint8Array(2 * 2 * 4);
  const colors = [
    [255, 0, 255, 255], [0, 0, 0, 255],
    [0, 0, 0, 255], [255, 0, 255, 255],
  ];
  colors.forEach((color, i) => data.set(color, i * 4));
  return encodePng({ width: 2, height: 2, data });
}

function pngDimensions(bytes: Uint8Array): Dimensions | undefined {
  if (
    bytes.length < 24 ||
    bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47 ||
    bytes[4] !== 0x0d || bytes[5] !== 0x0a || bytes[6] !== 0x1a || bytes[7] !== 0x0a
  ) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function addGeometryTextureReferences(ctx: ConversionContext, byGeometry: Map<string, string>): void {
  for (const path of ctx.bedrock.list({ prefix: "attachables/", suffix: ".json" })) {
    const text = ctx.bedrock.readText(path);
    if (text === undefined) continue;
    const root = record(parseLenientJson(text));
    const description = record(record(root?.["minecraft:attachable"])?.description);
    const geometries = record(description?.geometry);
    const textures = record(description?.textures);
    if (geometries === undefined || textures === undefined) continue;
    for (const [slot, identifier] of Object.entries(geometries)) {
      const texture = textures[slot];
      if (typeof identifier === "string" && typeof texture === "string") {
        byGeometry.set(identifier, `${texture}.png`);
      }
    }
  }
}

function scaleGeometryUvs(rootValue: unknown, resized: Map<string, Dimensions>, byGeometry: Map<string, string>): boolean {
  const root = record(rootValue);
  const geometries = root?.["minecraft:geometry"];
  if (root === undefined || !Array.isArray(geometries)) return false;
  let changed = false;

  for (const geometryValue of geometries) {
    const geometry = record(geometryValue);
    const description = record(geometry?.description);
    const identifier = description?.identifier;
    if (description === undefined || typeof identifier !== "string") continue;

    let texturePath = byGeometry.get(identifier);
    if (texturePath === undefined && identifier.startsWith("geometry.geyser_custom.block_")) {
      const name = identifier.slice("geometry.geyser_custom.block_".length);
      texturePath = `textures/geyser_custom/blocks/${name}.png`;
    }
    const dimensions = texturePath === undefined ? undefined : resized.get(texturePath);
    const oldWidth = description.texture_width;
    const oldHeight = description.texture_height;
    if (
      dimensions === undefined || typeof oldWidth !== "number" || typeof oldHeight !== "number" ||
      oldWidth <= 0 || oldHeight <= 0
    ) continue;

    const scaleX = dimensions.width / oldWidth;
    const scaleY = dimensions.height / oldHeight;
    description.texture_width = dimensions.width;
    description.texture_height = dimensions.height;
    const bones = geometry?.bones;
    if (Array.isArray(bones)) {
      for (const boneValue of bones) {
        const cubes = record(boneValue)?.cubes;
        if (!Array.isArray(cubes)) continue;
        for (const cubeValue of cubes) {
          const faces = record(record(cubeValue)?.uv);
          if (faces === undefined) continue;
          for (const faceValue of Object.values(faces)) {
            const face = record(faceValue);
            const uv = face?.uv;
            const uvSize = face?.uv_size;
            if (Array.isArray(uv) && typeof uv[0] === "number" && typeof uv[1] === "number") {
              uv[0] *= scaleX;
              uv[1] *= scaleY;
            }
            if (Array.isArray(uvSize) && typeof uvSize[0] === "number" && typeof uvSize[1] === "number") {
              uvSize[0] *= scaleX;
              uvSize[1] *= scaleY;
            }
          }
        }
      }
    }
    changed = true;
  }
  return changed;
}

/** Caps all emitted PNG dimensions and updates generated Bedrock geometry UVs to match. */
export const textureResolutionStage: PipelineStage = {
  name: "texture-resolution",
  run(ctx: ConversionContext): void {
    const maxDimension = ctx.options.maxTextureResolution;
    const capEnabled = Number.isSafeInteger(maxDimension) && maxDimension > 0;

    const resized = new Map<string, Dimensions>();
    const pngPaths = ctx.bedrock.list({ suffix: ".png" });
    const replacedUnreadable: string[] = [];
    let count = 0;
    let largestSource = 0;

    if (capEnabled) {
      for (const path of pngPaths) {
        const bytes = ctx.bedrock.read(path)!;
        // Bedrock glyph sheets use the pixel art as the font itself. Shrinking
        // a full glyph page with the item/texture cap makes chat text unreadable.
        // Preserve generated and copied font atlases at their authored size.
        if (path.startsWith("font/") || path.startsWith("textures/font/")) continue;
        const dimensions = pngDimensions(bytes);
        if (dimensions === undefined || Math.max(dimensions.width, dimensions.height) <= maxDimension) continue;
        let image: RgbaImage;
        try {
          image = decodePng(bytes);
        } catch (error) {
          // A user-selected resolution cap promises that oversized source images
          // will not leak through unchanged. Some protected/damaged PNGs have
          // invalid compressed data; keep the output pack loadable and the cap
          // meaningful with an explicit, reported placeholder.
          ctx.bedrock.write(path, unreadableTexturePlaceholder());
          resized.set(path, { width: 2, height: 2 });
          count++;
          replacedUnreadable.push(path);
          largestSource = Math.max(largestSource, dimensions.width, dimensions.height);
          ctx.report.approximated(
            "texture-resolution",
            path,
            `could not decode oversized ${dimensions.width}x${dimensions.height} PNG; replaced with a 2x2 magenta checkerboard to honor the ${maxDimension}px cap (${error instanceof Error ? error.message : String(error)})`,
            [path],
          );
          continue;
        }
        try {
          const scaled = scaleDownToMax(image, maxDimension);
          ctx.bedrock.write(path, encodePng(scaled));
          resized.set(path, { width: scaled.width, height: scaled.height });
          count++;
          largestSource = Math.max(largestSource, dimensions.width, dimensions.height);
        } catch (error) {
          ctx.bedrock.write(path, unreadableTexturePlaceholder());
          resized.set(path, { width: 2, height: 2 });
          count++;
          replacedUnreadable.push(path);
          largestSource = Math.max(largestSource, dimensions.width, dimensions.height);
          ctx.report.approximated(
            "texture-resolution",
            path,
            `could not resize ${dimensions.width}x${dimensions.height} PNG; replaced with a 2x2 magenta checkerboard to honor the ${maxDimension}px cap (${error instanceof Error ? error.message : String(error)})`,
            [path],
          );
        }
        if (count % 25 === 0 || count === pngPaths.length) {
          ctx.progress("texture-resolution", count, pngPaths.length, {
            type: "progress",
            message: `Resized ${count} oversized PNGs; latest: ${path}`,
          });
        }
      }
    }

    if (count > 0) {
      const geometryTextures = new Map<string, string>();
      addGeometryTextureReferences(ctx, geometryTextures);
      let geometriesUpdated = 0;
      for (const path of ctx.bedrock.list({ prefix: "models/", suffix: ".geo.json" })) {
        const text = ctx.bedrock.readText(path);
        if (text === undefined) continue;
        try {
          const geometry = parseLenientJson(text);
          if (scaleGeometryUvs(geometry, resized, geometryTextures)) {
            ctx.bedrock.writeJson(path, geometry);
            geometriesUpdated++;
          }
        } catch {
          ctx.report.approximated("texture-resolution", path, "could not update geometry UVs after texture downscaling");
        }
      }

      ctx.report.approximated(
        "texture-resolution",
        "output PNG textures",
        `${count} image(s) downscaled or replaced to at most ${maxDimension}px on the longest side; largest source dimension was ${largestSource}px; ${geometriesUpdated} geometry UV set(s) updated${replacedUnreadable.length > 0 ? `; ${replacedUnreadable.length} PNG(s) replaced with magenta placeholders because resizing failed` : ""}`,
        [...resized.keys()],
      );
      ctx.progress("texture-resolution", pngPaths.length, pngPaths.length);
    }

  },
};

export const textureBudgetStage: PipelineStage = {
  name: "texture-budget",
  run(ctx: ConversionContext): void {
    reportTextureBudget(ctx);
  },
};

function reportTextureBudget(ctx: ConversionContext): void {
  let textureCount = 0;
  let decodedRgbaBytes = 0;
  let maxSide = 0;
  let over2048 = 0;
  for (const path of ctx.bedrock.list({ suffix: ".png" })) {
    const bytes = ctx.bedrock.read(path)!;
    const dimensions = pngDimensions(bytes);
    if (dimensions === undefined || dimensions.width <= 0 || dimensions.height <= 0) continue;
    textureCount++;
    decodedRgbaBytes += dimensions.width * dimensions.height * 4;
    maxSide = Math.max(maxSide, dimensions.width, dimensions.height);
    if (dimensions.width > 2048 || dimensions.height > 2048) over2048++;
  }
  const decodedMiB = decodedRgbaBytes / (1024 * 1024);
  const detail = `${textureCount} PNG(s); estimated decoded RGBA pixel data ${decodedMiB.toFixed(1)} MiB if all images are resident; largest dimension ${maxSide}px; ${over2048} PNG(s) exceed 2048px on one side. Estimate is not measured client memory.`;
  ctx.report.converted("texture-budget", "output texture budget", [detail]);
  if (over2048 > 0) {
    ctx.progress("texture-budget", 0, 0, {
      type: "warning",
      message: `Texture budget: ${over2048} PNG(s) exceed the 2048px side recommendation; largest is ${maxSide}px. Estimated decoded RGBA data is ${decodedMiB.toFixed(1)} MiB. Consider the texture resolution cap for lower-memory Bedrock clients.`,
    });
  }
}
