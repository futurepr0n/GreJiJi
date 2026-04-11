import crypto from "node:crypto";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith("--")) {
      continue;
    }
    const key = value.slice(2);
    args[key] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true;
    if (args[key] !== true) {
      i += 1;
    }
  }
  return args;
}

function hmacStripeSignature({ payload, secret, timestamp }) {
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

const args = parseArgs(process.argv.slice(2));
const baseUrl = String(args["base-url"] ?? process.env.BASE_URL ?? "").replace(/\/$/, "");
const timeoutMs = Number(args["timeout-ms"] ?? process.env.SYNTHETIC_CHECK_TIMEOUT_MS ?? 10000);
const webhookSecret = String(args["webhook-secret"] ?? process.env.STRIPE_WEBHOOK_SECRET ?? "");

if (!baseUrl) {
  console.error("Missing base URL. Use --base-url or BASE_URL.");
  process.exit(2);
}
if (!webhookSecret) {
  console.error("Missing Stripe webhook secret. Use --webhook-secret or STRIPE_WEBHOOK_SECRET.");
  process.exit(2);
}

const runId = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

async function requestJson(method, endpoint, { body, token, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });

    const payloadText = await response.text();
    let payload;
    try {
      payload = payloadText ? JSON.parse(payloadText) : {};
    } catch {
      payload = { raw: payloadText };
    }

    return { response, payload };
  } finally {
    clearTimeout(timer);
  }
}

async function runCheck(name, fn) {
  const startedAt = Date.now();
  try {
    await fn();
    console.log(
      JSON.stringify({
        event: "synthetic.check.passed",
        check: name,
        latencyMs: Date.now() - startedAt,
        runId,
        at: new Date().toISOString()
      })
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "synthetic.check.failed",
        check: name,
        latencyMs: Date.now() - startedAt,
        runId,
        at: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error)
      })
    );
    throw error;
  }
}

function assertStatus(response, expected, context) {
  if (response.status !== expected) {
    throw new Error(`${context} expected ${expected}, got ${response.status}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function registerUser({ role, suffix }) {
  const password = `${role}-password-123`;
  const userId = `${role}-${suffix}`;
  const email = `${role}.${suffix}@example.com`;

  const { response, payload } = await requestJson("POST", "/auth/register", {
    body: { userId, email, password, role }
  });
  assertStatus(response, 201, `register ${role}`);
  assert(payload?.token, `${role} registration missing token`);
  return payload;
}

async function main() {
  const suffix = runId.replace(/[^a-zA-Z0-9]/g, "");
  let seller;
  let buyer;
  let admin;
  let transactionId;

  await runCheck("health", async () => {
    const { response, payload } = await requestJson("GET", "/health");
    assertStatus(response, 200, "health");
    assert(payload?.status === "ok", "health payload status is not ok");
  });

  await runCheck("auth", async () => {
    seller = await registerUser({ role: "seller", suffix: `${suffix}a` });
    buyer = await registerUser({ role: "buyer", suffix: `${suffix}b` });
    admin = await registerUser({ role: "admin", suffix: `${suffix}c` });
  });

  await runCheck("listing_create_and_browse", async () => {
    const listingId = `listing-${suffix}`;
    const created = await requestJson("POST", "/listings", {
      token: seller.token,
      body: {
        listingId,
        title: "Synthetic listing",
        description: "Synthetic deploy smoke listing",
        priceCents: 4200,
        localArea: "Toronto"
      }
    });
    assertStatus(created.response, 201, "listing create");

    const listed = await requestJson("GET", "/listings");
    assertStatus(listed.response, 200, "listings browse");
    const hasListing = Array.isArray(listed.payload?.listings)
      ? listed.payload.listings.some((entry) => entry.id === listingId)
      : false;
    assert(hasListing, "created listing not found in browse response");
  });

  await runCheck("transaction_create", async () => {
    transactionId = `txn-${suffix}`;
    const created = await requestJson("POST", "/transactions", {
      token: seller.token,
      body: {
        transactionId,
        buyerId: buyer.user.id,
        amountCents: 4200
      }
    });
    assertStatus(created.response, 201, "transaction create");
  });

  await runCheck("dispute_api", async () => {
    const opened = await requestJson("POST", `/transactions/${transactionId}/disputes`, {
      token: buyer.token,
      body: {}
    });
    assertStatus(opened.response, 200, "open dispute");

    const queue = await requestJson("GET", "/admin/disputes?filter=open", {
      token: admin.token
    });
    assertStatus(queue.response, 200, "admin dispute queue");

    const detail = await requestJson("GET", `/admin/disputes/${transactionId}`, {
      token: admin.token
    });
    assertStatus(detail.response, 200, "admin dispute detail");
  });

  await runCheck("reputation_read", async () => {
    const sellerReputation = await requestJson(
      "GET",
      `/users/${encodeURIComponent(seller.user.id)}/reputation`
    );
    assertStatus(sellerReputation.response, 200, "seller reputation read");
    assert(
      sellerReputation.payload?.reputation?.userId === seller.user.id,
      "seller reputation payload missing userId"
    );
  });

  await runCheck("webhook_ingestion", async () => {
    const eventId = `evt_${suffix}`;
    const eventPayload = {
      id: eventId,
      type: "payment_intent.succeeded",
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: `pi_${suffix}`,
          metadata: {
            transaction_id: transactionId
          }
        }
      }
    };
    const rawPayload = JSON.stringify(eventPayload);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = hmacStripeSignature({
      payload: rawPayload,
      secret: webhookSecret,
      timestamp
    });

    const ingested = await requestJson("POST", "/webhooks/stripe", {
      body: eventPayload,
      headers: {
        "Stripe-Signature": signature
      }
    });
    assertStatus(ingested.response, 200, "stripe webhook ingest");
    assert(ingested.payload?.ok === true, "stripe webhook response did not return ok=true");

    const events = await requestJson("GET", "/admin/payment-webhooks?status=processed&provider=stripe", {
      token: admin.token
    });
    assertStatus(events.response, 200, "payment webhook admin list");
    const hasEvent = Array.isArray(events.payload?.events)
      ? events.payload.events.some((entry) => entry.eventId === eventId)
      : false;
    assert(hasEvent, "processed webhook event not found in admin listing");
  });

  console.log(
    JSON.stringify({
      event: "synthetic.run.passed",
      runId,
      baseUrl,
      checkedAt: new Date().toISOString()
    })
  );
}

main().catch(() => {
  process.exit(1);
});
