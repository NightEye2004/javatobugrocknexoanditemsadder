import type { JavaDisplayContext, JavaDisplayTransform } from "../java/model.js";
import { BONE_ROOT, BONE_X, BONE_Y, BONE_Z } from "./geometry.js";

/**
 * Converts Java display transforms into static Bedrock attachable animations.
 * Base offsets per slot replicate how Bedrock positions held/worn items so the
 * Java display values can be layered on top (constants from java2bedrock.sh).
 */

type Vec3 = [number, number, number];

interface SlotSpec {
  animationKey: string;
  javaContext: JavaDisplayContext;
  baseRotation: Vec3;
  basePosition: Vec3;
  baseScale: number;
  /** Head-slot values are shrunk by the skull render scale. */
  valueScale: number;
}

const SLOTS: SlotSpec[] = [
  {
    animationKey: "thirdperson_main_hand",
    javaContext: "thirdperson_righthand",
    baseRotation: [90, 0, 0],
    basePosition: [0, 13, -3],
    baseScale: 1,
    valueScale: 1,
  },
  {
    animationKey: "thirdperson_off_hand",
    javaContext: "thirdperson_lefthand",
    baseRotation: [90, 0, 0],
    basePosition: [0, 13, -3],
    baseScale: 1,
    valueScale: 1,
  },
  {
    animationKey: "firstperson_main_hand",
    javaContext: "firstperson_righthand",
    baseRotation: [90, 60, -40],
    basePosition: [4, 10, 4],
    baseScale: 1.5,
    valueScale: 1,
  },
  {
    animationKey: "firstperson_off_hand",
    javaContext: "firstperson_lefthand",
    baseRotation: [90, 60, -40],
    basePosition: [4, 10, 4],
    baseScale: 1.5,
    valueScale: 1,
  },
  {
    animationKey: "head",
    javaContext: "head",
    baseRotation: [0, 0, 0],
    basePosition: [0, 19.5, 0],
    baseScale: 0.625,
    valueScale: 0.625,
  },
];

export interface BuiltAnimations {
  /** animations file content (animations/<name>.animation.json). */
  file: object;
  /** animation key → full animation identifier, for the attachable. */
  refs: Record<string, string>;
}

export function buildDisplayAnimations(
  name: string,
  display: Partial<Record<JavaDisplayContext, JavaDisplayTransform>>,
  options?: {
    /**
     * Extra Y offset (geometry units, 16 = one block) added to the head-slot
     * base position. Bedrock renders armor-stand head items (HMCCosmetics
     * backpacks/wings) lower than Java; +12 ≈ the observed gap.
     */
    headLift?: number;
    /** Keep a first-person offhand cosmetic visible if the Java pack hides it. */
    offhandCosmetic?: boolean;
    /** Raise selected third-person offhand cosmetics (Bedrock geometry units). */
    offhandYOffset?: number;
  },
): BuiltAnimations {
  const animations: Record<string, object> = {};
  const refs: Record<string, string> = {};

  for (const slot of SLOTS) {
    const transformSlot = slot;
    const id = `animation.geyser_custom.${name}.${slot.animationKey}`;
    refs[slot.animationKey] = id;

    let effectiveJavaContext = transformSlot.javaContext;
    let java = display[effectiveJavaContext] ?? fallbackContext(display, effectiveJavaContext);
    if (display[effectiveJavaContext] === undefined && effectiveJavaContext.endsWith("lefthand")) {
      effectiveJavaContext = effectiveJavaContext.replace("lefthand", "righthand") as JavaDisplayContext;
    }
    // Some back cosmetics explicitly hide in Java first-person by setting a
    // zero-scale left-hand transform. Bedrock still needs a visible first-
    // person fallback because the back/head mount is not rendered there.
    if (
      options?.offhandCosmetic === true && slot.animationKey === "firstperson_off_hand" &&
      java?.scale?.every((value) => value === 0)
    ) {
      const rightHand = display.firstperson_righthand;
      if (rightHand?.scale?.some((value) => value !== 0)) {
        java = rightHand;
        effectiveJavaContext = "firstperson_righthand";
      } else {
        java = { ...java, scale: [1, 1, 1] };
      }
    }
    const rotation: Vec3 = java?.rotation ?? [0, 0, 0];
    const translation: Vec3 = java?.translation ?? [0, 0, 0];
    const scale: Vec3 = java?.scale ?? [1, 1, 1];
    const vs = transformSlot.valueScale;
    // Java's left-hand X translation already points inward toward the torso.
    // Unlike main-hand X, it must not be mirrored again for selected back
    // cosmetics, or the model moves farther away from the body.
    const mirrorTranslationX = !(
      options?.offhandCosmetic === true && effectiveJavaContext.endsWith("lefthand")
    );

    const lift = transformSlot.animationKey === "head" ? (options?.headLift ?? 0) : 0;
    const bones: Record<string, object> = {
      [BONE_ROOT]: {
        rotation: slot.baseRotation,
        position: [
          transformSlot.basePosition[0] + (mirrorTranslationX ? -translation[0] : translation[0]) * vs,
          transformSlot.basePosition[1] + translation[1] * vs + lift +
            (options?.offhandCosmetic === true && slot.animationKey === "thirdperson_off_hand"
              ? options.offhandYOffset ?? 0
              : 0),
          transformSlot.basePosition[2] + translation[2] * vs,
        ],
      },
      [BONE_X]: { rotation: [-rotation[0], 0, 0] },
      [BONE_Y]: { rotation: [0, -rotation[1], 0] },
      [BONE_Z]: {
        rotation: [0, 0, rotation[2]],
          scale: [scale[0] * transformSlot.baseScale, scale[1] * transformSlot.baseScale, scale[2] * transformSlot.baseScale],
      },
    };

    animations[id] = { loop: true, bones };
  }

  return {
    file: { format_version: "1.8.0", animations },
    refs,
  };
}

/** Java falls back left→right hand contexts when one is missing. */
function fallbackContext(
  display: Partial<Record<JavaDisplayContext, JavaDisplayTransform>>,
  context: JavaDisplayContext,
): JavaDisplayTransform | undefined {
  if (context === "thirdperson_lefthand") return display["thirdperson_righthand"];
  if (context === "firstperson_lefthand") return display["firstperson_righthand"];
  return undefined;
}
