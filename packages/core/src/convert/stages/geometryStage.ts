import type { ConversionContext, PendingGeometry, PipelineStage } from "../context.js";
import { buildAtlas } from "../../image/atlas.js";
import { buildGeometry } from "../../bedrock/geometry.js";
import { buildDisplayAnimations } from "../../bedrock/animations.js";
import { buildFlipbookRenderController, buildItemAttachable } from "../../bedrock/attachable.js";
import { parseLenientJson } from "../../java/json.js";
import { alphaBleed, decodePng, encodePng, type RgbaImage } from "../../image/png.js";
import { sha256 } from "@noble/hashes/sha2";
import { renderModelIcon } from "../../image/modelRender.js";
import { defaultUv } from "../../bedrock/geometry.js";
import { buildDefinition, safeName } from "./itemsStage.js";
import { parseResourceLocation } from "../../java/javaPack.js";
import type { JavaElement, JavaFaceName } from "../../java/model.js";
import type { ResolvedModel } from "../../resolve/modelResolver.js";

/** 2x2 magenta placeholder for missing textures (classic "missing texture" look). */
function missingTexture(): RgbaImage {
  const data = new Uint8Array(2 * 2 * 4);
  const px = [
    [255, 0, 255, 255],
    [0, 0, 0, 255],
    [0, 0, 0, 255],
    [255, 0, 255, 255],
  ];
  px.forEach((p, i) => data.set(p, i * 4));
  return { width: 2, height: 2, data };
}

