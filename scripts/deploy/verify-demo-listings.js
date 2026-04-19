import { listExpectedDemoListings } from "../../src/demo-catalog.js";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
      continue;
    }
    args[key] = true;
  }
  return args;
}

function sortById(left, right) {
  return left.id.localeCompare(right.id);
}

function toComparableListing(listing) {
  const photoUrls = Array.isArray(listing.photoUrls)
    ? listing.photoUrls.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];
  return {
    id: String(listing.id ?? ""),
    title: String(listing.title ?? ""),
    priceCents: Number(listing.priceCents ?? NaN),
    localArea: String(listing.localArea ?? ""),
    photoUrls
  };
}

export function validateDemoCatalogIntegrity(listings, expectedListings = listExpectedDemoListings()) {
  const errors = [];
  if (!Array.isArray(listings)) {
    return {
      ok: false,
      errors: ["listings payload must be an array"],
      expected: expectedListings
    };
  }

  const demoListings = listings
    .map(toComparableListing)
    .filter((entry) => entry.id.startsWith("demo-listing-"))
    .sort(sortById);

  const expected = expectedListings.map(toComparableListing).sort(sortById);

  if (demoListings.length !== expected.length) {
    errors.push(
      `expected ${expected.length} demo listings, received ${demoListings.length}`
    );
  }

  const expectedById = new Map(expected.map((entry) => [entry.id, entry]));
  for (const listing of demoListings) {
    const expectedListing = expectedById.get(listing.id);
    if (!expectedListing) {
      errors.push(`unexpected demo listing id '${listing.id}'`);
      continue;
    }

    for (const field of ["title", "priceCents", "localArea"]) {
      if (listing[field] !== expectedListing[field]) {
        errors.push(
          `${listing.id} ${field} mismatch: expected '${expectedListing[field]}', got '${listing[field]}'`
        );
      }
    }

    const samePhotoCount = listing.photoUrls.length === expectedListing.photoUrls.length;
    const samePhotoValues =
      samePhotoCount &&
      listing.photoUrls.every((url, index) => url === expectedListing.photoUrls[index]);
    if (!samePhotoValues) {
      errors.push(
        `${listing.id} photoUrls mismatch: expected ${JSON.stringify(
          expectedListing.photoUrls
        )}, got ${JSON.stringify(listing.photoUrls)}`
      );
    }

    for (const url of listing.photoUrls) {
      if (!url.startsWith("/demo-assets/") || !url.endsWith(".svg")) {
        errors.push(`${listing.id} has non-deterministic media URL '${url}'`);
      }
    }
  }

  for (const expectedListing of expected) {
    if (!demoListings.some((entry) => entry.id === expectedListing.id)) {
      errors.push(`missing expected demo listing '${expectedListing.id}'`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    demoListings,
    expected
  };
}

async function requestJson({ baseUrl, endpoint, timeoutMs = 10000, fetchImpl = fetch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}${endpoint}`, {
      method: "GET",
      headers: {
        Accept: "application/json"
      },
      signal: controller.signal
    });
    const payload = await response.json();
    return { response, payload };
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyDemoMediaAvailability({
  baseUrl,
  demoListings,
  timeoutMs = 10000,
  fetchImpl = fetch
}) {
  const errors = [];
  for (const listing of demoListings) {
    for (const mediaUrl of listing.photoUrls) {
      const resolved = new URL(mediaUrl, `${baseUrl}/`).toString();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(resolved, {
          method: "GET",
          signal: controller.signal
        });
        if (response.status !== 200) {
          errors.push(`${listing.id} media '${mediaUrl}' returned ${response.status}`);
          continue;
        }
        const contentType = String(response.headers.get("content-type") ?? "").toLowerCase();
        if (!contentType.startsWith("image/svg+xml")) {
          errors.push(
            `${listing.id} media '${mediaUrl}' returned unexpected content-type '${contentType}'`
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${listing.id} media '${mediaUrl}' fetch failed: ${message}`);
      } finally {
        clearTimeout(timer);
      }
    }
  }
  return {
    ok: errors.length === 0,
    errors
  };
}

export async function runVerification({
  baseUrl,
  timeoutMs = 10000,
  fetchImpl = fetch
}) {
  const listingsResult = await requestJson({
    baseUrl,
    endpoint: "/listings",
    timeoutMs,
    fetchImpl
  });
  if (listingsResult.response.status !== 200) {
    throw new Error(`GET /listings expected 200, got ${listingsResult.response.status}`);
  }

  const integrity = validateDemoCatalogIntegrity(listingsResult.payload?.listings);
  if (!integrity.ok) {
    throw new Error(`catalog integrity failed: ${integrity.errors.join("; ")}`);
  }

  const mediaHealth = await verifyDemoMediaAvailability({
    baseUrl,
    demoListings: integrity.demoListings,
    timeoutMs,
    fetchImpl
  });
  if (!mediaHealth.ok) {
    throw new Error(`media health failed: ${mediaHealth.errors.join("; ")}`);
  }

  return {
    verifiedAt: new Date().toISOString(),
    demoListingCount: integrity.demoListings.length,
    mediaAssetCount: integrity.demoListings.reduce((sum, listing) => sum + listing.photoUrls.length, 0)
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = String(args["base-url"] ?? process.env.BASE_URL ?? "").replace(/\/$/, "");
  const timeoutMs = Number(args["timeout-ms"] ?? process.env.DEMO_LISTING_VERIFY_TIMEOUT_MS ?? 10000);

  if (!baseUrl) {
    console.error("Missing base URL. Use --base-url or BASE_URL.");
    process.exit(2);
  }

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    console.error("Timeout must be a positive number in milliseconds.");
    process.exit(2);
  }

  try {
    const summary = await runVerification({ baseUrl, timeoutMs });
    console.log(
      JSON.stringify({
        event: "demo.listings.verification.passed",
        baseUrl,
        ...summary
      })
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "demo.listings.verification.failed",
        baseUrl,
        error: error instanceof Error ? error.message : String(error),
        verifiedAt: new Date().toISOString()
      })
    );
    process.exit(1);
  }
}

const scriptEntryUrl = new URL(`file://${process.argv[1]}`).href;
if (import.meta.url === scriptEntryUrl) {
  main();
}
