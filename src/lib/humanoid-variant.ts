export const HUMANOID_VARIANTS = [
  "meditating",
  "standing",
  "athlete",
  "coins",
  "resting",
  "creative",
] as const;

export type HumanoidVariant = (typeof HUMANOID_VARIANTS)[number];
export type HumanoidSelection = "auto" | HumanoidVariant;

const CATEGORY_VARIANTS: Record<string, HumanoidVariant> = {
  health: "athlete",
  finance: "coins",
  rest: "resting",
  creativity: "creative",
  growth: "creative",
  career: "standing",
  relationships: "standing",
  environment: "standing",
};

export function resolveHumanoidVariant(
  categorySlug?: string | null,
): HumanoidVariant {
  if (!categorySlug) return "meditating";
  return CATEGORY_VARIANTS[categorySlug] ?? "standing";
}

export function isHumanoidSelection(value: string): value is HumanoidSelection {
  return value === "auto" || HUMANOID_VARIANTS.some((variant) => variant === value);
}
