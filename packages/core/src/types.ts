export const CATEGORIES = [
  "top",
  "bottom",
  "one-piece",
  "outerwear",
  "footwear",
  "accessory",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Something you own. Lives on the server, shown in the web app and extension. */
export interface WardrobeItem {
  id: string;
  name: string;
  category: Category;
  /** e.g. "shirt", "jeans", "sneakers" */
  kind?: string;
  /** Basic colour names, see COLORS in classify.ts */
  colors: string[];
  pattern?: string;
  /** 1 = loungewear, 3 = smart casual, 5 = formal */
  formality: number;
  brand?: string;
  /** Path served by the server, e.g. /images/abc.jpg */
  image?: string;
  sourceUrl?: string;
  price?: number;
  currency?: string;
  notes?: string;
  source: "upload" | "product-page" | "manual";
  createdAt: string;
  lastWornAt?: string;
  wornCount: number;
}

export type NewWardrobeItem = Omit<WardrobeItem, "id" | "createdAt" | "wornCount" | "image"> & {
  /** data: URL or http(s) URL. The server stores a local copy. */
  imageSrc?: string;
};

/** A product found on a shopping page. */
export interface DetectedProduct {
  name: string;
  url: string;
  images: string[];
  brand?: string;
  price?: number;
  currency?: string;
  description?: string;
  color?: string;
  /** Everything else the page says about it: sizes, fabric, reviews, the full price story */
  details?: ProductDetails;
  /** How we found it, useful for debugging odd sites */
  via: "json-ld" | "microdata" | "open-graph";
}

/** What a product page says beyond name, price and photo. Every field is optional: stores differ. */
export interface ProductDetails {
  /** the price before the discount */
  mrp?: number;
  discountPct?: number;
  /** average buyer rating out of 5 */
  rating?: number;
  reviewCount?: number;
  /** a few buyer reviews, trimmed */
  reviews?: string[];
  sizes?: Array<{ label: string; available: boolean }>;
  colours?: string[];
  material?: string;
  pattern?: string;
  fit?: string;
  care?: string;
  /** the store's own category path, e.g. "Men > Shirts > Casual" */
  category?: string;
  inStock?: boolean;
  /** "Fabric: Cotton" style rows from the page */
  specs?: Array<[string, string]>;
  /** the product section's own words, for the AI to read */
  text?: string;
}

/** A product with our best guess of what it is. */
export interface ClassifiedProduct extends DetectedProduct {
  category: Category;
  kind?: string;
  colors: string[];
  formality: number;
}

export interface DuplicateMatch {
  item: WardrobeItem;
  score: number;
  reason: string;
}

export interface PairMatch {
  item: WardrobeItem;
  score: number;
  reason: string;
}

export interface ProductCheck {
  product: ClassifiedProduct;
  duplicates: DuplicateMatch[];
  pairs: PairMatch[];
  /** Short AI written take, present only when an AI key is configured */
  aiNote?: string;
  verdict: "buy" | "think" | "skip";
}

export interface Outfit {
  title: string;
  itemIds: string[];
  why: string;
}
