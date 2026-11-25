# Agent tasks

## ANIM-001 — synchronize multiple animated item textures

- **Status:** Complete
- **Objective:** Ensure one 3D item with multiple animated textures loops only after every texture has completed its own cycle.
- **Scope:** `packages/core/src/convert/stages/geometryStage.ts`, `packages/core/test/flipbook.test.ts`, and animation limitations documentation.
- **Implementation:** Use the least common multiple of texture cycle lengths for the shared item timeline; retain the greatest common divisor of frame durations as the timeline unit.
- **Verification:** Added a 4-tick plus 6-tick cycle fixture; the current core test suite and workspace typechecking pass. The supplied real pack completed at full scale with 973 animated-item render controllers and no conversion errors.
- **Limitations:** No Bedrock client validation was available. This pack used a 20-frame cap, and its rendered timing was not checked in-game.

## ANIM-002 — read animation frame grids and report invalid metadata

- **Status:** Complete
- **Objective:** Support `.mcmeta` frame width/height and frame ordering, and report invalid animation metadata instead of silently producing incorrect item textures.
- **Scope:** `packages/core/src/convert/stages/geometryStage.ts`, `packages/core/test/flipbook.test.ts`, and conversion limitations documentation.
- **Implementation:** Split row-major frame grids, honor explicit frame sequences, clamp invalid indices with an approximation report, and normalize invalid timing values with a report.
- **Verification:** Grid-frame output pixel tests and invalid-index report test added; the current core test suite and workspace typechecking pass. The real pack contains 305 animation metadata files; a six-frame item animation was verified in the representative subset.
- **Limitations:** The supplied pack did not use custom frame width/height values; no Bedrock client validation was available.

## ANIM-003 — disable animated texture conversion

- **Status:** Implemented
- **Objective:** Let users omit animated texture behavior and keep only each animated texture's first configured frame.
- **Scope:** Core conversion options, texture/geometry/flipbook stages, web UI, and conversion limitations.
- **Implementation:** Added an advanced setting that crops copied animated PNGs and 3D item atlas sources to their first configured frame and skips Bedrock block flipbook definitions. Existing static display-transform animations remain because they position 3D items in attachable contexts.
- **Verification:** Workspace `pnpm typecheck` and `pnpm build` pass. No Bedrock client activation validation is available yet.
- **Limitations:** It reduces frame-related output but cannot guarantee a fix for the user's activation crash without inspecting the exact converted pack or Bedrock crash details.

## Next

- Add representative real-pack fixtures for rotated cube elements, mixed texture resolutions, animated item sheets, and parent chains.
- Validate generated attachables, geometry, render controllers, and animation timing in a Bedrock client and supported Geyser setup.
- Investigate the 2,234 skipped assets and 1,193 approximations from the supplied sample using detailed report entries; prioritize by user-visible impact.

## GEO-001 — extrude item-atlas borders

- **Status:** Complete
- **Objective:** Reduce neighboring texture colors bleeding across filtered UV boundaries in generated 3D item atlases.
- **Scope:** `packages/core/src/image/atlas.ts`, the 3D geometry stage, and atlas/model tests.
- **Implementation:** Added optional atlas padding with edge-texel extrusion; the item geometry path uses a one-pixel gutter while block atlases keep their previous layout.
- **Verification:** Added gutter pixel-isolation test and updated generated item atlas dimension assertions; all 60 core tests pass, workspace typechecking passes, and `git diff --check` passes.
- **Limitations:** Pixel tests establish atlas layout only; actual in-game filtering still needs Bedrock client validation.

## GEO-002 — preserve zero-thickness Java model elements

- **Status:** Complete
- **Objective:** Keep flat Java geometry panels visible in Bedrock's cube-based geometry output.
- **Scope:** `packages/core/src/bedrock/geometry.ts`, `packages/core/src/convert/stages/geometryStage.ts`, and 3D model tests.
- **Implementation:** A zero-size element axis receives a small 0.05-unit Bedrock cube inflate. The asset report now marks this geometry as approximated, and animation frame subsampling is also marked approximated.
- **Verification:** Added a regression test for a plane element. A one-model subset of the user-supplied ItemsAdder pack emitted an 8-cube model and six-frame render-controller animation with no missing-texture placeholder; its 8 flat elements were reported as approximated.
- **Limitations:** The full pack finished, but the converter emits 997 approximated 3D assets in it; no Bedrock client was available to verify the inflated model's visual appearance.

