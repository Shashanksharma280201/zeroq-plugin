import type { Category, ClassifiedProduct, DetectedProduct } from "./types.ts";

/**
 * Keyword rules, checked in order. More specific words come first so that
 * "t-shirt" wins over "shirt" and "shirt dress" wins over "shirt".
 * formality: 1 lounge, 2 casual, 3 smart casual, 4 business, 5 formal
 */
const KIND_RULES: Array<{ words: string[]; kind: string; category: Category; formality: number }> = [
  { words: ["shirt dress", "maxi dress", "midi dress", "mini dress", "dress", "gown"], kind: "dress", category: "one-piece", formality: 3 },
  { words: ["jumpsuit", "playsuit", "romper", "dungaree", "dungarees"], kind: "jumpsuit", category: "one-piece", formality: 2 },
  { words: ["saree", "sari", "lehenga", "anarkali"], kind: "ethnic set", category: "one-piece", formality: 4 },
  { words: ["kurta set", "co-ord", "co ord", "coord set", "tracksuit"], kind: "set", category: "one-piece", formality: 2 },
  { words: ["blazer", "suit jacket", "waistcoat", "nehru jacket", "sherwani"], kind: "blazer", category: "outerwear", formality: 4 },
  { words: ["overcoat", "trench", "coat", "parka"], kind: "coat", category: "outerwear", formality: 3 },
  { words: ["jacket", "bomber", "windcheater", "gilet", "shacket"], kind: "jacket", category: "outerwear", formality: 2 },
  { words: ["hoodie", "sweatshirt"], kind: "hoodie", category: "outerwear", formality: 1 },
  { words: ["cardigan", "sweater", "pullover", "jumper"], kind: "sweater", category: "outerwear", formality: 3 },
  { words: ["t-shirt", "tshirt", "t shirt", "tee"], kind: "t-shirt", category: "top", formality: 2 },
  { words: ["polo"], kind: "polo", category: "top", formality: 2 },
  { words: ["shirt"], kind: "shirt", category: "top", formality: 3 },
  { words: ["kurta", "kurti", "tunic"], kind: "kurta", category: "top", formality: 3 },
  { words: ["blouse", "camisole", "crop top", "tank top", "tank", "vest", "top", "bodysuit"], kind: "top", category: "top", formality: 2 },
  { words: ["jeans", "denim"], kind: "jeans", category: "bottom", formality: 2 },
  { words: ["chinos", "chino"], kind: "chinos", category: "bottom", formality: 3 },
  { words: ["formal trousers", "trousers", "trouser", "slacks", "pants", "pant"], kind: "trousers", category: "bottom", formality: 3 },
  { words: ["joggers", "jogger", "track pants", "trackpants", "sweatpants", "pyjama", "pajama", "lounge pants"], kind: "joggers", category: "bottom", formality: 1 },
  { words: ["cargo", "cargos"], kind: "cargo", category: "bottom", formality: 2 },
  { words: ["shorts", "short"], kind: "shorts", category: "bottom", formality: 1 },
  { words: ["skirt", "skort"], kind: "skirt", category: "bottom", formality: 3 },
  { words: ["leggings", "palazzo", "palazzos", "salwar", "churidar", "dhoti"], kind: "ethnic bottom", category: "bottom", formality: 2 },
  { words: ["sneakers", "sneaker", "trainers", "running shoes", "sports shoes"], kind: "sneakers", category: "footwear", formality: 2 },
  { words: ["loafers", "loafer", "derby", "oxford", "brogues", "formal shoes"], kind: "formal shoes", category: "footwear", formality: 4 },
  { words: ["boots", "boot", "chelsea"], kind: "boots", category: "footwear", formality: 3 },
  { words: ["heels", "pumps", "stilettos", "wedges"], kind: "heels", category: "footwear", formality: 4 },
  { words: ["sandals", "sandal", "flip flops", "flip-flops", "slides", "sliders", "mojari", "juttis", "jutti", "kolhapuri"], kind: "sandals", category: "footwear", formality: 1 },
  { words: ["shoes", "shoe"], kind: "shoes", category: "footwear", formality: 2 },
  { words: ["watch", "belt", "bag", "handbag", "backpack", "wallet", "cap", "hat", "scarf", "dupatta", "stole", "sunglasses", "tie", "necklace", "earrings", "bracelet", "socks"], kind: "accessory", category: "accessory", formality: 2 },
];

