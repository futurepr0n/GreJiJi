import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createServer } from "../../src/server.js";

async function withTestServer(fn) {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "grejiji-trust-v11-int-"));
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

test("trust operations v11: buyer-risk intelligence, preemption automation, and unwind audit chain", async () => {
  await withTestServer(async ({ request, registerUser }) => {
    const buyer = await registerUser("trust-v11-buyer", "buyer");
    const seller = await registerUser("trust-v11-seller", "seller");
    const admin = await registerUser("trust-v11-admin", "admin");

    const listing = await request(
      "POST",
      "/listings",
      {
        id: "listing-v11-1",
        title: "Collector console package",
        description: "Includes stock photo references and seller-managed warranty card.",
        priceCents: 64000,
        localArea: "Toronto",
        category: "electronics",
        itemCondition: "used"
      },
      seller.token
    );
    assert.equal(listing.response.status, 201);

    const created = await request(
      "POST",
      "/transactions",
      {
        transactionId: "txn-trust-v11-1",
        sellerId: seller.user.id,
        amountCents: 72000
      },
      buyer.token
    );
    assert.equal(created.response.status, 201);

    const createdPolicy = await request(
      "POST",
      "/admin/trust-operations/policies",
      {
        name: "trust-v11-buyer-intel-controls-1",
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
          v11Enabled: true,
          preemptiveEscrowDelayHours: 36,
          preemptiveEscrowDelayRiskScore: 30,
          preemptiveShipmentConfirmationRiskScore: 35,
          preemptivePayoutRestrictionRiskScore: 45,
          v11BuyerRiskHighScore: 20,
          v11BuyerRiskCriticalScore: 35,
          v11EscrowAnomalyHighScore: 20,
          v11DisputePreemptionHighScore: 20,
          v11TemporarySettlementDelayHours: 18,
          v11VelocityControlWindowHours: 36
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
        transactionId: "txn-trust-v11-1",
        policyVersionId,
        links: [
          {
            sourceEntityKey: `account:${buyer.user.id}`,
            targetEntityKey: "device:fp_shared_v11",
            linkType: "device",
            confidenceScore: 96,
            propagatedRiskScore: 93,
            evidence: { source: "device_fingerprint", sampleCount: 7 }
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
    assert.ok((recompute.payload.v11?.buyerSignalsLogged ?? 0) >= 1);
    assert.ok(
      (recompute.payload.v11?.preemptionActionsApplied ?? 0) +
        (recompute.payload.v11?.preemptionActionsProposed ?? 0) >=
        1
    );

    const queue = await request("GET", "/admin/trust-operations/cases?status=open", undefined, admin.token);
    assert.equal(queue.response.status, 200);
    const trustCase = queue.payload.cases.find((item) => item.transactionId === "txn-trust-v11-1");
    assert.ok(trustCase);

    const caseDetail = await request(
      "GET",
      `/admin/trust-operations/cases/${trustCase.id}`,
      undefined,
      admin.token
    );
    assert.equal(caseDetail.response.status, 200);
    assert.ok(
      Array.isArray(caseDetail.payload.trustCase.payoutDecision.buyerRiskIntelligence.featureAttributions)
    );
    assert.ok(
      Array.isArray(caseDetail.payload.trustCase.payoutDecision.disputePreemptionAutomation.actions)
    );
    assert.ok((caseDetail.payload.buyerRiskSignals ?? []).length >= 1);
    assert.ok((caseDetail.payload.disputePreemptionActions ?? []).length >= 1);

    const preview = await request(
      "GET",
      `/admin/trust-operations/cases/${trustCase.id}/intervention-preview`,
      undefined,
      admin.token
    );
    assert.equal(preview.response.status, 200);
    assert.equal(preview.payload.preview.caseId, trustCase.id);
    assert.equal(typeof preview.payload.preview.alternativeInterventionPaths, "object");

    const forbiddenExport = await request(
      "POST",
      `/admin/trust-operations/cases/${trustCase.id}/evidence-bundle/export`,
      {},
      buyer.token
    );
    assert.equal(forbiddenExport.response.status, 403);

    const strictMissingArtifacts = await request(
      "POST",
      `/admin/trust-operations/cases/${trustCase.id}/evidence-bundle/export`,
      {
        requireDisputeArtifacts: true
      },
      admin.token
    );
    assert.equal(strictMissingArtifacts.response.status, 409);

    const exported = await request(
      "POST",
      `/admin/trust-operations/cases/${trustCase.id}/evidence-bundle/export`,
      {},
      admin.token
    );
    assert.equal(exported.response.status, 200);
    assert.equal(exported.payload.caseId, trustCase.id);
    assert.equal(exported.payload.payload.exportVersion, "v17");
    assert.ok(Array.isArray(exported.payload.payload.buyerRiskSignals));
    assert.ok(Array.isArray(exported.payload.payload.disputePreemptionActions));
    assert.equal(typeof exported.payload.payload.contextBundles, "object");
    assert.equal(typeof exported.payload.payload.contextBundles.assessment, "object");
    assert.equal(typeof exported.payload.payload.contextBundles.intervention, "object");
    assert.equal(typeof exported.payload.payload.contextBundles.dispute, "object");
    assert.equal(typeof exported.payload.payload.integrityMetadata.bundleHashSha256, "string");
    assert.ok(Array.isArray(exported.payload.payload.integrityMetadata.checkpointLinkage));

    const strictHashMismatch = await request(
      "POST",
      `/admin/trust-operations/cases/${trustCase.id}/evidence-bundle/export`,
      {
        expectedBundleHashSha256: "deadbeef"
      },
      admin.token
    );
    assert.equal(strictHashMismatch.response.status, 409);

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
    const rolledBack = (clearedDetail.payload.disputePreemptionActions ?? []).filter(
      (item) => item.status === "rolled_back"
    );
    const unwind = (clearedDetail.payload.disputePreemptionActions ?? []).filter(
      (item) => item.actionType === "preemption_unwind"
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
    assert.equal(typeof dashboard.payload.metrics.buyerRiskV11.disputeRateReductionProxy, "number");
    assert.equal(
      typeof dashboard.payload.metrics.buyerRiskV11.falsePositiveInterventionImpactRate,
      "number"
    );
  });
});
