// Writes ERC-1155 metadata JSON for every catalog item to docs/cosmetics/<64-hex id>.json and docs/cosmetics/catalog.json
import { writeFileSync } from "node:fs";
import { CATALOG, CATEGORY_NAMES, COSMETICS, tokenFile } from "../../docs/art/catalog.js";
const BASE = "https://tapelog-journal.github.io/fogline";
const dir = new URL("../../docs/cosmetics/", import.meta.url).pathname;
for (const it of CATALOG) {
  const meta = {
    name: it.name,
    description: `${it.desc} Fogline cosmetic (${CATEGORY_NAMES[it.category]}). Purely decorative: zero gameplay effect. Base Sepolia testnet item priced in valueless test fUSD. Game for entertainment. Not investment advice.`,
    image: `${BASE}/cosmetics/img/${it.id}.png`,
    external_url: `${BASE}/?${{ skin: "skin", table: "table", fog: "fog", trail: "trail", banner: "banner", effect: "fx" }[it.category]}=${it.id}`,
    attributes: [
      { trait_type: "Category", value: CATEGORY_NAMES[it.category] },
      { trait_type: "Rarity", value: it.rarity },
      { trait_type: "Price (test fUSD)", value: it.price },
      { trait_type: "Max supply", value: it.max || "Unlimited" },
      { trait_type: "Equip slot", value: it.kind === 0 ? "PieceSkin" : "BoardTheme" },
      { trait_type: "Gameplay effect", value: "None" },
      { trait_type: "Network", value: "Base Sepolia (testnet)" },
    ],
  };
  writeFileSync(dir + tokenFile(it.id) + ".json", JSON.stringify(meta, null, 1));
}
writeFileSync(dir + "catalog.json", JSON.stringify({ contract: COSMETICS, chainId: 84532, currency: "fUSD (test token, 6 decimals)", items: CATALOG }, null, 1));
console.log("wrote", CATALOG.length, "metadata files");
