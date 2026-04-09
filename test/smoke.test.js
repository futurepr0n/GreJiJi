import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createServer } from "../src/server.js";

async function withTestServer(options, fn) {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "grejiji-test-"));
  const databasePath = path.join(tempDirectory, "test.sqlite");
  const server = createServer({ databasePath, ...options });

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

    const payload = await response.json();
    return { response, payload };
  }

  async function registerUser({ userId, email, password, role }) {
    const result = await requestJson("POST", "/auth/register", { userId, email, password, role });
    assert.equal(result.response.status, 201);
    assert.ok(result.payload.token);
    return result.payload;
  }

  async function loginUser({ email, password }) {
    const result = await requestJson("POST", "/auth/login", { email, password });
    return result;
  }

  try {
    await fn({ requestJson, registerUser, loginUser });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
}

test("GET /health returns ok", async () => {
  await withTestServer({}, async ({ requestJson }) => {
    const { response, payload } = await requestJson("GET", "/health");

    assert.equal(response.status, 200);
    assert.equal(payload.status, "ok");
    assert.equal(payload.service, "grejiji-api");
  });
});

test("register/login succeeds and invalid login is rejected", async () => {
  await withTestServer({}, async ({ registerUser, loginUser }) => {
    const registration = await registerUser({
      userId: "user-buyer-1",
      email: "buyer@example.com",
      password: "buyer-password",
      role: "buyer"
    });

    assert.equal(registration.user.role, "buyer");

    const login = await loginUser({ email: "buyer@example.com", password: "buyer-password" });
    assert.equal(login.response.status, 200);
    assert.equal(login.payload.user.id, "user-buyer-1");
    assert.ok(login.payload.token);

    const invalidLogin = await loginUser({ email: "buyer@example.com", password: "wrong-pass" });
    assert.equal(invalidLogin.response.status, 403);
    assert.match(invalidLogin.payload.error, /invalid email or password/i);
  });
});

test("protected transaction route rejects unauthenticated requests", async () => {
  await withTestServer({}, async ({ requestJson }) => {
    const unauthenticated = await requestJson("POST", "/transactions", {
      transactionId: "txn-unauth-1",
      buyerId: "buyer-x",
      sellerId: "seller-x",
      amountCents: 1000
    });

    assert.equal(unauthenticated.response.status, 403);
    assert.match(unauthenticated.payload.error, /token/i);
  });
});

test("seller-only listing create and update authorization", async () => {
  await withTestServer({}, async ({ requestJson, registerUser }) => {
    const seller = await registerUser({
      userId: "seller-1",
      email: "seller@example.com",
      password: "seller-password",
      role: "seller"
    });

    const buyer = await registerUser({
      userId: "buyer-1",
      email: "buyer@example.com",
      password: "buyer-password",
      role: "buyer"
    });

    const createByBuyer = await requestJson(
      "POST",
      "/listings",
      { listingId: "listing-1", title: "Bike", priceCents: 25000, localArea: "Toronto" },
      buyer.token
    );
    assert.equal(createByBuyer.response.status, 403);

    const createBySeller = await requestJson(
      "POST",
      "/listings",
      {
        listingId: "listing-1",
        title: "Bike",
        description: "Road bike",
        priceCents: 25000,
        localArea: "Toronto"
      },
      seller.token
    );

    assert.equal(createBySeller.response.status, 201);
    assert.equal(createBySeller.payload.listing.sellerId, "seller-1");

    const updateByBuyer = await requestJson(
      "PATCH",
      "/listings/listing-1",
      { title: "Updated", description: "Updated", priceCents: 26000, localArea: "Toronto" },
      buyer.token
    );
    assert.equal(updateByBuyer.response.status, 403);

    const updateBySeller = await requestJson(
      "PATCH",
      "/listings/listing-1",
      {
        title: "Bike v2",
        description: "Tuned bike",
        priceCents: 27500,
        localArea: "Toronto"
      },
      seller.token
    );

    assert.equal(updateBySeller.response.status, 200);
    assert.equal(updateBySeller.payload.listing.title, "Bike v2");
  });
});