## PATH-001 — resolve ItemsAdder texture namespace aliases

- **Status:** Complete
- **Objective:** Load texture resources referenced with a leading underscore namespace when the resource pack stores the asset under the unprefixed namespace.
- **Scope:** `packages/core/src/java/javaPack.ts`, `packages/core/test/javaPack.test.ts`, and the 3D item integration tests.
- **Implementation:** Exact namespace paths keep precedence; the parser strips one leading underscore only when the exact asset is absent and the alias exists.
- **Verification:** Added parser and end-to-end atlas pixel tests. A subset of the supplied real pack resolved `_mariposa_requiem:wing_ami` to its unprefixed PNG and emitted six animation frames with no placeholder warning.
- **Limitations:** The full 6,730-entry pack completed in 877.3 seconds with a 20-frame animation cap. It produced a 104,577,519-byte `.mcpack`, 1,015 geometries, 973 animated-item controllers, 5,383 atlas PNGs, and zero conversion errors. Peak observed process memory was approximately 1.25 GB. This establishes pipeline throughput and generated-file counts, but does not establish that Bedrock or Geyser renders the pack correctly.

## UI-LOG-001 — stream conversion activity and diagnostics

- **Status:** Implemented
- **Objective:** Show live pipeline activity, current model/asset progress, and actionable warnings/errors during conversion.
- **Scope:** Core progress/report callbacks, the web worker bridge, and the conversion progress UI.
- **Implementation:** Added optional progress events without changing existing three-argument callback behavior. The UI shows elapsed time, overall stage progress, current activity, and a clearable bounded log containing the latest 500 events.
- **Verification:** Workspace TypeScript checks and production build pass. The browser UI has not yet been manually exercised with a pack after this change.
- **Limitations:** Successful per-asset entries remain in the downloadable final report rather than the live log; the live stream focuses on stage activity, warnings, and errors.

## TEX-001 — cap emitted texture resolution

- **Status:** Implemented
- **Objective:** Let users lower output texture dimensions to reduce Bedrock texture memory use.
- **Scope:** Convert options, advanced web UI, output texture stage, generated geometry UV updates, and conversion limitations documentation.
- **Implementation:** Added original/2048/1024/512/256 longest-side presets. Oversized output PNGs are area-averaged with alpha preservation and aspect ratio retained. Generated item and custom-block geometry texture dimensions and face UVs are rescaled to match.
- **Verification:** Workspace `pnpm typecheck` and `pnpm build` pass. No Bedrock client activation/render validation has been run.
- **Limitations:** Lower resolutions reduce visual detail; texture-handle count and other Bedrock limits remain. Validate the user's wing model in Bedrock after reconversion.

## TEX-002 — add 128 px texture resolution preset

- **Status:** Implemented
- **Objective:** Offer a lower-memory 128 px cap for users whose Bedrock clients still struggle with large textures.
- **Scope:** Advanced resolution selector and conversion limitations documentation.
- **Implementation:** Added a 128 px longest-side preset. The existing generic resize stage downsizes emitted PNGs with alpha preservation and adjusts generated geometry UVs and texture dimensions to match.
- **Verification:** Workspace `pnpm typecheck` and `pnpm build` pass. Build retains the existing Vite warnings about Node `path` and `fs` being externalized in the Zopfli dependency.
- **Limitations:** The lower cap can reduce texture detail significantly and does not guarantee crash-free activation; no Bedrock client validation has been run.

## TEX-003 — add 64/32/16 px texture resolution presets

- **Status:** Superseded; removed because these caps did not render in the user's Bedrock client
- **Objective:** Let users compare very low texture caps on large animated packs.
- **Scope:** Advanced resolution selector and conversion limitations documentation.
- **Implementation:** The presets were initially added, then removed after the user confirmed they did not render. The 128 px cap is now the lowest supported selection, and API requests below 128 are raised to 128.
- **Verification:** See TEX-005.
- **Limitations:** Texture rendering still requires validation on each target Bedrock client.

## TEX-005 — set 128 px as the minimum texture cap

