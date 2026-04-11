import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { createServer } from "../src/server.js";

async function withTestServer(options, fn) {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "grejiji-test-"));
  const databasePath = path.join(tempDirectory, "test.sqlite");
  const evidenceStoragePath = path.join(tempDirectory, "dispute-evidence");
  const server = createServer({ databasePath, evidenceStoragePath, ...options });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const baseUrl = `http://127.0.0.1:${port}`;

  async function requestJson(method, endpoint, body, token, extraHeaders = {}) {
    const headers = { "Content-Type": "application/json", ...extraHeaders };
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

  async function requestRawJson(method, endpoint, rawBody, headers = {}) {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers,
      body: rawBody
    });
    const payload = await response.json();
    return { response, payload };
  }

  async function requestText(method, endpoint, token) {
    const headers = {};
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers
    });

    const payload = await response.text();
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
    await fn({ requestJson, requestRawJson, requestText, registerUser, loginUser, databasePath });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
}

function signStripePayload({ body, secret, timestamp }) {
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

test("GET /health returns ok", async () => {
  await withTestServer({}, async ({ requestJson }) => {
    const { response, payload } = await requestJson("GET", "/health");

    assert.equal(response.status, 200);
    assert.equal(payload.status, "ok");
    assert.equal(payload.service, "grejiji-api");
  });
});

test("GET /ready returns service and db readiness", async () => {
  await withTestServer({}, async ({ requestJson }) => {
    const { response, payload } = await requestJson("GET", "/ready");

    assert.equal(response.status, 200);
    assert.equal(payload.status, "ready");
    assert.equal(payload.service, "grejiji-api");
    assert.equal(payload.db, "ok");
  });
});

test("request correlation IDs propagate and /metrics exposes core SLO telemetry", async () => {
  await withTestServer({}, async ({ requestJson }) => {
    const correlationId = "corr-observability-test-1";
    const register = await requestJson(
      "POST",
      "/auth/register",
      {
        userId: "metrics-buyer-1",
        email: "metrics-buyer-1@example.com",
        password: "buyer-password",
        role: "buyer"
      },
      null,
      { "x-correlation-id": correlationId }
    );

    assert.equal(register.response.status, 201);
    assert.equal(register.response.headers.get("x-correlation-id"), correlationId);
    assert.ok(register.response.headers.get("x-request-id"));

    const failedLogin = await requestJson("POST", "/auth/login", {
      email: "metrics-buyer-1@example.com",
      password: "wrong-password"
    });
    assert.equal(failedLogin.response.status, 403);

    const metrics = await requestJson("GET", "/metrics");
    assert.equal(metrics.response.status, 200);
    assert.equal(metrics.payload.service, "grejiji-api");
    assert.ok(metrics.payload.slo?.coreFlow);
    assert.equal(typeof metrics.payload.slo.coreFlow.availability, "number");
    assert.equal(typeof metrics.payload.slo.coreFlow.errorBudgetBurnRate, "number");

    const authRejectedCounter = metrics.payload.counters.find(
      (entry) =>
        entry.name === "api.requests.total" &&
        entry.labels.flow === "auth.login" &&
        entry.labels.outcome === "rejected"
    );
    assert.ok(authRejectedCounter);
    assert.ok(authRejectedCounter.value >= 1);
  });
});

test("GET /docs returns browsable HTML documentation", async () => {
  await withTestServer({}, async ({ requestText }) => {
    const { response, payload } = await requestText("GET", "/docs");

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.match(payload, /<title>GreJiJi API Docs<\/title>/);
    assert.match(payload, /Table of contents/i);
    assert.match(payload, /GET \/transactions\/:id\/events/);
  });
});

test("GET /app and static assets serve the responsive web UI shell", async () => {
  await withTestServer({}, async ({ requestText }) => {
    const appPage = await requestText("GET", "/app");
    assert.equal(appPage.response.status, 200);
    assert.match(appPage.response.headers.get("content-type") ?? "", /text\/html/);
    assert.match(appPage.payload, /<title>GreJiJi Marketplace Console<\/title>/);
    assert.match(appPage.payload, /id="register-form"/);
    assert.match(appPage.payload, /id="admin-disputes-panel"/);
    assert.match(appPage.payload, /id="admin-moderation-panel"/);
    assert.match(appPage.payload, /id="admin-risk-panel"/);
    assert.match(appPage.payload, /id="admin-moderation-action-form"/);
    assert.match(appPage.payload, /id="admin-risk-action-form"/);
    assert.match(appPage.payload, /src="\/app\/client.js"/);

    const client = await requestText("GET", "/app/client.js");
    assert.equal(client.response.status, 200);
    assert.match(client.response.headers.get("content-type") ?? "", /text\/javascript/);
    assert.match(client.payload, /async function apiRequest/);
    assert.match(client.payload, /renderRoleUI/);
    assert.match(client.payload, /loadModerationDetail/);
    assert.match(client.payload, /loadTransactionRiskDetail/);

    const styles = await requestText("GET", "/app/styles.css");
    assert.equal(styles.response.status, 200);
    assert.match(styles.response.headers.get("content-type") ?? "", /text\/css/);
    assert.match(styles.payload, /@media \(max-width: 980px\)/);
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

test("auth routes enforce rate limiting after repeated failures", async () => {
  await withTestServer({}, async ({ requestJson }) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const failed = await requestJson("POST", "/auth/login", {
        email: "nobody@example.com",
        password: "bad-password"
      });
      assert.equal(failed.response.status, 403);
    }

    const throttled = await requestJson("POST", "/auth/login", {
      email: "nobody@example.com",
      password: "bad-password"
    });
    assert.equal(throttled.response.status, 429);
    assert.match(throttled.payload.error, /rate limit/i);
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

test("transaction APIs expose deterministic service-fee and settlement breakdown fields", async () => {
  await withTestServer(
    { serviceFeeFixedCents: 200, serviceFeePercent: 5, settlementCurrency: "cad" },
    async ({ requestJson, registerUser }) => {
      const seller = await registerUser({
        userId: "seller-fee-1",
        email: "seller-fee-1@example.com",
        password: "seller-password",
        role: "seller"
      });
      const buyer = await registerUser({
        userId: "buyer-fee-1",
        email: "buyer-fee-1@example.com",
        password: "buyer-password",
        role: "buyer"
      });

      const created = await requestJson(
        "POST",
        "/transactions",
        {
          transactionId: "txn-fee-breakdown-1",
          buyerId: buyer.user.id,
          amountCents: 10000
        },
        seller.token
      );
      assert.equal(created.response.status, 201);
      assert.equal(created.payload.transaction.amountCents, 10000);
      assert.equal(created.payload.transaction.itemPrice, 10000);
      assert.equal(created.payload.transaction.serviceFee, 700);
      assert.equal(created.payload.transaction.totalBuyerCharge, 10700);
      assert.equal(created.payload.transaction.sellerNet, 10000);
      assert.equal(created.payload.transaction.currency, "CAD");
      assert.equal(created.payload.transaction.settlementOutcome, null);
      assert.equal(created.payload.transaction.paymentProvider, "local");
      assert.equal(created.payload.transaction.paymentStatus, "captured");
      assert.match(created.payload.transaction.providerPaymentIntentId, /^pi_local_/);
      assert.match(created.payload.transaction.providerChargeId, /^ch_local_/);

      const fetched = await requestJson(
        "GET",
        "/transactions/txn-fee-breakdown-1",
        undefined,
        buyer.token
      );
      assert.equal(fetched.response.status, 200);
      assert.equal(fetched.payload.transaction.serviceFee, 700);
      assert.equal(fetched.payload.transaction.totalBuyerCharge, 10700);
      assert.equal(fetched.payload.transaction.sellerNet, 10000);
      assert.equal(fetched.payload.transaction.currency, "CAD");
      assert.equal(fetched.payload.transaction.paymentProvider, "local");
      assert.equal(fetched.payload.transaction.paymentStatus, "captured");
    }
  );
});

test("settlement outcomes persist auditable completed, refunded, and cancelled financial snapshots", async () => {
  await withTestServer(
    { serviceFeeFixedCents: 300, serviceFeePercent: 2.5, settlementCurrency: "USD" },
    async ({ requestJson, registerUser, databasePath }) => {
      const seller = await registerUser({
        userId: "seller-fee-2",
        email: "seller-fee-2@example.com",
        password: "seller-password",
        role: "seller"
      });
      const buyer = await registerUser({
        userId: "buyer-fee-2",
        email: "buyer-fee-2@example.com",
        password: "buyer-password",
        role: "buyer"
      });
      const admin = await registerUser({
        userId: "admin-fee-2",
        email: "admin-fee-2@example.com",
        password: "admin-password",
        role: "admin"
      });

      const createTransaction = async (transactionId) =>
        requestJson(
          "POST",
          "/transactions",
          {
            transactionId,
            buyerId: buyer.user.id,
            amountCents: 12000
          },
          seller.token
        );

      assert.equal((await createTransaction("txn-fee-release")).response.status, 201);
      assert.equal((await createTransaction("txn-fee-refund")).response.status, 201);
      assert.equal((await createTransaction("txn-fee-cancel")).response.status, 201);

      assert.equal(
        (await requestJson("POST", "/transactions/txn-fee-release/disputes", {}, buyer.token)).response
          .status,
        200
      );
      assert.equal(
        (await requestJson("POST", "/transactions/txn-fee-refund/disputes", {}, buyer.token)).response
          .status,
        200
      );
      assert.equal(
        (await requestJson("POST", "/transactions/txn-fee-cancel/disputes", {}, buyer.token)).response
          .status,
        200
      );

      const release = await requestJson(
        "POST",
        "/transactions/txn-fee-release/disputes/adjudicate",
        { decision: "release_to_seller" },
        admin.token
      );
      const refund = await requestJson(
        "POST",
        "/transactions/txn-fee-refund/disputes/adjudicate",
        { decision: "refund_to_buyer" },
        admin.token
      );
      const cancelled = await requestJson(
        "POST",
        "/transactions/txn-fee-cancel/disputes/adjudicate",
        { decision: "cancel_transaction" },
        admin.token
      );

      assert.equal(release.response.status, 200);
      assert.equal(release.payload.transaction.settlementOutcome, "completed");
      assert.equal(release.payload.transaction.totalBuyerCharge, 12600);
      assert.equal(release.payload.transaction.sellerNet, 12000);
      assert.equal(release.payload.transaction.serviceFee, 600);
      assert.equal(release.payload.transaction.settledBuyerCharge, 12600);
      assert.equal(release.payload.transaction.settledSellerPayout, 12000);
      assert.equal(release.payload.transaction.settledPlatformFee, 600);

      assert.equal(refund.response.status, 200);
      assert.equal(refund.payload.transaction.settlementOutcome, "refunded");
      assert.equal(refund.payload.transaction.settledBuyerCharge, 0);
      assert.equal(refund.payload.transaction.settledSellerPayout, 0);
      assert.equal(refund.payload.transaction.settledPlatformFee, 0);
      assert.equal(refund.payload.transaction.paymentStatus, "refunded");
      assert.match(refund.payload.transaction.providerLastRefundId, /^re_local_/);

      assert.equal(cancelled.response.status, 200);
      assert.equal(cancelled.payload.transaction.settlementOutcome, "cancelled");
      assert.equal(cancelled.payload.transaction.settledBuyerCharge, 0);
      assert.equal(cancelled.payload.transaction.settledSellerPayout, 0);
      assert.equal(cancelled.payload.transaction.settledPlatformFee, 0);
      assert.equal(cancelled.payload.transaction.paymentStatus, "refunded");
      assert.match(cancelled.payload.transaction.providerLastRefundId, /^re_local_/);

      const db = new Database(databasePath, { readonly: true });
      const paymentOps = db
        .prepare(
          "SELECT transaction_id, operation, provider, status FROM payment_operations WHERE transaction_id IN ('txn-fee-release', 'txn-fee-refund', 'txn-fee-cancel') ORDER BY transaction_id, operation"
        )
        .all();
      db.close();

      assert.deepEqual(
        paymentOps.map((row) => `${row.transaction_id}:${row.operation}:${row.provider}:${row.status}`),
        [
          "txn-fee-cancel:authorize_capture:local:succeeded",
          "txn-fee-cancel:refund:local:succeeded",
          "txn-fee-refund:authorize_capture:local:succeeded",
          "txn-fee-refund:refund:local:succeeded",
          "txn-fee-release:authorize_capture:local:succeeded"
        ]
      );
    }
  );
});

test("server rejects negative service fee configuration values", async () => {
  await assert.rejects(
    async () => {
      const server = createServer({ serviceFeeFixedCents: -1 });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
    /SERVICE_FEE_FIXED_CENTS must be a non-negative integer/
  );
});

test("event history endpoint is role-protected and success path writes outbox rows", async () => {
  await withTestServer({}, async ({ requestJson, registerUser, databasePath }) => {
    const seller = await registerUser({
      userId: "seller-events-1",
      email: "seller-events-1@example.com",
      password: "seller-password",
      role: "seller"
    });
    const buyer = await registerUser({
      userId: "buyer-events-1",
      email: "buyer-events-1@example.com",
      password: "buyer-password",
      role: "buyer"
    });
    const outsider = await registerUser({
      userId: "buyer-events-outsider",
      email: "buyer-events-outsider@example.com",
      password: "buyer-password",
      role: "buyer"
    });

    const created = await requestJson(
      "POST",
      "/transactions",
      {
        transactionId: "txn-events-success-1",
        buyerId: buyer.user.id,
        amountCents: 12000
      },
      seller.token
    );
    assert.equal(created.response.status, 201);

    const confirmed = await requestJson(
      "POST",
      "/transactions/txn-events-success-1/confirm-delivery",
      {},
      buyer.token
    );
    assert.equal(confirmed.response.status, 200);

    const unauthorizedHistory = await requestJson(
      "GET",
      "/transactions/txn-events-success-1/events",
      undefined,
      outsider.token
    );
    assert.equal(unauthorizedHistory.response.status, 403);

    const authorizedHistory = await requestJson(
      "GET",
      "/transactions/txn-events-success-1/events",
      undefined,
      buyer.token
    );
    assert.equal(authorizedHistory.response.status, 200);
    assert.deepEqual(
      authorizedHistory.payload.events.map((event) => event.eventType),
      ["payment_captured", "buyer_confirmed", "settlement_completed"]
    );

    const db = new Database(databasePath, { readonly: true });
    const pendingOutbox = db
      .prepare(
        "SELECT topic, recipient_user_id FROM notification_outbox WHERE transaction_id = ? ORDER BY id ASC"
      )
      .all("txn-events-success-1");
    db.close();

    assert.deepEqual(
      pendingOutbox.map((row) => row.topic),
      ["payment_received", "action_required", "dispute_update"]
    );
  });
});

test("dispute path writes ordered events and dispute-update outbox notifications", async () => {
  await withTestServer({}, async ({ requestJson, registerUser, databasePath }) => {
    const seller = await registerUser({
      userId: "seller-events-2",
      email: "seller-events-2@example.com",
      password: "seller-password",
      role: "seller"
    });
    const buyer = await registerUser({
      userId: "buyer-events-2",
      email: "buyer-events-2@example.com",
      password: "buyer-password",
      role: "buyer"
    });
    const admin = await registerUser({
      userId: "admin-events-2",
      email: "admin-events-2@example.com",
      password: "admin-password",
      role: "admin"
    });

    const created = await requestJson(
      "POST",
      "/transactions",
      {
        transactionId: "txn-events-dispute-1",
        buyerId: buyer.user.id,
        amountCents: 14000
      },
      seller.token
    );
    assert.equal(created.response.status, 201);

    const opened = await requestJson(
      "POST",
      "/transactions/txn-events-dispute-1/disputes",
      {},
      buyer.token
    );
    assert.equal(opened.response.status, 200);

    const adjudicated = await requestJson(
      "POST",
      "/transactions/txn-events-dispute-1/disputes/adjudicate",
      { decision: "refund_to_buyer", notes: "item not delivered" },
      admin.token
    );
    assert.equal(adjudicated.response.status, 200);

    const history = await requestJson(
      "GET",
      "/transactions/txn-events-dispute-1/events",
      undefined,
      admin.token
    );
    assert.equal(history.response.status, 200);
    assert.deepEqual(
      history.payload.events.map((event) => event.eventType),
      ["payment_captured", "dispute_opened", "dispute_adjudicated", "settlement_refunded"]
    );

    const db = new Database(databasePath, { readonly: true });
    const pendingOutbox = db
      .prepare(
        "SELECT topic FROM notification_outbox WHERE transaction_id = ? ORDER BY id ASC"
      )
      .all("txn-events-dispute-1");
    db.close();

    assert.deepEqual(
      pendingOutbox.map((row) => row.topic),
      [
        "payment_received",
        "action_required",
        "action_required",
        "dispute_update",
        "dispute_update",
        "dispute_update"
      ]
    );
  });
});

test("dispute evidence upload/list/download enforces authz and validation", async () => {
  await withTestServer({}, async ({ requestJson, requestText, registerUser }) => {
    const seller = await registerUser({
      userId: "seller-evidence-1",
      email: "seller-evidence-1@example.com",
      password: "seller-password",
      role: "seller"
    });
    const buyer = await registerUser({
      userId: "buyer-evidence-1",
      email: "buyer-evidence-1@example.com",
      password: "buyer-password",
      role: "buyer"
    });
    const outsider = await registerUser({
      userId: "buyer-evidence-outsider",
      email: "buyer-evidence-outsider@example.com",
      password: "buyer-password",
      role: "buyer"
    });
    const admin = await registerUser({
      userId: "admin-evidence-1",
      email: "admin-evidence-1@example.com",
      password: "admin-password",
      role: "admin"
    });

    const created = await requestJson(
      "POST",
      "/transactions",
      {
        transactionId: "txn-evidence-1",
        buyerId: buyer.user.id,
        amountCents: 16000
      },
      seller.token
    );
    assert.equal(created.response.status, 201);

    const opened = await requestJson(
      "POST",
      "/transactions/txn-evidence-1/disputes",
      {},
      buyer.token
    );
    assert.equal(opened.response.status, 200);

    const outsiderUpload = await requestJson(
      "POST",
      "/transactions/txn-evidence-1/disputes/evidence",
      {
        fileName: "receipt.txt",
        mimeType: "text/plain",
        contentBase64: Buffer.from("proof").toString("base64")
      },
      outsider.token
    );
    assert.equal(outsiderUpload.response.status, 403);

    const invalidChecksumUpload = await requestJson(
      "POST",
      "/transactions/txn-evidence-1/disputes/evidence",
      {
        fileName: "receipt.txt",
        mimeType: "text/plain",
        contentBase64: Buffer.from("proof").toString("base64"),
        checksumSha256: "invalid"
      },
      buyer.token
    );
    assert.equal(invalidChecksumUpload.response.status, 400);

    const uploaded = await requestJson(
      "POST",
      "/transactions/txn-evidence-1/disputes/evidence",
      {
        evidenceId: "evidence-1",
        fileName: "receipt.txt",
        mimeType: "text/plain",
        contentBase64: Buffer.from("proof").toString("base64")
      },
      buyer.token
    );
    assert.equal(uploaded.response.status, 201);
    assert.equal(uploaded.payload.evidence.transactionId, "txn-evidence-1");
    assert.equal(uploaded.payload.evidence.uploaderUserId, buyer.user.id);
    assert.equal(uploaded.payload.evidence.sizeBytes, 5);

    const participantList = await requestJson(
      "GET",
      "/transactions/txn-evidence-1/disputes/evidence",
      undefined,
      seller.token
    );
    assert.equal(participantList.response.status, 200);
    assert.equal(participantList.payload.evidence.length, 1);

    const outsiderList = await requestJson(
      "GET",
      "/transactions/txn-evidence-1/disputes/evidence",
      undefined,
      outsider.token
    );
    assert.equal(outsiderList.response.status, 403);

    const adminDownload = await requestText(
      "GET",
      "/transactions/txn-evidence-1/disputes/evidence/evidence-1/download",
      admin.token
    );
    assert.equal(adminDownload.response.status, 200);
    assert.equal(adminDownload.payload, "proof");
  });
});

test("admin dispute queue filters and detail endpoint include evidence and timeline", async () => {
  await withTestServer({}, async ({ requestJson, registerUser }) => {
    const seller = await registerUser({
      userId: "seller-admin-disputes-1",
      email: "seller-admin-disputes-1@example.com",
      password: "seller-password",
      role: "seller"
    });
    const buyer = await registerUser({
      userId: "buyer-admin-disputes-1",
      email: "buyer-admin-disputes-1@example.com",
      password: "buyer-password",
      role: "buyer"
    });
    const admin = await registerUser({
      userId: "admin-admin-disputes-1",
      email: "admin-admin-disputes-1@example.com",
      password: "admin-password",
      role: "admin"
    });

    const createTransaction = async (transactionId) =>
      requestJson(
        "POST",
        "/transactions",
        {
          transactionId,
          buyerId: buyer.user.id,
          amountCents: 11000
        },
        seller.token
      );

    assert.equal((await createTransaction("txn-queue-needs-evidence")).response.status, 201);
    assert.equal((await createTransaction("txn-queue-awaiting-decision")).response.status, 201);
    assert.equal((await createTransaction("txn-queue-resolved")).response.status, 201);

    assert.equal(
      (
        await requestJson(
          "POST",
          "/transactions/txn-queue-needs-evidence/disputes",
          {},
          buyer.token
        )
      ).response.status,
      200
    );
    assert.equal(
      (
        await requestJson(
          "POST",
          "/transactions/txn-queue-awaiting-decision/disputes",
          {},
          buyer.token
        )
      ).response.status,
      200
    );
    assert.equal(
      (
        await requestJson(
          "POST",
          "/transactions/txn-queue-resolved/disputes",
          {},
          buyer.token
        )
      ).response.status,
      200
    );

    const evidenceUpload = await requestJson(
      "POST",
      "/transactions/txn-queue-awaiting-decision/disputes/evidence",
      {
        evidenceId: "queue-evidence-1",
        fileName: "chat-screenshot.txt",
        mimeType: "text/plain",
        contentBase64: Buffer.from("chat evidence").toString("base64")
      },
      buyer.token
    );
    assert.equal(evidenceUpload.response.status, 201);

    const adjudicated = await requestJson(
      "POST",
      "/transactions/txn-queue-resolved/disputes/adjudicate",
      { decision: "refund_to_buyer", notes: "clear seller breach" },
      admin.token
    );
    assert.equal(adjudicated.response.status, 200);

    const forbiddenQueue = await requestJson(
      "GET",
      "/admin/disputes?filter=open",
      undefined,
      buyer.token
    );
    assert.equal(forbiddenQueue.response.status, 403);

    const needsEvidenceQueue = await requestJson(
      "GET",
      "/admin/disputes?filter=needs_evidence&sortBy=updatedAt&sortOrder=desc",
      undefined,
      admin.token
    );
    assert.equal(needsEvidenceQueue.response.status, 200);
    assert.equal(needsEvidenceQueue.payload.disputes.length, 1);
    assert.equal(
      needsEvidenceQueue.payload.disputes[0].transaction.id,
      "txn-queue-needs-evidence"
    );

    const awaitingDecisionQueue = await requestJson(
      "GET",
      "/admin/disputes?filter=awaiting_decision&sortBy=evidenceCount&sortOrder=desc",
      undefined,
      admin.token
    );
    assert.equal(awaitingDecisionQueue.response.status, 200);
    assert.equal(awaitingDecisionQueue.payload.disputes.length, 1);
    assert.equal(
      awaitingDecisionQueue.payload.disputes[0].transaction.id,
      "txn-queue-awaiting-decision"
    );
    assert.equal(awaitingDecisionQueue.payload.disputes[0].evidenceCount, 1);

    const resolvedQueue = await requestJson(
      "GET",
      "/admin/disputes?filter=resolved",
      undefined,
      admin.token
    );
    assert.equal(resolvedQueue.response.status, 200);
    assert.equal(resolvedQueue.payload.disputes.length, 1);
    assert.equal(resolvedQueue.payload.disputes[0].transaction.id, "txn-queue-resolved");

    const disputeDetail = await requestJson(
      "GET",
      "/admin/disputes/txn-queue-awaiting-decision",
      undefined,
      admin.token
    );
    assert.equal(disputeDetail.response.status, 200);
    assert.equal(disputeDetail.payload.dispute.transaction.id, "txn-queue-awaiting-decision");
    assert.equal(disputeDetail.payload.dispute.evidence.length, 1);
    assert.ok(disputeDetail.payload.dispute.events.length >= 2);
    assert.ok(Array.isArray(disputeDetail.payload.dispute.adjudicationActions));
  });
});

test("notification dispatcher populates inbox, enforces authz, and is idempotent", async () => {
  await withTestServer({}, async ({ requestJson, registerUser }) => {
    const seller = await registerUser({
      userId: "seller-notify-1",
      email: "seller-notify-1@example.com",
      password: "seller-password",
      role: "seller"
    });
    const buyer = await registerUser({
      userId: "buyer-notify-1",
      email: "buyer-notify-1@example.com",
      password: "buyer-password",
      role: "buyer"
    });
    const outsider = await registerUser({
      userId: "buyer-notify-outsider",
      email: "buyer-notify-outsider@example.com",
      password: "buyer-password",
      role: "buyer"
    });
    const admin = await registerUser({
      userId: "admin-notify-1",
      email: "admin-notify-1@example.com",
      password: "admin-password",
      role: "admin"
    });

    const created = await requestJson(
      "POST",
      "/transactions",
      {
        transactionId: "txn-notify-1",
        buyerId: buyer.user.id,
        amountCents: 18000
      },
      seller.token
    );
    assert.equal(created.response.status, 201);

    const dispatchFirst = await requestJson(
      "POST",
      "/jobs/notification-dispatch",
      { limit: 50 },
      admin.token
    );
    assert.equal(dispatchFirst.response.status, 200);
    assert.equal(dispatchFirst.payload.sentCount, 2);
    assert.equal(dispatchFirst.payload.failedCount, 0);
    assert.equal(dispatchFirst.payload.deliveredNotificationCount, 2);

    const dispatchSecond = await requestJson(
      "POST",
      "/jobs/notification-dispatch",
      { limit: 50 },
      admin.token
    );
    assert.equal(dispatchSecond.response.status, 200);
    assert.equal(dispatchSecond.payload.processedCount, 0);

    const buyerInbox = await requestJson("GET", "/notifications", undefined, buyer.token);
    assert.equal(buyerInbox.response.status, 200);
    assert.equal(buyerInbox.payload.notifications.length, 1);
    assert.equal(buyerInbox.payload.notifications[0].topic, "action_required");

    const sellerInbox = await requestJson("GET", "/notifications", undefined, seller.token);
    assert.equal(sellerInbox.response.status, 200);
    assert.equal(sellerInbox.payload.notifications.length, 1);
    assert.equal(sellerInbox.payload.notifications[0].topic, "payment_received");

    const outsiderReadAttempt = await requestJson(
      "POST",
      `/notifications/${buyerInbox.payload.notifications[0].id}/read`,
      {},
      outsider.token
    );
    assert.equal(outsiderReadAttempt.response.status, 403);

    const readByOwner = await requestJson(
      "POST",
      `/notifications/${buyerInbox.payload.notifications[0].id}/read`,
      {},
      buyer.token
    );
    assert.equal(readByOwner.response.status, 200);
    assert.equal(readByOwner.payload.notification.status, "read");
    assert.ok(readByOwner.payload.notification.readAt);

    const acknowledgedByOwner = await requestJson(
      "POST",
      `/notifications/${buyerInbox.payload.notifications[0].id}/acknowledge`,
      {},
      buyer.token
    );
    assert.equal(acknowledgedByOwner.response.status, 200);
    assert.equal(acknowledgedByOwner.payload.notification.status, "acknowledged");
    assert.ok(acknowledgedByOwner.payload.notification.acknowledgedAt);
  });
});

test("notification dispatcher records retries and backoff metadata on failure", async () => {
  await withTestServer(
    {
      dispatchNotification: ({ outboxRecord }) => {
        if (outboxRecord.topic === "action_required") {
          throw new Error("simulated downstream notifier outage");
        }
      }
    },
    async ({ requestJson, registerUser, databasePath }) => {
      const seller = await registerUser({
        userId: "seller-notify-2",
        email: "seller-notify-2@example.com",
        password: "seller-password",
        role: "seller"
      });
      const buyer = await registerUser({
        userId: "buyer-notify-2",
        email: "buyer-notify-2@example.com",
        password: "buyer-password",
        role: "buyer"
      });
      const admin = await registerUser({
        userId: "admin-notify-2",
        email: "admin-notify-2@example.com",
        password: "admin-password",
        role: "admin"
      });

      const created = await requestJson(
        "POST",
        "/transactions",
        {
          transactionId: "txn-notify-2",
          buyerId: buyer.user.id,
          amountCents: 19000
        },
        seller.token
      );
      assert.equal(created.response.status, 201);

      const firstRunAt = "2099-01-01T10:00:00.000Z";
      const secondRunAt = "2099-01-01T10:05:00.000Z";

      const dispatchFirst = await requestJson(
        "POST",
        "/jobs/notification-dispatch",
        { nowAt: firstRunAt, limit: 50 },
        admin.token
      );
      assert.equal(dispatchFirst.response.status, 200);
      assert.equal(dispatchFirst.payload.sentCount, 1);
      assert.equal(dispatchFirst.payload.failedCount, 1);

      const dispatchSecond = await requestJson(
        "POST",
        "/jobs/notification-dispatch",
        { nowAt: secondRunAt, limit: 50 },
        admin.token
      );
      assert.equal(dispatchSecond.response.status, 200);
      assert.equal(dispatchSecond.payload.sentCount, 0);
      assert.equal(dispatchSecond.payload.failedCount, 1);

      const db = new Database(databasePath, { readonly: true });
      const failedRow = db
        .prepare(
          "SELECT status, attempt_count, last_attempt_at, next_retry_at, failed_at, failure_reason FROM notification_outbox WHERE transaction_id = ? AND topic = 'action_required'"
        )
        .get("txn-notify-2");
      const deliveredRows = db
        .prepare("SELECT COUNT(1) AS count FROM user_notifications WHERE transaction_id = ?")
        .get("txn-notify-2");
      db.close();

      assert.equal(failedRow.status, "failed");
      assert.equal(failedRow.attempt_count, 2);
      assert.ok(failedRow.last_attempt_at);
      assert.ok(failedRow.next_retry_at);
      assert.ok(failedRow.failed_at);
      assert.match(failedRow.failure_reason, /simulated downstream notifier outage/);
      assert.equal(deliveredRows.count, 1);
    }
  );
});

test("stripe webhook rejects invalid signatures and persists failed audit row", async () => {
  const previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const previousTolerance = process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS;
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_invalid_signature";
  process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS = "300";

  try {
    await withTestServer({}, async ({ requestJson, requestRawJson, registerUser }) => {
      const admin = await registerUser({
        userId: "admin-webhook-invalid-1",
        email: "admin-webhook-invalid-1@example.com",
        password: "admin-password",
        role: "admin"
      });

      const payload = JSON.stringify({
        id: "evt_invalid_sig_1",
        type: "payment_intent.succeeded",
        created: 1_900_000_000,
        data: {
          object: {
            id: "pi_invalid_sig_1",
            metadata: {
              transaction_id: "txn-missing-invalid-signature"
            }
          }
        }
      });

      const invalidResponse = await requestRawJson("POST", "/webhooks/stripe", payload, {
        "content-type": "application/json",
        "stripe-signature": "t=1900000000,v1=deadbeef"
      });
      assert.equal(invalidResponse.response.status, 400);
      assert.match(invalidResponse.payload.error, /invalid webhook signature/i);

      const events = await requestJson("GET", "/admin/payment-webhooks?status=failed", undefined, admin.token);
      assert.equal(events.response.status, 200);
      const event = events.payload.events.find((entry) => entry.eventId === "evt_invalid_sig_1");
      assert.ok(event);
      assert.equal(event.status, "failed");
      assert.equal(event.signatureValid, false);
    });
  } finally {
    process.env.STRIPE_WEBHOOK_SECRET = previousSecret;
    process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS = previousTolerance;
  }
});

test("stripe webhook handles duplicate and out-of-order events and reconciliation corrects drift", async () => {
  const previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const previousTolerance = process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS;
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_dedupe";
  process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS = "300";

  try {
    await withTestServer({}, async ({ requestJson, requestRawJson, registerUser, databasePath }) => {
      const seller = await registerUser({
        userId: "seller-webhook-1",
        email: "seller-webhook-1@example.com",
        password: "seller-password",
        role: "seller"
      });
      const buyer = await registerUser({
        userId: "buyer-webhook-1",
        email: "buyer-webhook-1@example.com",
        password: "buyer-password",
        role: "buyer"
      });
      const admin = await registerUser({
        userId: "admin-webhook-1",
        email: "admin-webhook-1@example.com",
        password: "admin-password",
        role: "admin"
      });

      const createTransaction = await requestJson(
        "POST",
        "/transactions",
        {
          transactionId: "txn-webhook-1",
          buyerId: buyer.user.id,
          amountCents: 19000
        },
        seller.token
      );
      assert.equal(createTransaction.response.status, 201);

      const nowSeconds = Math.floor(Date.now() / 1000);
      const succeededEvent = {
        id: "evt_dedupe_succeeded_1",
        type: "payment_intent.succeeded",
        created: nowSeconds - 10,
        data: {
          object: {
            id: "pi_dedupe_1",
            metadata: {
              transaction_id: "txn-webhook-1"
            }
          }
        }
      };
      const succeededBody = JSON.stringify(succeededEvent);
      const succeededSig = signStripePayload({
        body: succeededBody,
        secret: process.env.STRIPE_WEBHOOK_SECRET,
        timestamp: nowSeconds
      });

      const firstDelivery = await requestRawJson("POST", "/webhooks/stripe", succeededBody, {
        "content-type": "application/json",
        "stripe-signature": succeededSig
      });
      assert.equal(firstDelivery.response.status, 200);
      assert.equal(firstDelivery.payload.result.applied, true);

      const duplicateDelivery = await requestRawJson("POST", "/webhooks/stripe", succeededBody, {
        "content-type": "application/json",
        "stripe-signature": succeededSig
      });
      assert.equal(duplicateDelivery.response.status, 200);
      assert.equal(duplicateDelivery.payload.result.applied, false);
      assert.equal(duplicateDelivery.payload.result.reason, "duplicate_delivery");

      const failedEvent = {
        id: "evt_failed_newer_1",
        type: "payment_intent.payment_failed",
        created: nowSeconds + 2,
        data: {
          object: {
            id: "pi_dedupe_1",
            metadata: {
              transaction_id: "txn-webhook-1"
            }
          }
        }
      };
      const failedBody = JSON.stringify(failedEvent);
      const failedSig = signStripePayload({
        body: failedBody,
        secret: process.env.STRIPE_WEBHOOK_SECRET,
        timestamp: nowSeconds
      });
      const failedDelivery = await requestRawJson("POST", "/webhooks/stripe", failedBody, {
        "content-type": "application/json",
        "stripe-signature": failedSig
      });
      assert.equal(failedDelivery.response.status, 200);
      assert.equal(failedDelivery.payload.result.applied, true);
      assert.equal(failedDelivery.payload.result.paymentStatus, "failed");

      const oldSucceededEvent = {
        id: "evt_succeeded_older_1",
        type: "payment_intent.succeeded",
        created: nowSeconds - 120,
        data: {
          object: {
            id: "pi_dedupe_1",
            metadata: {
              transaction_id: "txn-webhook-1"
            }
          }
        }
      };
      const oldSucceededBody = JSON.stringify(oldSucceededEvent);
      const oldSucceededSig = signStripePayload({
        body: oldSucceededBody,
        secret: process.env.STRIPE_WEBHOOK_SECRET,
        timestamp: nowSeconds
      });
      const outOfOrderDelivery = await requestRawJson(
        "POST",
        "/webhooks/stripe",
        oldSucceededBody,
        {
          "content-type": "application/json",
          "stripe-signature": oldSucceededSig
        }
      );
      assert.equal(outOfOrderDelivery.response.status, 200);
      assert.equal(outOfOrderDelivery.payload.result.applied, false);
      assert.equal(outOfOrderDelivery.payload.result.reason, "out_of_order_ignored");

      const transactionAfterOutOfOrder = await requestJson(
        "GET",
        "/transactions/txn-webhook-1",
        undefined,
        admin.token
      );
      assert.equal(transactionAfterOutOfOrder.response.status, 200);
      assert.equal(transactionAfterOutOfOrder.payload.transaction.paymentStatus, "failed");
      assert.ok("itemPrice" in transactionAfterOutOfOrder.payload.transaction);
      assert.ok("serviceFee" in transactionAfterOutOfOrder.payload.transaction);
      assert.ok("totalBuyerCharge" in transactionAfterOutOfOrder.payload.transaction);
      assert.ok("sellerNet" in transactionAfterOutOfOrder.payload.transaction);

      const db = new Database(databasePath);
      db.prepare("UPDATE transactions SET payment_status = 'captured' WHERE id = ?").run("txn-webhook-1");
      db.close();

      const reconcile = await requestJson(
        "POST",
        "/jobs/payment-reconciliation",
        { limit: 20 },
        admin.token
      );
      assert.equal(reconcile.response.status, 200);
      assert.equal(reconcile.payload.correctedCount, 1);
      assert.equal(reconcile.payload.corrections[0].transactionId, "txn-webhook-1");
      assert.equal(reconcile.payload.corrections[0].correctedPaymentStatus, "failed");
    });
  } finally {
    process.env.STRIPE_WEBHOOK_SECRET = previousSecret;
    process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS = previousTolerance;
  }
});

test("admin can inspect and reprocess failed webhook events safely", async () => {
  const previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const previousTolerance = process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS;
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_reprocess";
  process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS = "300";

  try {
    await withTestServer({}, async ({ requestJson, requestRawJson, registerUser }) => {
      const seller = await registerUser({
        userId: "seller-webhook-reprocess-1",
        email: "seller-webhook-reprocess-1@example.com",
        password: "seller-password",
        role: "seller"
      });
      const buyer = await registerUser({
        userId: "buyer-webhook-reprocess-1",
        email: "buyer-webhook-reprocess-1@example.com",
        password: "buyer-password",
        role: "buyer"
      });
      const admin = await registerUser({
        userId: "admin-webhook-reprocess-1",
        email: "admin-webhook-reprocess-1@example.com",
        password: "admin-password",
        role: "admin"
      });

      const nowSeconds = Math.floor(Date.now() / 1000);
      const event = {
        id: "evt_needs_reprocess_1",
        type: "payment_intent.succeeded",
        created: nowSeconds,
        data: {
          object: {
            id: "pi_reprocess_1",
            metadata: {
              transaction_id: "txn-reprocess-1"
            }
          }
        }
      };
      const body = JSON.stringify(event);
      const signature = signStripePayload({
        body,
        secret: process.env.STRIPE_WEBHOOK_SECRET,
        timestamp: nowSeconds
      });

      const firstAttempt = await requestRawJson("POST", "/webhooks/stripe", body, {
        "content-type": "application/json",
        "stripe-signature": signature
      });
      assert.equal(firstAttempt.response.status, 200);
      assert.equal(firstAttempt.payload.result.reason, "transaction_not_found");

      const createTransaction = await requestJson(
        "POST",
        "/transactions",
        {
          transactionId: "txn-reprocess-1",
          buyerId: buyer.user.id,
          amountCents: 17500
        },
        seller.token
      );
      assert.equal(createTransaction.response.status, 201);

      const failedList = await requestJson(
        "GET",
        "/admin/payment-webhooks?status=failed&provider=stripe",
        undefined,
        admin.token
      );
      assert.equal(failedList.response.status, 200);
      const failedEvent = failedList.payload.events.find((entry) => entry.eventId === "evt_needs_reprocess_1");
      assert.ok(failedEvent);

      const replay = await requestJson(
        "POST",
        `/admin/payment-webhooks/${failedEvent.id}/reprocess`,
        {},
        admin.token
      );
      assert.equal(replay.response.status, 200);
      assert.equal(replay.payload.result.reason, "applied");
      assert.equal(replay.payload.result.transactionId, "txn-reprocess-1");
    });
  } finally {
    process.env.STRIPE_WEBHOOK_SECRET = previousSecret;
    process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS = previousTolerance;
  }
});
