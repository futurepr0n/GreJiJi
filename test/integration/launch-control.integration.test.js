import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createServer } from "../../src/server.js";

async function withTestServer(envOverrides, fn) {
  const original = new Map();
  for (const [key, value] of Object.entries(envOverrides ?? {})) {
    original.set(key, process.env[key]);
    process.env[key] = String(value);
  }

  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "grejiji-launch-control-int-"));
  const databasePath = path.join(tempDirectory, "test.sqlite");
  const evidenceStoragePath = path.join(tempDirectory, "evidence");
  const server = createServer({ databasePath, evidenceStoragePath });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  async function request(method, endpoint, body, token, extraHeaders = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...extraHeaders
    };
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
    for (const [key, value] of original.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("launch control: canary rollout gates transaction initiation and writes audit trail", async () => {
  await withTestServer({}, async ({ request }) => {
    const seller = await request("POST", "/auth/register", {
      userId: "lc-seller-1",
      email: "lc-seller-1@example.com",
      password: "seller-password",
      role: "seller"
    });
    assert.equal(seller.response.status, 201);

    const buyerCanary = await request("POST", "/auth/register", {
      userId: "lc-buyer-canary-1",
      email: "lc-buyer-canary-1@example.com",
      password: "buyer-password",
      role: "buyer"
    });
    assert.equal(buyerCanary.response.status, 201);

    const buyerGeneral = await request("POST", "/auth/register", {
      userId: "lc-buyer-general-1",
      email: "lc-buyer-general-1@example.com",
      password: "buyer-password",
      role: "buyer"
    });
    assert.equal(buyerGeneral.response.status, 201);

    const admin = await request("POST", "/auth/register", {
      userId: "lc-admin-1",
      email: "lc-admin-1@example.com",
      password: "admin-password",
      role: "admin"
    });
    assert.equal(admin.response.status, 201);

    const flagSet = await request(
      "POST",
      "/admin/launch-control/flags/transaction_initiation",
      {
        enabled: true,
        rolloutPercentage: 0,
        allowlistUserIds: ["lc-buyer-canary-1"],
        reason: "canary-only checkout enable"
      },
      admin.payload.token
    );
    assert.equal(flagSet.response.status, 200);
    assert.equal(flagSet.payload.flag.rolloutPercentage, 0);

    const canaryAllowed = await request(
      "POST",
      "/transactions",
      {
        transactionId: "lc-txn-canary-1",
        sellerId: "lc-seller-1",
        amountCents: 1000
      },
      buyerCanary.payload.token
    );
    assert.equal(canaryAllowed.response.status, 201);

    const generalBlocked = await request(
      "POST",
      "/transactions",
      {
        transactionId: "lc-txn-general-1",
        sellerId: "lc-seller-1",
        amountCents: 1000
      },
      buyerGeneral.payload.token
    );
    assert.equal(generalBlocked.response.status, 403);
    assert.match(generalBlocked.payload.error, /launch control/i);

    const audit = await request("GET", "/admin/launch-control/audit?key=transaction_initiation", undefined, admin.payload.token);
    assert.equal(audit.response.status, 200);
    assert.ok(Array.isArray(audit.payload.events));
    assert.ok(audit.payload.events.length >= 1);
    assert.equal(audit.payload.events[0].flagKey, "transaction_initiation");
  });
});

test("launch control: region allowlist and auto-rollback disable payout release", async () => {
  await withTestServer({}, async ({ request }) => {
    const seller = await request("POST", "/auth/register", {
      userId: "lc-seller-2",
      email: "lc-seller-2@example.com",
      password: "seller-password",
      role: "seller"
    });
    assert.equal(seller.response.status, 201);

    const buyer = await request("POST", "/auth/register", {
      userId: "lc-buyer-2",
      email: "lc-buyer-2@example.com",
      password: "buyer-password",
      role: "buyer"
    });
    assert.equal(buyer.response.status, 201);

    const admin = await request("POST", "/auth/register", {
      userId: "lc-admin-2",
      email: "lc-admin-2@example.com",
      password: "admin-password",
      role: "admin"
    });
    assert.equal(admin.response.status, 201);

    const regionSet = await request(
      "POST",
      "/admin/launch-control/flags/transaction_initiation",
      {
        enabled: true,
        rolloutPercentage: 100,
        regionAllowlist: ["CA-ON"],
        reason: "region canary"
      },
      admin.payload.token
    );
    assert.equal(regionSet.response.status, 200);

    const blockedRegion = await request(
      "POST",
      "/transactions",
      {
        transactionId: "lc-txn-region-blocked-1",
        sellerId: "lc-seller-2",
        amountCents: 1800
      },
      buyer.payload.token,
      { "x-region": "US-NY" }
    );
    assert.equal(blockedRegion.response.status, 403);

    const allowedRegion = await request(
      "POST",
      "/transactions",
      {
        transactionId: "lc-txn-region-allowed-1",
        sellerId: "lc-seller-2",
        amountCents: 1800
      },
      buyer.payload.token,
      { "x-region": "CA-ON" }
    );
    assert.equal(allowedRegion.response.status, 201);

    const rollback = await request(
      "POST",
      "/jobs/launch-control/auto-rollback",
      {
        incidentKey: "lc-incident-force-1",
        signalType: "deploy_breach",
        severity: "critical",
        force: true,
        affectedFlags: ["payout_release"]
      },
      admin.payload.token
    );
    assert.equal(rollback.response.status, 200);
    assert.equal(rollback.payload.triggered, true);

    const payoutBlocked = await request(
      "POST",
      "/transactions/lc-txn-region-allowed-1/confirm-delivery",
      {},
      buyer.payload.token,
      { "x-region": "CA-ON" }
    );
    assert.equal(payoutBlocked.response.status, 403);
    assert.match(payoutBlocked.payload.error, /launch control/i);

    const incidents = await request("GET", "/admin/launch-control/incidents?limit=20", undefined, admin.payload.token);
    assert.equal(incidents.response.status, 200);
    assert.ok((incidents.payload.incidents ?? []).some((incident) => incident.incidentKey === "lc-incident-force-1"));
  });
});
