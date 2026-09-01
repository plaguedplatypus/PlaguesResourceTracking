export const farmingCanonicalHerbs = [
  "guam",
  "marrentill",
  "tarromin",
  "harralander",
  "Goutweed",
  "ranarr",
  "spirit weed",
  "toadflax",
  "irit",
  "wergali",
  "avantoe",
  "kwuarm",
  "bloodweed",
  "snapdragon",
  "cadantine",
  "lantadyme",
  "arbuck",
  "dwarf weed",
  "torstol",
  "fellstalk",
] as const;

export const farmingHerbProducts = farmingCanonicalHerbs.reduce<string[]>(
  (products, herb) => {
    if (herb !== "Goutweed") {
      products.push(`Grimy ${herb}`, `Clean ${herb}`);
    }
    return products;
  },
  ["Goutweed"],
);

export const farmingProduceByPatch = {
  allotments: [
    "Raw potato",
    "Onion",
    "Cabbage",
    "Tomato",
    "Sweetcorn",
    "Strawberry",
    "Watermelon",
    "Snape grass",
    "Sweet potato",
    "Red onion",
    "Cannonball cabbage",
    "Heirloom tomato",
    "Rainbow sweetcorn",
    "White strawberry",
    "Golden watermelon",
  ],
  flowers: [
    "Marigold",
    "Rosemary",
    "Nasturtium",
    "Woad leaves",
    "Limpwurt root",
    "Starbloom flower",
  ],
  herbs: farmingHerbProducts,
  hops: [
    "Barley",
    "Hammerstone hops",
    "Asgarnian hops",
    "Wendlewick hops",
    "Jute fibre",
    "Yanillian hops",
    "Krandorian hops",
    "Wildblood hops",
    "Grapes",
    "Toad egg sac",
    "Grapes of Guthix",
    "Grapes of Saradomin",
    "Grapes of Zamorak",
  ],
  bushes: [
    "Redberries",
    "Cadava berries",
    "Dwellberries",
    "Jangerberries",
    "White berries",
    "Poison ivy berries",
    "Avocado",
    "Mango",
    "Lychee",
  ],
  fruitTrees: [
    "Cooking apple",
    "Banana",
    "Orange",
    "Curry leaf",
    "Pineapple",
    "Papaya fruit",
    "Coconut",
    "Ciku",
    "Guarana",
    "Carambola",
  ],
  cactus: ["Cactus spine", "Potato cactus", "Dragonfruit", "Golden dragonfruit"],
  mushrooms: [
    "Bittercap mushroom",
    "Morchella mushroom",
    "Stinkflies",
    "Tombshroom",
  ],
} as const;

const canonicalProducts: string[] = [];
for (const products of Object.values(farmingProduceByPatch)) {
  for (const product of products) {
    canonicalProducts.push(product);
  }
}
const farmingProductsByNormalizedName = new Map(
  canonicalProducts.map((item) => [normalizeFarmingItemName(item), item]),
);
const farmingHerbsByNormalizedName = new Set(
  farmingHerbProducts.map(normalizeFarmingItemName),
);

export function getCanonicalFarmingProduce(value: string): string | null {
  return farmingProductsByNormalizedName.get(normalizeFarmingItemName(value)) ?? null;
}

export function isFarmingHerbProduce(value: string): boolean {
  return farmingHerbsByNormalizedName.has(normalizeFarmingItemName(value));
}

export function normalizeFarmingItemName(value: string): string {
  return value.trim().replace(/\.$/, "").replace(/\s+/g, " ").toLowerCase();
}
