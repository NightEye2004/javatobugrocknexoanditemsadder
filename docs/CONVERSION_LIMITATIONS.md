# Conversion limitations

This converter targets Bedrock resource packs and Geyser Custom Items API v2 mappings. It does not currently emit a standalone behavior pack or make custom identifiers usable without the corresponding Geyser/server mapping setup.

## InteractiveChatDiscordSrvAddon icon overlay

The optional **InteractiveChatDiscordSrvAddon icon pack** output is a Java resource-pack ZIP overlay, not a Bedrock pack. It preserves supported item definitions and predicates, replaces their resolved item model leaves with generated flat `item/generated` models, and includes only the generated icon PNGs rather than source 3D item model files. It is intended for the addon's Java resource-pack loader. Put the ZIP in `plugins/InteractiveChatDiscordSrvAddon/resourcepacks/` and list it above the original pack in `Resources.Order`, since higher entries take precedence. The addon documents Java resource-pack loading and the resourcepacks folder in its [resource-pack guide](https://github.com/LOOHP/InteractiveChat-DiscordSRV-Addon/wiki/Resource-Pack).

Only models that the converter can resolve and render become icons. Unsupported models are recorded as skipped in the conversion report. The addon's renderer/version and the original pack's pack format can affect compatibility; no live addon validation is available from this workspace.

## 3D items

Java item models with `elements` are converted to Bedrock cube geometry, a texture atlas with one-pixel extruded gutters, an attachable, and display-transform animations. Zero-thickness Java elements are inflated by 0.05 geometry units so their faces have renderable depth; these assets are reported as approximated. Models with no textured faces, missing/unresolvable model parents, or the `builtin/entity` parent are skipped or reported as partial according to the conversion report. Non-cube mesh formats and renderer-specific Java extensions are not converted.

The advanced **Selected offhand cosmetics** option accepts comma-separated Java model IDs such as `radiance_collection/wings`. Selected models remain bound to their actual item slot and use their Java third-person offhand transform, which cosmetic models can use to position themselves behind the wearer. Their left-hand X translation is applied without a second mirror so inward offsets move toward the torso. A configurable vertical adjustment (default +12 Bedrock geometry units) raises selected offhand cosmetics. If a model's Java first-person offhand transform has zero scale, the converter falls back to its first-person right-hand transform so it remains visible. A leading `minecraft:` in the ID can be included or omitted. Placement still needs validation on the target Bedrock client.