- **Status:** Implemented
- **Objective:** Remove non-rendering 64/32/16 px presets and make 128 px the minimum.
- **Scope:** Resolution selector, conversion option normalization, and texture resolution documentation.
- **Implementation:** Removed the three presets from the UI. Conversion requests below 128 px are normalized to 128 px; original resolution remains available as 0.
- **Verification:** Workspace `pnpm typecheck` and `pnpm build` pass. The build retains existing Vite warnings about Node `path` and `fs` in the Zopfli dependency.
- **Limitations:** No Bedrock client test was run for this code change.

## FONT-001 — preserve font glyph resolution

- **Status:** Implemented
- **Objective:** Keep converted Bedrock text glyphs readable when a low texture cap is selected.
- **Scope:** Texture resolution stage and conversion limitations.
- **Implementation:** Exempt `font/` and `textures/font/` PNGs from the general texture-resolution cap. Those pages encode glyph detail directly, so downscaling them can turn text into blurry dots.
- **Verification:** Workspace `pnpm typecheck` and `pnpm build` pass. The build retains existing Vite warnings about Node `path` and `fs` in the Zopfli dependency.
- **Limitations:** Font glyph atlases may remain larger than the selected texture cap; no Bedrock client retest was run.

## ICDSA-001 — emit icon-only addon resource-pack overlay

- **Status:** Implemented
- **Objective:** Optionally generate a Java resource-pack overlay for InteractiveChatDiscordSrvAddon with item icons and without source 3D item models.
- **Scope:** Core icon-pack builder, conversion options/result, web UI download, API bundle, and conversion limitations.
- **Implementation:** Resolves item model variants, renders geometry models as flat 64 px icons, composites sprite layers, and writes synthetic `item/generated` models. Supported legacy overrides and modern item model leaves are rewritten to those generated models. Source item definitions are retained where rewritten; source 3D item model files are omitted. Output is optional and separate from the regular Geyser `.mcpack`.
- **Verification:** Workspace `pnpm typecheck` and `pnpm build` pass. No addon runtime validation was performed.
- **Limitations:** Unsupported/unresolvable item models are reported as skipped. The output inherits source `pack.mcmeta`; if absent, it uses pack format 34. Custom color provider logic and arbitrary non-model item components are not transformed.

## SRC-001 — select plugin resource-pack source

- **Status:** Implemented
- **Objective:** Distinguish regular Java, Nexo, and ItemsAdder generated resource packs and surface missing plugin item configuration.
- **Scope:** Web source profile selector and worker preflight diagnostics.
- **Implementation:** Added a source selector. Nexo and ItemsAdder profiles warn in the live conversion log when no readable plugin item configs were recognized; plugin config ZIP parsing remains format-flexible and existing regular-pack behavior is preserved.
- **Verification:** Pending workspace typecheck/build.
- **Limitations:** The profile does not synthesize missing server configs. Plugin-generated packs still need their matching server's item config ZIP for accurate base-item mappings.

## UX-001 — clarify the conversion setup flow

- **Status:** Implemented
- **Objective:** Make the pack source, matching plugin configs, and common output settings clear before conversion starts.
- **Scope:** Web app setup screen and resource-pack drop zone.
- **Implementation:** Promoted pack source and plugin config upload into a visible numbered setup flow; plugin sources require a config ZIP before pack selection. Moved animation and texture size to quick settings, added accessible keyboard support for the drop zone, and constrained the file picker to narrow screens.
- **Verification:** Workspace typecheck/build pass; browser preview confirmed the Nexo config-required state and no horizontal overflow at a narrow viewport.
- **Limitations:** No conversion was run during UI verification.

## GYS-001 — emit valid has_component predicates

- **Status:** Implemented
- **Objective:** Prevent Geyser from rejecting item mappings generated from modern item-model conditions.
- **Scope:** Modern item variant extraction and conversion limitations documentation.
- **Implementation:** Forward the component identifier on `has_component` condition predicates. When it is absent, omit that predicate, retain only the default branch, and report the unsupported condition.
- **Verification:** Workspace typecheck and build pass. The production log identified the missing `component` key in emitted predicates.
- **Limitations:** No Bedrock client re-test yet; a fresh conversion and Geyser restart are required to use the fix. Geyser also warned that the previous pack contained thousands of paths over 80 characters, so generated 3D asset filenames now use short deterministic keys while preserving logical identifiers.

