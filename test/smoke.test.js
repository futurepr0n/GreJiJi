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

  async function requestJson(method, endpoint, body) {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    });

    const payload = await response.json();
    return { response, payload };
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

test("GET /health returns ok", async () => {
  await withTestServer({}, async ({ requestJson }) => {
    const { response, payload } = await requestJson("GET", "/health");

    assert.equal(response.status, 200);
    assert.equal(payload.status, "ok");
    assert.equal(payload.service, "grejiji-api");
  });
});

test("buyer delivery confirmation settles transaction and releases payout once", async () => {
  await withTestServer({}, async ({ requestJson }) => {
    const creation = await requestJson("POST", "/transactions", {
      transactionId: "txn-confirm-1",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      amountCents: 2599
    });

    assert.equal(creation.response.status, 201);
    assert.equal(creation.payload.transaction.status, "accepted");

    const firstConfirmation = await requestJson(
      "POST",
      "/transactions/txn-confirm-1/confirm-delivery",
      { buyerId: "buyer-1" }
    );

    assert.equal(firstConfirmation.response.status, 200);
    assert.equal(firstConfirmation.payload.transaction.status, "completed");
    assert.equal(firstConfirmation.payload.transaction.payoutReleaseReason, "buyer_confirmation");
    assert.ok(firstConfirmation.payload.transaction.payoutReleasedAt);

    const secondConfirmation = await requestJson(
      "POST",
      "/transactions/txn-confirm-1/confirm-delivery",
      { buyerId: "buyer-1" }
    );

    assert.equal(secondConfirmation.response.status, 409);
    assert.match(secondConfirmation.payload.error, /already released/i);
  });
});

test("auto-release settles accepted transactions after timeout", async () => {
  await withTestServer({ releaseTimeoutHours: 72 }, async ({ requestJson }) => {
    const acceptedAt = new Date(Date.now() - 96 * 60 * 60 * 1000).toISOString();

    const creation = await requestJson("POST", "/transactions", {
      transactionId: "txn-auto-1",
      buyerId: "buyer-auto",
      sellerId: "seller-auto",
      amountCents: 4200,
      acceptedAt
    });

    assert.equal(creation.response.status, 201);

    const autoReleaseRun = await requestJson("POST", "/jobs/auto-release", {});
    assert.equal(autoReleaseRun.response.status, 200);
    assert.equal(autoReleaseRun.payload.releasedCount, 1);
    assert.deepEqual(autoReleaseRun.payload.releasedTransactionIds, ["txn-auto-1"]);

    const lookup = await requestJson("GET", "/transactions/txn-auto-1");
    assert.equal(lookup.response.status, 200);
    assert.equal(lookup.payload.transaction.status, "completed");
    assert.equal(lookup.payload.transaction.payoutReleaseReason, "auto_release");
    assert.ok(lookup.payload.transaction.autoReleasedAt);
    assert.ok(lookup.payload.transaction.payoutReleasedAt);
  });
});

test("open disputes block auto-release until resolved", async () => {
  await withTestServer({ releaseTimeoutHours: 1 }, async ({ requestJson }) => {
    const acceptedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

    await requestJson("POST", "/transactions", {
      transactionId: "txn-dispute-1",
      buyerId: "buyer-dispute",
      sellerId: "seller-dispute",
      amountCents: 3900,
      acceptedAt
    });

    const disputeOpen = await requestJson("POST", "/transactions/txn-dispute-1/disputes", {});
    assert.equal(disputeOpen.response.status, 200);
    assert.equal(disputeOpen.payload.transaction.status, "disputed");

    const blockedRun = await requestJson("POST", "/jobs/auto-release", {});
    assert.equal(blockedRun.response.status, 200);
    assert.equal(blockedRun.payload.releasedCount, 0);

    const stillDisputed = await requestJson("GET", "/transactions/txn-dispute-1");
    assert.equal(stillDisputed.response.status, 200);
    assert.equal(stillDisputed.payload.transaction.status, "disputed");
    assert.equal(stillDisputed.payload.transaction.payoutReleasedAt, null);

    const resolveDispute = await requestJson(
      "POST",
      "/transactions/txn-dispute-1/disputes/resolve",
      {}
    );
    assert.equal(resolveDispute.response.status, 200);
    assert.equal(resolveDispute.payload.transaction.status, "accepted");

    const releaseAfterResolve = await requestJson("POST", "/jobs/auto-release", {});
    assert.equal(releaseAfterResolve.response.status, 200);
    assert.equal(releaseAfterResolve.payload.releasedCount, 1);
    assert.deepEqual(releaseAfterResolve.payload.releasedTransactionIds, ["txn-dispute-1"]);
  });
});
