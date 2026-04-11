import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createServer } from "../../src/server.js";

async function withTestServer(fn) {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "grejiji-trust-v10-int-"));
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

test("trust operations v10: proactive interdiction, intervention preview/export, and remediation unwind", async () => {
  await withTestServer(async ({ request, registerUser }) => {
    const buyer = await registerUser("trust-v10-buyer", "buyer");
    const seller = await registerUser("trust-v10-seller", "seller");
    const admin = await registerUser("trust-v10-admin", "admin");

    for (let index = 0; index < 3; index += 1) {
      const listing = await request(
        "POST",
        "/listings",
        {
          id: `listing-v10-${index}`,
          title: "Mint Console Bundle - stock photo",
          description: "Includes stock photo references and catalog image placeholders.",
          priceCents: 12000 + index * 1500,
          localArea: "Toronto",
          category: "electronics",
          itemCondition: "used"
        },
        seller.token
      );
      assert.equal(listing.response.status, 201);
    }

    const created = await request(
      "POST",
      "/transactions",
      {
        transactionId: "txn-trust-v10-1",
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
          id: `evt_trust_v10_invalid_${index}`,
          type: "payment_intent.succeeded",
          data: {
            object: {
              id: `pi_trust_v10_${index}`,
              metadata: {
                transaction_id: "txn-trust-v10-1"
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
        name: "trust-v10-interdiction-controls-1",
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
          v10Enabled: true,
          highRiskGateScore: 35,
          challengeGateScore: 50,
          assuranceBypassScore: 85,
          identityAssuranceLookbackDays: 90,
          collusionEscalationRiskScore: 40,
          preemptiveEscrowDelayHours: 36,
          preemptiveEscrowDelayRiskScore: 30,
          preemptiveShipmentConfirmationRiskScore: 35,
          preemptivePayoutRestrictionRiskScore: 45,
          v10ReserveEscalationMediumPercent: 25,
          v10ReserveEscalationHighPercent: 40,
          v10ReserveEscalationCriticalPercent: 55,
          authenticityPriceHighRatio: 2.0,
          authenticityPriceLowRatio: 0.4,
          authenticityLookbackDays: 30
        },
        cohort: {
          minAmountCents: 1000,
          maxAmountCents: 150000
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
        transactionId: "txn-trust-v10-1",
        policyVersionId,
        links: [
          {
            sourceEntityKey: `account:${buyer.user.id}`,
            targetEntityKey: "device:fp_shared_v10",
            linkType: "device",
            confidenceScore: 96,
            propagatedRiskScore: 93,
            evidence: { source: "device_fingerprint", sampleCount: 7 }
          },
          {
            sourceEntityKey: `account:${seller.user.id}`,
            targetEntityKey: "payment_instrument:pm_shared_v10",
            linkType: "payment_instrument",
            confidenceScore: 94,
            propagatedRiskScore: 91,
            evidence: { source: "instrument_reuse", sampleCount: 5 }
          }
        ]
      },
      admin.token
    );
    assert.equal(networkSignals.response.status, 201);

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
    assert.ok((recompute.payload.v10?.listingSignalsLogged ?? 0) >= 1);

    const queue = await request("GET", "/admin/trust-operations/cases?status=open", undefined, admin.token);
    assert.equal(queue.response.status, 200);
    const trustCase = queue.payload.cases.find((item) => item.transactionId === "txn-trust-v10-1");
    assert.ok(trustCase);

    const caseDetail = await request(
      "GET",
      `/admin/trust-operations/cases/${trustCase.id}`,
      undefined,
      admin.token
    );
    assert.equal(caseDetail.response.status, 200);
    assert.ok(
      Number(caseDetail.payload.trustCase.payoutDecision.listingAuthenticityForensics.score) >= 1
    );
    assert.ok(
      ["high", "critical"].includes(
        caseDetail.payload.trustCase.payoutDecision.scamRingInterdiction.confidenceTier
      )
    );
    assert.ok(
      (caseDetail.payload.trustCase.payoutDecision.remediationPlan.actions ?? []).length >= 2
    );
    assert.ok(
      (caseDetail.payload.listingAuthenticitySignals ?? []).length >= 1
    );
    assert.ok(
      (caseDetail.payload.remediationActions ?? []).length >= 1
    );

    const preview = await request(
      "GET",
      `/admin/trust-operations/cases/${trustCase.id}/intervention-preview`,
      undefined,
      admin.token
    );
    assert.equal(preview.response.status, 200);
    assert.equal(preview.payload.preview.caseId, trustCase.id);
    assert.ok(Array.isArray(preview.payload.preview.actions));
    assert.ok(
      Array.isArray(
        preview.payload.preview.machineHumanDecisionBoundary.overridePath?.allowedActions ?? []
      )
    );

    const exported = await request(
      "POST",
      `/admin/trust-operations/cases/${trustCase.id}/evidence-bundle/export`,
      {},
      admin.token
    );
    assert.equal(exported.response.status, 200);
    assert.equal(exported.payload.caseId, trustCase.id);
    assert.equal(exported.payload.payload.exportVersion, "v10");
    assert.ok(Array.isArray(exported.payload.payload.remediationActions));
    assert.ok(Array.isArray(exported.payload.payload.listingAuthenticitySignals));

    const cleared = await request(
      "POST",
      `/admin/trust-operations/cases/${trustCase.id}/clear`,
      {
        reasonCode: "false_positive_after_review",
        notes: "manual review found low collateral risk"
      },
      admin.token
    );
    assert.equal(cleared.response.status, 200);
    assert.equal(cleared.payload.trustCase.status, "resolved");

    const clearedDetail = await request(
      "GET",
      `/admin/trust-operations/cases/${trustCase.id}`,
      undefined,
      admin.token
    );
    assert.equal(clearedDetail.response.status, 200);
    const rolledBack = (clearedDetail.payload.remediationActions ?? []).filter(
      (item) => item.status === "rolled_back"
    );
    const unwind = (clearedDetail.payload.remediationActions ?? []).filter(
      (item) => item.actionType === "remediation_unwind"
    );
    assert.ok(rolledBack.length >= 1);
    assert.ok(unwind.length >= 1);

    const dashboard = await request(
      "GET",
      "/admin/trust-operations/dashboard?lookbackHours=48",
      undefined,
      admin.token
    );
    assert.equal(dashboard.response.status, 200);
    assert.equal(typeof dashboard.payload.metrics.interdictionV10.rollbackRate, "number");
    assert.equal(
      typeof dashboard.payload.metrics.interdictionV10.averageListingAuthenticitySignalScore,
      "number"
    );
  });
});
