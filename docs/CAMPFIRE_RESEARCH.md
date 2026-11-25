# Campfire and ItemsAdder-to-Geyser research

## Scope and confidence

This review compares the converter in this repository with publicly documented formats and Campfire's public product listing. Campfire's conversion source and internal pipeline were not available for inspection. Its listing offers source code as a separate paid add-on; this review did not obtain or inspect it. Therefore, claims about Campfire internals are hypotheses only.

The user supplied the ItemsAdder ZIP, Campfire `.mcpack`, and Campfire mapping for inspection. The separate 19.14 MiB → 18.06 MiB claim in the task description does not match these exact files: this source ZIP is 20,067,581 bytes (19.14 MiB), while the supplied Campfire archive is 14,156,811 bytes (13.50 MiB). This pair is now suitable for structural comparison, but its in-game behavior has not been independently tested.

## Verified findings

| Topic | Verified behavior | Source / confidence |
|---|---|---|
| ItemsAdder structure | The generated Java pack stores assets by namespace under `assets/<namespace>/...`; ItemsAdder's editable `contents/` folders group configs, models, textures, and other resources. Item `resource` settings can point to a generated texture or a JSON model. | [ItemsAdder contents guide](https://wiki.itemsadder.com/plugin-usage/beginners/configs-and-resourcepack/), [resource properties](https://wiki.itemsadder.com/adding-content/items/item-properties/resource/). High for the documented layouts; the input archive remains the source of truth for any particular server. |
| Java/Bedrock format difference | Java texture animations use adjacent `.png.mcmeta` files; Bedrock block flipbooks use a consolidated `flipbook_textures.json`. Java model JSON and Bedrock geometry/attachables are separate schemas and need generated output rather than a folder rename. | [Microsoft texture-pack conversion guide](https://learn.microsoft.com/en-us/minecraft/creator/documents/convertingtexturepacks), [animated block texture guide](https://learn.microsoft.com/en-us/minecraft/creator/documents/createanimatedblocktexture?view=minecraft-bedrock-stable). High for the documented formats. |
| Geyser responsibility | Geyser does not convert Java packs or automatically create custom item mappings. A Bedrock pack and mappings must both be configured. Current custom item documentation covers mapping v2, modern Java `item_model` definitions, and legacy custom model data. | [Geyser custom items](https://github.com/GeyserMC/GeyserWebsite/blob/master/wiki/geyser/custom-items.mdx). High for Geyser's documented contract; exact support still depends on the installed Geyser build. |
| Campfire's advertised scope | Its public listing advertises 2D/3D items, armor, shields, blocks, bows, crossbows, fishing rods, animated 2D/3D/block/armor assets, fonts, sounds, automatic 3D icons, Geyser Mappings V2, ItemsAdder and other pack sources. The page is a product listing, not a technical specification. | [Campfire Tools listing](https://builtbybit.com/resources/campfire-tools-converter-java2bedrock.108820/). High that these claims are listed; not independent proof that every feature works for every pack/version. |

## Campfire implementation: evidence versus hypotheses

**Evidence:** The public listing claims broad format coverage and refined model/animation conversion, and describes an optional source-code add-on. No public source repository or implementation details were found in the sources reviewed. The listing does not explain how assets are traversed, how Java frames are scheduled, how geometry is tessellated, or how output size is optimized. The supplied output exposes generated artifacts but not the transformation code.

**Hypotheses, not findings:** Similar outputs could be produced by a custom parser/generator, existing format libraries, or a mix of tools. The large shared atlas suggests cross-model packing may be used, but the archive alone cannot establish the packing algorithm or whether all listed resources are active. The claimed 19.14 → 18.06 MiB measurement does not match the supplied pair and cannot be used as this pair's benchmark.

## Supplied Campfire output inspection

The paired source ZIP contains 7,170 entries (6,325 under `assets/`), 5,418 model JSON files including version overlays, 191 item-definition JSON files, 1,060 PNGs, and 318 `.mcmeta` animation files. These archive counts include version-specific ItemsAdder overlays, so they are not counts of unique runtime models.

The supplied Campfire `.mcpack` is 14,156,811 bytes (13.50 MiB) compressed and 473,360,755 bytes (451.4 MiB) uncompressed, with 5,024 ZIP entries. It has 2,037 model JSON files, 661 attachables, 115 render-controller files, 23 animation files, 4 animation-controller files, 1,979 TGA files, and 2 PNG files. The matching mapping has `format_version: 1`, 703 definitions under 26 Java base-item keys, and no block mappings. Its shape (`name`, `icon`, `custom_model_data`) resembles Geyser's older custom-item format; this is a schema comparison, not confirmation of which Geyser build the user runs. Geyser's current documentation describes v2 and says v1 is deprecated in newer builds.

The output uses nested `.campfire_*` paths and JSON comments/string escaping. After stripping JSON block comments, all 2,843 JSON files parse. This obfuscation is observable; its generation mechanism is not known. The 32-bit uncompressed TGA assets represent an estimated 408,994,208 decoded RGBA bytes (about 390 MiB). Three textures exceed a 2,048-pixel side; the largest is 5,936 × 5,920, is referenced by 123 attachables, and expands to about 134 MiB of RGBA pixels by itself. The archive stores that atlas in about 2.0 MiB. This is evidence that a shared large atlas is used, though the packing algorithm is unknown. Microsoft recommends manually built atlases no larger than 2,048 × 2,048 and notes that texture data loads uncompressed into memory, so the low ZIP size does not establish low Bedrock activation memory or good mobile performance. See [Microsoft's performance guidance](https://learn.microsoft.com/en-us/minecraft/creator/documents/practices/improvingperformanceandresourceusage?view=minecraft-bedrock-stable).

## Existing converter audit

The current application is a TypeScript monorepo with one Java ZIP/VFS parser and an ordered conversion pipeline that emits a Bedrock resource pack plus Geyser mapping v2. It does not need a second converter or a Rust rewrite to follow the Geyser contract.

| Area | Existing behavior | Gap / comparison to public claims |
|---|---|---|
| ItemsAdder inputs | Reads Java `assets/<namespace>` models/textures and item definitions, including legacy custom model data and modern 1.21.4+ item-model definitions. ItemsAdder `contents/` source configs are not required for basic model conversion; matching plugin configs improve base-item/name/equipment mapping hints. | Existing output structure is compatible with the documented ItemsAdder generated-pack layout. Plugin-specific runtime semantics still need configs or explicit hints. |
| 2D and 3D items | Sprite layers are composited into icon PNGs. Cube-element models become Bedrock geometry, attachables, texture atlases, and display-transform animations; missing/unsupported model cases are reported. | The implementation is feature-specific and approximate, not a general Java model renderer. Complex/non-cube formats and renderer extensions remain unsupported. |
| Animations | Animated 3D item textures are split into frames and represented by generated atlas variants and render-controller timelines. Metadata frame grids, ordering, per-frame timing, interpolation approximation, and optional animation disable are handled. Supported vanilla block textures use Bedrock flipbook definitions. | Java item-icon animation is reduced to the first frame; custom entity/attachable animation outside converted 3D items is not converted. Bedrock block flipbooks use a single `ticks_per_frame`, so per-frame Java timing is approximated. This follows the Java/Bedrock schema difference in Microsoft's guidance. |
| Texture and pack optimization | Caps PNG dimensions when requested, re-encodes copied PNGs losslessly, minifies JSON, merges identical generated textures, and offers slow opt-in Zopfli recompression. | Before this task, all custom-namespace PNG passthrough copies were retained even when generated Bedrock JSON never referenced them. This duplicated pixels already baked into item/block atlases or generated icons. |
| Geyser | Emits a Bedrock pack and JSON mappings v2 separately. | Geyser still needs the matching mapping file and pack installed/reloaded on the actual server; a successful archive build is not in-game validation. |

## Improvement implemented in this task

The lossless optimizer now builds a set of string references from emitted Bedrock JSON and omits a copied custom-namespace source PNG only if neither its path with `.png` nor without the extension is referenced. Vanilla-mapped textures and generated `textures/geyser_custom/**` assets are not candidates. Each omission gets an `optimize` / `skipped` report entry containing the original Java path and reason. If any output JSON cannot be parsed, pruning is disabled for that conversion to preserve assets conservatively.

A final `texture-budget` stage now reports the number of output PNGs, estimated decoded RGBA bytes if all are resident, largest dimension, and count above 2,048 px. When any exceed that side length it also emits a live warning with the existing resolution-cap setting as a possible mitigation. This is a size-based estimate, not a promise about actual Bedrock/GPU memory.

This is reachability pruning for the converter's generated output, not a general Java-pack unused-file detector. Asset pixels remain present where supported through generated icons/atlases. It does not remove sounds, models, arbitrary source files, or textures that generated JSON references.

## Benchmark and validation

The paired ItemsAdder input is 20,067,581 bytes (19.14 MiB). The supplied Campfire pack is 14,156,811 bytes (13.50 MiB) compressed and 473,360,755 bytes (451.4 MiB) expanded. The earlier 18.06 MiB output number does not match this exact `.mcpack`.

The current converter was run on this exact input with animations enabled, a 20-frame cap, original texture resolution (`maxTextureResolution: 0`), lossless optimization enabled, and Zopfli disabled. It produced a 120,269,999-byte `.mcpack` (114.67 MiB), 11,877 files / 156,083,714 uncompressed bytes, 7,155 PNGs, and 4,603 JSON files; all emitted JSON files parsed. The output contains an estimated 13,766,193,984 bytes of decoded RGBA texture data if every image is resident (about 12.82 GiB), with 182 PNGs wider or taller than 2,048 px and a maximum side of 6,400 px. This is an upper-bound texture-memory estimate, not measured device memory. This original-resolution output is not suitable for assuming phone activation will succeed; use the existing resolution cap and validate the resulting pack on the target client.

| Metric | Campfire supplied output | Current converter run |
|---|---:|---:|
| Compressed pack | 14,156,811 B (13.50 MiB) | 120,269,999 B (114.67 MiB) |
| Expanded ZIP contents | 473,360,755 B (451.4 MiB) | 156,083,714 B (148.8 MiB) |
| Texture files | 1,979 TGA + 2 PNG | 7,155 PNG |
| Texture dimensions | max 5,936 × 5,920; 3 textures >2,048 | max side 6,400; 182 textures >2,048 |
| Conversion duration | Not exposed by the supplied artifact | 1,139,448 ms (18m 59s) |
| Asset report | Not supplied | 1,327 converted, 1,273 approximated, 3,444 skipped, 1 error |
| Runtime validation | Not performed here | Not performed here |

These are same-source archive measurements but not equivalent feature/settings measurements: Campfire's settings are unknown, while the current converter run retained original dimensions and capped animations at 20 frames. The smaller Campfire ZIP does not mean lower memory: its biggest atlas is about 134 MiB decoded and is referenced by 123 attachables. Conversely, the current converter's many per-model/per-frame PNGs account for a much higher decoded-pixel estimate. Neither pack's actual phone/Geyser performance was tested in this review.

The current run's optimizer removed 994 unreachable custom-namespace passthrough PNGs (9.7 MiB before ZIP compression), merged 160 duplicate generated textures, and minified JSON. It reduced the in-memory uncompressed content from 286,251,676 to 156,083,714 bytes, a measured saving of 124.1 MiB. Its stage took 9.64 seconds. 3D model/animation generation took 1,123.50 seconds; ZIP writing took 1.98 seconds. PNG indexed encoding accounted for 291.3 seconds across 7,318 encodes. The primary runtime bottleneck is 3D/animation generation, not final ZIP writing or lossless optimization.

The sole conversion error is `abyssal_knight:hammer`: its referenced source file `assets/abyssal_knight/textures/item/hammer.png` has a valid PNG signature/chunk CRCs but an IDAT zlib stream that fails decompression (`incorrect data check`). The source asset is malformed; the converter correctly records a per-model error and continues with the rest of the pack. The PNG was not edited.

The previous workspace `E:\Coding\TexturePack converter\generated.zip` and `C:\Users\Velrix\Downloads\pack.mcpack` are different packs and are excluded from this paired benchmark.

To reproduce the real-pack benchmark, set `CONVERTER_BENCH_PACK` to a local ItemsAdder ZIP and run `pnpm --filter @geyser-converter/core exec vitest run test/realPack.bench.test.ts`. The benchmark file skips during ordinary test runs unless that environment variable is set. The optimizer fixture and pipeline regression tests and workspace typecheck pass. JSON parsing and report counts are converter-level validation only; they do not replace Bedrock/Geyser runtime testing. For runtime validation, install the `.mcpack` and matching mapping on a test Geyser server, restart Geyser, and check animated blocks, static/animated item models, fonts, and representative 3D geometry on the target Bedrock client.

## Sources

- ItemsAdder, [Contents Folder](https://wiki.itemsadder.com/plugin-usage/beginners/configs-and-resourcepack/) and [Resource properties](https://wiki.itemsadder.com/adding-content/items/item-properties/resource/).
- Microsoft Learn, [Converting texture packs](https://learn.microsoft.com/en-us/minecraft/creator/documents/convertingtexturepacks) and [Create an animated block texture](https://learn.microsoft.com/en-us/minecraft/creator/documents/createanimatedblocktexture?view=minecraft-bedrock-stable).
- GeyserMC, [Custom items](https://github.com/GeyserMC/GeyserWebsite/blob/master/wiki/geyser/custom-items.mdx).
- Campfire Tools, [public product listing](https://builtbybit.com/resources/campfire-tools-converter-java2bedrock.108820/).
