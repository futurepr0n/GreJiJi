import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createServer } from "../../src/server.js";

async function withTestServer(fn) {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "grejiji-dispute-center-int-"));
  const databasePath = path.join(tempDirectory, "test.sqlite");
  const evidenceStoragePath = path.join(tempDirectory, "evidence");
  const server = createServer({ databasePath, evidenceStoragePath });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  async function request(method, endpoint, body, token) {
    const headers = { "Content-Type": "application/json" };
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

  async function registerUser(userId, role) {
    const result = await request("POST", "/auth/register", {
      userId,
      email: `${userId}@example.com`,
      password: `${role}-password`,
      role
    });
    assert.equal(result.response.status, 201);
    return result.payload;
  }

  try {
    await fn({ request, registerUser });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
}

test("dispute center: participant notes/timeline and operator triage transitions", async () => {
  await withTestServer(async ({ request, registerUser }) => {
    const buyer = await registerUser("dc-buyer", "buyer");
    const seller = await registerUser("dc-seller", "seller");
    const admin = await registerUser("dc-admin", "admin");
    const outsider = await registerUser("dc-outsider", "buyer");

    const created = await request(
      "POST",
      "/transactions",
      {
        transactionId: "txn-dc-1",
        sellerId: seller.user.id,
        amountCents: 12900
      },
      buyer.token
    );
    assert.equal(created.response.status, 201);

    const opened = await request("POST", "/transactions/txn-dc-1/disputes", {}, buyer.token);
    assert.equal(opened.response.status, 200);
    assert.equal(opened.payload.transaction.status, "disputed");

    const uploaded = await request(
      "POST",
      "/transactions/txn-dc-1/disputes/evidence",
      {
        evidenceId: "dc-ev-1",
        fileName: "chat-log.txt",
        mimeType: "text/plain",
        contentBase64: Buffer.from("sample-evidence", "utf8").toString("base64"),
        note: "Buyer submitted chat log",
        attachmentRefs: [{ id: "ref-1", type: "message", url: "https://example.test/chat/1" }]
      },
      buyer.token
    );
    assert.equal(uploaded.response.status, 201);
    assert.equal(uploaded.payload.evidence.note, "Buyer submitted chat log");

    const addedNote = await request(
      "POST",
      "/transactions/txn-dc-1/disputes/notes",
      {
        note: "Adding timeline context before operator review",
        attachmentRefs: [{ id: "ctx-1", type: "external_ref" }]
      },
      buyer.token
    );
    assert.equal(addedNote.response.status, 201);
    assert.equal(addedNote.payload.entry.eventType, "note_added");

    const outsiderRead = await request(
      "GET",
      "/transactions/txn-dc-1/disputes/timeline",
      undefined,
      outsider.token
    );
    assert.equal(outsiderRead.response.status, 403);

    const participantTimeline = await request(
      "GET",
      "/transactions/txn-dc-1/disputes/timeline",
      undefined,
      buyer.token
    );
    assert.equal(participantTimeline.response.status, 200);
    assert.ok(Array.isArray(participantTimeline.payload.timeline));
    assert.ok(participantTimeline.payload.timeline.some((item) => item.eventType === "evidence_added"));
    assert.ok(participantTimeline.payload.timeline.some((item) => item.eventType === "note_added"));

    const claimed = await request("POST", "/admin/disputes/txn-dc-1/claim", {}, admin.token);
    assert.equal(claimed.response.status, 200);
    assert.equal(claimed.payload.disputeCase.status, "under_review");
    assert.equal(claimed.payload.disputeCase.assignedOperatorId, admin.user.id);

    const invalidTransition = await request(
      "POST",
      "/admin/disputes/txn-dc-1/status",
      { status: "resolved" },
      admin.token
    );
    assert.equal(invalidTransition.response.status, 400);
    assert.match(invalidTransition.payload.error, /resolutionNote is required/i);

    const resolved = await request(
      "POST",
      "/admin/disputes/txn-dc-1/status",
      { status: "resolved", resolutionNote: "Verified evidence and closed dispute" },
      admin.token
    );
    assert.equal(resolved.response.status, 200);
    assert.equal(resolved.payload.disputeCase.status, "resolved");

    const participantAfter = await request(
      "GET",
      "/transactions/txn-dc-1/disputes/timeline",
      undefined,
      seller.token
    );
    assert.equal(participantAfter.response.status, 200);
    const statusEvents = participantAfter.payload.timeline.filter((item) =>
      ["status_changed", "claimed"].includes(item.eventType)
    );
    assert.ok(statusEvents.some((item) => item.toStatus === "under_review" && item.actorId === admin.user.id));
    assert.ok(statusEvents.some((item) => item.toStatus === "resolved" && item.actorId === admin.user.id));

    const nonAdminClaim = await request("POST", "/admin/disputes/txn-dc-1/claim", {}, buyer.token);
    assert.equal(nonAdminClaim.response.status, 403);
  });
});
