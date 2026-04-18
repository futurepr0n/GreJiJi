import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createServer } from "../../src/server.js";

async function withTestServer(fn) {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "grejiji-perf-int-"));
  const databasePath = path.join(tempDirectory, "test.sqlite");
  const evidenceStoragePath = path.join(tempDirectory, "evidence");
  const server = createServer({
    databasePath,
    evidenceStoragePath,
    listingsCacheTtlMs: 10_000,
    transactionCacheTtlMs: 10_000
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  async function request(method, endpoint, body, token) {
    const headers = {};
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }

    return { response, payload };
  }

  try {
    await fn({ request });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
}

test("listings feed supports filter + keyset pagination", async () => {
  await withTestServer(async ({ request }) => {
    const seller = await request("POST", "/auth/register", {
      userId: "perf-seller",
      email: "perf-seller@example.com",
      password: "seller-password",
      role: "seller"
    });
    assert.equal(seller.response.status, 201);

    for (let index = 0; index < 6; index += 1) {
      const listing = await request(
        "POST",
        "/listings",
        {
          listingId: `perf-listing-${index}`,
          title: `Perf listing ${index}`,
          description: "perf listing",
          priceCents: 1000 + index,
          localArea: index < 3 ? "Toronto" : "Montreal"
        },
        seller.payload.token
      );
      assert.equal(listing.response.status, 201);
    }

    const torontoOnly = await request("GET", "/listings?localArea=Toronto&limit=2");
    assert.equal(torontoOnly.response.status, 200);
    assert.equal(torontoOnly.payload.listings.length, 2);
    for (const listing of torontoOnly.payload.listings) {
      assert.equal(listing.localArea, "Toronto");
    }

    const last = torontoOnly.payload.listings[torontoOnly.payload.listings.length - 1];
    const nextPage = await request(
      "GET",
      `/listings?localArea=Toronto&limit=2&cursorCreatedAt=${encodeURIComponent(
        last.createdAt
      )}&cursorId=${encodeURIComponent(last.id)}`
    );
    assert.equal(nextPage.response.status, 200);
    assert.ok(nextPage.payload.listings.length <= 2);
    if (nextPage.payload.listings.length > 0) {
      assert.notEqual(nextPage.payload.listings[0].id, last.id);
    }
  });
});

test("listings feed supports discovery search, price filters, and deterministic price cursor pagination", async () => {
  await withTestServer(async ({ request }) => {
    const seller = await request("POST", "/auth/register", {
      userId: "discovery-seller",
      email: "discovery-seller@example.com",
      password: "seller-password",
      role: "seller"
    });
    assert.equal(seller.response.status, 201);

    const fixtures = [
      { id: "disc-a", title: "Vintage Bike Frame", description: "blue steel frame", priceCents: 12000 },
      { id: "disc-b", title: "Gaming Console Bundle", description: "retro console + 3 games", priceCents: 15000 },
      { id: "disc-c", title: "Mountain Bike Helmet", description: "helmet for bike rides", priceCents: 4500 },
      { id: "disc-d", title: "Desk Lamp", description: "warm light", priceCents: 2500 }
    ];

    for (const fixture of fixtures) {
      const listing = await request(
        "POST",
        "/listings",
        {
          listingId: fixture.id,
          title: fixture.title,
          description: fixture.description,
          priceCents: fixture.priceCents,
          localArea: "Toronto"
        },
        seller.payload.token
      );
      assert.equal(listing.response.status, 201);
    }

    const filtered = await request(
      "GET",
      "/listings?q=bike&minPriceCents=4000&maxPriceCents=13000&sortBy=priceCents&sortOrder=asc"
    );
    assert.equal(filtered.response.status, 200);
    assert.deepEqual(
      filtered.payload.listings.map((listing) => listing.id),
      ["disc-c", "disc-a"]
    );

    const pageOne = await request("GET", "/listings?sortBy=priceCents&sortOrder=asc&limit=2");
    assert.equal(pageOne.response.status, 200);
    assert.equal(pageOne.payload.listings.length, 2);
    assert.equal(pageOne.payload.listings[0].id, "disc-d");
    assert.equal(pageOne.payload.listings[1].id, "disc-c");

    const cursor = pageOne.payload.listings[pageOne.payload.listings.length - 1];
    const pageTwo = await request(
      "GET",
      `/listings?sortBy=priceCents&sortOrder=asc&limit=2&cursorPriceCents=${encodeURIComponent(
        cursor.priceCents
      )}&cursorId=${encodeURIComponent(cursor.id)}`
    );
    assert.equal(pageTwo.response.status, 200);
    assert.ok(pageTwo.payload.listings.length >= 1);
    if (pageTwo.payload.listings.length > 0) {
      assert.ok(pageTwo.payload.listings[0].priceCents >= cursor.priceCents);
      assert.notEqual(pageTwo.payload.listings[0].id, cursor.id);
    }
  });
});

test("listings feed rejects invalid discovery query combinations", async () => {
  await withTestServer(async ({ request }) => {
    const invalidSortBy = await request("GET", "/listings?sortBy=updatedAt");
    assert.equal(invalidSortBy.response.status, 400);
    assert.match(invalidSortBy.payload.error, /sortBy/i);

    const invalidPriceRange = await request("GET", "/listings?minPriceCents=600&maxPriceCents=500");
    assert.equal(invalidPriceRange.response.status, 400);
    assert.match(invalidPriceRange.payload.error, /minPriceCents/i);

    const invalidCursor = await request(
      "GET",
      "/listings?sortBy=priceCents&sortOrder=asc&cursorCreatedAt=2026-01-01T00:00:00.000Z&cursorPriceCents=1200&cursorId=abc"
    );
    assert.equal(invalidCursor.response.status, 400);
    assert.match(invalidCursor.payload.error, /cursorCreatedAt/i);
  });
});

test("transaction cache invalidates on lifecycle mutation", async () => {
  await withTestServer(async ({ request }) => {
    const seller = await request("POST", "/auth/register", {
      userId: "perf-seller-2",
      email: "perf-seller-2@example.com",
      password: "seller-password",
      role: "seller"
    });
    const buyer = await request("POST", "/auth/register", {
      userId: "perf-buyer-2",
      email: "perf-buyer-2@example.com",
      password: "buyer-password",
      role: "buyer"
    });
    assert.equal(seller.response.status, 201);
    assert.equal(buyer.response.status, 201);

    const created = await request(
      "POST",
      "/transactions",
      {
        transactionId: "perf-txn-1",
        sellerId: "perf-seller-2",
        amountCents: 4500
      },
      buyer.payload.token
    );
    assert.equal(created.response.status, 201);
    assert.equal(created.payload.transaction.status, "accepted");

    const readBefore = await request("GET", "/transactions/perf-txn-1", undefined, buyer.payload.token);
    assert.equal(readBefore.response.status, 200);
    assert.equal(readBefore.payload.transaction.status, "accepted");

    const confirmed = await request(
      "POST",
      "/transactions/perf-txn-1/confirm-delivery",
      {},
      buyer.payload.token
    );
    assert.equal(confirmed.response.status, 200);
    assert.equal(confirmed.payload.transaction.status, "completed");

    const readAfter = await request("GET", "/transactions/perf-txn-1", undefined, buyer.payload.token);
    assert.equal(readAfter.response.status, 200);
    assert.equal(readAfter.payload.transaction.status, "completed");
  });
});

test("notification dispatch job enforces new bounds", async () => {
  await withTestServer(async ({ request }) => {
    const admin = await request("POST", "/auth/register", {
      userId: "perf-admin-1",
      email: "perf-admin-1@example.com",
      password: "admin-password",
      role: "admin"
    });
    assert.equal(admin.response.status, 201);

    const invalidLimit = await request(
      "POST",
      "/jobs/notification-dispatch",
      { limit: 100000 },
      admin.payload.token
    );
    assert.equal(invalidLimit.response.status, 400);
    assert.match(invalidLimit.payload.error, /limit/i);

    const invalidBudget = await request(
      "POST",
      "/jobs/notification-dispatch",
      { maxProcessingMs: 0 },
      admin.payload.token
    );
    assert.equal(invalidBudget.response.status, 400);
    assert.match(invalidBudget.payload.error, /maxProcessingMs/i);
  });
});