## COS-001 — preserve offhand cosmetic placement

- **Status:** Implemented; Bedrock client verification pending
- **Objective:** Preserve the Java pack's offhand cosmetic transform so wings can be positioned behind the wearer for other players.
- **Scope:** Conversion options, web setup, Bedrock geometry/attachable generation, and HTTP API.
- **Implementation:** Added a comma-separated model-ID setting. Selected models remain bound to the real item slot and retain the Java third-person offhand transform, with left-hand X translation applied inward without a second mirror and a configurable vertical raise (default +12 Bedrock units). If the first-person offhand transform has zero scale, the first-person right-hand transform is used as a visible fallback. Other item mappings are unchanged.
- **Verification:** Workspace typecheck/build pass; no Bedrock client validation for the X/Y adjustments yet.
- **Limitations:** Whether the source offhand transform places an item on the back depends on the model's Java display data and Bedrock rendering. Add `radiance_collection/wings` to the setting for the Radiance Wings model.

## TEX-004 — enforce resolution caps for unreadable PNGs

- **Status:** Implemented; Bedrock client verification pending
- **Objective:** Keep oversized PNGs that cannot be decompressed from bypassing a user's selected texture cap.
- **Scope:** Texture-resolution conversion stage and limitations documentation.
- **Implementation:** When an oversized PNG cannot be decoded, replace the output copy with a reported 2×2 magenta checkerboard and update dependent geometry UV metadata. The source pack bytes remain untouched.
- **Verification:** Workspace typecheck/build pass; the user's 64 px report showed 71 source PNG decode failures, including images up to 3584×512.
- **Limitations:** This avoids shipping those unreadable oversized textures, but the full output still contains 27,568 files and is 68 MB compressed; mobile client activation must be retested.

## Next

- Validate texture-resolution downscaling on a representative 3D pack and in a Bedrock client, especially generated atlases and the resulting UV alignment.

## OPT-001 — prune unreachable copied custom textures

- **Status:** Implemented; paired benchmark complete, Bedrock runtime validation pending
- **Objective:** Reduce redundant texture payloads without removing assets referenced by the generated Bedrock pack.
- **Scope:** `packages/core/src/convert/stages/optimizeStage.ts`, optimizer/pipeline regression tests, and conversion limitations/research documentation.
- **Implementation:** The optimizer scans emitted JSON texture references and removes only copied custom-namespace source PNGs whose path is not referenced with or without `.png`. Each omission is traceable to the source Java path in the conversion report. If any emitted JSON cannot be parsed, it skips pruning for that run.
- **Verification:** Full core suite passes (68 passed; the environment-gated real-pack benchmark is skipped in ordinary runs); workspace typecheck/build pass. The paired 7,170-entry ItemsAdder ZIP converted in 18m 59s to a 120,269,999-byte archive. Optimization omitted 994 unreachable copies and reduced uncompressed output content by 124.1 MiB. All 4,603 emitted JSON files parsed.
- **Limitations:** No Bedrock/Geyser runtime validation. The original-resolution benchmark produced 182 PNGs over 2,048 px and one source texture decode error; use a texture cap for lower-memory clients and inspect the reported corrupt asset.

## OPT-002 — report output texture-memory budget

- **Status:** Implemented; Bedrock runtime validation pending
- **Objective:** Surface high texture dimensions and the aggregate decoded-pixel estimate that ZIP size alone conceals.
- **Scope:** `packages/core/src/convert/stages/textureResolutionStage.ts`, pipeline ordering, and optimizer regression tests.
- **Implementation:** Added a final post-optimization stage that scans PNG headers, reports count / estimated RGBA bytes / max dimension / number above 2,048 px, and sends a live warning when any exceed that side length.
- **Verification:** Regression fixture covers the report and progress warning. Full core suite, workspace typecheck, and build pass. The paired real-pack benchmark measured 7,155 PNGs, 182 over 2,048 px, and a 6,400 px maximum with no cap; this is an estimate, not Bedrock runtime memory.
- **Limitations:** Microsoft's 2,048 px guidance is a recommendation, not a universal hard engine limit. Actual residency and activation behavior still require the target Bedrock client.
