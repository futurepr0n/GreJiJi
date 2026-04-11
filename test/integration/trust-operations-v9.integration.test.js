import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createServer } from "../../src/server.js";

async function withTestServer(fn) {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "grejiji-trust-v9-int-"));
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

test("trust operations v9: collusion evidence graphing and preemptive dispute controls", async () => {
  await withTestServer(async ({ request, registerUser }) => {
    const buyer = await registerUser("trust-v9-buyer", "buyer");
    const seller = await registerUser("trust-v9-seller", "seller");
    const admin = await registerUser("trust-v9-admin", "admin");

    const created = await request(
      "POST",
      "/transactions",
      {
        transactionId: "txn-trust-v9-1",
        sellerId: seller.user.id,
        amountCents: 58000
      },
      buyer.token
    );
    assert.equal(created.response.status, 201);

    for (let index = 0; index < 4; index += 1) {
      const invalidWebhook = await request(
        "POST",
        "/webhooks/stripe",
        {
          id: `evt_trust_v9_invalid_${index}`,
          type: "payment_intent.succeeded",
          data: {
            object: {
              id: `pi_trust_v9_${index}`,
              metadata: {
                transaction_id: "txn-trust-v9-1"
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
        name: "trust-v9-collusion-controls-1",
        policy: {
          autoHoldRiskScore: 30,
          clearRiskScore: 15,
          holdDurationHours: 24,
          reserveRiskScore: 20,
          manualReviewRiskScore: 45,
          reservePercent: 30,
          integrityLookbackDays: 30,
          networkRiskWeight: 50,
          propagationDecayHours: 168,
          v5Enabled: true,
          v6Enabled: true,
          v8Enabled: true,
          v9Enabled: true,
          highRiskGateScore: 35,
          challengeGateScore: 50,
          assuranceBypassScore: 85,
          identityAssuranceLookbackDays: 90,
          collusionEscalationRiskScore: 40,
          preemptiveEscrowDelayHours: 36,
          preemptiveEscrowDelayRiskScore: 30,
          preemptiveShipmentConfirmationRiskScore: 35,
          preemptivePayoutRestrictionRiskScore: 45
        },
        cohort: {
          minAmountCents: 1000,
          maxAmountCents: 100000
        }
      },
      admin.token
    );
    assert.equal(createdPolicy.response.status, 201);
    const policyVersionId = createdPolicy.payload.policyVersion.id;

    const activated = await request(
      "POST",
      `/admin/trust-operations/policies/${policyVersionId}/activate`,
      {},
      admin.token
    );
    assert.equal(activated.response.status, 200);

    const networkSignals = await request(
      "POST",
      "/admin/trust-operations/network/signals",
      {
        transactionId: "txn-trust-v9-1",
        policyVersionId,
        links: [
          {
            sourceEntityKey: `account:${buyer.user.id}`,
            targetEntityKey: "device:fp_shared_v9",
            linkType: "device",
            confidenceScore: 94,
            propagatedRiskScore: 90,
            evidence: { source: "device_fingerprint", sampleCount: 5 }
          },
          {
            sourceEntityKey: `account:${seller.user.id}`,
            targetEntityKey: "payment_instrument:pm_shared_v9",
            linkType: "payment_instrument",
            confidenceScore: 92,
            propagatedRiskScore: 89,
            evidence: { source: "instrument_reuse", sampleCount: 3 }
          },
          {
            sourceEntityKey: `account:${buyer.user.id}`,
            targetEntityKey: "fulfillment_endpoint:locker_v9_22",
            linkType: "fulfillment_endpoint",
            confidenceScore: 90,
            propagatedRiskScore: 87,
            evidence: { source: "shared_pickup_endpoint", sampleCount: 2 }
          },
          {
            sourceEntityKey: `account:${seller.user.id}`,
            targetEntityKey: "communication_fingerprint:chat_style_v9",
            linkType: "communication_fingerprint",
            confidenceScore: 86,
            propagatedRiskScore: 84,
            evidence: { source: "message_signature_similarity", sampleCount: 4 }
          }
        ]
      },
      admin.token
    );
    assert.equal(networkSignals.response.status, 201);
    assert.ok(networkSignals.payload.networkRiskScore >= 60);

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

    const queue = await request("GET", "/admin/trust-operations/cases?status=open", undefined, admin.token);
    assert.equal(queue.response.status, 200);
    const trustCase = queue.payload.cases.find((item) => item.transactionId === "txn-trust-v9-1");
    assert.ok(trustCase);

    const caseDetail = await request(
      "GET",
      `/admin/trust-operations/cases/${trustCase.id}`,
      undefined,
      admin.token
    );
    assert.equal(caseDetail.response.status, 200);
    assert.equal(
      caseDetail.payload.trustCase.payoutDecision.preemptiveDisputeControls.controls.requireShipmentConfirmation,
      true
    );
    assert.equal(
      caseDetail.payload.trustCase.payoutDecision.preemptiveDisputeControls.controls.restrictPayoutProgression,
      true
    );
    assert.ok(
      caseDetail.payload.trustCase.payoutDecision.preemptiveDisputeControls.controls
        .conditionalEscrowDelayHours >= 24
    );
    assert.ok(
      (caseDetail.payload.trustCase.payoutDecision.interventionRationaleCards ?? []).length >= 1
    );

    const investigation = await request(
      "GET",
      "/admin/trust-operations/network/investigation?transactionId=txn-trust-v9-1",
      undefined,
      admin.token
    );
    assert.equal(investigation.response.status, 200);
    assert.ok((investigation.payload.graph?.summary?.nodeCount ?? 0) >= 4);
    assert.ok((investigation.payload.graph?.summary?.highConfidenceEdgeCount ?? 0) >= 2);
    assert.ok((investigation.payload.linkedCaseExpansion?.openCaseCount ?? 0) >= 1);
    assert.ok((investigation.payload.interventionRationaleCards ?? []).length >= 1);

    const blockedWithoutProof = await request(
      "POST",
      "/transactions/txn-trust-v9-1/confirm-delivery",
      {},
      buyer.token
    );
    assert.equal(blockedWithoutProof.response.status, 409);
    assert.match(blockedWithoutProof.payload.error, /shipment confirmation is required/i);

    const blockedByPayoutRestriction = await request(
      "POST",
      "/transactions/txn-trust-v9-1/confirm-delivery",
      {
        fulfillmentProof: {
          id: "proof-v9-1",
          proofType: "shipment_receipt",
          metadata: { carrier: "integration-test", trackingId: "track-v9-1" }
        }
      },
      buyer.token
    );
    assert.equal(blockedByPayoutRestriction.response.status, 409);
    assert.match(blockedByPayoutRestriction.payload.error, /manual trust-ops review/i);
  });
});