The Bedrock geometry uses per-face UVs. Face UV rotation requires Bedrock geometry format 1.21.0; other generated geometry uses 1.16.0. See the [Bedrock geometry reference](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/visualreference/geometry.v1.21.0?view=minecraft-bedrock-stable) and [attachables guide](https://learn.microsoft.com/en-us/minecraft/creator/documents/attachables?view=minecraft-bedrock-stable).

## Texture resolution

Advanced option **Maximum texture resolution** caps the longest side of emitted PNGs to the selected value (original, 2048, 1024, 512, 256, or 128 pixels), except font glyph atlases, which remain at their authored dimensions so Bedrock text stays readable. 128 px is the lowest supported cap because smaller presets did not render reliably in the user's Bedrock client. Requests below 128 px are raised to 128 px. Downscaling uses area averaging with alpha preservation, keeps the original aspect ratio, and updates generated item/block geometry texture dimensions and UVs to match resized atlases. If an oversized PNG cannot be decoded, it is replaced in the output with a reported 2×2 magenta checkerboard so an unreadable original does not bypass the selected cap; the Java source pack is not modified. This reduces decoded texture memory; it does not guarantee crash-free activation because pack texture count and other client limits also matter. Microsoft recommends manually created atlases no larger than 2048×2048 and notes that textures load uncompressed into memory: [performance and resource guidance](https://learn.microsoft.com/en-us/minecraft/creator/documents/practices/improvingperformanceandresourceusage?view=minecraft-bedrock-stable).

When lossless optimization is enabled, copied custom-namespace PNGs that are not referenced by any emitted Bedrock JSON are omitted from the output and listed as `skipped` entries under the `optimize` stage. Supported item/block texture pixels are already baked into generated output; explicit Bedrock JSON references keep the passthrough file. If an emitted JSON cannot be parsed during this scan, the converter keeps all such candidate files for that conversion. This does not prune vanilla textures, generated `geyser_custom` assets, sounds, or arbitrary unused source files.

After optimization, the **Texture budget** stage reports the PNG count, estimated decoded RGBA pixel bytes (if all output images are resident), maximum dimension, and count above 2,048 px. It emits a live warning when files exceed 2,048 px and points to the existing **Maximum texture resolution** setting. This is a rough asset-size diagnostic, not a measured Bedrock memory limit; font glyph atlases remain at their authored dimensions for readability and may still exceed a selected cap.

## Animated textures

The advanced **Disable animated textures** option omits Bedrock block flipbook definitions and uses the first frame for animated PNG sheets copied into the pack and baked into 3D item atlases. This reduces duplicated per-frame item atlases and avoids loading texture flipbooks. It does not remove the static display-transform animation files required to position 3D items in Bedrock's attachable contexts. If animation metadata or image data is invalid, the original texture is retained and the conversion report records the limitation.

For Geyser v2 `has_component` predicates, the converter carries the Java component identifier into the mapping. If the source condition omits that identifier, only its false/default branch is emitted and the report marks the condition unsupported; this avoids producing a mapping Geyser rejects.

- 3D item texture sheets are split into frames and baked into atlas images. Attachables select the atlas frames through a render controller.
- When one model uses multiple animated textures, the generated timeline now lasts until every texture has completed a whole cycle. The timeline resolution is based on the greatest common divisor of the textures' frame durations.
- Interpolated Java animation is approximated by baking intermediate frames. A configured frame cap subsamples long timelines and is reported in the conversion report.
- Animated 2D item icons use the first frame because Bedrock item icons do not provide the same Java flipbook behavior.
- Block flipbooks are emitted only for supported vanilla block texture remaps. Per-frame durations cannot be represented by Bedrock's `flipbook_textures.json` entry and are reported as an approximation.
- The 3D item sheet reader supports frame grids using the metadata `width` and `height` fields. Invalid sheet dimensions fall back to the uncut texture with an approximation warning; invalid frame indices are clamped and reported. Non-integer or non-positive frame durations are normalized and reported.
- Entity and attachable textures outside the converted 3D item path do not receive Java `.mcmeta` animation conversion.

The Java frame sheet and `.mcmeta` conventions are summarized in the [Minecraft resource pack reference](https://minecraft.wiki/w/Resource_Pack#Texture_animation). This community reference supplements the official Bedrock output references above.

## Real-pack sample evidence

A user-supplied ItemsAdder pack was processed without extracting or executing its contents. Its `mariposa_requiem:wing_1` model references `_mariposa_requiem:wing_ami`, while the actual PNG is stored under `assets/mariposa_requiem/textures/wing_ami.png`. A one-model subset resolved the guarded leading-underscore namespace alias, emitted the 8-element geometry and six-frame animation, and reported no missing-texture placeholder. Its eight elements all have a zero-size axis; they are inflated and reported as approximated.

The full 6,730-entry ZIP completed conversion with a 20-frame animation cap in 877.3 seconds. The report summary was 1,159 converted, 1,193 approximated, 2,234 skipped, and 0 errors. Output contained 1,015 geometry files, 973 animated-item render controllers, and 5,383 atlas PNGs; the `.mcpack` was 104,577,519 bytes. Peak observed conversion-process memory was approximately 1.25 GB. This verifies that the pipeline completed and emitted files at this scale. It does not verify in-game rendering or explain every skipped/approximated asset; those remain follow-up work.

## Validation boundary

Unit tests verify generated JSON, references, atlas output, and timeline calculations. A passing test suite does not prove that a pack renders correctly in a Bedrock client or on a particular Geyser version. Real-pack and in-game validation remain outstanding for the supported model and animation cases.
