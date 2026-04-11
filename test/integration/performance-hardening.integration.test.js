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