/** Short deterministic filename segment that avoids long-path issues and collisions. */
function compactFileKey(value: string): string {
  const readable = safeName(value).slice(0, 28).replace(/_+$/g, "") || "asset";
  const digest = toHex(sha256(new TextEncoder().encode(value))).slice(0, 12);
  return `${readable}_${digest}`;
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

interface LoadedTexture {
  /** Frame images (single entry for static textures). */
  frames: RgbaImage[];
  /** Java frametime in ticks (1 tick = 1/20 s). */
  frametime: number;
}

interface LoadedTextureCache {
  entries: Map<string, { texture: LoadedTexture; byteSize: number }>;
  byteSize: number;
}

const MAX_DECODED_TEXTURE_CACHE_BYTES = 128 * 1024 * 1024;

interface McmetaAnimation {
  animation?: {
    frametime?: number;
    width?: number;
    height?: number;
    interpolate?: boolean;
    frames?: (number | { index: number; time?: number })[];
  };
}

const ITEM_ATLAS_PADDING_PIXELS = 1;

/** Linear blend of two same-size images (t=0 → a, t=1 → b), as Java's interpolate does. */
function blendImages(a: RgbaImage, b: RgbaImage, t: number): RgbaImage {
  const out = new Uint8Array(a.data.length);
  const bd = b.data.length === a.data.length ? b.data : a.data;
  for (let i = 0; i < a.data.length; i++) {
    out[i] = Math.round(a.data[i]! + (bd[i]! - a.data[i]!) * t);
  }
  return { width: a.width, height: a.height, data: out };
}

function gcd(a: number, b: number): number {
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

/** Smallest number of ticks that completes every animation cycle. */
function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

function cropFrame(image: RgbaImage, index: number, frameWidth: number, frameHeight: number, columns: number): RgbaImage {
  const x = (index % columns) * frameWidth;
  const y = Math.floor(index / columns) * frameHeight;
  if (columns === 1) {
    const start = y * image.width * 4;
    return {
      width: frameWidth,
      height: frameHeight,
      data: image.data.subarray(start, start + frameWidth * frameHeight * 4),
    };
  }
  const data = new Uint8Array(frameWidth * frameHeight * 4);
  for (let row = 0; row < frameHeight; row++) {
    const start = ((y + row) * image.width + x) * 4;
    data.set(image.data.subarray(start, start + frameWidth * 4), row * frameWidth * 4);
  }
  return { width: frameWidth, height: frameHeight, data };
}

function normalizedFrameDuration(
  ctx: ConversionContext,
  textureId: string,
  value: number | undefined,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (Number.isSafeInteger(value) && value > 0) return value;
  ctx.report.approximated(
    "items-3d",
    textureId,
    `invalid animation frame duration ${String(value)} — ${fallback} tick(s) used`,
  );
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : fallback;
}

function cacheLoadedTexture(cache: LoadedTextureCache, textureId: string, texture: LoadedTexture): LoadedTexture {
  const buffers = new Set<ArrayBufferLike>();
  let byteSize = 0;
  for (const frame of texture.frames) {
    const buffer = frame.data.buffer;
    if (buffers.has(buffer)) continue;
    buffers.add(buffer);
    byteSize += buffer.byteLength;
  }
  if (byteSize > MAX_DECODED_TEXTURE_CACHE_BYTES) return texture;

  while (cache.byteSize + byteSize > MAX_DECODED_TEXTURE_CACHE_BYTES) {
    const oldest = cache.entries.entries().next().value as
      | [string, { texture: LoadedTexture; byteSize: number }]
      | undefined;
    if (oldest === undefined) break;
    cache.entries.delete(oldest[0]);
    cache.byteSize -= oldest[1].byteSize;
  }
  cache.entries.set(textureId, { texture, byteSize });
  cache.byteSize += byteSize;
  return texture;
}

/**
 * Load a texture, splitting mcmeta flipbook strips into ordered frames.
 * Per-frame `time` values are honoured by expanding frames on a gcd tick
 * grid, so a frame lasting 2× the base frametime appears twice.
 */
function loadTexture(
  ctx: ConversionContext,
  textureId: string,
  cache: LoadedTextureCache,
): LoadedTexture | undefined {
  const cached = cache.entries.get(textureId);
  if (cached !== undefined) {
    // Refresh insertion order to maintain a small LRU of decoded source data.
    cache.entries.delete(textureId);
    cache.entries.set(textureId, cached);
    return cached.texture;
  }
  const path = ctx.java.assetPath("textures", textureId, ".png");
  const bytes = ctx.java.read(path);
  if (bytes === undefined) return undefined;
  const image = decodePng(bytes);

  const metaText = ctx.java.readText(path + ".mcmeta");
  const meta = metaText !== undefined ? parseLenientJson<McmetaAnimation>(metaText) : undefined;
  const animationValue: unknown = meta?.animation;
  if (animationValue === undefined) {
    return cacheLoadedTexture(cache, textureId, { frames: [image], frametime: 1 });
  }
  if (ctx.options.disableAnimations) {
    if (typeof animationValue !== "object" || animationValue === null) {
      return cacheLoadedTexture(cache, textureId, { frames: [image], frametime: 1 });
    }
    const animation = animationValue as NonNullable<McmetaAnimation["animation"]>;
    const frameWidth = animation.width ?? image.width;
    const frameHeight = animation.height ?? frameWidth;
    if (
      !Number.isSafeInteger(frameWidth) || !Number.isSafeInteger(frameHeight) ||
      frameWidth <= 0 || frameHeight <= 0 || frameWidth > image.width || frameHeight > image.height ||
      image.width % frameWidth !== 0 || image.height % frameHeight !== 0
    ) return cacheLoadedTexture(cache, textureId, { frames: [image], frametime: 1 });
    const columns = image.width / frameWidth;
    const frameList = animation.frames;
    const rawFirst = Array.isArray(frameList) && frameList.length > 0 ? frameList[0] : 0;
    const firstIndex = typeof rawFirst === "number" ? rawFirst : rawFirst?.index;
    const count = columns * (image.height / frameHeight);
    const index = Number.isSafeInteger(firstIndex) ? Math.max(0, Math.min(count - 1, firstIndex!)) : 0;
    return cacheLoadedTexture(cache, textureId, {
      frames: [cropFrame(image, index, frameWidth, frameHeight, columns)],
      frametime: 1,
    });
  }
  if (typeof animationValue !== "object" || animationValue === null) {
    ctx.report.approximated("items-3d", textureId, "invalid animation metadata — static texture used");
    return cacheLoadedTexture(cache, textureId, { frames: [image], frametime: 1 });
  }

  const animation = animationValue as NonNullable<McmetaAnimation["animation"]>;
  const frameWidth = animation.width ?? image.width;
  const frameHeight = animation.height ?? frameWidth;
  if (
    !Number.isSafeInteger(frameWidth) ||
    !Number.isSafeInteger(frameHeight) ||
    frameWidth <= 0 ||
    frameHeight <= 0 ||
    frameWidth > image.width ||
    frameHeight > image.height ||
    image.width % frameWidth !== 0 ||
    image.height % frameHeight !== 0
  ) {
    ctx.report.approximated(
      "items-3d",
      textureId,
      `animation frame dimensions ${frameWidth}x${frameHeight} do not tile the ${image.width}x${image.height} sheet — static texture used`,
    );
    return cacheLoadedTexture(cache, textureId, { frames: [image], frametime: 1 });
  }

  const columns = image.width / frameWidth;
  const rows = image.height / frameHeight;
  const sheet: RgbaImage[] = [];
  for (let i = 0; i < columns * rows; i++) {
    sheet.push(cropFrame(image, i, frameWidth, frameHeight, columns));
  }

  const baseTime = normalizedFrameDuration(ctx, textureId, animation.frametime, 1);
  const rawFramesValue: unknown = animation.frames;
  const rawFrames = Array.isArray(rawFramesValue)
    ? (rawFramesValue as NonNullable<McmetaAnimation["animation"]>["frames"])
    : undefined;
  if (rawFramesValue !== undefined && rawFrames === undefined) {
    ctx.report.approximated("items-3d", textureId, "invalid animation frame list — every sheet frame used");
  }
  if (rawFrames !== undefined && rawFrames.length === 0) {
    ctx.report.approximated("items-3d", textureId, "empty animation frame list — every sheet frame used");
  }
  const frameSequence = rawFrames === undefined || rawFrames.length === 0 ? sheet.map((_, i) => i) : rawFrames;
  const entries = frameSequence.map((frame) => {
    const indexValue = typeof frame === "number" ? frame : frame !== null ? frame.index : undefined;
    let index: number;
    if (!Number.isSafeInteger(indexValue)) {
      ctx.report.approximated("items-3d", textureId, `invalid animation frame index ${String(indexValue)} — frame 0 used`);
      index = 0;
    } else {
      index = Math.max(0, Math.min(sheet.length - 1, indexValue as number));
      if (index !== indexValue) {
        ctx.report.approximated(
          "items-3d",
          textureId,
          `animation frame index ${indexValue} is outside 0..${sheet.length - 1} — frame ${index} used`,
        );
      }
    }
    const timeValue = typeof frame === "object" && frame !== null ? frame.time : undefined;
    return { index, ticks: normalizedFrameDuration(ctx, textureId, timeValue, baseTime) };
  });

  // Interpolated animation: Java cross-fades between frames every tick, so
  // resample the whole cycle on a 1-tick grid with per-tick blends. (Frame
  // dedupe + the frame-cap option keep pack size in check.)
  if (animation.interpolate === true) {
    const frames: RgbaImage[] = [];
    for (let i = 0; i < entries.length; i++) {
      const cur = sheet[entries[i]!.index]!;
      const next = sheet[entries[(i + 1) % entries.length]!.index]!;
      for (let s = 0; s < entries[i]!.ticks; s++) {
        const t = s / entries[i]!.ticks;
        frames.push(t === 0 ? cur : blendImages(cur, next, t));
      }
    }
    return cacheLoadedTexture(cache, textureId, { frames, frametime: 1 });
  }

  // Uniform tick grid: gcd of all durations; repeat frames to their length.
  const unit = entries.reduce((acc, e) => gcd(acc, e.ticks), entries[0]!.ticks);
  const frames: RgbaImage[] = [];
  for (const e of entries) {
    const img = sheet[e.index]!;
    for (let r = 0; r < e.ticks / unit; r++) frames.push(img);
  }
  return cacheLoadedTexture(cache, textureId, { frames, frametime: unit });
}

/**
 * Converts 3D item models collected by the items stage into Bedrock
 * geometry + attachable + animation trios, and registers Geyser mappings.
 */
export const geometryStage: PipelineStage = {
  name: "items-3d",
  run(ctx: ConversionContext): void {
    // Group variants by model so shared models produce one geometry/attachable.
    const byModel = new Map<string, PendingGeometry[]>();
    for (const pending of ctx.pendingGeometry) {
      const list = byModel.get(pending.variant.model) ?? [];
      list.push(pending);
      byModel.set(pending.variant.model, list);
    }
    ctx.pendingGeometry.length = 0;

    // Content-hash cache for atlas PNGs: items sharing texture sets (bow_0/1/2
    // charge variants) and repeated animation frames reuse one file.
    const atlasCache = new Map<string, string>();
    const textureCache: LoadedTextureCache = { entries: new Map(), byteSize: 0 };

    let done = 0;
    for (const [modelId, group] of byModel) {
      done++;
      ctx.progress("items-3d", done, byModel.size, {
        type: "progress",
        message: `Converting model ${modelId} (${done}/${byModel.size})`,
      });
      try {
        convertModel(ctx, modelId, group, atlasCache, textureCache);
      } catch (err) {
        ctx.report.error("items-3d", modelId, err instanceof Error ? err.message : String(err));
      }
    }
  },
};

function convertModel(
  ctx: ConversionContext,
  modelId: string,
  group: PendingGeometry[],
  atlasCache: Map<string, string>,
  textureCache: LoadedTextureCache,
): void {
  const resolved = group[0]!.resolved;
  const elements = resolved.elements ?? [];
  const name = safeName(modelId);
  const backMounted = isBackMountedModel(ctx, modelId, group);
  // Keep generated file paths short enough for Bedrock clients that reject
  // deeply nested/long pack paths. Logical geometry and animation identifiers
  // continue using `name`; only filesystem segments use this stable key.
  const fileKey = compactFileKey(modelId);

  // 1. Collect the distinct textures used by element faces.
  const textureIds = new Set<string>();
  for (const element of elements) {
    for (const face of Object.values(element.faces ?? {})) {
      const id = resolveFaceTexture(resolved.textures, face.texture);
      if (id !== undefined) textureIds.add(id);
    }
  }
  if (textureIds.size === 0) {
    ctx.report.skipped("items-3d", modelId, "3D model has no textured faces");
    return;
  }

  // 2. Load textures (magenta placeholder for missing ones), splitting
  // mcmeta flipbook strips into frames.
  const loaded = new Map<string, LoadedTexture>();
  for (const id of textureIds) {
    const tex = loadTexture(ctx, id, textureCache);
    if (tex === undefined) {
      ctx.report.approximated("items-3d", modelId, `texture ${id} missing — magenta placeholder used`);
      loaded.set(id, { frames: [missingTexture()], frametime: 1 });
    } else {
      loaded.set(id, tex);
    }
  }

  // 3. Flipbook timeline: Bedrock attachables have no native texture
  // animation, so we bake one atlas per timeline frame and cycle them with a
  // render controller (time-indexed texture array). Static models get one atlas.
  // Tick-accurate timeline: textures may have different frametimes and frame
  // counts (multi-strip items). Use the gcd of frame durations as the time
  // unit, and the least common multiple of all cycle lengths as the timeline
  // duration. A longest-cycle duration would restart before shorter cycles
  // return to their first frame, causing a visible jump at the loop boundary.
  const animated = [...loaded.values()].filter((t) => t.frames.length > 1);
  const unit = animated.length > 0 ? animated.map((t) => t.frametime).reduce(gcd) : 1;
  const cycleTicks = animated.map((t) => t.frames.length * t.frametime);
  const durationTicks = Math.max(1, cycleTicks.reduce(lcm, 1));
  const fullSlots = Math.ceil(durationTicks / unit);
  // 0 = unlimited: keep the full animation (default).
  const frameCap = ctx.options.maxAnimationFrames > 0 ? ctx.options.maxAnimationFrames : fullSlots;
  const timelineFrames = Math.min(fullSlots, frameCap);
  const maxSourceFrames = fullSlots; // for the subsample report note
  // fps for the render controller; compensates when the timeline is subsampled.
  const fps = (timelineFrames * 20) / durationTicks;

  const framePaths: string[] = [];
  let atlas!: ReturnType<typeof buildAtlas>;
  for (let f = 0; f < timelineFrames; f++) {
    // Real time (ticks) this timeline slot represents.
    const ticks = (f * durationTicks) / timelineFrames;
    // Same insertion order every frame → identical atlas placements.
    const frameImages = new Map<string, RgbaImage>();
    for (const [id, tex] of loaded) {
      const idx = Math.floor(ticks / tex.frametime) % tex.frames.length;
      frameImages.set(id, tex.frames[idx]!);
    }
    const frameAtlas = buildAtlas(frameImages, { padding: ITEM_ATLAS_PADDING_PIXELS });
    alphaBleed(frameAtlas.image);
    if (f === 0) atlas = frameAtlas;

    // Dedup on the raw pixels *before* encoding: consecutive timeline slots
    // often resolve to the same source frames (finer grid than frametime), and
    // encoding dominates conversion time — skip re-encoding identical atlases.
    const hash = toHex(sha256(frameAtlas.image.data));
    const cached = atlasCache.get(hash);
    if (cached !== undefined) {
      framePaths.push(cached);
    } else {
      const path =
        f === 0 ? `textures/geyser_custom/atlases/${fileKey}` : `textures/geyser_custom/atlases/${fileKey}_f${f}`;
      ctx.bedrock.write(path + ".png", encodePng(frameAtlas.image));
      atlasCache.set(hash, path);
      framePaths.push(path);
    }
  }
  const atlasPath = framePaths[0]!;
  const images = new Map<string, RgbaImage>([...loaded].map(([id, t]) => [id, t.frames[0]!]));

  // 4. Geometry.
  const geometryId = `geometry.geyser_custom.${name}`;
  const faceTexture = (element: JavaElement, faceName: JavaFaceName) => {
    const face = element.faces?.[faceName];
    if (face === undefined) return undefined;
    const id = resolveFaceTexture(resolved.textures, face.texture);
    return id !== undefined ? atlas.placements.get(id) : undefined;
  };
  const geo = buildGeometry(geometryId, elements, faceTexture, {
    width: atlas.image.width,
    height: atlas.image.height,
  });
  ctx.bedrock.writeJson(`models/entity/geyser_custom/${fileKey}.geo.json`, geo.geometry);

  // 5. Display-transform animations. Back cosmetics (HMCCosmetics backpacks —
  // armor-stand head items) get a head lift: Bedrock renders those lower than Java.
  const backpacks = ctx.options.backpackItems;
  const isBackpack =
    backpacks.length > 0 &&
    group.some(({ variant }) => {
      const keys = [
        ...(variant.source.kind === "modern"
          ? [parseResourceLocation(variant.source.itemModelId).path.toLowerCase()]
          : []),
        parseResourceLocation(variant.model).path.split("/").pop()!.toLowerCase(),
        ...(variant.baseItem !== undefined && cmdOf(variant) !== undefined
          ? [ctx.options.cmdItemKeys[`${variant.baseItem}|${cmdOf(variant)}`] ?? ""]
          : []),
      ];
      return keys.some((k) => k !== "" && backpacks.includes(k));
    });
  const anims = buildDisplayAnimations(name, resolved.display, {
    ...(isBackpack ? { headLift: 12 } : {}),
    ...(backMounted
      ? { offhandCosmetic: true, offhandYOffset: ctx.options.offhandCosmeticYOffset }
      : {}),
  });
  ctx.bedrock.writeJson(`animations/geyser_custom/${fileKey}.animation.json`, anims.file);
  if (isBackpack) {
    ctx.report.approximated(
      "items-3d",
      modelId,
      "back cosmetic (HMCCosmetics backpack): head position lifted +12 units to compensate Bedrock armor-stand rendering — report over/under-shoot for tuning",
    );
  }

  // 6. Flipbook render controller when animated (shared by all attachables).
  let renderController: string | undefined;
  let extraTextures: Record<string, string> | undefined;
  if (timelineFrames > 1) {
    renderController = `controller.render.gc_${name}`;
    extraTextures = {};
    const shortnames = ["default"];
    for (let f = 1; f < timelineFrames; f++) {
      extraTextures[`frame${f}`] = framePaths[f]!;
      shortnames.push(`frame${f}`);
    }
    ctx.bedrock.writeJson(
      `render_controllers/geyser_custom/${fileKey}.render_controllers.json`,
      buildFlipbookRenderController({ id: renderController, frameShortnames: shortnames, fps }),
    );
  }

  // 7. Icon: sprites.json override → isometric software render of the model.
  const iconKey = pickIcon(ctx, modelId, name, resolved, images);

  // 8. Register a mapping entry per variant, and an attachable per unique
  // bedrock identifier (definitions may get item-model based identifiers, so
  // one shared model can back several bedrock items).
  const attachableIds = new Set<string>();
  for (const { variant } of group) {
    const definition = buildDefinition(ctx, variant, { icon: iconKey, displayHandheld: false });
    ctx.definitionTextures.set(definition, [...textureIds]);
    const identifier = definition.bedrock_identifier!;
    if (attachableIds.has(identifier)) continue;
    attachableIds.add(identifier);
    ctx.bedrock.writeJson(
      `attachables/geyser_custom/${compactFileKey(identifier.split(":")[1] ?? identifier)}.json`,
      buildItemAttachable({
        identifier,
        material: ctx.options.attachableMaterial,
        texture: atlasPath,
        geometry: geometryId,
        animations: anims.refs,
        extraTextures,
        renderController,
      }),
    );
  }

  const outputs = [
    atlasPath + ".png",
    `models/entity/geyser_custom/${fileKey}.geo.json`,
    `animations/geyser_custom/${fileKey}.animation.json`,
    ...[...attachableIds].map((id) => `attachables/geyser_custom/${compactFileKey(id.split(":")[1] ?? id)}.json`),
  ];
  const approximations: string[] = [];
  if (backMounted) {
    approximations.push(`uses the Java offhand display transform in third person with a ${ctx.options.offhandCosmeticYOffset}-unit upward adjustment so the model can position itself behind the wearer; if the source hides it in first person, a visible hand fallback is used`);
  }
  if (ctx.options.disableAnimations && [...loaded.values()].some((texture) => texture.frames.length > 1) === false &&
      textureIds.size > 0 && [...textureIds].some((id) => ctx.java.has(ctx.java.assetPath("textures", id, ".png") + ".mcmeta"))) {
    approximations.push("animated texture disabled by user setting — first frame used");
  }
  const degenerateElements = elements.filter((element) =>
    element.from.some((coordinate, axis) => coordinate === element.to[axis]),
  ).length;
  if (degenerateElements > 0) {
    approximations.push(
      `${degenerateElements} zero-thickness element(s) inflated by 0.05 geometry units so Bedrock can render the faces`,
    );
  }
  if (geo.usedUvRotation) {
    approximations.push("face UV rotation requires a Bedrock 1.21+ client");
  }
  if (timelineFrames < maxSourceFrames) {
    approximations.push(`animation subsampled from ${maxSourceFrames} to ${timelineFrames} timeline frames`);
  }
  const animationOutput =
    timelineFrames > 1 ? `animated: ${timelineFrames} frames @ ${fps.toFixed(1)} fps via render controller` : undefined;
  if (animationOutput !== undefined) outputs.push(animationOutput);
  if (approximations.length > 0) {
    ctx.report.approximated("items-3d", modelId, approximations.join("; "), outputs);
  } else {
    ctx.report.converted("items-3d", modelId, outputs);
  }
}

function isBackMountedModel(ctx: ConversionContext, modelId: string, group: PendingGeometry[]): boolean {
  const selected = new Set(ctx.options.backMountedItems.map(normalizeBackMountSelector));
  if (selected.size === 0) return false;
  const candidates = new Set<string>([
    normalizeBackMountSelector(modelId),
    normalizeBackMountSelector(parseResourceLocation(modelId).path),
  ]);
  for (const { variant } of group) {
    candidates.add(normalizeBackMountSelector(variant.model));
    candidates.add(normalizeBackMountSelector(parseResourceLocation(variant.model).path));
    if (variant.source.kind === "modern") {
      candidates.add(normalizeBackMountSelector(variant.source.itemModelId));
      candidates.add(normalizeBackMountSelector(parseResourceLocation(variant.source.itemModelId).path));
    }
    if (variant.baseItem !== undefined && cmdOf(variant) !== undefined) {
      const key = ctx.options.cmdItemKeys[`${variant.baseItem}|${cmdOf(variant)}`];
      if (key !== undefined) candidates.add(normalizeBackMountSelector(key));
    }
  }
  return [...candidates].some((candidate) => selected.has(candidate));
}

function normalizeBackMountSelector(value: string): string {
  return value.trim().toLowerCase().replace(/^minecraft:/, "").replace(/^models?\//, "").replace(/\.json$/, "");
}

/** custom_model_data value of a variant (legacy field or modern range_dispatch predicate). */
function cmdOf(variant: PendingGeometry["variant"]): number | undefined {
  if (variant.source.kind === "legacy") return variant.source.customModelData;
  const p = variant.predicates.find(
    (p) => p.type === "range_dispatch" && p.property === "custom_model_data",
  );
  return p !== undefined && "threshold" in p ? p.threshold : undefined;
}

function resolveFaceTexture(textures: Record<string, string>, ref: string): string | undefined {
  let value = ref;
  const seen = new Set<string>();
  while (value.startsWith("#")) {
    const key = value.slice(1);
    if (seen.has(key)) return undefined;
    seen.add(key);
    const next = textures[key];
    if (next === undefined) return undefined;
    value = next;
  }
  return value;
}

function pickIcon(
  ctx: ConversionContext,
  modelId: string,
  name: string,
  resolved: ResolvedModel,
  images: Map<string, RgbaImage>,
): string {
  const iconKey = `${name}_icon`;
  if (ctx.itemTextures.has(iconKey)) return iconKey;
  const path = `textures/geyser_custom/icons/${compactFileKey(modelId)}`;

  // Optional pack-provided icon overrides: sprites.json at pack root mapping
  // model id → texture resource location (same convention as java2bedrock).
  const sprites = ctx.java.readJson<Record<string, string>>("sprites.json");
  const override = sprites?.[modelId];
  let image: RgbaImage | undefined;
  if (override !== undefined) {
    const bytes = ctx.java.read(ctx.java.assetPath("textures", override, ".png"));
    image = bytes !== undefined ? decodePng(bytes) : undefined;
  }

  if (image === undefined) {
    // Render the model itself to an isometric icon.
    image = renderModelIcon(
      resolved.elements ?? [],
      (element, faceName) => {
        const face = element.faces?.[faceName];
        if (face === undefined) return undefined;
        const id = resolveFaceTexture(resolved.textures, face.texture);
        const tex = id !== undefined ? images.get(id) : undefined;
        if (tex === undefined) return undefined;
        return { image: tex, uv: face.uv ?? defaultUv(faceName, element.from, element.to) };
      },
      resolved.display["gui"],
    );
  }

  alphaBleed(image);
  ctx.bedrock.write(path + ".png", encodePng(image));
  ctx.itemTextures.set(iconKey, { textures: path });
  return iconKey;
}
