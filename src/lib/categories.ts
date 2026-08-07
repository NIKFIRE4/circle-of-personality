import type { Prisma } from "@prisma/client";
import { z } from "zod";

export const categorySelect = {
  id: true,
  name: true,
  slug: true,
  color: true,
  icon: true,
  targetMinutesPerWeek: true,
  sortOrder: true,
  isArchived: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.BalanceCategorySelect;

const color = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Color must be a six-digit hex value");
const icon = z.string().trim().max(64).nullable();

export const createCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
    color: color.default("#D8A84F"),
    icon: icon.optional(),
    targetMinutesPerWeek: z.number().int().min(0).max(10_080).default(0),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();

export const updateCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    color: color.optional(),
    icon: icon.optional(),
    targetMinutesPerWeek: z.number().int().min(0).max(10_080).optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    isArchived: z.boolean().optional(),
  })
  .strict()
  .refine((category) => Object.keys(category).length > 0, "At least one field is required");

const queryBoolean = z.enum(["true", "false"]).transform((value) => value === "true");

export const categoriesQuerySchema = z
  .object({ includeArchived: queryBoolean.default(false) })
  .strict();

const CYRILLIC: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

export function slugifyCategoryName(name: string): string {
  const transliterated = Array.from(name.trim().toLowerCase(), (character) => CYRILLIC[character] ?? character).join("");
  const slug = transliterated
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");

  return slug || "category";
}