test("dispute creation is restricted to participants and adjudication is admin-only", async () => {
  await withTestServer({}, async ({ requestJson, registerUser }) => {
    const seller = await registerUser({
      userId: "seller-2",
      email: "seller2@example.com",
      password: "seller-password",
      role: "seller"
    });
    const buyer = await registerUser({
      userId: "buyer-2",
      email: "buyer2@example.com",
      password: "buyer-password",
      role: "buyer"
    });
    const outsider = await registerUser({
      userId: "buyer-3",
      email: "buyer3@example.com",
      password: "buyer-password",
      role: "buyer"
    });
    const admin = await registerUser({
      userId: "admin-1",
      email: "admin@example.com",
      password: "admin-password",
      role: "admin"
    });

    const created = await requestJson(
      "POST",
      "/transactions",
      {
        transactionId: "txn-authz-1",
        buyerId: "buyer-2",
        amountCents: 5400
      },
      seller.token
    );
    assert.equal(created.response.status, 201);
    assert.equal(created.payload.transaction.sellerId, "seller-2");

    const outsiderDispute = await requestJson(
      "POST",
      "/transactions/txn-authz-1/disputes",
      {},
      outsider.token
    );
    assert.equal(outsiderDispute.response.status, 403);

    const participantDispute = await requestJson(
      "POST",
      "/transactions/txn-authz-1/disputes",
      {},
      buyer.token
    );
    assert.equal(participantDispute.response.status, 200);
    assert.equal(participantDispute.payload.transaction.status, "disputed");

    const nonAdminAdjudication = await requestJson(
      "POST",
      "/transactions/txn-authz-1/disputes/adjudicate",
      { decision: "refund_to_buyer" },
      buyer.token
    );
    assert.equal(nonAdminAdjudication.response.status, 403);

    const adminAdjudication = await requestJson(
      "POST",
      "/transactions/txn-authz-1/disputes/adjudicate",
      { decision: "refund_to_buyer", notes: "verified claim" },
      admin.token
    );
    assert.equal(adminAdjudication.response.status, 200);
    assert.equal(adminAdjudication.payload.transaction.adjudicationDecision, "refund_to_buyer");
  });
});

test("admin can run auto-release and participant can confirm delivery", async () => {
  await withTestServer({ releaseTimeoutHours: 1 }, async ({ requestJson, registerUser }) => {
    const seller = await registerUser({
      userId: "seller-3",
      email: "seller3@example.com",
      password: "seller-password",
      role: "seller"
    });
    const buyer = await registerUser({
      userId: "buyer-4",
      email: "buyer4@example.com",
      password: "buyer-password",
      role: "buyer"
    });
    const admin = await registerUser({
      userId: "admin-2",
      email: "admin2@example.com",
      password: "admin-password",
      role: "admin"
    });

    const acceptedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

    const created = await requestJson(
      "POST",
      "/transactions",
      {
        transactionId: "txn-auto-auth-1",
        buyerId: "buyer-4",
        amountCents: 8800,
        acceptedAt
      },
      seller.token
    );
    assert.equal(created.response.status, 201);

    const nonAdminAutoRelease = await requestJson("POST", "/jobs/auto-release", {}, seller.token);
    assert.equal(nonAdminAutoRelease.response.status, 403);

    const autoRelease = await requestJson("POST", "/jobs/auto-release", {}, admin.token);
    assert.equal(autoRelease.response.status, 200);
    assert.equal(autoRelease.payload.releasedCount, 1);

    const createdSecond = await requestJson(
      "POST",
      "/transactions",
      {
        transactionId: "txn-confirm-auth-1",
        buyerId: "buyer-4",
        amountCents: 9100
      },
      seller.token
    );
    assert.equal(createdSecond.response.status, 201);

    const buyerConfirm = await requestJson(
      "POST",
      "/transactions/txn-confirm-auth-1/confirm-delivery",
      {},
      buyer.token
    );
    assert.equal(buyerConfirm.response.status, 200);
    assert.equal(buyerConfirm.payload.transaction.payoutReleaseReason, "buyer_confirmation");
  });
});
