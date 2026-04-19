const RETRO_DEMO_ITEMS = Object.freeze([
  {
    slug: "chrono-trigger-snes-cib",
    title: "Chrono Trigger (SNES) CIB",
    description:
      "Authentic North American cart with original box and manual. Battery save confirmed.",
    priceCents: 32900,
    localArea: "Toronto"
  },
  {
    slug: "donkey-kong-country-snes",
    title: "Donkey Kong Country (SNES)",
    description: "Clean label and tested on hardware. Great starter platformer for SNES collectors.",
    priceCents: 5900,
    localArea: "Vancouver"
  },
  {
    slug: "f-zero-snes",
    title: "F-Zero (SNES)",
    description: "Original cart in very good condition. Works perfectly and includes protective sleeve.",
    priceCents: 4600,
    localArea: "Calgary"
  },
  {
    slug: "earthbound-snes-cart",
    title: "EarthBound (SNES) Cart",
    description:
      "Collector-grade label and shell. Save battery and pins cleaned before listing.",
    priceCents: 39800,
    localArea: "Montreal"
  },
  {
    slug: "final-fantasy-iii-snes",
    title: "Final Fantasy III (SNES)",
    description: "Classic RPG release with crisp label and tested SRAM saves.",
    priceCents: 9400,
    localArea: "Ottawa"
  },
  {
    slug: "pokemon-blue-game-boy",
    title: "Pokemon Blue Version (Game Boy)",
    description: "Original release cartridge. Save file present and battery currently holding.",
    priceCents: 8400,
    localArea: "Toronto"
  },
  {
    slug: "tetris-game-boy",
    title: "Tetris (Game Boy)",
    description:
      "Reliable puzzle staple for original DMG hardware. Label has minor wear, game fully tested.",
    priceCents: 2300,
    localArea: "Quebec City"
  },
  {
    slug: "kirbys-dream-land-game-boy",
    title: "Kirby's Dream Land (Game Boy)",
    description: "Original cart with clean contacts. Great condition for a first-party handheld classic.",
    priceCents: 4100,
    localArea: "Edmonton"
  },
  {
    slug: "golden-axe-genesis",
    title: "Golden Axe (Genesis)",
    description:
      "Sega Genesis cart and case set. Tested on Model 1 console and includes original insert.",
    priceCents: 5200,
    localArea: "Halifax"
  },
  {
    slug: "super-mario-64-nintendo-64",
    title: "Super Mario 64 (Nintendo 64)",
    description:
      "North American cart with clear front label and clean back sticker. Boots first try.",
    priceCents: 7700,
    localArea: "Winnipeg"
  }
]);

function toDemoAssetPath(assetId) {
  return `/demo-assets/${encodeURIComponent(assetId)}.svg`;
}

function createAssetVariants(slug) {
  return [
    {
      id: `${slug}-box`,
      variantLabel: "Box Art"
    },
    {
      id: `${slug}-gameplay`,
      variantLabel: "Gameplay"
    }
  ];
}

function buildAssetRegistry() {
  const entries = [];
  for (const item of RETRO_DEMO_ITEMS) {
    const variants = createAssetVariants(item.slug);
    for (const variant of variants) {
      entries.push([
        variant.id,
        {
          title: item.title,
          variantLabel: variant.variantLabel,
          area: item.localArea
        }
      ]);
    }
  }
  return new Map(entries);
}

const DEMO_ASSET_REGISTRY = buildAssetRegistry();

function toDemoListing(item, index) {
  const ordinal = String(index + 1).padStart(2, "0");
  const assets = createAssetVariants(item.slug).map((entry) => toDemoAssetPath(entry.id));
  return {
    id: `demo-listing-${ordinal}`,
    title: item.title,
    description: item.description,
    priceCents: item.priceCents,
    localArea: item.localArea,
    photoUrls: assets
  };
}

export function listExpectedDemoListings() {
  return RETRO_DEMO_ITEMS.map((item, index) => toDemoListing(item, index));
}

export function buildDemoCatalog() {
  const demoListings = listExpectedDemoListings();
  const sellers = demoListings.map((listing, index) => {
    const ordinal = String(index + 1).padStart(2, "0");
    return {
      id: `demo-seller-${ordinal}`,
      email: `demo-seller-${ordinal}@grejiji.demo`,
      role: "seller",
      listing
    };
  });

  return {
    admin: { id: "demo-admin", email: "demo-admin@grejiji.demo", role: "admin" },
    buyer: { id: "demo-buyer", email: "demo-buyer@grejiji.demo", role: "buyer" },
    sellers
  };
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function computeHue(seed) {
  let value = 0;
  for (let index = 0; index < seed.length; index += 1) {
    value = (value + seed.charCodeAt(index) * (index + 17)) % 360;
  }
  return value;
}

export function isKnownDemoAssetId(assetId) {
  return DEMO_ASSET_REGISTRY.has(assetId);
}

export function renderDemoAssetSvg(assetId) {
  const details = DEMO_ASSET_REGISTRY.get(assetId);
  if (!details) {
    return null;
  }

  const hue = computeHue(assetId);
  const secondaryHue = (hue + 34) % 360;
  const tertiaryHue = (hue + 68) % 360;
  const escapedTitle = escapeXml(details.title);
  const escapedVariant = escapeXml(details.variantLabel);
  const escapedArea = escapeXml(details.area);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900" role="img" aria-label="${escapedTitle} ${escapedVariant}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${hue}, 74%, 37%)"/>
      <stop offset="100%" stop-color="hsl(${secondaryHue}, 69%, 28%)"/>
    </linearGradient>
    <linearGradient id="card" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsla(${tertiaryHue}, 72%, 60%, 0.92)"/>
      <stop offset="100%" stop-color="hsla(${secondaryHue}, 77%, 18%, 0.78)"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="900" fill="url(#bg)"/>
  <g opacity="0.24">
    <circle cx="220" cy="160" r="180" fill="hsl(${tertiaryHue}, 88%, 72%)"/>
    <circle cx="1020" cy="130" r="230" fill="hsl(${secondaryHue}, 78%, 45%)"/>
    <circle cx="1040" cy="780" r="260" fill="hsl(${hue}, 82%, 30%)"/>
  </g>
  <rect x="88" y="120" width="1024" height="660" rx="36" fill="url(#card)" stroke="hsla(0, 0%, 100%, 0.26)"/>
  <text x="140" y="258" font-family="Trebuchet MS, Segoe UI, sans-serif" font-size="44" font-weight="700" fill="white">GreJiJi Demo Asset</text>
  <text x="140" y="332" font-family="Trebuchet MS, Segoe UI, sans-serif" font-size="56" font-weight="700" fill="white">${escapedTitle}</text>
  <text x="140" y="404" font-family="Trebuchet MS, Segoe UI, sans-serif" font-size="40" font-weight="600" fill="hsla(0, 0%, 100%, 0.95)">${escapedVariant}</text>
  <text x="140" y="468" font-family="Trebuchet MS, Segoe UI, sans-serif" font-size="32" fill="hsla(0, 0%, 100%, 0.9)">Local pickup area: ${escapedArea}</text>
  <text x="140" y="724" font-family="Trebuchet MS, Segoe UI, sans-serif" font-size="24" fill="hsla(0, 0%, 100%, 0.88)">Deterministic project-hosted demo media. Asset id: ${escapeXml(assetId)}</text>
</svg>`;
}