/** Basic colours we reason about. Order matters: multiword and specific first. */
export const COLORS: Array<{ name: string; words: string[] }> = [
  { name: "navy", words: ["navy blue", "navy", "midnight blue"] },
  { name: "olive", words: ["olive green", "olive", "khaki green"] },
  { name: "maroon", words: ["maroon", "burgundy", "wine", "oxblood"] },
  { name: "beige", words: ["beige", "khaki", "tan", "camel", "sand", "stone", "taupe"] },
  { name: "cream", words: ["off white", "off-white", "cream", "ivory", "ecru"] },
  { name: "black", words: ["black", "jet", "charcoal black"] },
  { name: "white", words: ["white", "optic white"] },
  { name: "grey", words: ["charcoal", "grey", "gray", "melange", "silver", "slate"] },
  { name: "denim", words: ["indigo", "light wash", "dark wash", "mid wash", "denim blue"] },
  { name: "blue", words: ["sky blue", "light blue", "powder blue", "teal", "turquoise", "blue", "cobalt"] },
  { name: "brown", words: ["brown", "chocolate", "coffee", "rust", "mocha"] },
  { name: "green", words: ["green", "mint", "sage", "emerald", "bottle green"] },
  { name: "red", words: ["red", "crimson", "scarlet"] },
  { name: "pink", words: ["pink", "blush", "rose", "fuchsia", "magenta", "peach"] },
  { name: "purple", words: ["purple", "lavender", "lilac", "violet", "mauve"] },
  { name: "yellow", words: ["yellow", "mustard", "lemon", "gold"] },
  { name: "orange", words: ["orange", "coral", "tangerine"] },
];

export const NEUTRALS = new Set(["black", "white", "grey", "navy", "beige", "cream", "denim", "brown", "olive"]);

const FORMAL_HINTS = ["formal", "office", "work", "tailored", "slim fit formal", "suit", "linen"];
const LOUNGE_HINTS = ["lounge", "gym", "sports", "running", "athleisure", "sleep", "night"];

function hasWord(haystack: string, word: string): boolean {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z])${esc}($|[^a-z])`, "i").test(haystack);
}

export function guessKind(text: string): { kind?: string; category: Category; formality: number } {
  const t = text.toLowerCase();
  for (const rule of KIND_RULES) {
    if (rule.words.some((w) => hasWord(t, w))) {
      let formality = rule.formality;
      if (FORMAL_HINTS.some((w) => hasWord(t, w))) formality = Math.min(5, formality + 1);
      if (LOUNGE_HINTS.some((w) => hasWord(t, w))) formality = Math.max(1, formality - 1);
      return { kind: rule.kind, category: rule.category, formality };
    }
  }
  return { category: "other", formality: 2 };
}

export function guessColors(text: string): string[] {
  let t = text.toLowerCase();
  const found: string[] = [];
  for (const c of COLORS) {
    for (const w of c.words) {
      if (hasWord(t, w)) {
        if (!found.includes(c.name)) found.push(c.name);
        // remove so "navy blue" does not also count as "blue"
        t = t.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
      }
    }
  }
  if (found.length === 0 && /\bjeans?\b|\bdenim\b/.test(text.toLowerCase())) found.push("denim");
  return found;
}

export function classifyProduct(p: DetectedProduct): ClassifiedProduct {
  // The name is the strongest signal; the description often lists other items
  // ("pair it with our chinos") so it only breaks ties.
  const fromName = guessKind(p.name);
  const k = fromName.category !== "other" ? fromName : guessKind(`${p.name} ${p.description ?? ""}`);
  const nameColors = guessColors(`${p.color ?? ""} ${p.name}`);
  const colors = nameColors.length ? nameColors : guessColors(p.description ?? "");
  return { ...p, category: k.category, kind: k.kind, formality: k.formality, colors };
}
