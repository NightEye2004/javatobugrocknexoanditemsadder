import type { ConversionContext, PipelineStage } from "../context.js";
import { remapVanillaTexture } from "../../data/vanillaTextureMap.js";
import { decodePng, encodePng, crop } from "../../image/png.js";
import { parseLenientJson } from "../../java/json.js";

interface TextureAnimationMeta {
  animation?: {
    width?: number;
    height?: number;
    frames?: (number | { index: number; time?: number })[];
  };
}

function staticTextureBytes(ctx: ConversionContext, path: string, bytes: Uint8Array): Uint8Array {
  if (!ctx.options.disableAnimations) return bytes;
  const metadata = ctx.java.readText(path + ".mcmeta");
  const animation = metadata === undefined
    ? undefined
    : parseLenientJson<TextureAnimationMeta>(metadata)?.animation;
  if (animation === undefined || animation === null || typeof animation !== "object") return bytes;
  ctx.report.approximated("textures", path, "animated texture conversion disabled by user — first frame used");

  try {
    const image = decodePng(bytes);
    const width = animation.width ?? image.width;
    const height = animation.height ?? width;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 ||
        width > image.width || height > image.height || image.width % width !== 0 || image.height % height !== 0) {
      ctx.report.approximated("textures", path, "animation disabled, but invalid frame dimensions prevented cropping — original texture kept");
      return bytes;
    }
    const first = animation.frames?.[0] ?? 0;
    const firstIndex = typeof first === "number" ? first : first !== null ? first.index : undefined;
    const columns = image.width / width;
    const frameCount = columns * (image.height / height);
    const index = Number.isSafeInteger(firstIndex)
      ? Math.max(0, Math.min(frameCount - 1, firstIndex as number))
      : 0;
    const frame = crop(image, (index % columns) * width, Math.floor(index / columns) * height, width, height);
    return encodePng(frame);
  } catch (error) {
    ctx.report.approximated("textures", path, `animation disabled, but texture could not be cropped — original texture kept (${error instanceof Error ? error.message : String(error)})`);
    return bytes;
  }
}

/**
 * Copies vanilla-namespace textures into their Bedrock locations using the
 * remap table. Non-minecraft namespaces are handled by the custom item stages.
 * They are first copied under a namespaced folder for traceability; the final
 * lossless optimizer removes these passthrough copies only when no emitted
 * Bedrock JSON references them (their pixels may already be baked into output).
 */
export const texturesStage: PipelineStage = {
  name: "textures",
  run(ctx: ConversionContext): void {
    const paths = ctx.java.list({ prefix: "assets/", suffix: ".png" });
    let done = 0;
    for (const path of paths) {
      done++;
      if (done % 100 === 0) {
        ctx.progress("textures", done, paths.length, {
          type: "progress",
          message: `Copied ${done}/${paths.length} texture assets; latest: ${path}`,
        });
      }

      if (path.startsWith("assets/minecraft/textures/")) {
        const remap = remapVanillaTexture(path);
        if (remap === undefined) {
          // Composite or special-cased category — a dedicated stage owns it.
          // Only report if no stage will ever pick it up (gui/painting/particle
          // handled later; font intentionally deferred).
          ctx.report.skipped("textures", path, "special category — handled by a dedicated stage or not yet supported");
          continue;
        }
        const data = ctx.java.read(path);
        if (data === undefined) continue;
        const output = staticTextureBytes(ctx, path, data);
        ctx.bedrock.write(remap.outputPath, output);
        if (remap.exact) {
          ctx.report.converted("textures", path, [remap.outputPath]);
        } else {
          ctx.report.approximated(
            "textures",
            path,
            "no explicit rename rule — copied with same filename (correct for most modern textures)",
            [remap.outputPath],
          );
        }
        // Copy the mcmeta alongside so the flipbook stage can find it later.
        continue;
      }

      // Custom-namespace texture: keep it addressable for models/attachables.
      const match = path.match(/^assets\/([^/]+)\/textures\/(.+)$/);
      if (match) {
        const [, ns, rest] = match;
        const out = `textures/${ns}/${rest}`;
        const data = ctx.java.read(path);
        if (data !== undefined) {
          const output = staticTextureBytes(ctx, path, data);
          ctx.bedrock.write(out, output);
          ctx.report.converted("textures", path, [out]);
        }
      }
    }
    ctx.progress("textures", paths.length, paths.length);
  },
};
