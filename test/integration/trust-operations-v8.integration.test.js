import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createServer } from "../../src/server.js";

async function withTestServer(fn) {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "grejiji-trust-v8-int-"));
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

test("trust operations v8: identity gating, challenge timeline, and staged account recovery", async () => {
  await withTestServer(async ({ request, registerUser }) => {
    const buyer = await registerUser("trust-v8-buyer", "buyer");
    const seller = await registerUser("trust-v8-seller", "seller");
    const admin = await registerUser("trust-v8-admin", "admin");

    const created = await request(
      "POST",
      "/transactions",
      {
        transactionId: "txn-trust-v8-1",
        sellerId: seller.user.id,
        amountCents: 9000
      },
      buyer.token
    );
    assert.equal(created.response.status, 201);

    for (let index = 0; index < 3; index += 1) {
      const invalidWebhook = await request(
        "POST",
        "/webhooks/stripe",
        {
          id: `evt_trust_v8_invalid_${index}`,
          type: "payment_intent.succeeded",
          data: {
            object: {
              id: `pi_trust_v8_${index}`,
              metadata: {
                transaction_id: "txn-trust-v8-1"
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
        name: "trust-v8-identity-gating-1",
        policy: {
          autoHoldRiskScore: 30,
          clearRiskScore: 15,
          holdDurationHours: 24,
          reserveRiskScore: 20,
          manualReviewRiskScore: 45,
          reservePercent: 20,
          integrityLookbackDays: 30,
          networkRiskWeight: 30,
          propagationDecayHours: 168,
          v5Enabled: true,
          v6Enabled: true,
          v7Enabled: true,
          v8Enabled: true,
          highRiskGateScore: 30,
          challengeGateScore: 40,
          assuranceBypassScore: 90,
          identityAssuranceLookbackDays: 90,
          evidenceConfidenceWeight: 35,
          arbitrationAutoReleaseRiskScore: 25,
          arbitrationDelayedReleaseRiskScore: 55,
          arbitrationDelayHours: 12,
          experimentTrafficCapPercent: 100
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
    assert.ok((recompute.payload.items ?? []).length >= 1);

    const cases = await request("GET", "/admin/trust-operations/cases?limit=50", undefined, admin.token);
    assert.equal(cases.response.status, 200);
    assert.ok((cases.payload.cases ?? []).length >= 1);
    const trustCase = cases.payload.cases.find((entry) => entry.transactionId === "txn-trust-v8-1");
    assert.ok(trustCase);

    const caseDetail = await request(
      "GET",
      `/admin/trust-operations/cases/${trustCase.id}`,
      undefined,
      admin.token
    );
    assert.equal(caseDetail.response.status, 200);
    assert.equal(
      typeof caseDetail.payload.trustCase.payoutDecision.identityAssurance.blendedScore,
      "number"
    );
    assert.equal(typeof caseDetail.payload.trustCase.payoutDecision.gating.action, "string");

    const challengeCreated = await request(
      "POST",
      `/admin/trust-operations/cases/${trustCase.id}/challenges`,
      {
        userId: buyer.user.id,
        reasonCode: "identity_step_up_challenge_required",
        challengeType: "identity_reverification",
        evidence: { source: "integration_test" }
      },
      admin.token
    );
    assert.equal(challengeCreated.response.status, 201);
    assert.equal(challengeCreated.payload.challenge.status, "pending");

    const challengeResolved = await request(
      "POST",
      `/admin/trust-operations/challenges/${challengeCreated.payload.challenge.id}/resolve`,
      {
        status: "passed",
        evidence: { result: "matched" }
      },
      admin.token
    );
    assert.equal(challengeResolved.response.status, 200);
    assert.equal(challengeResolved.payload.challenge.status, "passed");

    const challengeList = await request(
      "GET",
      `/admin/trust-operations/cases/${trustCase.id}/challenges?limit=20`,
      undefined,
      admin.token
    );
    assert.equal(challengeList.response.status, 200);
    assert.ok((challengeList.payload.challenges ?? []).length >= 1);

    const startRecovery = await request(
      "POST",
      `/admin/accounts/${seller.user.id}/recovery/start`,
      {
        compromiseSignal: {
          source: "network_link_cluster",
          reasonCode: "suspected_account_takeover"
        },
        notes: "compromise suspected"
      },
      admin.token
    );
    assert.equal(startRecovery.response.status, 201);
    assert.equal(startRecovery.payload.recoveryCase.stage, "lockdown");

    for (let index = 0; index < 4; index += 1) {
      const advanced = await request(
        "POST",
        `/admin/accounts/${seller.user.id}/recovery/approve-stage`,
        {
          notes: `approval-step-${index + 1}`
        },
        admin.token
      );
      assert.equal(advanced.response.status, 200);
    }

    const recoveryState = await request(
      "GET",
      `/admin/accounts/${seller.user.id}/recovery?limit=10`,
      undefined,
      admin.token
    );
    assert.equal(recoveryState.response.status, 200);
    assert.equal(recoveryState.payload.activeCase, null);
    assert.ok((recoveryState.payload.history ?? []).length >= 1);
    assert.equal(recoveryState.payload.history[0].status, "resolved");

    const accountRisk = await request(
      "GET",
      `/admin/accounts/${seller.user.id}/risk`,
      undefined,
      admin.token
    );
    assert.equal(accountRisk.response.status, 200);
    assert.equal(accountRisk.payload.account.riskFlagged, false);
    assert.equal(accountRisk.payload.account.verificationRequired, false);

    const dashboard = await request(
      "GET",
      "/admin/trust-operations/dashboard?lookbackHours=168",
      undefined,
      admin.token
    );
    assert.equal(dashboard.response.status, 200);
    assert.equal(typeof dashboard.payload.metrics.identityGating.challengeCompletionRate, "number");
    assert.equal(typeof dashboard.payload.metrics.accountRecovery.turnaroundCompletionRate, "number");
  });
});
