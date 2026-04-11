import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createServer } from "../../src/server.js";

process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "load-test-secret";

function percentile(values, ratio) {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function signStripePayload({ body, secret, timestamp }) {
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

async function withServer(options, fn) {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "grejiji-load-"));
  const databasePath = path.join(tempDirectory, "test.sqlite");
  const evidenceStoragePath = path.join(tempDirectory, "evidence");
  const server = createServer({ databasePath, evidenceStoragePath, ...options });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  async function request(method, endpoint, body, token, headers = {}) {
    const finalHeaders = { ...headers };
    if (body !== undefined) {
      finalHeaders["content-type"] = "application/json";
    }
    if (token) {
      finalHeaders.authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers: finalHeaders,
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    return { response, payload };
  }

  try {
    return await fn({ request });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
}

async function seedScenario(request) {
  const seller = await request("POST", "/auth/register", {
    userId: "load-seller",
    email: "load-seller@example.com",
    password: "seller-password",
    role: "seller"
  });
  const buyer = await request("POST", "/auth/register", {
    userId: "load-buyer",
    email: "load-buyer@example.com",
    password: "buyer-password",
    role: "buyer"
  });
  const admin = await request("POST", "/auth/register", {
    userId: "load-admin",
    email: "load-admin@example.com",
    password: "admin-password",
    role: "admin"
  });

  if (seller.response.status !== 201 || buyer.response.status !== 201 || admin.response.status !== 201) {
    throw new Error("failed to register seed users");
  }

  const sellerToken = seller.payload.token;
  const buyerToken = buyer.payload.token;
  const adminToken = admin.payload.token;

  for (let index = 0; index < 40; index += 1) {
    const listingResult = await request(
      "POST",
      "/listings",
      {
        listingId: `load-listing-${index}`,
        title: `Load listing ${index}`,
        description: "benchmark listing",
        priceCents: 1000 + index,
        localArea: index % 2 === 0 ? "Toronto" : "Mississauga"
      },
      sellerToken
    );
    if (listingResult.response.status !== 201) {
      throw new Error(`failed to seed listing ${index}`);
    }
  }

  const transactionIds = [];
  for (let index = 0; index < 30; index += 1) {
    const transactionId = `load-txn-${index}`;
    const transactionResult = await request(
      "POST",
      "/transactions",
      {
        transactionId,
        sellerId: "load-seller",
        amountCents: 7000 + index
      },
      buyerToken
    );
    if (transactionResult.response.status !== 201) {
      throw new Error(`failed to seed transaction ${index}`);
    }
    transactionIds.push(transactionId);
  }

  for (let index = 0; index < 10; index += 1) {
    const disputeResult = await request(
      "POST",
      `/transactions/${transactionIds[index]}/disputes`,
      {},
      buyerToken
    );
    if (disputeResult.response.status !== 200) {
      throw new Error(`failed to seed dispute ${index}`);
    }
  }

  return { sellerToken, buyerToken, adminToken, transactionIds };
}

async function runMixedLoad({ request, buyerToken, adminToken, transactionIds }) {
  const durationMs = 8000;
  const concurrency = 24;
  const stopAt = Date.now() + durationMs;
  const latencies = [];
  let totalRequests = 0;
  let errorRequests = 0;
  let webhookCounter = 0;

  const runWorker = async () => {
    while (Date.now() < stopAt) {
      const start = process.hrtime.bigint();
      const selection = Math.floor(Math.random() * 100);
      let response;

      if (selection < 65) {
        response = await request("GET", "/listings?limit=80");
      } else if (selection < 95) {
        const transactionId = transactionIds[Math.floor(Math.random() * transactionIds.length)];
        response = await request("GET", `/transactions/${transactionId}`, undefined, buyerToken);
      } else if (selection < 99) {
        response = await request("GET", "/admin/disputes?filter=open", undefined, adminToken);
      } else {
        const transactionId = transactionIds[Math.floor(Math.random() * transactionIds.length)];
        const eventPayload = {
          id: `evt_load_${webhookCounter}`,
          type: webhookCounter % 2 === 0 ? "payment_intent.succeeded" : "charge.succeeded",
          created: Math.floor(Date.now() / 1000),
          data: {
            object: {
              id: `pi_load_${webhookCounter}`,
              metadata: { transaction_id: transactionId }
            }
          }
        };
        webhookCounter += 1;
        const rawBody = JSON.stringify(eventPayload);
        const signature = signStripePayload({
          body: rawBody,
          secret: process.env.STRIPE_WEBHOOK_SECRET,
          timestamp: Math.floor(Date.now() / 1000)
        });
        response = await request("POST", "/webhooks/stripe", eventPayload, null, {
          "stripe-signature": signature
        });
      }

      const end = process.hrtime.bigint();
      const latencyMs = Number(end - start) / 1_000_000;
      latencies.push(latencyMs);
      totalRequests += 1;
      if ((response?.response?.status ?? 500) >= 400) {
        errorRequests += 1;
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));

  const metrics = await request("GET", "/metrics");

  return {
    totalRequests,
    errorRequests,
    errorRate: totalRequests === 0 ? 0 : errorRequests / totalRequests,
    p95Ms: Number(percentile(latencies, 0.95).toFixed(2)),
    p99Ms: Number(percentile(latencies, 0.99).toFixed(2)),
    maxMs: Number(Math.max(...latencies, 0).toFixed(2)),
    metrics: metrics.payload
  };
}

async function runScenario(name, serverOptions) {
  return withServer(serverOptions, async ({ request }) => {
    const seeded = await seedScenario(request);
    const loadResult = await runMixedLoad({
      request,
      buyerToken: seeded.buyerToken,
      adminToken: seeded.adminToken,
      transactionIds: seeded.transactionIds
    });

    return {
      name,
      ...loadResult
    };
  });
}

async function main() {
  const baseline = await runScenario("no-cache", {
    listingsCacheTtlMs: 0,
    transactionCacheTtlMs: 0
  });
  const optimized = await runScenario("cache-enabled", {
    listingsCacheTtlMs: 1500,
    transactionCacheTtlMs: 750
  });

  const report = {
    generatedAt: new Date().toISOString(),
    scenarios: [baseline, optimized].map((scenario) => ({
      name: scenario.name,
      totalRequests: scenario.totalRequests,
      errorRate: Number(scenario.errorRate.toFixed(6)),
      p95Ms: scenario.p95Ms,
      p99Ms: scenario.p99Ms,
      maxMs: scenario.maxMs,
      coreFlowSlo: scenario.metrics?.slo?.coreFlow ?? null,
      queue: scenario.metrics?.queue?.notificationOutbox ?? null,
      cacheHits: scenario.metrics?.counters?.filter((entry) => entry.name === "cache.hit_total") ?? [],
      cacheMisses:
        scenario.metrics?.counters?.filter((entry) => entry.name === "cache.miss_total") ?? []
    }))
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
