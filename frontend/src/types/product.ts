import { z } from "zod";

export const ProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  // Finer-grained than category (e.g. "Milk" within "Dairy") — the backend's
  // substitution matching prefers a same-subcategory candidate, falling
  // back to same-category only if that finds nothing. Not shown in the
  // shop UI; carried through purely for mock mode's matching logic to use.
  subcategory: z.string(),
  pricePaise: z.number().int().positive(),
});

export type Product = z.infer<typeof ProductSchema>;

export const ProductListSchema = z.array(ProductSchema);
