import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createServer } from "../../src/server.js";

async function withTestServer(fn) {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "grejiji-int-"));
  const databasePath = path.join(tempDirectory, "test.sqlite");
  const evidenceStoragePath = path.join(tempDirectory, "evidence");
  const server = createServer({ databasePath, evidenceStoragePath });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  async function requestJson(method, endpoint, body, token) {
    const headers = { "Content-Type": "application/json" };
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    return {
      response,
      payload: await response.json()
    };
  }

  try {
    await fn({ requestJson });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
}

test("auth + listing integration: seller can create listing, buyer cannot", async () => {
  await withTestServer(async ({ requestJson }) => {
    const sellerRegister = await requestJson("POST", "/auth/register", {
      userId: "integration-seller-1",
      email: "integration-seller-1@example.com",
      password: "seller-password",
      role: "seller"
    });
    assert.equal(sellerRegister.response.status, 201);

    const buyerRegister = await requestJson("POST", "/auth/register", {
      userId: "integration-buyer-1",
      email: "integration-buyer-1@example.com",
      password: "buyer-password",
      role: "buyer"
    });
    assert.equal(buyerRegister.response.status, 201);

    const sellerToken = sellerRegister.payload.token;
    const buyerToken = buyerRegister.payload.token;

    const sellerCreate = await requestJson(
      "POST",
      "/listings",
      {
        listingId: "integration-listing-1",
        title: "Integration Bike",
        description: "Road bike",
        priceCents: 22000,
        localArea: "Toronto"
      },
      sellerToken
    );

    assert.equal(sellerCreate.response.status, 201);
    assert.equal(sellerCreate.payload.listing.sellerId, "integration-seller-1");

    const buyerCreate = await requestJson(
      "POST",
      "/listings",
      {
        listingId: "integration-listing-2",
        title: "Should fail",
        priceCents: 10000,
        localArea: "Toronto"
      },
      buyerToken
    );

    assert.equal(buyerCreate.response.status, 403);
    assert.match(buyerCreate.payload.error, /seller role is required/i);
  });
});
