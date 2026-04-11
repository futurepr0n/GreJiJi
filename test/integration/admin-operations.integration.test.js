import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createServer } from "../../src/server.js";

async function withTestServer(fn) {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "grejiji-admin-ops-int-"));
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

    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }

    return { response, payload };
  }

  async function registerUser({ userId, email, role }) {
    const result = await requestJson("POST", "/auth/register", {
      userId,
      email,
      password: "password-123",
      role
    });
    assert.equal(result.response.status, 201);
    return result.payload.token;
  }

  try {
    await fn({ requestJson, registerUser });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
}

test("admin operations: moderation and dispute workflows are end-to-end reachable", async () => {
  await withTestServer(async ({ requestJson, registerUser }) => {
    const sellerToken = await registerUser({
      userId: "ops-seller-1",
      email: "ops-seller-1@example.com",
      role: "seller"
    });
    const buyerToken = await registerUser({
      userId: "ops-buyer-1",
      email: "ops-buyer-1@example.com",
      role: "buyer"
    });
    const adminToken = await registerUser({
      userId: "ops-admin-1",
      email: "ops-admin-1@example.com",
      role: "admin"
    });

    const listingCreated = await requestJson(
      "POST",
      "/listings",
      {
        listingId: "ops-listing-1",
        title: "Desk Lamp",
        description: "Works",
        priceCents: 3500,
        localArea: "Toronto"
      },
      sellerToken
    );
    assert.equal(listingCreated.response.status, 201);
    assert.equal(listingCreated.payload.listing.moderationStatus, "pending_review");

    const moderationQueue = await requestJson(
      "GET",
      "/admin/listings/moderation?status=pending_review",
      undefined,
      adminToken
    );
    assert.equal(moderationQueue.response.status, 200);
    assert.ok(moderationQueue.payload.queue.some((listing) => listing.id === "ops-listing-1"));

    const approved = await requestJson(
      "POST",
      "/admin/listings/ops-listing-1/moderation/approve",
      { reasonCode: "manual_review", notes: "approved from console" },
      adminToken
    );
    assert.equal(approved.response.status, 200);
    assert.equal(approved.payload.listing.moderationStatus, "approved");

    const createdTxn = await requestJson(
      "POST",
      "/transactions",
      {
        transactionId: "ops-txn-1",
        sellerId: "ops-seller-1",
        amountCents: 4500
      },
      buyerToken
    );
    assert.equal(createdTxn.response.status, 201);

    const openedDispute = await requestJson(
      "POST",
      "/transactions/ops-txn-1/disputes",
      {},
      buyerToken
    );
    assert.equal(openedDispute.response.status, 200);
    assert.equal(openedDispute.payload.transaction.status, "disputed");

    const queueOpen = await requestJson(
      "GET",
      "/admin/disputes?filter=open&sortBy=updatedAt&sortOrder=desc",
      undefined,
      adminToken
    );
    assert.equal(queueOpen.response.status, 200);
    assert.ok(queueOpen.payload.disputes.some((row) => row.transaction.id === "ops-txn-1"));

    const adjudicated = await requestJson(
      "POST",
      "/transactions/ops-txn-1/disputes/adjudicate",
      { decision: "release_to_seller", notes: "verified delivery evidence" },
      adminToken
    );
    assert.equal(adjudicated.response.status, 200);
    assert.equal(adjudicated.payload.transaction.adjudicationDecision, "release_to_seller");

    const queueResolved = await requestJson(
      "GET",
      "/admin/disputes?filter=resolved",
      undefined,
      adminToken
    );
    assert.equal(queueResolved.response.status, 200);
    assert.ok(queueResolved.payload.disputes.some((row) => row.transaction.id === "ops-txn-1"));
  });
});

test("admin operations: non-admin users are denied admin routes", async () => {
  await withTestServer(async ({ requestJson, registerUser }) => {
    const sellerToken = await registerUser({
      userId: "ops-seller-2",
      email: "ops-seller-2@example.com",
      role: "seller"
    });

    const buyerToken = await registerUser({
      userId: "ops-buyer-2",
      email: "ops-buyer-2@example.com",
      role: "buyer"
    });

    const listingCreated = await requestJson(
      "POST",
      "/listings",
      {
        listingId: "ops-listing-2",
        title: "Kitchen Set",
        description: "new",
        priceCents: 20000,
        localArea: "Toronto"
      },
      sellerToken
    );
    assert.equal(listingCreated.response.status, 201);

    const transactionCreated = await requestJson(
      "POST",
      "/transactions",
      {
        transactionId: "ops-txn-2",
        sellerId: "ops-seller-2",
        amountCents: 20000
      },
      buyerToken
    );
    assert.equal(transactionCreated.response.status, 201);

    const moderationQueueDenied = await requestJson(
      "GET",
      "/admin/listings/moderation?status=pending_review",
      undefined,
      sellerToken
    );
    assert.equal(moderationQueueDenied.response.status, 403);

    const disputesQueueDenied = await requestJson(
      "GET",
      "/admin/disputes?filter=open",
      undefined,
      buyerToken
    );
    assert.equal(disputesQueueDenied.response.status, 403);

    const transactionRiskDenied = await requestJson(
      "GET",
      "/admin/transactions/ops-txn-2/risk",
      undefined,
      sellerToken
    );
    assert.equal(transactionRiskDenied.response.status, 403);
  });
});
