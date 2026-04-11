import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createServer } from "../../src/server.js";

async function withTestServer(fn) {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "grejiji-moderation-int-"));
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

async function registerUser(requestJson, { userId, email, role }) {
  const result = await requestJson("POST", "/auth/register", {
    userId,
    email,
    password: "password-123",
    role
  });
  assert.equal(result.response.status, 201);
  return result.payload.token;
}

test("listing moderation: policy pass and fail paths", async () => {
  await withTestServer(async ({ requestJson }) => {
    const sellerToken = await registerUser(requestJson, {
      userId: "mod-seller-1",
      email: "mod-seller-1@example.com",
      role: "seller"
    });

    const approvedCreate = await requestJson(
      "POST",
      "/listings",
      {
        listingId: "mod-listing-ok",
        title: "Commuter Bike",
        description: "Well maintained commuter bike with lock and lights included.",
        priceCents: 30000,
        category: "sports",
        itemCondition: "used",
        localArea: "Toronto"
      },
      sellerToken
    );
    assert.equal(approvedCreate.response.status, 201);
    assert.equal(approvedCreate.payload.listing.moderationStatus, "approved");

    const rejectedCreate = await requestJson(
      "POST",
      "/listings",
      {
        listingId: "mod-listing-bad",
        title: "Stolen bike, urgent sale",
        description: "No papers.",
        priceCents: 10000,
        category: "sports",
        itemCondition: "used",
        localArea: "Toronto"
      },
      sellerToken
    );
    assert.equal(rejectedCreate.response.status, 201);
    assert.equal(rejectedCreate.payload.listing.moderationStatus, "rejected");
    assert.equal(rejectedCreate.payload.listing.moderationReasonCode, "prohibited_content");
    assert.ok(rejectedCreate.payload.listing.sellerFeedback);

    const listResponse = await requestJson("GET", "/listings");
    assert.equal(listResponse.response.status, 200);
    const listingIds = listResponse.payload.listings.map((listing) => listing.id);
    assert.ok(listingIds.includes("mod-listing-ok"));
    assert.ok(!listingIds.includes("mod-listing-bad"));
  });
});

test("listing moderation: admin transitions are audited and protected", async () => {
  await withTestServer(async ({ requestJson }) => {
    const sellerToken = await registerUser(requestJson, {
      userId: "mod-seller-2",
      email: "mod-seller-2@example.com",
      role: "seller"
    });
    const buyerToken = await registerUser(requestJson, {
      userId: "mod-buyer-2",
      email: "mod-buyer-2@example.com",
      role: "buyer"
    });
    const adminToken = await registerUser(requestJson, {
      userId: "mod-admin-2",
      email: "mod-admin-2@example.com",
      role: "admin"
    });

    const createPending = await requestJson(
      "POST",
      "/listings",
      {
        listingId: "mod-listing-review",
        title: "Desk Lamp",
        description: "Works",
        priceCents: 3500,
        localArea: "Toronto"
      },
      sellerToken
    );
    assert.equal(createPending.response.status, 201);
    assert.equal(createPending.payload.listing.moderationStatus, "pending_review");

    const buyerApproveAttempt = await requestJson(
      "POST",
      "/admin/listings/mod-listing-review/moderation/approve",
      {},
      buyerToken
    );
    assert.equal(buyerApproveAttempt.response.status, 403);

    const adminApprove = await requestJson(
      "POST",
      "/admin/listings/mod-listing-review/moderation/approve",
      {
        reasonCode: "manual_approve",
        publicReason: "Approved after metadata review",
        notes: "operator-reviewed"
      },
      adminToken
    );
    assert.equal(adminApprove.response.status, 200);
    assert.equal(adminApprove.payload.listing.moderationStatus, "approved");

    const detail = await requestJson(
      "GET",
      "/admin/listings/mod-listing-review/moderation",
      null,
      adminToken
    );
    assert.equal(detail.response.status, 200);
    assert.ok(detail.payload.events.length >= 2);
    assert.equal(detail.payload.events[0].toStatus, "approved");
    assert.equal(detail.payload.events[1].toStatus, "pending_review");
  });
});

test("listing moderation: abuse reports persist and can auto-hide listings", async () => {
  await withTestServer(async ({ requestJson }) => {
    const sellerToken = await registerUser(requestJson, {
      userId: "mod-seller-3",
      email: "mod-seller-3@example.com",
      role: "seller"
    });
    const adminToken = await registerUser(requestJson, {
      userId: "mod-admin-3",
      email: "mod-admin-3@example.com",
      role: "admin"
    });
    const reporterTokens = [];
    for (let index = 1; index <= 3; index += 1) {
      const token = await registerUser(requestJson, {
        userId: `mod-reporter-${index}`,
        email: `mod-reporter-${index}@example.com`,
        role: "buyer"
      });
      reporterTokens.push(token);
    }

    const createListing = await requestJson(
      "POST",
      "/listings",
      {
        listingId: "mod-listing-report",
        title: "Vintage Chair",
        description: "Solid wood chair with minor wear, ready for pickup.",
        priceCents: 14000,
        category: "furniture",
        itemCondition: "used",
        localArea: "Toronto"
      },
      sellerToken
    );
    assert.equal(createListing.response.status, 201);
    assert.equal(createListing.payload.listing.moderationStatus, "approved");

    for (let index = 0; index < reporterTokens.length; index += 1) {
      const report = await requestJson(
        "POST",
        "/listings/mod-listing-report/abuse-reports",
        {
          reasonCode: "suspicious_listing",
          details: `report-${index + 1}`
        },
        reporterTokens[index]
      );
      assert.equal(report.response.status, 201);
    }

    const detail = await requestJson(
      "GET",
      "/admin/listings/mod-listing-report/moderation",
      null,
      adminToken
    );
    assert.equal(detail.response.status, 200);
    assert.equal(detail.payload.abuseReports.length, 3);
    assert.equal(detail.payload.listing.moderationStatus, "temporarily_hidden");

    const publicFeed = await requestJson("GET", "/listings");
    assert.equal(publicFeed.response.status, 200);
    assert.ok(
      !publicFeed.payload.listings.some((listing) => listing.id === "mod-listing-report")
    );
  });
});
