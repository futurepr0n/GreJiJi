import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createServer } from "../../src/server.js";

async function withTestServer(fn) {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "grejiji-trust-v6-int-"));
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

test("trust operations v6: network risk propagation, cluster actions, and recovery automation", async () => {
  await withTestServer(async ({ request, registerUser }) => {
    const buyer = await registerUser("trust-v6-buyer", "buyer");
    const seller = await registerUser("trust-v6-seller", "seller");
    const admin = await registerUser("trust-v6-admin", "admin");

    const created = await request(
      "POST",
      "/transactions",
      {
        transactionId: "txn-trust-v6-1",
        sellerId: seller.user.id,
        amountCents: 38000
      },
      buyer.token
    );
    assert.equal(created.response.status, 201);

    for (let index = 0; index < 5; index += 1) {
      const invalidWebhook = await request(
        "POST",
        "/webhooks/stripe",
        {
          id: `evt_trust_v6_invalid_${index}`,
          type: "payment_intent.succeeded",
          data: {
            object: {
              id: `pi_trust_v6_${index}`,
              metadata: {
                transaction_id: "txn-trust-v6-1"
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
        name: "trust-v6-network-ladder-1",
        policy: {
          autoHoldRiskScore: 35,
          clearRiskScore: 20,
          holdDurationHours: 24,
          reserveRiskScore: 30,
          manualReviewRiskScore: 40,
          reservePercent: 30,
          integrityLookbackDays: 30,
          networkRiskWeight: 45,
          propagationDecayHours: 168,
          v5Enabled: true,
          v6Enabled: true
        },
        cohort: {
          minAmountCents: 10000,
          maxAmountCents: 60000
        }
      },
      admin.token
    );
    assert.equal(createdPolicy.response.status, 201);
    const policyVersionId = createdPolicy.payload.policyVersion.id;

    const networkSignals = await request(
      "POST",
      "/admin/trust-operations/network/signals",
      {
        transactionId: "txn-trust-v6-1",
        policyVersionId,
        links: [
          {
            sourceEntityKey: `account:${buyer.user.id}`,
            targetEntityKey: "device:fp_shared_1",
            linkType: "device",
            confidenceScore: 92,
            propagatedRiskScore: 88,
            evidence: { source: "fingerprint", sampleCount: 3 }
          },
          {
            sourceEntityKey: `account:${seller.user.id}`,
            targetEntityKey: "payment_instrument:pm_shared_42",
            linkType: "payment_instrument",
            confidenceScore: 90,
            propagatedRiskScore: 85,
            evidence: { source: "instrument_reuse", sampleCount: 2 }
          }
        ]
      },
      admin.token
    );
    assert.equal(networkSignals.response.status, 201);
    assert.ok(networkSignals.payload.networkRiskScore >= 70);

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
    assert.ok(recompute.payload.applied.casesCreated >= 1);

    const queue = await request(
      "GET",
      "/admin/trust-operations/cases?status=open",
      undefined,
      admin.token
    );
    assert.equal(queue.response.status, 200);
    const trustCase = queue.payload.cases.find((item) => item.transactionId === "txn-trust-v6-1");
    assert.ok(trustCase);
    assert.equal(typeof trustCase.networkRiskScoreAtTrigger, "number");
    assert.equal(typeof trustCase.interventionLadderStep, "string");
    assert.ok(trustCase.clusterId);

    const investigation = await request(
      "GET",
      "/admin/trust-operations/network/investigation?transactionId=txn-trust-v6-1",
      undefined,
      admin.token
    );
    assert.equal(investigation.response.status, 200);
    assert.ok(Array.isArray(investigation.payload.links));
    assert.ok(investigation.payload.links.length >= 2);

    const preview = await request(
      "POST",
      `/admin/trust-operations/cases/${trustCase.id}/cluster-preview`,
      {
        action: "clear",
        reasonCode: "cluster_clear_preview"
      },
      admin.token
    );
    assert.equal(preview.response.status, 200);
    assert.ok(preview.payload.preview.impactedCount >= 1);

    const applyCluster = await request(
      "POST",
      `/admin/trust-operations/cases/${trustCase.id}/cluster-apply`,
      {
        action: "clear",
        reasonCode: "false_positive_after_review",
        notes: "network evidence downgraded"
      },
      admin.token
    );
    assert.equal(applyCluster.response.status, 200);
    assert.ok(applyCluster.payload.affectedCases.length >= 1);

    const recoveryQueue = await request(
      "GET",
      "/admin/trust-operations/recovery/queue?status=queued",
      undefined,
      admin.token
    );
    assert.equal(recoveryQueue.response.status, 200);
    assert.ok(recoveryQueue.payload.jobs.length >= 1);

    const processRecovery = await request(
      "POST",
      "/jobs/trust-operations/recovery/process",
      { limit: 25 },
      admin.token
    );
    assert.equal(processRecovery.response.status, 200);
    assert.ok(processRecovery.payload.processedCount >= 1);

    const dashboard = await request(
      "GET",
      "/admin/trust-operations/dashboard?lookbackHours=48",
      undefined,
      admin.token
    );
    assert.equal(dashboard.response.status, 200);
    assert.equal(typeof dashboard.payload.metrics.interventionEfficacyByLadderStep.manual_review_gate, "number");
    assert.equal(typeof dashboard.payload.metrics.clusterRiskQuality.collateralImpactRate, "number");
    assert.equal(typeof dashboard.payload.metrics.recoveryAutomation.completionRate, "number");
  });
});
