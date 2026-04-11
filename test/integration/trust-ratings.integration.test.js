import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createServer } from "../../src/server.js";

async function withTestServer(fn) {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "grejiji-trust-int-"));
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

test("ratings and closure safeguards enforce dual-sided flow, pending state, duplicate rejection, and dispute diversion", async () => {
  await withTestServer(async ({ requestJson, registerUser }) => {
    const sellerToken = await registerUser({
      userId: "trust-seller-1",
      email: "trust-seller-1@example.com",
      role: "seller"
    });
    const buyerToken = await registerUser({
      userId: "trust-buyer-1",
      email: "trust-buyer-1@example.com",
      role: "buyer"
    });
    const outsiderToken = await registerUser({
      userId: "trust-outsider-1",
      email: "trust-outsider-1@example.com",
      role: "buyer"
    });

    const created = await requestJson(
      "POST",
      "/transactions",
      {
        transactionId: "trust-txn-1",
        sellerId: "trust-seller-1",
        amountCents: 5000
      },
      buyerToken
    );
    assert.equal(created.response.status, 201);

    const completed = await requestJson(
      "POST",
      "/transactions/trust-txn-1/confirm-delivery",
      {},
      buyerToken
    );
    assert.equal(completed.response.status, 200);
    assert.equal(completed.payload.transaction.status, "completed");

    const pendingRatings = await requestJson(
      "GET",
      "/transactions/trust-txn-1/ratings",
      undefined,
      buyerToken
    );
    assert.equal(pendingRatings.response.status, 200);
    assert.equal(pendingRatings.payload.trust.ratingsState, "pending");
    assert.deepEqual(pendingRatings.payload.trust.pendingBy.sort(), ["buyer", "seller"]);

    const buyerRating = await requestJson(
      "POST",
      "/transactions/trust-txn-1/ratings",
      { score: 5, comment: "Smooth pickup and fast response." },
      buyerToken
    );
    assert.equal(buyerRating.response.status, 201);
    assert.equal(buyerRating.payload.rating.raterUserId, "trust-buyer-1");

    const sellerStillPending = await requestJson(
      "GET",
      "/transactions/trust-txn-1/ratings",
      undefined,
      sellerToken
    );
    assert.equal(sellerStillPending.response.status, 200);
    assert.equal(sellerStillPending.payload.trust.ratingsState, "pending");
    assert.deepEqual(sellerStillPending.payload.trust.pendingBy, ["seller"]);

    const duplicateBuyerRating = await requestJson(
      "POST",
      "/transactions/trust-txn-1/ratings",
      { score: 4, comment: "Duplicate should fail." },
      buyerToken
    );
    assert.equal(duplicateBuyerRating.response.status, 409);
    assert.match(duplicateBuyerRating.payload.error, /already submitted/i);

    const sellerAck = await requestJson(
      "POST",
      "/transactions/trust-txn-1/acknowledge-completion",
      {},
      sellerToken
    );
    assert.equal(sellerAck.response.status, 200);
    assert.ok(sellerAck.payload.transaction.sellerCompletionAcknowledgedAt);

    const sellerAckDuplicate = await requestJson(
      "POST",
      "/transactions/trust-txn-1/acknowledge-completion",
      {},
      sellerToken
    );
    assert.equal(sellerAckDuplicate.response.status, 409);

    const sellerRating = await requestJson(
      "POST",
      "/transactions/trust-txn-1/ratings",
      { score: 5, comment: "Buyer confirmed quickly." },
      sellerToken
    );
    assert.equal(sellerRating.response.status, 201);

    const bothRated = await requestJson(
      "GET",
      "/transactions/trust-txn-1/ratings",
      undefined,
      buyerToken
    );
    assert.equal(bothRated.response.status, 200);
    assert.equal(bothRated.payload.trust.ratingsState, "complete");
    assert.deepEqual(bothRated.payload.trust.pendingBy, []);

    const reputation = await requestJson("GET", "/users/trust-seller-1/reputation");
    assert.equal(reputation.response.status, 200);
    assert.equal(reputation.payload.reputation.userId, "trust-seller-1");
    assert.equal(reputation.payload.reputation.ratingCount, 1);

    const outsiderReadDenied = await requestJson(
      "GET",
      "/transactions/trust-txn-1/ratings",
      undefined,
      outsiderToken
    );
    assert.equal(outsiderReadDenied.response.status, 403);

    const outsiderWriteDenied = await requestJson(
      "POST",
      "/transactions/trust-txn-1/ratings",
      { score: 1 },
      outsiderToken
    );
    assert.equal(outsiderWriteDenied.response.status, 403);

    const disputedCreated = await requestJson(
      "POST",
      "/transactions",
      {
        transactionId: "trust-txn-2",
        sellerId: "trust-seller-1",
        amountCents: 7000
      },
      buyerToken
    );
    assert.equal(disputedCreated.response.status, 201);

    const disputeOpened = await requestJson(
      "POST",
      "/transactions/trust-txn-2/disputes",
      {},
      buyerToken
    );
    assert.equal(disputeOpened.response.status, 200);
    assert.equal(disputeOpened.payload.transaction.status, "disputed");

    const confirmBlockedByDispute = await requestJson(
      "POST",
      "/transactions/trust-txn-2/confirm-delivery",
      {},
      buyerToken
    );
    assert.equal(confirmBlockedByDispute.response.status, 409);

    const ratingBlockedByDispute = await requestJson(
      "POST",
      "/transactions/trust-txn-2/ratings",
      { score: 2 },
      buyerToken
    );
    assert.equal(ratingBlockedByDispute.response.status, 409);
    assert.match(ratingBlockedByDispute.payload.error, /after transaction completion/i);
  });
});
