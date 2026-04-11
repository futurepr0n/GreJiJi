import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createServer } from "../../src/server.js";

async function withTestServer(fn) {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "grejiji-trust-v4-int-"));
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

test("trust operations v4: policy versions, investigator workflow, bulk actions, and dashboard", async () => {
  await withTestServer(async ({ request, registerUser }) => {
    const buyer = await registerUser("trust-v4-buyer", "buyer");
    const seller = await registerUser("trust-v4-seller", "seller");
    const admin = await registerUser("trust-v4-admin", "admin");

    const created = await request(
      "POST",
      "/transactions",
      {
        transactionId: "txn-trust-v4-1",
        sellerId: seller.user.id,
        amountCents: 22000
      },
      buyer.token
    );
    assert.equal(created.response.status, 201);

    for (let index = 0; index < 3; index += 1) {
      const invalidWebhook = await request(
        "POST",
        "/webhooks/stripe",
        {
          id: `evt_trust_v4_invalid_${index}`,
          type: "payment_intent.succeeded",
          data: {
            object: {
              id: `pi_trust_v4_${index}`,
              metadata: {
                transaction_id: "txn-trust-v4-1"
              }
            }
          }
        },
        null,
        { "stripe-signature": "t=1,v1=invalid" }
      );
      assert.equal(invalidWebhook.response.status, 400);
    }

    const createdPolicy = await request(
      "POST",
      "/admin/trust-operations/policies",
      {
        name: "risk-high-local-window-1",
        policy: {
          autoHoldRiskScore: 70,
          clearRiskScore: 30,
          holdDurationHours: 24
        },
        cohort: {
          minAmountCents: 10000,
          maxAmountCents: 30000,
          riskLevelAllowlist: ["high"]
        }
      },
      admin.token
    );
    assert.equal(createdPolicy.response.status, 201);
    const policyVersionId = createdPolicy.payload.policyVersion.id;

    const activatedPolicy = await request(
      "POST",
      `/admin/trust-operations/policies/${policyVersionId}/activate`,
      {},
      admin.token
    );
    assert.equal(activatedPolicy.response.status, 200);
    assert.equal(activatedPolicy.payload.policyVersion.status, "active");

    const backtest = await request(
      "POST",
      "/admin/trust-operations/backtest",
      {
        policyVersionId,
        limit: 50
      },
      admin.token
    );
    assert.equal(backtest.response.status, 200);
    assert.ok(backtest.payload.impactSummary.scanned >= 1);
    assert.ok(backtest.payload.impactSummary.recommendations.hold >= 1);

    const recompute = await request(
      "POST",
      "/jobs/trust-operations/recompute",
      {
        policyVersionId,
        apply: true,
        limit: 50
      },
      admin.token
    );
    assert.equal(recompute.response.status, 200);
    assert.ok(recompute.payload.applied.holds >= 1);

    const queue = await request(
      "GET",
      "/admin/trust-operations/cases?status=open",
      undefined,
      admin.token
    );
    assert.equal(queue.response.status, 200);
    const trustCase = queue.payload.cases.find((item) => item.transactionId === "txn-trust-v4-1");
    assert.ok(trustCase);
    assert.equal(typeof trustCase.severity, "string");
    assert.equal(typeof trustCase.priorityScore, "number");

    const claimed = await request(
      "POST",
      `/admin/trust-operations/cases/${trustCase.id}/claim`,
      {
        investigatorId: admin.user.id,
        reasonCode: "on_duty_claim"
      },
      admin.token
    );
    assert.equal(claimed.response.status, 200);
    assert.equal(claimed.payload.trustCase.assignedInvestigatorId, admin.user.id);

    const noted = await request(
      "POST",
      `/admin/trust-operations/cases/${trustCase.id}/notes`,
      {
        note: "Reviewed evidence cluster and assigned immediate follow-up."
      },
      admin.token
    );
    assert.equal(noted.response.status, 201);
    assert.ok(noted.payload.notes.some((item) => item.note.includes("Reviewed evidence cluster")));

    const bulkClear = await request(
      "POST",
      "/admin/trust-operations/cases/bulk-action",
      {
        caseIds: [trustCase.id],
        action: "clear",
        reasonCode: "false_positive_after_review",
        notes: "bulk clearance after operator review"
      },
      admin.token
    );
    assert.equal(bulkClear.response.status, 200);
    assert.equal(bulkClear.payload.total, 1);
    assert.equal(bulkClear.payload.cases[0].trustCase.status, "resolved");

    const feedback = await request(
      "POST",
      "/admin/trust-operations/feedback",
      {
        transactionId: "txn-trust-v4-1",
        caseId: trustCase.id,
        feedbackType: "operator_action",
        outcome: "false_positive_confirmed",
        source: "manual_review",
        details: {
          reviewer: admin.user.id,
          reason: "signals were synthetic noise"
        }
      },
      admin.token
    );
    assert.equal(feedback.response.status, 201);
    assert.equal(feedback.payload.feedback.feedbackType, "operator_action");

    const dashboard = await request(
      "GET",
      "/admin/trust-operations/dashboard?lookbackHours=48",
      undefined,
      admin.token
    );
    assert.equal(dashboard.response.status, 200);
    assert.ok(dashboard.payload.metrics.decisionQuality.falsePositiveCases >= 1);

    const recommendations = await request(
      "GET",
      "/admin/trust-operations/policy-recommendations?lookbackHours=168",
      undefined,
      admin.token
    );
    assert.equal(recommendations.response.status, 200);
    assert.equal(typeof recommendations.payload.recommendations.recommendation.autoHoldRiskScore, "number");
  });
});
