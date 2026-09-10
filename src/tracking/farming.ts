const herbs = [
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

const herbProducts = herbs.reduce<string[]>(
  (products, herb) => {
    if (herb !== "Goutweed") {
      products.push(`Grimy ${herb}`, `Clean ${herb}`);
    }
    return products;
  },
  ["Goutweed"],
);

const produceByPatch = {
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
  herbs: herbProducts,
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

const allProducts: string[] = [];
for (const patchProducts of Object.values(produceByPatch)) {
  for (const product of patchProducts) {
    allProducts.push(product);
  }
}
const produceByName = new Map(
  allProducts.map((item) => [normalizeFarmingItemName(item), item]),
);
export function getFarmingProduce(value: string): string | null {
  return produceByName.get(normalizeFarmingItemName(value)) ?? null;
}

function normalizeFarmingItemName(value: string): string {
  return value.trim().replace(/\.$/, "").replace(/\s+/g, " ").toLowerCase();
}
