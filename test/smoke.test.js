import assert from "node:assert/strict";
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
    await fn({ requestJson, requestText, registerUser, loginUser, databasePath });
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
    assert.match(appPage.payload, /src="\/app\/client.js"/);

    const client = await requestText("GET", "/app/client.js");
    assert.equal(client.response.status, 200);
    assert.match(client.response.headers.get("content-type") ?? "", /text\/javascript/);
    assert.match(client.payload, /async function apiRequest/);
    assert.match(client.payload, /renderRoleUI/);

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
    }
  );
});

test("settlement outcomes persist auditable completed, refunded, and cancelled financial snapshots", async () => {
  await withTestServer(
    { serviceFeeFixedCents: 300, serviceFeePercent: 2.5, settlementCurrency: "USD" },
    async ({ requestJson, registerUser }) => {
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

      assert.equal(cancelled.response.status, 200);
      assert.equal(cancelled.payload.transaction.settlementOutcome, "cancelled");
      assert.equal(cancelled.payload.transaction.settledBuyerCharge, 0);
      assert.equal(cancelled.payload.transaction.settledSellerPayout, 0);
      assert.equal(cancelled.payload.transaction.settledPlatformFee, 0);
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

test("trust assessment is persisted and exposed through transaction and trust endpoints", async () => {
  await withTestServer({}, async ({ requestJson, registerUser }) => {
    const seller = await registerUser({
      userId: "seller-trust-1",
      email: "seller-trust-1@example.com",
      password: "seller-password",
      role: "seller"
    });
    const buyer = await registerUser({
      userId: "buyer-trust-1",
      email: "buyer-trust-1@example.com",
      password: "buyer-password",
      role: "buyer"
    });

    const listing = await requestJson(
      "POST",
      "/listings",
      {
        listingId: "listing-trust-1",
        title: "Camera",
        description: "Mirrorless camera",
        priceCents: 64000,
        localArea: "Toronto-East"
      },
      seller.token
    );
    assert.equal(listing.response.status, 201);

    const created = await requestJson(
      "POST",
      "/transactions",
      {
        transactionId: "txn-trust-1",
        buyerId: buyer.user.id,
        amountCents: 12000
      },
      seller.token
    );
    assert.equal(created.response.status, 201);
    assert.ok(created.payload.trustAssessment);
    assert.equal(created.payload.trustAssessment.transactionId, "txn-trust-1");
    assert.match(created.payload.trustAssessment.riskBand, /low|medium|high/);
    assert.ok(Array.isArray(created.payload.trustAssessment.reasonCodes));

    const fetched = await requestJson("GET", "/transactions/txn-trust-1", undefined, buyer.token);
    assert.equal(fetched.response.status, 200);
    assert.equal(fetched.payload.trustAssessment.transactionId, "txn-trust-1");

    const trust = await requestJson("GET", "/transactions/txn-trust-1/trust", undefined, buyer.token);
    assert.equal(trust.response.status, 200);
    assert.equal(trust.payload.transactionId, "txn-trust-1");
    assert.ok(Array.isArray(trust.payload.trustInterventions));
    assert.ok(trust.payload.trustInterventions.length >= 1);
    assert.ok(trust.payload.trustInterventions[0].reasonCodes.length >= 1);
  });
});

test("trust operations v12 returns deterministic low, medium, and high risk bands", async () => {
  await withTestServer({}, async ({ requestJson, registerUser }) => {
    const sellerLow = await registerUser({
      userId: "seller-trust-low",
      email: "seller-trust-low@example.com",
      password: "seller-password",
      role: "seller"
    });
    const buyerLow = await registerUser({
      userId: "buyer-trust-low",
      email: "buyer-trust-low@example.com",
      password: "buyer-password",
      role: "buyer"
    });
    const sellerMedium = await registerUser({
      userId: "seller-trust-medium",
      email: "seller-trust-medium@example.com",
      password: "seller-password",
      role: "seller"
    });
    const buyerMedium = await registerUser({
      userId: "buyer-trust-medium",
      email: "buyer-trust-medium@example.com",
      password: "buyer-password",
      role: "buyer"
    });
    const sellerHigh = await registerUser({
      userId: "seller-trust-high",
      email: "seller-trust-high@example.com",
      password: "seller-password",
      role: "seller"
    });
    const buyerHigh = await registerUser({
      userId: "buyer-trust-high",
      email: "buyer-trust-high@example.com",
      password: "buyer-password",
      role: "buyer"
    });

    const createListing = async (token, listingId, localArea) =>
      requestJson(
        "POST",
        "/listings",
        { listingId, title: listingId, description: "seed", priceCents: 50000, localArea },
        token
      );

    assert.equal((await createListing(sellerLow.token, "listing-trust-low", "Calm-North")).response.status, 201);
    assert.equal(
      (await createListing(sellerMedium.token, "listing-trust-medium", "Metro-Mid")).response.status,
      201
    );
    assert.equal((await createListing(sellerHigh.token, "listing-trust-high", "Metro-Risk")).response.status, 201);

    const createTransaction = async (sellerToken, transactionId, buyerId, amountCents) =>
      requestJson(
        "POST",
        "/transactions",
        { transactionId, buyerId, amountCents },
        sellerToken
      );

    const low = await createTransaction(
      sellerLow.token,
      "txn-trust-low-target",
      buyerLow.user.id,
      3000
    );
    assert.equal(low.response.status, 201);
    assert.equal(low.payload.trustAssessment.riskBand, "low");
    assert.ok(
      low.payload.trustAssessment.intervention.recommendedControls.includes(
        "session_risk_annotation"
      )
    );
    assert.equal(low.payload.trustAssessment.policyCanaryGovernance.rolloutDecision, "promote");
    assert.equal(low.payload.trustAssessment.policyBlastRadiusSimulation.gateDecision, "pass");
    assert.equal(
      low.payload.trustAssessment.crossMarketCollusionInterdiction.falsePositiveContainment
        .maxAutomatedSuppressionMinutes,
      0
    );

    for (let index = 1; index <= 3; index += 1) {
      const seeded = await createTransaction(
        sellerMedium.token,
        `txn-trust-medium-seed-${index}`,
        buyerMedium.user.id,
        18000
      );
      assert.equal(seeded.response.status, 201);
      if (index === 1) {
        const opened = await requestJson(
          "POST",
          `/transactions/txn-trust-medium-seed-${index}/disputes`,
          {},
          buyerMedium.token
        );
        assert.equal(opened.response.status, 200);
      }
    }

    const medium = await createTransaction(
      sellerMedium.token,
      "txn-trust-medium-target",
      buyerMedium.user.id,
      30000
    );
    assert.equal(medium.response.status, 201);
    assert.equal(medium.payload.trustAssessment.riskBand, "medium");
    assert.ok(
      medium.payload.trustAssessment.intervention.recommendedControls.includes(
        "step_up_verification"
      )
    );
    assert.match(
      medium.payload.trustAssessment.policyBlastRadiusSimulation.gateDecision,
      /review|block/
    );

    const highSeedBuyers = [];
    for (let index = 1; index <= 4; index += 1) {
      const seededBuyer = await registerUser({
        userId: `buyer-trust-high-seed-${index}`,
        email: `buyer-trust-high-seed-${index}@example.com`,
        password: "buyer-password",
        role: "buyer"
      });
      highSeedBuyers.push(seededBuyer);
    }

    for (let index = 0; index < highSeedBuyers.length; index += 1) {
      const buyer = highSeedBuyers[index];
      const seeded = await createTransaction(
        sellerHigh.token,
        `txn-trust-high-seed-${index + 1}`,
        buyer.user.id,
        95000
      );
      assert.equal(seeded.response.status, 201);
      const opened = await requestJson(
        "POST",
        `/transactions/txn-trust-high-seed-${index + 1}/disputes`,
        {},
        buyer.token
      );
      assert.equal(opened.response.status, 200);
    }

    const high = await createTransaction(
      sellerHigh.token,
      "txn-trust-high-target",
      buyerHigh.user.id,
      120000
    );
    assert.equal(high.response.status, 201);
    assert.equal(high.payload.trustAssessment.riskBand, "high");
    assert.ok(
      high.payload.trustAssessment.intervention.recommendedControls.includes("temporary_hold")
    );
    assert.ok(high.payload.trustAssessment.reasonCodes.includes("geo_cluster_dispute_density_high"));
    assert.match(
      high.payload.trustAssessment.policyBlastRadiusSimulation.gateDecision,
      /review|block/
    );
  });
});

test("trust operations v17 persists collusion interdiction, escrow attestations, and blast-radius simulation metadata", async () => {
  await withTestServer({}, async ({ requestJson, registerUser }) => {
    const seller = await registerUser({
      userId: "seller-trust-v13",
      email: "seller-trust-v13@example.com",
      password: "seller-password",
      role: "seller"
    });
    const buyerA = await registerUser({
      userId: "buyer-trust-v13-a",
      email: "buyer-trust-v13-a@example.com",
      password: "buyer-password",
      role: "buyer"
    });
    const buyerB = await registerUser({
      userId: "buyer-trust-v13-b",
      email: "buyer-trust-v13-b@example.com",
      password: "buyer-password",
      role: "buyer"
    });

    const listing = await requestJson(
      "POST",
      "/listings",
      {
        listingId: "listing-trust-v13",
        title: "Monitor",
        description: "4k monitor",
        priceCents: 40000,
        localArea: "Metro-Cluster"
      },
      seller.token
    );
    assert.equal(listing.response.status, 201);

    const seeded = await requestJson(
      "POST",
      "/transactions",
      {
        transactionId: "txn-trust-v13-seed",
        buyerId: buyerA.user.id,
        amountCents: 15000,
        deviceFingerprint: "device-v13-shared",
        paymentFingerprint: "payment-v13-shared"
      },
      seller.token
    );
    assert.equal(seeded.response.status, 201);

    const target = await requestJson(
      "POST",
      "/transactions",
      {
        transactionId: "txn-trust-v13-target",
        buyerId: buyerB.user.id,
        amountCents: 22000,
        deviceFingerprint: "device-v13-shared",
        paymentFingerprint: "payment-v13-shared"
      },
      seller.token
    );
    assert.equal(target.response.status, 201);

    const trust = target.payload.trustAssessment;
    assert.equal(trust.orchestrationVersion, "trust-ops-v17");
    assert.ok(trust.graphSignals.linkedTransactionCount >= 1);
    assert.ok(trust.graphSignals.entityTypeCounts.device >= 1);
    assert.ok(trust.graphSignals.entityTypeCounts.paymentFingerprint >= 1);
    assert.ok(Array.isArray(trust.explainability.topRiskPaths));
    assert.ok(trust.explainability.topRiskPaths.length >= 1);
    assert.ok(Array.isArray(trust.identityFriction.requirements));
    assert.equal(typeof trust.postIncidentVerification.regressionDetected, "boolean");
    assert.equal(typeof trust.fraudRingDisruption.disruptionScore, "number");
    assert.ok(Array.isArray(trust.fraudRingDisruption.recommendedActions));
    assert.equal(typeof trust.escrowAdversarialSimulation.maxSeverity, "number");
    assert.ok(Array.isArray(trust.escrowAdversarialSimulation.scenarioOutcomes));
    assert.equal(typeof trust.trustPolicyRollback.rollbackTriggered, "boolean");
    assert.equal(typeof trust.accountTakeoverContainment.correlationScore, "number");
    assert.ok(Array.isArray(trust.accountTakeoverContainment.recommendedActions));
    assert.equal(typeof trust.settlementRiskStressControls.maxScenarioSeverity, "number");
    assert.ok(Array.isArray(trust.settlementRiskStressControls.stressScenarios));
    assert.equal(typeof trust.crossMarketCollusionInterdiction.collusionRiskScore, "number");
    assert.ok(Array.isArray(trust.crossMarketCollusionInterdiction.graduatedInterventions));
    assert.equal(
      trust.crossMarketCollusionInterdiction.falsePositiveContainment.allowCounterpartyRecoveryPath,
      true
    );
    assert.equal(typeof trust.escrowIntegrityAttestations.attestationStatus, "string");
    assert.match(trust.escrowIntegrityAttestations.finalChainHash, /^[a-f0-9]{64}$/);
    assert.ok(Array.isArray(trust.escrowIntegrityAttestations.tamperEvidentChain));
    assert.ok(trust.escrowIntegrityAttestations.tamperEvidentChain.length >= 4);
    assert.match(
      trust.policyBlastRadiusSimulation.gateDecision,
      /pass|review|block/
    );
    assert.match(
      trust.policyCanaryGovernance.rolloutDecision,
      /promote|hold|revert/
    );
    assert.match(trust.evidenceProvenance.snapshotId, /^trust-signal-txn-trust-v13-target-/);
    assert.match(trust.evidenceProvenance.snapshotHash, /^[a-f0-9]{64}$/);
    assert.ok(trust.outcomeFeedback.thresholdModel.medium >= 20);
    assert.ok(trust.outcomeFeedback.thresholdModel.high <= 85);
    assert.ok(
      trust.outcomeFeedback.thresholdModel.high >= trust.outcomeFeedback.thresholdModel.medium + 15
    );

    const trustEndpoint = await requestJson(
      "GET",
      "/transactions/txn-trust-v13-target/trust",
      undefined,
      buyerB.token
    );
    assert.equal(trustEndpoint.response.status, 200);
    assert.ok(trustEndpoint.payload.trustInterventions.length >= 1);
    assert.equal(
      trustEndpoint.payload.trustInterventions[0].provenanceRef,
      trust.evidenceProvenance.snapshotId
    );
    assert.deepEqual(
      trustEndpoint.payload.trustInterventions[0].identityFriction.requirements,
      trust.identityFriction.requirements
    );
    assert.equal(
      trustEndpoint.payload.trustInterventions[0].fraudRingDisruption.disruptionScore,
      trust.fraudRingDisruption.disruptionScore
    );
    assert.equal(
      trustEndpoint.payload.trustInterventions[0].trustPolicyRollback.rollbackTriggered,
      trust.trustPolicyRollback.rollbackTriggered
    );
    assert.equal(
      trustEndpoint.payload.trustInterventions[0].accountTakeoverContainment.correlationScore,
      trust.accountTakeoverContainment.correlationScore
    );
    assert.equal(
      trustEndpoint.payload.trustInterventions[0].policyCanaryGovernance.rolloutDecision,
      trust.policyCanaryGovernance.rolloutDecision
    );
    assert.equal(
      trustEndpoint.payload.trustInterventions[0].crossMarketCollusionInterdiction.interdictionBand,
      trust.crossMarketCollusionInterdiction.interdictionBand
    );
    assert.equal(
      trustEndpoint.payload.trustInterventions[0].policyBlastRadiusSimulation.gateDecision,
      trust.policyBlastRadiusSimulation.gateDecision
    );
    assert.equal(
      trustEndpoint.payload.trustInterventions[0].escrowIntegrityAttestations.finalChainHash,
      trust.escrowIntegrityAttestations.finalChainHash
    );
  });
});

test("trust operations v15 computes multi-hop fraud ring metrics", async () => {
  await withTestServer({}, async ({ requestJson, registerUser }) => {
    const admin = await registerUser({
      userId: "admin-trust-v15-multihop",
      email: "admin-trust-v15-multihop@example.com",
      password: "admin-password",
      role: "admin"
    });
    const sellerA = await registerUser({
      userId: "seller-v15-multihop-a",
      email: "seller-v15-multihop-a@example.com",
      password: "seller-password",
      role: "seller"
    });
    const sellerC = await registerUser({
      userId: "seller-v15-multihop-c",
      email: "seller-v15-multihop-c@example.com",
      password: "seller-password",
      role: "seller"
    });
    const buyerA = await registerUser({
      userId: "buyer-v15-multihop-a",
      email: "buyer-v15-multihop-a@example.com",
      password: "buyer-password",
      role: "buyer"
    });
    const buyerB = await registerUser({
      userId: "buyer-v15-multihop-b",
      email: "buyer-v15-multihop-b@example.com",
      password: "buyer-password",
      role: "buyer"
    });
    const buyerD = await registerUser({
      userId: "buyer-v15-multihop-d",
      email: "buyer-v15-multihop-d@example.com",
      password: "buyer-password",
      role: "buyer"
    });

    assert.equal(
      (
        await requestJson(
          "POST",
          "/listings",
          {
            listingId: "listing-v15-multihop-a",
            title: "Target listing",
            description: "seed",
            priceCents: 24000,
            localArea: "Metro-MultiHop"
          },
          sellerA.token
        )
      ).response.status,
      201
    );
    assert.equal(
      (
        await requestJson(
          "POST",
          "/listings",
          {
            listingId: "listing-v15-multihop-c",
            title: "Bridge listing",
            description: "seed",
            priceCents: 26000,
            localArea: "Metro-MultiHop"
          },
          sellerC.token
        )
      ).response.status,
      201
    );

    assert.equal(
      (
        await requestJson(
          "POST",
          "/transactions",
          {
            transactionId: "txn-v15-multihop-target",
            buyerId: buyerA.user.id,
            amountCents: 22000,
            deviceFingerprint: "device-v15-target",
            paymentFingerprint: "payment-v15-target"
          },
          sellerA.token
        )
      ).response.status,
      201
    );
    assert.equal(
      (
        await requestJson(
          "POST",
          "/transactions",
          {
            transactionId: "txn-v15-multihop-hop1",
            buyerId: buyerB.user.id,
            amountCents: 21000,
            deviceFingerprint: "device-v15-hop1",
            paymentFingerprint: "payment-v15-hop1"
          },
          sellerA.token
        )
      ).response.status,
      201
    );
    assert.equal(
      (
        await requestJson(
          "POST",
          "/transactions",
          {
            transactionId: "txn-v15-multihop-hop2",
            buyerId: buyerB.user.id,
            amountCents: 23000,
            deviceFingerprint: "device-v15-hop2",
            paymentFingerprint: "payment-v15-hop2"
          },
          sellerC.token
        )
      ).response.status,
      201
    );
    assert.equal(
      (
        await requestJson(
          "POST",
          "/transactions",
          {
            transactionId: "txn-v15-multihop-hop3",
            buyerId: buyerD.user.id,
            amountCents: 25000,
            deviceFingerprint: "device-v15-hop3",
            paymentFingerprint: "payment-v15-hop3"
          },
          sellerC.token
        )
      ).response.status,
      201
    );

    const reevaluated = await requestJson(
      "POST",
      "/transactions/txn-v15-multihop-target/trust/evaluate",
      { evaluatedBy: admin.user.id },
      admin.token
    );
    assert.equal(reevaluated.response.status, 200);

    const trust = reevaluated.payload.trustAssessment;
    assert.ok(trust.fraudRingDisruption.ringMetrics.linkedTransactionCount >= 3);
    assert.ok(trust.fraudRingDisruption.ringMetrics.hopDistribution.hop2 >= 1);
    assert.ok(trust.fraudRingDisruption.ringMetrics.hopDistribution.hop3 >= 1);
    assert.ok(
      trust.fraudRingDisruption.recommendedActions.includes("ring_entity_quarantine")
    );
  });
});

test("trust operations v15 flags post-incident regression and can trigger rollback", async () => {
  await withTestServer({}, async ({ requestJson, registerUser }) => {
    const admin = await registerUser({
      userId: "admin-trust-v14",
      email: "admin-trust-v14@example.com",
      password: "admin-password",
      role: "admin"
    });
    const seller = await registerUser({
      userId: "seller-trust-v14-regression",
      email: "seller-trust-v14-regression@example.com",
      password: "seller-password",
      role: "seller"
    });

    const listing = await requestJson(
      "POST",
      "/listings",
      {
        listingId: "listing-trust-v14-regression",
        title: "Tablet",
        description: "seed listing",
        priceCents: 55000,
        localArea: "Metro-Regress"
      },
      seller.token
    );
    assert.equal(listing.response.status, 201);

    for (let index = 1; index <= 8; index += 1) {
      const seedBuyer = await registerUser({
        userId: `buyer-trust-v14-regression-${index}`,
        email: `buyer-trust-v14-regression-${index}@example.com`,
        password: "buyer-password",
        role: "buyer"
      });

      const seededTransaction = await requestJson(
        "POST",
        "/transactions",
        {
          transactionId: `txn-trust-v14-regression-seed-${index}`,
          buyerId: seedBuyer.user.id,
          amountCents: 72000,
          deviceFingerprint: `device-v14-regression-${index}`,
          paymentFingerprint: `payment-v14-regression-${index}`
        },
        seller.token
      );
      assert.equal(seededTransaction.response.status, 201);

      const opened = await requestJson(
        "POST",
        `/transactions/txn-trust-v14-regression-seed-${index}/disputes`,
        {},
        seedBuyer.token
      );
      assert.equal(opened.response.status, 200);

      const adjudicated = await requestJson(
        "POST",
        `/transactions/txn-trust-v14-regression-seed-${index}/disputes/adjudicate`,
        { decision: "refund_to_buyer", notes: "regression-seed adverse outcome" },
        admin.token
      );
      assert.equal(adjudicated.response.status, 200);
    }

    const targetBuyer = await registerUser({
      userId: "buyer-trust-v14-regression-target",
      email: "buyer-trust-v14-regression-target@example.com",
      password: "buyer-password",
      role: "buyer"
    });

    const target = await requestJson(
      "POST",
      "/transactions",
      {
        transactionId: "txn-trust-v14-regression-target",
        buyerId: targetBuyer.user.id,
        amountCents: 78000,
        deviceFingerprint: "device-v14-regression-target",
        paymentFingerprint: "payment-v14-regression-target"
      },
      seller.token
    );
    assert.equal(target.response.status, 201);

    const trust = target.payload.trustAssessment;
    assert.equal(trust.postIncidentVerification.regressionDetected, true);
    assert.equal(trust.postIncidentVerification.controlStatus, "degraded");
    assert.ok(
      trust.postIncidentVerification.alerts.includes("policy_regression_detected")
    );
    assert.ok(
      trust.reasonCodes.includes("post_incident_control_regression_detected")
    );
    assert.equal(trust.trustPolicyRollback.rollbackTriggered, true);
    assert.ok(
      trust.reasonCodes.includes("autonomous_trust_policy_rollback_triggered")
    );
    assert.ok(
      trust.intervention.recommendedControls.includes("autonomous_policy_rollback")
    );
    assert.equal(trust.policyCanaryGovernance.rolloutDecision, "revert");
    assert.equal(trust.policyCanaryGovernance.autoReverted, true);
    assert.equal(trust.policyBlastRadiusSimulation.gateDecision, "block");
    assert.ok(trust.reasonCodes.includes("policy_blast_radius_gate_blocked"));
  });
});
