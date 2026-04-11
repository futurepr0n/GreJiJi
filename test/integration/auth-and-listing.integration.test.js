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
  const listingPhotoStoragePath = path.join(tempDirectory, "listing-photos");
  const server = createServer({ databasePath, evidenceStoragePath, listingPhotoStoragePath });

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

  async function requestBinary(method, endpoint, token) {
    const headers = {};
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }
    const response = await fetch(`${baseUrl}${endpoint}`, { method, headers });
    return {
      response,
      payload: Buffer.from(await response.arrayBuffer())
    };
  }

  try {
    await fn({ requestJson, requestBinary });
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
        localArea: "Toronto",
        photoUrls: ["https://example.com/photos/bike-front.jpg"]
      },
      sellerToken
    );

    assert.equal(sellerCreate.response.status, 201);
    assert.equal(sellerCreate.payload.listing.sellerId, "integration-seller-1");
    assert.deepEqual(sellerCreate.payload.listing.photoUrls, [
      "https://example.com/photos/bike-front.jpg"
    ]);

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

test("listing photo uploads persist and can be downloaded", async () => {
  await withTestServer(async ({ requestJson, requestBinary }) => {
    const sellerRegister = await requestJson("POST", "/auth/register", {
      userId: "integration-seller-photo-1",
      email: "integration-seller-photo-1@example.com",
      password: "seller-password",
      role: "seller"
    });
    assert.equal(sellerRegister.response.status, 201);
    const sellerToken = sellerRegister.payload.token;

    const listingCreate = await requestJson(
      "POST",
      "/listings",
      {
        listingId: "integration-listing-photo-1",
        title: "Listing with uploaded photo",
        description: "Road bike with fresh photos",
        priceCents: 17500,
        localArea: "Toronto"
      },
      sellerToken
    );
    assert.equal(listingCreate.response.status, 201);

    const sampleContent = Buffer.from("fake-png-binary");
    const upload = await requestJson(
      "POST",
      "/listings/integration-listing-photo-1/photos",
      {
        photoId: "photo-1",
        fileName: "bike.png",
        mimeType: "image/png",
        contentBase64: sampleContent.toString("base64")
      },
      sellerToken
    );
    assert.equal(upload.response.status, 201);
    assert.equal(upload.payload.photo.id, "photo-1");
    assert.equal(upload.payload.photo.mimeType, "image/png");
    assert.match(upload.payload.photo.downloadUrl, /\/listings\/integration-listing-photo-1\/photos\/photo-1/);

    const listingFeed = await requestJson("GET", "/listings");
    assert.equal(listingFeed.response.status, 200);
    const saved = listingFeed.payload.listings.find((item) => item.id === "integration-listing-photo-1");
    assert.ok(saved);
    assert.equal(saved.uploadedPhotos.length, 1);
    assert.equal(saved.uploadedPhotos[0].id, "photo-1");

    const download = await requestBinary("GET", "/listings/integration-listing-photo-1/photos/photo-1");
    assert.equal(download.response.status, 200);
    assert.equal(download.response.headers.get("content-type"), "image/png");
    assert.deepEqual(download.payload, sampleContent);
  });
});
