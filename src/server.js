import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { StoreError, createTransactionStore } from "./db.js";
import { PaymentProviderError, createPaymentProvider } from "./payment-provider.js";
import { renderDocsPage } from "./docs-page.js";
import { renderWebAppPage } from "./web/app-page.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultDatabasePath = path.join(__dirname, "..", "data", "grejiji.sqlite");
const defaultEvidenceStoragePath = path.join(__dirname, "..", "data", "dispute-evidence");
const defaultListingPhotoStoragePath = path.join(__dirname, "..", "data", "listing-photos");
const migrationsDirectory = path.join(__dirname, "..", "migrations");
const webClientFilePath = path.join(__dirname, "web", "client.js");
const webStylesFilePath = path.join(__dirname, "web", "styles.css");

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const nodeEnv = process.env.NODE_ENV ?? "development";
const authTokenSecret = process.env.AUTH_TOKEN_SECRET ?? "local-dev-secret-change-me";
const tokenTtlSeconds = Number(process.env.AUTH_TOKEN_TTL_SECONDS ?? 60 * 60 * 12);
const evidenceMaxBytes = Number(process.env.EVIDENCE_MAX_BYTES ?? 5 * 1024 * 1024);
const listingPhotoMaxBytes = Number(process.env.LISTING_PHOTO_MAX_BYTES ?? 8 * 1024 * 1024);
const defaultBodyMaxBytes = Number(process.env.REQUEST_BODY_MAX_BYTES ?? 1024 * 1024);
const requestLogEnabled = String(process.env.REQUEST_LOG_ENABLED ?? "true") !== "false";
const errorEventLogFile = process.env.ERROR_EVENT_LOG_FILE ?? null;
const demoSeedEnabled = parseBooleanEnv(process.env.DEMO_SEED_ENABLED, nodeEnv !== "test");
const demoSeedPassword = process.env.DEMO_SEED_PASSWORD ?? "DemoMarket123!";
const rateLimitEnabled = String(process.env.RATE_LIMIT_ENABLED ?? "true") !== "false";
const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60 * 1000);
const coreFlowAvailabilityTarget = Number(process.env.CORE_FLOW_SLO_AVAILABILITY_TARGET ?? 0.995);
const coreFlowP95LatencyMsTarget = Number(process.env.CORE_FLOW_SLO_P95_MS_TARGET ?? 1200);
const coreFlowBurnRateAlertThreshold = Number(
  process.env.CORE_FLOW_SLO_BURN_RATE_ALERT_THRESHOLD ?? 2
);
const routeRateLimits = {
  auth: Number(process.env.RATE_LIMIT_AUTH_MAX ?? 20),
  listingsWrite: Number(process.env.RATE_LIMIT_LISTINGS_WRITE_MAX ?? 60),
  transactionsWrite: Number(process.env.RATE_LIMIT_TRANSACTIONS_WRITE_MAX ?? 60),
  disputeWrite: Number(process.env.RATE_LIMIT_DISPUTE_WRITE_MAX ?? 40),
  adminJobs: Number(process.env.RATE_LIMIT_ADMIN_JOBS_MAX ?? 30),
  webhookIntake: Number(process.env.RATE_LIMIT_WEBHOOK_INTAKE_MAX ?? 120)
};
const riskVelocityWindowMinutes = Number(process.env.RISK_VELOCITY_WINDOW_MINUTES ?? 30);
const riskVelocityThreshold = Number(process.env.RISK_VELOCITY_THRESHOLD ?? 5);
const riskDisputeWindowHours = Number(process.env.RISK_DISPUTE_WINDOW_HOURS ?? 24);
const riskDisputeThreshold = Number(process.env.RISK_DISPUTE_THRESHOLD ?? 3);
const trustOpsAutoHoldRiskScoreDefault = Number(process.env.TRUST_OPS_AUTO_HOLD_RISK_SCORE ?? 70);
const trustOpsClearRiskScoreDefault = Number(process.env.TRUST_OPS_CLEAR_RISK_SCORE ?? 30);
const trustOpsHoldDurationHoursDefault = Number(process.env.TRUST_OPS_HOLD_DURATION_HOURS ?? 24);
const trustOpsRecomputeDefaultLimit = Number(process.env.TRUST_OPS_RECOMPUTE_DEFAULT_LIMIT ?? 100);
const trustOpsRecomputeHardLimit = Number(process.env.TRUST_OPS_RECOMPUTE_HARD_LIMIT ?? 500);
const riskTierPolicies = {
  low: {
    maxTransactionCents: parseOptionalNonNegativeInteger(
      process.env.RISK_LIMIT_LOW_MAX_TRANSACTION_CENTS,
      500000,
      10_000_000,
      "RISK_LIMIT_LOW_MAX_TRANSACTION_CENTS"
    ),
    dailyVolumeCapCents: parseOptionalNonNegativeInteger(
      process.env.RISK_LIMIT_LOW_DAILY_VOLUME_CAP_CENTS,
      1500000,
      10_000_000,
      "RISK_LIMIT_LOW_DAILY_VOLUME_CAP_CENTS"
    ),
    payoutCooldownHours: parseOptionalNonNegativeInteger(
      process.env.RISK_LIMIT_LOW_PAYOUT_COOLDOWN_HOURS,
      0,
      240,
      "RISK_LIMIT_LOW_PAYOUT_COOLDOWN_HOURS"
    )
  },
  medium: {
    maxTransactionCents: parseOptionalNonNegativeInteger(
      process.env.RISK_LIMIT_MEDIUM_MAX_TRANSACTION_CENTS,
      250000,
      10_000_000,
      "RISK_LIMIT_MEDIUM_MAX_TRANSACTION_CENTS"
    ),
    dailyVolumeCapCents: parseOptionalNonNegativeInteger(
      process.env.RISK_LIMIT_MEDIUM_DAILY_VOLUME_CAP_CENTS,
      750000,
      10_000_000,
      "RISK_LIMIT_MEDIUM_DAILY_VOLUME_CAP_CENTS"
    ),
    payoutCooldownHours: parseOptionalNonNegativeInteger(
      process.env.RISK_LIMIT_MEDIUM_PAYOUT_COOLDOWN_HOURS,
      6,
      240,
      "RISK_LIMIT_MEDIUM_PAYOUT_COOLDOWN_HOURS"
    )
  },
  high: {
    maxTransactionCents: parseOptionalNonNegativeInteger(
      process.env.RISK_LIMIT_HIGH_MAX_TRANSACTION_CENTS,
      100000,
      10_000_000,
      "RISK_LIMIT_HIGH_MAX_TRANSACTION_CENTS"
    ),
    dailyVolumeCapCents: parseOptionalNonNegativeInteger(
      process.env.RISK_LIMIT_HIGH_DAILY_VOLUME_CAP_CENTS,
      250000,
      10_000_000,
      "RISK_LIMIT_HIGH_DAILY_VOLUME_CAP_CENTS"
    ),
    payoutCooldownHours: parseOptionalNonNegativeInteger(
      process.env.RISK_LIMIT_HIGH_PAYOUT_COOLDOWN_HOURS,
      24,
      240,
      "RISK_LIMIT_HIGH_PAYOUT_COOLDOWN_HOURS"
    )
  }
};
const verificationLimitCaps = {
  unverified: {
    maxTransactionCents: parseOptionalNonNegativeInteger(
      process.env.RISK_LIMIT_UNVERIFIED_MAX_TRANSACTION_CENTS,
      75000,
      10_000_000,
      "RISK_LIMIT_UNVERIFIED_MAX_TRANSACTION_CENTS"
    ),
    dailyVolumeCapCents: parseOptionalNonNegativeInteger(
      process.env.RISK_LIMIT_UNVERIFIED_DAILY_VOLUME_CAP_CENTS,
      200000,
      10_000_000,
      "RISK_LIMIT_UNVERIFIED_DAILY_VOLUME_CAP_CENTS"
    )
  },
  pending: {
    maxTransactionCents: parseOptionalNonNegativeInteger(
      process.env.RISK_LIMIT_PENDING_MAX_TRANSACTION_CENTS,
      150000,
      10_000_000,
      "RISK_LIMIT_PENDING_MAX_TRANSACTION_CENTS"
    ),
    dailyVolumeCapCents: parseOptionalNonNegativeInteger(
      process.env.RISK_LIMIT_PENDING_DAILY_VOLUME_CAP_CENTS,
      350000,
      10_000_000,
      "RISK_LIMIT_PENDING_DAILY_VOLUME_CAP_CENTS"
    )
  },
  rejected: {
    maxTransactionCents: 0,
    dailyVolumeCapCents: 0
  }
};
const listingsCacheTtlMsDefault = Number(process.env.LISTINGS_CACHE_TTL_MS ?? 1500);
const listingsCacheMaxEntriesDefault = Number(process.env.LISTINGS_CACHE_MAX_ENTRIES ?? 64);
const transactionCacheTtlMsDefault = Number(process.env.TRANSACTION_CACHE_TTL_MS ?? 750);
const transactionCacheMaxEntriesDefault = Number(process.env.TRANSACTION_CACHE_MAX_ENTRIES ?? 512);
const notificationDispatchDefaultLimit = Number(
  process.env.NOTIFICATION_DISPATCH_DEFAULT_LIMIT ?? 100
);
const notificationDispatchHardLimit = Number(process.env.NOTIFICATION_DISPATCH_HARD_LIMIT ?? 250);
const notificationDispatchDefaultMaxProcessingMs = Number(
  process.env.NOTIFICATION_DISPATCH_DEFAULT_MAX_PROCESSING_MS ?? 300
);
const paymentReconciliationDefaultLimit = Number(
  process.env.PAYMENT_RECONCILIATION_DEFAULT_LIMIT ?? 100
);
const paymentReconciliationHardLimit = Number(process.env.PAYMENT_RECONCILIATION_HARD_LIMIT ?? 300);
const listingPolicyPriceHighMultiplier = Number(
  process.env.LISTING_POLICY_PRICE_HIGH_MULTIPLIER ?? 5
);
const listingPolicyPriceLowMultiplier = Number(
  process.env.LISTING_POLICY_PRICE_LOW_MULTIPLIER ?? 0.2
);
const listingPolicyPriceBaselineMinSamples = Number(
  process.env.LISTING_POLICY_PRICE_BASELINE_MIN_SAMPLES ?? 3
);
const listingAbuseAutoHideThreshold = Number(process.env.LISTING_ABUSE_AUTO_HIDE_THRESHOLD ?? 3);
const launchControlEnvironment = process.env.LAUNCH_CONTROL_ENV ?? nodeEnv;
const launchControlRolloutSalt = process.env.LAUNCH_CONTROL_ROLLOUT_SALT ?? "grejiji-launch-control";
const launchControlAutoRollbackBurnRateThreshold = Number(
  process.env.LAUNCH_CONTROL_AUTO_ROLLBACK_BURN_RATE_THRESHOLD ?? coreFlowBurnRateAlertThreshold
);
const launchControlAutoRollbackErrorRateThreshold = Number(
  process.env.LAUNCH_CONTROL_AUTO_ROLLBACK_ERROR_RATE_THRESHOLD ?? 0.05
);
const launchControlAutoRollbackWebhookFailureThreshold = Number(
  process.env.LAUNCH_CONTROL_AUTO_ROLLBACK_WEBHOOK_FAILURE_THRESHOLD ?? 5
);
const launchControlAutoRollbackDefaultFlags = String(
  process.env.LAUNCH_CONTROL_AUTO_ROLLBACK_FLAGS ??
    "transaction_initiation,payout_release,dispute_auto_transitions,moderation_auto_actions"
)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const listingPolicyBlockedKeywords = String(
  process.env.LISTING_POLICY_BLOCKED_KEYWORDS ?? "weapon,drugs,counterfeit,stolen"
)
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const launchControlFlagKeys = new Set([
  "transaction_initiation",
  "payout_release",
  "dispute_auto_transitions",
  "moderation_auto_actions"
]);

function parseReleaseTimeoutHours(value) {
  const parsed = Number(value ?? 72);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("RELEASE_TIMEOUT_HOURS must be a positive number");
  }
  return parsed;
}

function parseEvidenceMaxBytes(value) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("EVIDENCE_MAX_BYTES must be a positive number");
  }
  return Math.floor(value);
}

function parseServiceFeeFixedCents(value) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    throw new Error("SERVICE_FEE_FIXED_CENTS must be a non-negative integer");
  }
  return parsed;
}

function parseServiceFeePercentToBps(value) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("SERVICE_FEE_PERCENT must be a non-negative number");
  }
  return Math.round(parsed * 100);
}

function parseSettlementCurrency(value) {
  const normalized = String(value ?? "USD").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new Error("SETTLEMENT_CURRENCY must be a 3-letter ISO currency code");
  }
  return normalized;
}

function parseOptionalPositiveInteger(value, fallback, minimum, maximum, fieldName) {
  const sourceValue = value ?? fallback;
  const parsed = Number(sourceValue);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${fieldName} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function parseOptionalNonNegativeInteger(value, fallback, maximum, fieldName) {
  const sourceValue = value ?? fallback;
  const parsed = Number(sourceValue);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw new Error(`${fieldName} must be an integer between 0 and ${maximum}`);
  }
  return parsed;
}

function parseBooleanEnv(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function getPathParams(pathname, pattern) {
  const match = pathname.match(pattern);
  return match ? match.slice(1) : null;
}

function readRequestBody(req, { requireJson = false, maxBytes = defaultBodyMaxBytes } = {}) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let byteLength = 0;

    const contentLengthRaw = req.headers["content-length"];
    if (contentLengthRaw) {
      const contentLength = Number(contentLengthRaw);
      if (!Number.isInteger(contentLength) || contentLength < 0) {
        reject(new StoreError("validation", "content-length must be a non-negative integer"));
        return;
      }
      if (contentLength > maxBytes) {
        reject(new StoreError("validation", `request body exceeds ${maxBytes} bytes`));
        return;
      }
    }

    if (requireJson) {
      const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
      if (!contentType.includes("application/json")) {
        reject(new StoreError("validation", "content-type must be application/json"));
        return;
      }
    }

    req.on("data", (chunk) => {
      byteLength += Buffer.byteLength(chunk);
      if (byteLength > maxBytes) {
        reject(new StoreError("validation", `request body exceeds ${maxBytes} bytes`));
        req.destroy();
        return;
      }
      raw += chunk;
    });

    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new StoreError("validation", "request body must be valid JSON"));
      }
    });

    req.on("error", reject);
  });
}

function readJsonBody(req) {
  return readRequestBody(req, { requireJson: true });
}

function readRawRequestBody(req, { maxBytes = defaultBodyMaxBytes } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let byteLength = 0;

    const contentLengthRaw = req.headers["content-length"];
    if (contentLengthRaw) {
      const contentLength = Number(contentLengthRaw);
      if (!Number.isInteger(contentLength) || contentLength < 0) {
        reject(new StoreError("validation", "content-length must be a non-negative integer"));
        return;
      }
      if (contentLength > maxBytes) {
        reject(new StoreError("validation", `request body exceeds ${maxBytes} bytes`));
        return;
      }
    }

    req.on("data", (chunk) => {
      byteLength += Buffer.byteLength(chunk);
      if (byteLength > maxBytes) {
        reject(new StoreError("validation", `request body exceeds ${maxBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    req.on("error", reject);
  });
}

function verifyStripeWebhookSignature({ rawBody, signatureHeader, secret, toleranceSeconds }) {
  if (!secret || typeof secret !== "string" || !secret.trim()) {
    return false;
  }
  if (!signatureHeader || typeof signatureHeader !== "string") {
    return false;
  }

  const pieces = signatureHeader.split(",").map((item) => item.trim());
  let timestamp = null;
  const signatures = [];
  for (const piece of pieces) {
    const [key, value] = piece.split("=", 2);
    if (key === "t" && value) {
      timestamp = Number(value);
      continue;
    }
    if (key === "v1" && value) {
      signatures.push(value);
    }
  }

  if (!Number.isInteger(timestamp) || signatures.length === 0) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return false;
  }

  const signedPayload = `${timestamp}.${rawBody.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", secret.trim()).update(signedPayload).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  for (const candidate of signatures) {
    try {
      const candidateBuffer = Buffer.from(candidate, "hex");
      if (
        candidateBuffer.length === expectedBuffer.length &&
        crypto.timingSafeEqual(candidateBuffer, expectedBuffer)
      ) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

function assertSafeId(value, fieldName) {
  if (value === undefined || value === null) {
    return;
  }
  if (typeof value !== "string" || !idPattern.test(value)) {
    throw new StoreError(
      "validation",
      `${fieldName} must match ${idPattern.toString()} and be 64 chars or fewer`
    );
  }
}

function normalizeEmail(email) {
  if (typeof email !== "string") {
    throw new StoreError("validation", "email must be a string");
  }
  const normalized = email.trim().toLowerCase();
  if (!emailPattern.test(normalized)) {
    throw new StoreError("validation", "email must be a valid address");
  }
  return normalized;
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    const first = forwarded.split(",")[0].trim();
    if (first) {
      return first;
    }
  }
  return req.socket.remoteAddress ?? "unknown";
}

function getRateLimitPolicy(method, pathname) {
  if (method === "POST" && (pathname === "/auth/register" || pathname === "/auth/login")) {
    return { key: "auth", max: routeRateLimits.auth };
  }
  if (
    (method === "POST" && pathname === "/listings") ||
    (method === "PATCH" && /^\/listings\/[^/]+$/.test(pathname)) ||
    (method === "POST" && /^\/listings\/[^/]+\/photos$/.test(pathname)) ||
    (method === "POST" && /^\/listings\/[^/]+\/abuse-reports$/.test(pathname))
  ) {
    return { key: "listingsWrite", max: routeRateLimits.listingsWrite };
  }
  if (
    method === "POST" &&
    (pathname === "/transactions" ||
      /^\/transactions\/[^/]+\/confirm-delivery$/.test(pathname) ||
      /^\/transactions\/[^/]+\/acknowledge-completion$/.test(pathname) ||
      /^\/transactions\/[^/]+\/disputes$/.test(pathname) ||
      /^\/transactions\/[^/]+\/ratings$/.test(pathname) ||
      /^\/transactions\/[^/]+\/disputes\/evidence$/.test(pathname))
  ) {
    return { key: "transactionsWrite", max: routeRateLimits.transactionsWrite };
  }
  if (
    method === "POST" &&
    (/^\/transactions\/[^/]+\/disputes\/resolve$/.test(pathname) ||
      /^\/transactions\/[^/]+\/disputes\/adjudicate$/.test(pathname))
  ) {
    return { key: "disputeWrite", max: routeRateLimits.disputeWrite };
  }
  if (method === "POST" && /^\/jobs\/.+/.test(pathname)) {
    return { key: "adminJobs", max: routeRateLimits.adminJobs };
  }
  if (method === "POST" && /^\/admin\/listings\/[^/]+\/moderation\/(approve|reject|hide|unhide)$/.test(pathname)) {
    return { key: "adminJobs", max: routeRateLimits.adminJobs };
  }
  if (method === "POST" && pathname === "/webhooks/stripe") {
    return { key: "webhookIntake", max: routeRateLimits.webhookIntake };
  }
  return null;
}

function getRouteMetricLabels(method, pathname) {
  if (method === "GET" && pathname === "/health") {
    return { pathTemplate: "/health", flow: "health", coreFlow: false };
  }
  if (method === "GET" && pathname === "/ready") {
    return { pathTemplate: "/ready", flow: "ready", coreFlow: false };
  }
  if (method === "GET" && pathname === "/metrics") {
    return { pathTemplate: "/metrics", flow: "metrics_read", coreFlow: false };
  }
  if (method === "GET" && pathname === "/listings") {
    return { pathTemplate: "/listings", flow: "listing.read", coreFlow: false };
  }
  if (method === "POST" && pathname === "/listings") {
    return { pathTemplate: "/listings", flow: "listing.create", coreFlow: true };
  }
  if (method === "PATCH" && /^\/listings\/[^/]+$/.test(pathname)) {
    return { pathTemplate: "/listings/:id", flow: "listing.update", coreFlow: true };
  }
  if (method === "POST" && /^\/listings\/[^/]+\/photos$/.test(pathname)) {
    return { pathTemplate: "/listings/:id/photos", flow: "listing.photo_upload", coreFlow: true };
  }
  if (method === "GET" && /^\/listings\/[^/]+\/photos\/[^/]+$/.test(pathname)) {
    return { pathTemplate: "/listings/:id/photos/:photoId", flow: "listing.photo_read", coreFlow: false };
  }
  if (method === "POST" && /^\/listings\/[^/]+\/abuse-reports$/.test(pathname)) {
    return { pathTemplate: "/listings/:id/abuse-reports", flow: "listing.abuse_report", coreFlow: true };
  }
  if (method === "POST" && pathname === "/auth/register") {
    return { pathTemplate: "/auth/register", flow: "auth.register", coreFlow: false };
  }
  if (method === "POST" && pathname === "/auth/login") {
    return { pathTemplate: "/auth/login", flow: "auth.login", coreFlow: true };
  }
  if (method === "POST" && pathname === "/transactions") {
    return { pathTemplate: "/transactions", flow: "transaction.create", coreFlow: true };
  }
  if (method === "POST" && /^\/transactions\/[^/]+\/confirm-delivery$/.test(pathname)) {
    return {
      pathTemplate: "/transactions/:id/confirm-delivery",
      flow: "transaction.confirm_delivery",
      coreFlow: true
    };
  }
  if (method === "POST" && /^\/transactions\/[^/]+\/acknowledge-completion$/.test(pathname)) {
    return {
      pathTemplate: "/transactions/:id/acknowledge-completion",
      flow: "transaction.acknowledge_completion",
      coreFlow: true
    };
  }
  if (method === "POST" && /^\/transactions\/[^/]+\/ratings$/.test(pathname)) {
    return { pathTemplate: "/transactions/:id/ratings", flow: "rating.submit", coreFlow: true };
  }
  if (method === "GET" && /^\/transactions\/[^/]+\/ratings$/.test(pathname)) {
    return { pathTemplate: "/transactions/:id/ratings", flow: "rating.read", coreFlow: false };
  }
  if (method === "GET" && /^\/users\/[^/]+\/reputation$/.test(pathname)) {
    return { pathTemplate: "/users/:id/reputation", flow: "reputation.read", coreFlow: false };
  }
  if (method === "POST" && /^\/transactions\/[^/]+\/disputes$/.test(pathname)) {
    return { pathTemplate: "/transactions/:id/disputes", flow: "dispute.open", coreFlow: true };
  }
  if (method === "POST" && /^\/transactions\/[^/]+\/disputes\/resolve$/.test(pathname)) {
    return {
      pathTemplate: "/transactions/:id/disputes/resolve",
      flow: "dispute.resolve",
      coreFlow: true
    };
  }
  if (method === "POST" && /^\/transactions\/[^/]+\/disputes\/adjudicate$/.test(pathname)) {
    return {
      pathTemplate: "/transactions/:id/disputes/adjudicate",
      flow: "dispute.adjudicate",
      coreFlow: true
    };
  }
  if (method === "POST" && pathname === "/webhooks/stripe") {
    return { pathTemplate: "/webhooks/stripe", flow: "webhook.stripe", coreFlow: false };
  }
  if (method === "POST" && pathname === "/jobs/notification-dispatch") {
    return {
      pathTemplate: "/jobs/notification-dispatch",
      flow: "notification.dispatch",
      coreFlow: false
    };
  }
  if (method === "POST" && pathname === "/jobs/payment-reconciliation") {
    return {
      pathTemplate: "/jobs/payment-reconciliation",
      flow: "payment.reconciliation",
      coreFlow: false
    };
  }
  if (method === "POST" && pathname === "/jobs/trust-operations/recompute") {
    return {
      pathTemplate: "/jobs/trust-operations/recompute",
      flow: "trust_ops.recompute",
      coreFlow: false
    };
  }
  if (method === "POST" && pathname === "/jobs/trust-operations/recovery/process") {
    return {
      pathTemplate: "/jobs/trust-operations/recovery/process",
      flow: "trust_ops.recovery.process",
      coreFlow: false
    };
  }
  if (method === "POST" && pathname === "/admin/trust-operations/simulate-policy") {
    return {
      pathTemplate: "/admin/trust-operations/simulate-policy",
      flow: "trust_ops.simulate",
      coreFlow: false
    };
  }
  if (method === "POST" && pathname === "/admin/trust-operations/backtest") {
    return {
      pathTemplate: "/admin/trust-operations/backtest",
      flow: "trust_ops.backtest",
      coreFlow: false
    };
  }
  if (method === "POST" && pathname === "/admin/trust-operations/policies") {
    return {
      pathTemplate: "/admin/trust-operations/policies",
      flow: "trust_ops.policy.create",
      coreFlow: false
    };
  }
  if (method === "GET" && pathname === "/admin/trust-operations/policies") {
    return {
      pathTemplate: "/admin/trust-operations/policies",
      flow: "trust_ops.policy.read",
      coreFlow: false
    };
  }
  if (method === "POST" && /^\/admin\/trust-operations\/policies\/\d+\/activate$/.test(pathname)) {
    return {
      pathTemplate: "/admin/trust-operations/policies/:id/activate",
      flow: "trust_ops.policy.activate",
      coreFlow: false
    };
  }
  if (method === "GET" && pathname === "/admin/trust-operations/dashboard") {
    return {
      pathTemplate: "/admin/trust-operations/dashboard",
      flow: "trust_ops.dashboard",
      coreFlow: false
    };
  }
  if (method === "GET" && pathname === "/admin/trust-operations/policy-recommendations") {
    return {
      pathTemplate: "/admin/trust-operations/policy-recommendations",
      flow: "trust_ops.policy.recommendations",
      coreFlow: false
    };
  }
  if (method === "POST" && pathname === "/admin/trust-operations/feedback") {
    return {
      pathTemplate: "/admin/trust-operations/feedback",
      flow: "trust_ops.feedback.write",
      coreFlow: false
    };
  }
  if (method === "POST" && pathname === "/admin/trust-operations/network/signals") {
    return {
      pathTemplate: "/admin/trust-operations/network/signals",
      flow: "trust_ops.network.signals",
      coreFlow: false
    };
  }
  if (method === "GET" && pathname === "/admin/trust-operations/network/investigation") {
    return {
      pathTemplate: "/admin/trust-operations/network/investigation",
      flow: "trust_ops.network.investigation",
      coreFlow: false
    };
  }
  if (method === "GET" && pathname === "/admin/trust-operations/recovery/queue") {
    return {
      pathTemplate: "/admin/trust-operations/recovery/queue",
      flow: "trust_ops.recovery.queue",
      coreFlow: false
    };
  }
  if (method === "GET" && pathname === "/admin/trust-operations/cases") {
    return {
      pathTemplate: "/admin/trust-operations/cases",
      flow: "trust_ops.queue.read",
      coreFlow: false
    };
  }
  if (method === "GET" && /^\/admin\/trust-operations\/cases\/\d+$/.test(pathname)) {
    return {
      pathTemplate: "/admin/trust-operations/cases/:id",
      flow: "trust_ops.case.read",
      coreFlow: false
    };
  }
  if (method === "GET" && /^\/admin\/trust-operations\/cases\/\d+\/intervention-preview$/.test(pathname)) {
    return {
      pathTemplate: "/admin/trust-operations/cases/:id/intervention-preview",
      flow: "trust_ops.case.intervention_preview",
      coreFlow: false
    };
  }
  if (
    method === "POST" &&
    /^\/admin\/trust-operations\/cases\/\d+\/(approve|override|clear|assign|claim)$/.test(pathname)
  ) {
    return {
      pathTemplate: "/admin/trust-operations/cases/:id/action",
      flow: "trust_ops.case.write",
      coreFlow: false
    };
  }
  if (method === "POST" && /^\/admin\/trust-operations\/cases\/\d+\/notes$/.test(pathname)) {
    return {
      pathTemplate: "/admin/trust-operations/cases/:id/notes",
      flow: "trust_ops.case.note",
      coreFlow: false
    };
  }
  if (
    method === "POST" &&
    /^\/admin\/trust-operations\/cases\/\d+\/evidence-bundle\/export$/.test(pathname)
  ) {
    return {
      pathTemplate: "/admin/trust-operations/cases/:id/evidence-bundle/export",
      flow: "trust_ops.case.evidence_bundle.export",
      coreFlow: false
    };
  }
  if (method === "POST" && pathname === "/admin/trust-operations/cases/bulk-action") {
    return {
      pathTemplate: "/admin/trust-operations/cases/bulk-action",
      flow: "trust_ops.case.bulk",
      coreFlow: false
    };
  }
  if (method === "GET" && pathname === "/admin/trust-operations/payout-risk/metrics") {
    return {
      pathTemplate: "/admin/trust-operations/payout-risk/metrics",
      flow: "trust_ops.payout_risk.read",
      coreFlow: false
    };
  }
  if (method === "GET" && /^\/admin\/accounts\/[^/]+\/integrity$/.test(pathname)) {
    return {
      pathTemplate: "/admin/accounts/:id/integrity",
      flow: "trust_ops.integrity.read",
      coreFlow: false
    };
  }
  return { pathTemplate: pathname, flow: "other", coreFlow: false };
}

function percentile(values, ratio) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function logLine(level, payload) {
  const line = JSON.stringify({
    level,
    ts: new Date().toISOString(),
    service: "grejiji-api",
    ...payload
  });

  if (level === "error") {
    console.error(line);
    return;
  }
  console.log(line);
}

async function appendErrorEvent(payload) {
  if (!errorEventLogFile) {
    return;
  }
  const line = `${JSON.stringify({ ts: new Date().toISOString(), ...payload })}\n`;
  await fs.mkdir(path.dirname(errorEventLogFile), { recursive: true });
  await fs.appendFile(errorEventLogFile, line, "utf8");
}

function mapStoreErrorToStatusCode(error) {
  if (error instanceof PaymentProviderError) {
    return error.isTemporary ? 503 : 502;
  }

  if (!(error instanceof StoreError)) {
    return 500;
  }

  switch (error.code) {
    case "validation":
      return 400;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "conflict":
      return 409;
    default:
      return 500;
  }
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function buildDemoCatalog() {
  const sellers = Array.from({ length: 10 }, (_, index) => {
    const ordinal = String(index + 1).padStart(2, "0");
    return {
      id: `demo-seller-${ordinal}`,
      email: `demo-seller-${ordinal}@grejiji.demo`,
      role: "seller",
      listing: {
        id: `demo-listing-${ordinal}`,
        title: `Demo Listing ${ordinal}: Local Item`,
        description: `Seller ${ordinal} sample inventory for marketplace demo mode.`,
        priceCents: 2500 + index * 950,
        localArea: ["Toronto", "Montreal", "Vancouver", "Calgary", "Ottawa"][index % 5],
        photoUrls: [
          `https://images.unsplash.com/photo-1556745757-${1000 + index}?auto=format&fit=crop&w=900&q=80`
        ]
      }
    };
  });

  return {
    admin: { id: "demo-admin", email: "demo-admin@grejiji.demo", role: "admin" },
    buyer: { id: "demo-buyer", email: "demo-buyer@grejiji.demo", role: "buyer" },
    sellers
  };
}

function ensureDemoUser(store, { id, email, role, password }) {
  const auth = store.getUserAuthByEmail(email);
  if (auth?.user) {
    return auth.user;
  }

  const salt = crypto.randomBytes(16).toString("hex");
  return store.createUser({
    id,
    email,
    role,
    passwordHash: hashPassword(password, salt),
    passwordSalt: salt
  });
}

function ensureDemoMarketplaceData(store, { enabled = true } = {}) {
  if (!enabled) {
    return { enabled: false };
  }

  const catalog = buildDemoCatalog();
  const summary = {
    enabled: true,
    createdUsers: 0,
    createdListings: 0,
    createdTransactions: 0,
    createdRatings: 0
  };

  const beforeAdmin = store.getUserAuthByEmail(catalog.admin.email)?.user;
  ensureDemoUser(store, {
    ...catalog.admin,
    password: demoSeedPassword
  });
  if (!beforeAdmin) {
    summary.createdUsers += 1;
  }

  const beforeBuyer = store.getUserAuthByEmail(catalog.buyer.email)?.user;
  ensureDemoUser(store, {
    ...catalog.buyer,
    password: demoSeedPassword
  });
  if (!beforeBuyer) {
    summary.createdUsers += 1;
  }

  for (const [index, seller] of catalog.sellers.entries()) {
    const beforeSeller = store.getUserAuthByEmail(seller.email)?.user;
    const ensuredSeller = ensureDemoUser(store, {
      id: seller.id,
      email: seller.email,
      role: seller.role,
      password: demoSeedPassword
    });
    if (!beforeSeller) {
      summary.createdUsers += 1;
    }

    const existingListing = store.getListingById(seller.listing.id);
    if (!existingListing) {
      store.createListing({
        id: seller.listing.id,
        sellerId: ensuredSeller.id,
        title: seller.listing.title,
        description: seller.listing.description,
        priceCents: seller.listing.priceCents,
        localArea: seller.listing.localArea,
        photoUrls: seller.listing.photoUrls,
        moderationStatus: "approved",
        moderationSource: "system_seed",
        moderationUpdatedBy: catalog.admin.id
      });
      summary.createdListings += 1;
    }

    const transactionId = `demo-history-txn-${String(index + 1).padStart(2, "0")}`;
    const existingTransaction = store.getTransactionById(transactionId);
    if (!existingTransaction) {
      store.createAcceptedTransactionWithPayment({
        id: transactionId,
        buyerId: catalog.buyer.id,
        sellerId: ensuredSeller.id,
        amountCents: seller.listing.priceCents,
        actorId: catalog.admin.id,
        paymentResult: {
          provider: "local",
          status: "succeeded",
          paymentIntentId: null,
          chargeId: null,
          raw: { mode: "demo_seed" }
        },
        paymentIdempotencyKey: `demo-seed:${transactionId}:authorize_capture:v1`
      });
      store.confirmDelivery({ id: transactionId, buyerId: catalog.buyer.id });
      store.acknowledgeCompletionBySeller({ id: transactionId, sellerId: ensuredSeller.id });
      summary.createdTransactions += 1;
    }

    const ratings = store.listTransactionRatings({ transactionId });
    if (!ratings.some((entry) => entry.raterUserId === catalog.buyer.id)) {
      store.submitTransactionRating({
        transactionId,
        raterUserId: catalog.buyer.id,
        score: 5 - (index % 2),
        comment: "Reliable seller. Item matched listing details."
      });
      summary.createdRatings += 1;
    }
    if (!ratings.some((entry) => entry.raterUserId === ensuredSeller.id)) {
      store.submitTransactionRating({
        transactionId,
        raterUserId: ensuredSeller.id,
        score: 5,
        comment: "Buyer paid promptly and completed the handoff."
      });
      summary.createdRatings += 1;
    }
  }

  return summary;
}

function timingSafeEqualHex(left, right) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function encodeBase64Url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64UrlJson(value) {
  const parsed = Buffer.from(value, "base64url").toString("utf8");
  return JSON.parse(parsed);
}

function signTokenPayload(payload) {
  const payloadPart = encodeBase64Url(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", authTokenSecret)
    .update(payloadPart)
    .digest("base64url");
  return `${payloadPart}.${signature}`;
}

function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return null;
  }

  const [payloadPart, signature] = token.split(".");
  if (!payloadPart || !signature) {
    return null;
  }

  const expectedSignature = crypto
    .createHmac("sha256", authTokenSecret)
    .update(payloadPart)
    .digest("base64url");

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  let payload;
  try {
    payload = decodeBase64UrlJson(payloadPart);
  } catch {
    return null;
  }

  if (!payload?.sub || !payload?.role || !payload?.exp) {
    return null;
  }

  if (Date.now() >= Number(payload.exp) * 1000) {
    return null;
  }

  return payload;
}

function getBearerToken(req) {
  const authorization = req.headers.authorization;
  if (!authorization || !authorization.startsWith("Bearer ")) {
    return null;
  }
  return authorization.slice("Bearer ".length).trim();
}

function buildAuthResponse(user) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    sub: user.id,
    role: user.role,
    iat: nowSeconds,
    exp: nowSeconds + tokenTtlSeconds
  };

  return {
    token: signTokenPayload(payload),
    expiresAt: new Date(payload.exp * 1000).toISOString()
  };
}

function requireAuth(req, store) {
  const token = getBearerToken(req);
  if (!token) {
    throw new StoreError("forbidden", "authentication token is required");
  }

  const tokenPayload = verifyToken(token);
  if (!tokenPayload) {
    throw new StoreError("forbidden", "authentication token is invalid or expired");
  }

  const user = store.getUserById(tokenPayload.sub);
  if (!user) {
    throw new StoreError("forbidden", "authenticated user does not exist");
  }

  if (req.requestContext) {
    req.requestContext.authenticatedUserId = user.id;
  }

  return user;
}

function getOptionalAuthUser(req, store) {
  const token = getBearerToken(req);
  if (!token) {
    return null;
  }

  const tokenPayload = verifyToken(token);
  if (!tokenPayload) {
    return null;
  }

  const user = store.getUserById(tokenPayload.sub);
  return user ?? null;
}

function requireRole(user, role) {
  if (user.role !== role) {
    throw new StoreError("forbidden", `${role} role is required`);
  }
}

function canReadTransaction(user, transaction) {
  if (user.role === "admin") {
    return true;
  }

  return user.id === transaction.buyerId || user.id === transaction.sellerId;
}

function canUploadDisputeEvidence(user, transaction) {
  return user.id === transaction.buyerId || user.id === transaction.sellerId;
}

function buildTrustSnapshot({ transaction, ratings, buyerReputation, sellerReputation }) {
  const buyerRating = ratings.find((entry) => entry.raterUserId === transaction.buyerId) ?? null;
  const sellerRating = ratings.find((entry) => entry.raterUserId === transaction.sellerId) ?? null;
  const bothRated = Boolean(buyerRating && sellerRating);
  const pendingBy = [];
  if (!buyerRating) {
    pendingBy.push("buyer");
  }
  if (!sellerRating) {
    pendingBy.push("seller");
  }
  return {
    ratings,
    ratingsState: bothRated ? "complete" : "pending",
    pendingBy,
    byRater: {
      buyer: buyerRating,
      seller: sellerRating
    },
    reputation: {
      buyer: buyerReputation,
      seller: sellerReputation
    }
  };
}

function ensureAccountRiskAllowsWrite(user) {
  if (user.role === "admin") {
    return;
  }
  if (user.riskFlagged) {
    throw new StoreError("forbidden", "account is flagged for manual review");
  }
  if (user.verificationRequired) {
    throw new StoreError("forbidden", "account requires additional verification");
  }
}

function resolveLimitPolicyForUser(user) {
  const tier = user.riskTier ?? "low";
  const base = riskTierPolicies[tier] ?? riskTierPolicies.low;
  const verificationStatus = user.verificationStatus ?? "unverified";
  const cap = verificationLimitCaps[verificationStatus] ?? null;
  if (!cap) {
    return {
      tier,
      verificationStatus,
      maxTransactionCents: base.maxTransactionCents,
      dailyVolumeCapCents: base.dailyVolumeCapCents,
      payoutCooldownHours: base.payoutCooldownHours
    };
  }
  return {
    tier,
    verificationStatus,
    maxTransactionCents: Math.min(base.maxTransactionCents, cap.maxTransactionCents),
    dailyVolumeCapCents: Math.min(base.dailyVolumeCapCents, cap.dailyVolumeCapCents),
    payoutCooldownHours: base.payoutCooldownHours
  };
}

function resolveTrustOpsPolicy(raw = {}) {
  const hasExplicitV5Enabled = typeof raw.v5Enabled === "boolean";
  const hasExplicitV6Enabled = typeof raw.v6Enabled === "boolean";
  const hasExplicitV7Enabled = typeof raw.v7Enabled === "boolean";
  const hasExplicitV8Enabled = typeof raw.v8Enabled === "boolean";
  const hasExplicitV9Enabled = typeof raw.v9Enabled === "boolean";
  const hasExplicitV10Enabled = typeof raw.v10Enabled === "boolean";
  const hasExplicitV11Enabled = typeof raw.v11Enabled === "boolean";
  const v5Enabled = hasExplicitV5Enabled
    ? raw.v5Enabled
    : Boolean(
        raw.reserveRiskScore !== undefined ||
          raw.manualReviewRiskScore !== undefined ||
          raw.reservePercent !== undefined ||
          raw.integrityLookbackDays !== undefined
      );
  const v6Enabled = hasExplicitV6Enabled
    ? raw.v6Enabled
    : Boolean(raw.networkRiskWeight !== undefined || raw.propagationDecayHours !== undefined);
  const v7Enabled = hasExplicitV7Enabled
    ? raw.v7Enabled
    : Boolean(
        raw.evidenceConfidenceWeight !== undefined ||
          raw.arbitrationAutoReleaseRiskScore !== undefined ||
          raw.arbitrationDelayedReleaseRiskScore !== undefined ||
          raw.arbitrationDelayHours !== undefined ||
          raw.experimentTrafficCapPercent !== undefined
      );
  const v8Enabled = hasExplicitV8Enabled
    ? raw.v8Enabled
    : Boolean(
        raw.highRiskGateScore !== undefined ||
          raw.challengeGateScore !== undefined ||
          raw.assuranceBypassScore !== undefined ||
          raw.identityAssuranceLookbackDays !== undefined
      );
  const v9Enabled = hasExplicitV9Enabled
    ? raw.v9Enabled
    : Boolean(
        raw.collusionEscalationRiskScore !== undefined ||
          raw.preemptiveEscrowDelayHours !== undefined ||
          raw.preemptiveEscrowDelayRiskScore !== undefined ||
          raw.preemptiveShipmentConfirmationRiskScore !== undefined ||
          raw.preemptivePayoutRestrictionRiskScore !== undefined
      );
  const v10Enabled = hasExplicitV10Enabled
    ? raw.v10Enabled
    : Boolean(
        raw.v10ReserveEscalationMediumPercent !== undefined ||
          raw.v10ReserveEscalationHighPercent !== undefined ||
          raw.v10ReserveEscalationCriticalPercent !== undefined ||
          raw.authenticityPriceHighRatio !== undefined ||
          raw.authenticityPriceLowRatio !== undefined ||
          raw.authenticityLookbackDays !== undefined
      );
  const v11Enabled = hasExplicitV11Enabled
    ? raw.v11Enabled
    : Boolean(
        raw.v11BuyerRiskHighScore !== undefined ||
          raw.v11BuyerRiskCriticalScore !== undefined ||
          raw.v11EscrowAnomalyHighScore !== undefined ||
          raw.v11DisputePreemptionHighScore !== undefined ||
          raw.v11TemporarySettlementDelayHours !== undefined ||
          raw.v11VelocityControlWindowHours !== undefined
      );
  const autoHoldRiskScore = Number(raw.autoHoldRiskScore ?? trustOpsAutoHoldRiskScoreDefault);
  const clearRiskScore = Number(raw.clearRiskScore ?? trustOpsClearRiskScoreDefault);
  const holdDurationHours = Number(raw.holdDurationHours ?? trustOpsHoldDurationHoursDefault);
  const reserveRiskScore = Number(raw.reserveRiskScore ?? 55);
  const manualReviewRiskScore = Number(raw.manualReviewRiskScore ?? 85);
  const reservePercent = Number(raw.reservePercent ?? 25);
  const integrityLookbackDays = Number(raw.integrityLookbackDays ?? 30);
  const networkRiskWeight = Number(raw.networkRiskWeight ?? 35);
  const propagationDecayHours = Number(raw.propagationDecayHours ?? 168);
  const evidenceConfidenceWeight = Number(raw.evidenceConfidenceWeight ?? 35);
  const arbitrationAutoReleaseRiskScore = Number(raw.arbitrationAutoReleaseRiskScore ?? 35);
  const arbitrationDelayedReleaseRiskScore = Number(raw.arbitrationDelayedReleaseRiskScore ?? 70);
  const arbitrationDelayHours = Number(raw.arbitrationDelayHours ?? 12);
  const experimentTrafficCapPercent = Number(raw.experimentTrafficCapPercent ?? 100);
  const experimentKillSwitchAppealOverturnRate = Number(
    raw.experimentKillSwitchAppealOverturnRate ?? 0.35
  );
  const experimentKillSwitchRollbackFrequency = Number(
    raw.experimentKillSwitchRollbackFrequency ?? 3
  );
  const experimentKillSwitchFalsePositiveReleaseRate = Number(
    raw.experimentKillSwitchFalsePositiveReleaseRate ?? 0.45
  );
  const highRiskGateScore = Number(raw.highRiskGateScore ?? 70);
  const challengeGateScore = Number(raw.challengeGateScore ?? 60);
  const assuranceBypassScore = Number(raw.assuranceBypassScore ?? 78);
  const identityAssuranceLookbackDays = Number(raw.identityAssuranceLookbackDays ?? 90);
  const collusionEscalationRiskScore = Number(raw.collusionEscalationRiskScore ?? 72);
  const preemptiveEscrowDelayHours = Number(raw.preemptiveEscrowDelayHours ?? 24);
  const preemptiveEscrowDelayRiskScore = Number(raw.preemptiveEscrowDelayRiskScore ?? 55);
  const preemptiveShipmentConfirmationRiskScore = Number(
    raw.preemptiveShipmentConfirmationRiskScore ?? 65
  );
  const preemptivePayoutRestrictionRiskScore = Number(raw.preemptivePayoutRestrictionRiskScore ?? 82);
  const v10ReserveEscalationMediumPercent = Number(raw.v10ReserveEscalationMediumPercent ?? 20);
  const v10ReserveEscalationHighPercent = Number(raw.v10ReserveEscalationHighPercent ?? 35);
  const v10ReserveEscalationCriticalPercent = Number(raw.v10ReserveEscalationCriticalPercent ?? 50);
  const authenticityPriceHighRatio = Number(raw.authenticityPriceHighRatio ?? 2.6);
  const authenticityPriceLowRatio = Number(raw.authenticityPriceLowRatio ?? 0.35);
  const authenticityLookbackDays = Number(raw.authenticityLookbackDays ?? 30);
  const v11BuyerRiskHighScore = Number(raw.v11BuyerRiskHighScore ?? 68);
  const v11BuyerRiskCriticalScore = Number(raw.v11BuyerRiskCriticalScore ?? 85);
  const v11EscrowAnomalyHighScore = Number(raw.v11EscrowAnomalyHighScore ?? 70);
  const v11DisputePreemptionHighScore = Number(raw.v11DisputePreemptionHighScore ?? 65);
  const v11TemporarySettlementDelayHours = Number(raw.v11TemporarySettlementDelayHours ?? 24);
  const v11VelocityControlWindowHours = Number(raw.v11VelocityControlWindowHours ?? 48);
  if (!Number.isInteger(autoHoldRiskScore) || autoHoldRiskScore < 1 || autoHoldRiskScore > 100) {
    throw new StoreError("validation", "autoHoldRiskScore must be an integer between 1 and 100");
  }
  if (!Number.isInteger(clearRiskScore) || clearRiskScore < 0 || clearRiskScore > 100) {
    throw new StoreError("validation", "clearRiskScore must be an integer between 0 and 100");
  }
  if (!Number.isInteger(holdDurationHours) || holdDurationHours < 1 || holdDurationHours > 240) {
    throw new StoreError("validation", "holdDurationHours must be an integer between 1 and 240");
  }
  if (!Number.isInteger(reserveRiskScore) || reserveRiskScore < 0 || reserveRiskScore > 100) {
    throw new StoreError("validation", "reserveRiskScore must be an integer between 0 and 100");
  }
  if (
    !Number.isInteger(manualReviewRiskScore) ||
    manualReviewRiskScore < 1 ||
    manualReviewRiskScore > 100
  ) {
    throw new StoreError("validation", "manualReviewRiskScore must be an integer between 1 and 100");
  }
  if (!Number.isInteger(reservePercent) || reservePercent < 0 || reservePercent > 80) {
    throw new StoreError("validation", "reservePercent must be an integer between 0 and 80");
  }
  if (!Number.isInteger(integrityLookbackDays) || integrityLookbackDays < 7 || integrityLookbackDays > 90) {
    throw new StoreError("validation", "integrityLookbackDays must be an integer between 7 and 90");
  }
  if (!Number.isInteger(networkRiskWeight) || networkRiskWeight < 0 || networkRiskWeight > 90) {
    throw new StoreError("validation", "networkRiskWeight must be an integer between 0 and 90");
  }
  if (!Number.isInteger(propagationDecayHours) || propagationDecayHours < 1 || propagationDecayHours > 720) {
    throw new StoreError("validation", "propagationDecayHours must be an integer between 1 and 720");
  }
  if (!Number.isInteger(evidenceConfidenceWeight) || evidenceConfidenceWeight < 0 || evidenceConfidenceWeight > 90) {
    throw new StoreError("validation", "evidenceConfidenceWeight must be an integer between 0 and 90");
  }
  if (
    !Number.isInteger(arbitrationAutoReleaseRiskScore) ||
    arbitrationAutoReleaseRiskScore < 0 ||
    arbitrationAutoReleaseRiskScore > 100
  ) {
    throw new StoreError(
      "validation",
      "arbitrationAutoReleaseRiskScore must be an integer between 0 and 100"
    );
  }
  if (
    !Number.isInteger(arbitrationDelayedReleaseRiskScore) ||
    arbitrationDelayedReleaseRiskScore < 0 ||
    arbitrationDelayedReleaseRiskScore > 100
  ) {
    throw new StoreError(
      "validation",
      "arbitrationDelayedReleaseRiskScore must be an integer between 0 and 100"
    );
  }
  if (arbitrationDelayedReleaseRiskScore < arbitrationAutoReleaseRiskScore) {
    throw new StoreError(
      "validation",
      "arbitrationDelayedReleaseRiskScore cannot be lower than arbitrationAutoReleaseRiskScore"
    );
  }
  if (!Number.isInteger(arbitrationDelayHours) || arbitrationDelayHours < 1 || arbitrationDelayHours > 168) {
    throw new StoreError("validation", "arbitrationDelayHours must be an integer between 1 and 168");
  }
  if (!Number.isInteger(experimentTrafficCapPercent) || experimentTrafficCapPercent < 1 || experimentTrafficCapPercent > 100) {
    throw new StoreError("validation", "experimentTrafficCapPercent must be an integer between 1 and 100");
  }
  if (
    !Number.isFinite(experimentKillSwitchAppealOverturnRate) ||
    experimentKillSwitchAppealOverturnRate < 0 ||
    experimentKillSwitchAppealOverturnRate > 1
  ) {
    throw new StoreError("validation", "experimentKillSwitchAppealOverturnRate must be between 0 and 1");
  }
  if (
    !Number.isInteger(experimentKillSwitchRollbackFrequency) ||
    experimentKillSwitchRollbackFrequency < 1 ||
    experimentKillSwitchRollbackFrequency > 100
  ) {
    throw new StoreError(
      "validation",
      "experimentKillSwitchRollbackFrequency must be an integer between 1 and 100"
    );
  }
  if (
    !Number.isFinite(experimentKillSwitchFalsePositiveReleaseRate) ||
    experimentKillSwitchFalsePositiveReleaseRate < 0 ||
    experimentKillSwitchFalsePositiveReleaseRate > 1
  ) {
    throw new StoreError(
      "validation",
      "experimentKillSwitchFalsePositiveReleaseRate must be between 0 and 1"
    );
  }
  if (!Number.isInteger(highRiskGateScore) || highRiskGateScore < 30 || highRiskGateScore > 100) {
    throw new StoreError("validation", "highRiskGateScore must be an integer between 30 and 100");
  }
  if (!Number.isInteger(challengeGateScore) || challengeGateScore < 20 || challengeGateScore > 100) {
    throw new StoreError("validation", "challengeGateScore must be an integer between 20 and 100");
  }
  if (!Number.isInteger(assuranceBypassScore) || assuranceBypassScore < 0 || assuranceBypassScore > 100) {
    throw new StoreError("validation", "assuranceBypassScore must be an integer between 0 and 100");
  }
  if (
    !Number.isInteger(identityAssuranceLookbackDays) ||
    identityAssuranceLookbackDays < 30 ||
    identityAssuranceLookbackDays > 180
  ) {
    throw new StoreError(
      "validation",
      "identityAssuranceLookbackDays must be an integer between 30 and 180"
    );
  }
  if (
    !Number.isInteger(collusionEscalationRiskScore) ||
    collusionEscalationRiskScore < 0 ||
    collusionEscalationRiskScore > 100
  ) {
    throw new StoreError("validation", "collusionEscalationRiskScore must be an integer between 0 and 100");
  }
  if (!Number.isInteger(preemptiveEscrowDelayHours) || preemptiveEscrowDelayHours < 0 || preemptiveEscrowDelayHours > 168) {
    throw new StoreError("validation", "preemptiveEscrowDelayHours must be an integer between 0 and 168");
  }
  if (
    !Number.isInteger(preemptiveEscrowDelayRiskScore) ||
    preemptiveEscrowDelayRiskScore < 0 ||
    preemptiveEscrowDelayRiskScore > 100
  ) {
    throw new StoreError("validation", "preemptiveEscrowDelayRiskScore must be an integer between 0 and 100");
  }
  if (
    !Number.isInteger(preemptiveShipmentConfirmationRiskScore) ||
    preemptiveShipmentConfirmationRiskScore < 0 ||
    preemptiveShipmentConfirmationRiskScore > 100
  ) {
    throw new StoreError(
      "validation",
      "preemptiveShipmentConfirmationRiskScore must be an integer between 0 and 100"
    );
  }
  if (
    !Number.isInteger(preemptivePayoutRestrictionRiskScore) ||
    preemptivePayoutRestrictionRiskScore < 0 ||
    preemptivePayoutRestrictionRiskScore > 100
  ) {
    throw new StoreError(
      "validation",
      "preemptivePayoutRestrictionRiskScore must be an integer between 0 and 100"
    );
  }
  if (preemptivePayoutRestrictionRiskScore < preemptiveShipmentConfirmationRiskScore) {
    throw new StoreError(
      "validation",
      "preemptivePayoutRestrictionRiskScore cannot be lower than preemptiveShipmentConfirmationRiskScore"
    );
  }
  for (const [fieldName, value] of [
    ["v10ReserveEscalationMediumPercent", v10ReserveEscalationMediumPercent],
    ["v10ReserveEscalationHighPercent", v10ReserveEscalationHighPercent],
    ["v10ReserveEscalationCriticalPercent", v10ReserveEscalationCriticalPercent]
  ]) {
    if (!Number.isInteger(value) || value < 0 || value > 80) {
      throw new StoreError("validation", `${fieldName} must be an integer between 0 and 80`);
    }
  }
  if (v10ReserveEscalationHighPercent < v10ReserveEscalationMediumPercent) {
    throw new StoreError(
      "validation",
      "v10ReserveEscalationHighPercent cannot be lower than v10ReserveEscalationMediumPercent"
    );
  }
  if (v10ReserveEscalationCriticalPercent < v10ReserveEscalationHighPercent) {
    throw new StoreError(
      "validation",
      "v10ReserveEscalationCriticalPercent cannot be lower than v10ReserveEscalationHighPercent"
    );
  }
  if (!Number.isFinite(authenticityPriceHighRatio) || authenticityPriceHighRatio < 1 || authenticityPriceHighRatio > 20) {
    throw new StoreError("validation", "authenticityPriceHighRatio must be between 1 and 20");
  }
  if (!Number.isFinite(authenticityPriceLowRatio) || authenticityPriceLowRatio <= 0 || authenticityPriceLowRatio > 1) {
    throw new StoreError("validation", "authenticityPriceLowRatio must be greater than 0 and at most 1");
  }
  if (authenticityPriceLowRatio >= authenticityPriceHighRatio) {
    throw new StoreError("validation", "authenticityPriceLowRatio must be lower than authenticityPriceHighRatio");
  }
  if (!Number.isInteger(authenticityLookbackDays) || authenticityLookbackDays < 7 || authenticityLookbackDays > 180) {
    throw new StoreError("validation", "authenticityLookbackDays must be an integer between 7 and 180");
  }
  for (const [fieldName, value] of [
    ["v11BuyerRiskHighScore", v11BuyerRiskHighScore],
    ["v11BuyerRiskCriticalScore", v11BuyerRiskCriticalScore],
    ["v11EscrowAnomalyHighScore", v11EscrowAnomalyHighScore],
    ["v11DisputePreemptionHighScore", v11DisputePreemptionHighScore]
  ]) {
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      throw new StoreError("validation", `${fieldName} must be an integer between 0 and 100`);
    }
  }
  if (v11BuyerRiskCriticalScore < v11BuyerRiskHighScore) {
    throw new StoreError(
      "validation",
      "v11BuyerRiskCriticalScore cannot be lower than v11BuyerRiskHighScore"
    );
  }
  for (const [fieldName, value] of [
    ["v11TemporarySettlementDelayHours", v11TemporarySettlementDelayHours],
    ["v11VelocityControlWindowHours", v11VelocityControlWindowHours]
  ]) {
    if (!Number.isInteger(value) || value < 0 || value > 168) {
      throw new StoreError("validation", `${fieldName} must be an integer between 0 and 168`);
    }
  }
  if (clearRiskScore > autoHoldRiskScore) {
    throw new StoreError("validation", "clearRiskScore cannot exceed autoHoldRiskScore");
  }
  if (v5Enabled && reserveRiskScore > autoHoldRiskScore) {
    throw new StoreError("validation", "reserveRiskScore cannot exceed autoHoldRiskScore");
  }
  if (v5Enabled && manualReviewRiskScore < autoHoldRiskScore) {
    throw new StoreError("validation", "manualReviewRiskScore cannot be lower than autoHoldRiskScore");
  }
  return {
    autoHoldRiskScore,
    clearRiskScore,
    holdDurationHours,
    reserveRiskScore,
    manualReviewRiskScore,
    reservePercent,
    integrityLookbackDays,
    networkRiskWeight,
    propagationDecayHours,
    v5Enabled,
    v6Enabled,
    v7Enabled,
    v8Enabled,
    v9Enabled,
    v10Enabled,
    v11Enabled,
    evidenceConfidenceWeight,
    arbitrationAutoReleaseRiskScore,
    arbitrationDelayedReleaseRiskScore,
    arbitrationDelayHours,
    experimentTrafficCapPercent,
    experimentKillSwitchAppealOverturnRate,
    experimentKillSwitchRollbackFrequency,
    experimentKillSwitchFalsePositiveReleaseRate,
    highRiskGateScore,
    challengeGateScore,
    assuranceBypassScore,
    identityAssuranceLookbackDays,
    collusionEscalationRiskScore,
    preemptiveEscrowDelayHours,
    preemptiveEscrowDelayRiskScore,
    preemptiveShipmentConfirmationRiskScore,
    preemptivePayoutRestrictionRiskScore,
    v10ReserveEscalationMediumPercent,
    v10ReserveEscalationHighPercent,
    v10ReserveEscalationCriticalPercent,
    authenticityPriceHighRatio,
    authenticityPriceLowRatio,
    authenticityLookbackDays,
    v11BuyerRiskHighScore,
    v11BuyerRiskCriticalScore,
    v11EscrowAnomalyHighScore,
    v11DisputePreemptionHighScore,
    v11TemporarySettlementDelayHours,
    v11VelocityControlWindowHours
  };
}

function resolveTrustOpsCohort(raw = {}) {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const minAmountCents =
    raw.minAmountCents === undefined || raw.minAmountCents === null
      ? null
      : Number(raw.minAmountCents);
  const maxAmountCents =
    raw.maxAmountCents === undefined || raw.maxAmountCents === null
      ? null
      : Number(raw.maxAmountCents);
  if (minAmountCents !== null && (!Number.isInteger(minAmountCents) || minAmountCents < 0)) {
    throw new StoreError("validation", "minAmountCents must be a non-negative integer when provided");
  }
  if (maxAmountCents !== null && (!Number.isInteger(maxAmountCents) || maxAmountCents < 0)) {
    throw new StoreError("validation", "maxAmountCents must be a non-negative integer when provided");
  }
  if (minAmountCents !== null && maxAmountCents !== null && minAmountCents > maxAmountCents) {
    throw new StoreError("validation", "minAmountCents cannot exceed maxAmountCents");
  }
  const riskLevelAllowlist = Array.isArray(raw.riskLevelAllowlist)
    ? raw.riskLevelAllowlist.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];
  return {
    minAmountCents,
    maxAmountCents,
    riskLevelAllowlist,
    transactionIdPrefix:
      raw.transactionIdPrefix === undefined || raw.transactionIdPrefix === null
        ? null
        : String(raw.transactionIdPrefix).trim() || null
  };
}

function evaluateAndEnforceRiskLimits({
  store,
  incrementMetricFn = () => {},
  checkpoint,
  transactionId = null,
  transactionAcceptedAt = null,
  amountCents,
  participants,
  requestId,
  correlationId
}) {
  const volumeSinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const decisionTransactionId =
    checkpoint === "transaction_initiation" ? null : transactionId ?? null;
  for (const participant of participants) {
    const user = store.getUserById(participant.userId);
    if (!user) {
      throw new StoreError("not_found", "participant account not found");
    }
    const policy = resolveLimitPolicyForUser(user);
    const dailyVolumeCents = store.countRecentAcceptedAmountByUser({
      userId: user.id,
      role: participant.role,
      sinceAt: volumeSinceIso
    });
    const projectedVolumeCents = dailyVolumeCents + amountCents;
    const cooldownUntil =
      checkpoint === "payout_release" &&
      policy.payoutCooldownHours > 0 &&
      transactionAcceptedAt
        ? new Date(
            new Date(transactionAcceptedAt).valueOf() + policy.payoutCooldownHours * 60 * 60 * 1000
          ).toISOString()
        : null;
    const cooldownActive = cooldownUntil ? Date.now() < new Date(cooldownUntil).valueOf() : false;

    let reasonCode = null;
    if (policy.maxTransactionCents <= 0 || policy.dailyVolumeCapCents <= 0) {
      reasonCode = "verification_rejected";
    } else if (amountCents > policy.maxTransactionCents) {
      reasonCode = "max_transaction_exceeded";
    } else if (projectedVolumeCents > policy.dailyVolumeCapCents) {
      reasonCode = "daily_volume_cap_exceeded";
    } else if (checkpoint === "payout_release" && cooldownActive) {
      reasonCode = "payout_cooldown_active";
    }
    const decision = reasonCode ? "deny" : "allow";
    store.evaluateAndRecordRiskLimitDecision({
      checkpoint,
      decision,
      reasonCode,
      transactionId: decisionTransactionId,
      userId: user.id,
      amountCents,
      dailyVolumeCents: projectedVolumeCents,
      maxTransactionCents: policy.maxTransactionCents,
      dailyVolumeCapCents: policy.dailyVolumeCapCents,
      cooldownHours: policy.payoutCooldownHours,
      cooldownUntil,
      riskTier: policy.tier,
      verificationStatus: policy.verificationStatus,
      policySnapshot: {
        role: participant.role,
        baseTierPolicy: riskTierPolicies[policy.tier] ?? riskTierPolicies.low,
        verificationCap: verificationLimitCaps[policy.verificationStatus] ?? null
      },
      requestId,
      correlationId
    });
    incrementMetricFn(
      reasonCode ? "risk.limit.denied_total" : "risk.limit.allowed_total",
      {
        checkpoint,
        role: participant.role,
        tier: policy.tier,
        verificationStatus: policy.verificationStatus,
        reasonCode: reasonCode ?? "none"
      },
      1
    );
    if (reasonCode) {
      store.recordRiskSignal({
        transactionId: decisionTransactionId,
        userId: user.id,
        signalType: "manual_review",
        severity: 50,
        details: {
          checkpoint,
          role: participant.role,
          reasonCode,
          amountCents,
          projectedVolumeCents,
          policy
        },
        createdBy: "system:risk-limits",
        requestId,
        correlationId
      });
      throw new StoreError(
        "forbidden",
        `${participant.role} account blocked by risk policy at ${checkpoint}: ${reasonCode}`
      );
    }
  }
}

function parseBase64Content(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new StoreError("validation", "contentBase64 is required");
  }
  const normalized = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new StoreError("validation", "contentBase64 must be valid base64");
  }
  return Buffer.from(normalized, "base64");
}

function sanitizeFileName(fileName) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function guessMimeTypeFromFileName(fileName) {
  const lower = String(fileName ?? "").trim().toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".pdf")) {
    return "application/pdf";
  }
  if (lower.endsWith(".txt")) {
    return "text/plain";
  }
  if (lower.endsWith(".json")) {
    return "application/json";
  }
  return null;
}

const allowedListingPhotoMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif"
]);

function normalizeListingPhotoUrls(value) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new StoreError("validation", "photoUrls must be an array of URLs");
  }
  const urls = [];
  for (const item of value) {
    const candidate = String(item ?? "").trim();
    if (!candidate) {
      continue;
    }
    let parsed;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new StoreError("validation", "photoUrls entries must be valid URLs");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new StoreError("validation", "photoUrls must use http or https");
    }
    urls.push(parsed.toString());
  }
  if (urls.length > 12) {
    throw new StoreError("validation", "photoUrls cannot include more than 12 entries");
  }
  return Array.from(new Set(urls));
}

function evaluateEvidenceMetadataConsistency({ fileName, mimeType }) {
  const expectedMime = guessMimeTypeFromFileName(fileName);
  if (!expectedMime) {
    return {
      metadataConsistencyScore: 70,
      integrityFlags: ["unknown_extension"]
    };
  }
  if (expectedMime === String(mimeType ?? "").trim().toLowerCase()) {
    return {
      metadataConsistencyScore: 100,
      integrityFlags: []
    };
  }
  return {
    metadataConsistencyScore: 45,
    integrityFlags: ["mime_extension_mismatch"]
  };
}

function buildDecisionTransparency({
  decision,
  reasonCode,
  decidedAt,
  policyVersionId = null
}) {
  const normalizedDecision = String(decision ?? "").trim();
  const normalizedReasonCode = String(reasonCode ?? "").trim() || "operator_decision";
  const openedAt = decidedAt ? new Date(decidedAt) : new Date();
  const closesAt = new Date(openedAt.valueOf());
  closesAt.setHours(closesAt.getHours() + 72);
  const nextActions =
    normalizedDecision === "release_to_seller"
      ? ["monitor_delivery_completion", "submit_appeal_if_new_evidence"]
      : normalizedDecision === "refund_to_buyer"
        ? ["confirm_refund_receipt", "submit_appeal_if_needed"]
        : normalizedDecision === "cancel_transaction"
          ? ["coordinate_item_return", "submit_appeal_if_needed"]
          : ["review_decision_details"];
  return {
    policyReasonCategory: normalizedReasonCode,
    policyVersionId,
    nextActions,
    appealWindow: {
      eligible: true,
      closesAt: closesAt.toISOString()
    }
  };
}

function normalizeModerationReasonMessage(reasonCode) {
  switch (reasonCode) {
    case "prohibited_content":
      return "Listing appears to contain prohibited content.";
    case "metadata_incomplete":
      return "Listing metadata is incomplete. Add a clearer description before resubmitting.";
    case "price_anomaly":
      return "Listing price is outside normal range and needs manual review.";
    case "abuse_reports_threshold":
      return "Listing is temporarily hidden while abuse reports are reviewed.";
    case "manual_reject":
      return "Listing was rejected by moderation.";
    case "manual_hide":
      return "Listing is temporarily hidden by moderation.";
    default:
      return "Listing requires moderation action.";
  }
}

function normalizeLaunchControlKey(key) {
  const normalized = String(key ?? "").trim();
  if (!launchControlFlagKeys.has(normalized)) {
    throw new StoreError("validation", "unsupported launch control flag key");
  }
  return normalized;
}

function normalizeLaunchControlAllowlist(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return Array.from(
    new Set(
      values
        .map((item) => String(item ?? "").trim())
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right));
}

function hashRolloutPercent(value) {
  const hash = crypto.createHash("sha256").update(value).digest();
  return Number(hash.readUInt32BE(0) % 100);
}

function buildLaunchControlDefaults() {
  const productionDefault = nodeEnv === "production";
  return {
    transaction_initiation: {
      key: "transaction_initiation",
      enabled: parseBooleanEnv(
        process.env.LAUNCH_FLAG_TRANSACTION_INITIATION_DEFAULT,
        true
      ),
      rolloutPercentage: 100,
      allowlistUserIds: [],
      regionAllowlist: []
    },
    payout_release: {
      key: "payout_release",
      enabled: parseBooleanEnv(process.env.LAUNCH_FLAG_PAYOUT_RELEASE_DEFAULT, !productionDefault),
      rolloutPercentage: 100,
      allowlistUserIds: [],
      regionAllowlist: []
    },
    dispute_auto_transitions: {
      key: "dispute_auto_transitions",
      enabled: parseBooleanEnv(
        process.env.LAUNCH_FLAG_DISPUTE_AUTO_TRANSITIONS_DEFAULT,
        !productionDefault
      ),
      rolloutPercentage: 100,
      allowlistUserIds: [],
      regionAllowlist: []
    },
    moderation_auto_actions: {
      key: "moderation_auto_actions",
      enabled: parseBooleanEnv(
        process.env.LAUNCH_FLAG_MODERATION_AUTO_ACTIONS_DEFAULT,
        !productionDefault
      ),
      rolloutPercentage: 100,
      allowlistUserIds: [],
      regionAllowlist: []
    }
  };
}

function evaluateListingPolicy({
  title,
  description,
  category,
  itemCondition,
  priceCents,
  baselineAveragePriceCents,
  baselineSampleSize
}) {
  const normalizedTitle = String(title ?? "").toLowerCase();
  const normalizedDescription = String(description ?? "").toLowerCase();
  for (const keyword of listingPolicyBlockedKeywords) {
    if (normalizedTitle.includes(keyword) || normalizedDescription.includes(keyword)) {
      return {
        moderationStatus: "rejected",
        reasonCode: "prohibited_content",
        publicReason: normalizeModerationReasonMessage("prohibited_content"),
        internalNotes: `blocked_keyword:${keyword}`
      };
    }
  }

  const hasMetadata = Boolean(
    String(description ?? "").trim().length >= 10
  );
  if (!hasMetadata) {
    return {
      moderationStatus: "pending_review",
      reasonCode: "metadata_incomplete",
      publicReason: normalizeModerationReasonMessage("metadata_incomplete"),
      internalNotes: "missing_category_condition_or_description"
    };
  }

  if (
    Number.isFinite(Number(baselineAveragePriceCents)) &&
    Number(baselineAveragePriceCents) > 0 &&
    Number(baselineSampleSize ?? 0) >= listingPolicyPriceBaselineMinSamples
  ) {
    const ratio = priceCents / Number(baselineAveragePriceCents);
    if (ratio > listingPolicyPriceHighMultiplier || ratio < listingPolicyPriceLowMultiplier) {
      return {
        moderationStatus: "pending_review",
        reasonCode: "price_anomaly",
        publicReason: normalizeModerationReasonMessage("price_anomaly"),
        internalNotes: `price_ratio:${ratio.toFixed(2)} baseline:${Math.round(
          Number(baselineAveragePriceCents)
        )}`
      };
    }
  }

  return {
    moderationStatus: "approved",
    reasonCode: null,
    publicReason: null,
    internalNotes: null
  };
}

export function createServer({
  databasePath,
  releaseTimeoutHours,
  dispatchNotification,
  serviceFeeFixedCents,
  serviceFeePercent,
  settlementCurrency,
  evidenceStoragePath,
  listingPhotoStoragePath,
  paymentProviderName,
  stripeSecretKey,
  stripeApiBaseUrl,
  stripeTimeoutMs,
  stripeDefaultPaymentMethod,
  localDefaultPaymentMethod,
  listingsCacheTtlMs,
  listingsCacheMaxEntries,
  transactionCacheTtlMs,
  transactionCacheMaxEntries,
  notificationDispatchLimit,
  notificationDispatchMaxProcessingMs,
  paymentReconciliationLimit
} = {}) {
  const resolvedDatabasePath = databasePath ?? process.env.DATABASE_PATH ?? defaultDatabasePath;
  const resolvedEvidenceStoragePath =
    evidenceStoragePath ?? process.env.EVIDENCE_STORAGE_PATH ?? defaultEvidenceStoragePath;
  const resolvedListingPhotoStoragePath =
    listingPhotoStoragePath ??
    process.env.LISTING_PHOTO_STORAGE_PATH ??
    defaultListingPhotoStoragePath;
  const resolvedEvidenceMaxBytes = parseEvidenceMaxBytes(evidenceMaxBytes);
  const resolvedListingPhotoMaxBytes = parseEvidenceMaxBytes(listingPhotoMaxBytes);
  const store = createTransactionStore({
    databasePath: resolvedDatabasePath,
    migrationsDirectory,
    releaseTimeoutHours: releaseTimeoutHours ?? parseReleaseTimeoutHours(process.env.RELEASE_TIMEOUT_HOURS),
    serviceFeeFixedCents: parseServiceFeeFixedCents(
      serviceFeeFixedCents ?? process.env.SERVICE_FEE_FIXED_CENTS
    ),
    serviceFeeRateBps: parseServiceFeePercentToBps(
      serviceFeePercent ?? process.env.SERVICE_FEE_PERCENT
    ),
    settlementCurrency: parseSettlementCurrency(
      settlementCurrency ?? process.env.SETTLEMENT_CURRENCY
    ),
    dispatchNotification
  });
  try {
    const shouldSeedDemo = demoSeedEnabled && resolvedDatabasePath === defaultDatabasePath;
    const demoSeedSummary = ensureDemoMarketplaceData(store, { enabled: shouldSeedDemo });
    if (demoSeedSummary.enabled) {
      logLine("info", {
        event: "demo.seed.completed",
        ...demoSeedSummary
      });
    }
  } catch (error) {
    logLine("error", {
      event: "demo.seed.failed",
      message: error instanceof Error ? error.message : String(error)
    });
  }
  const paymentProvider = createPaymentProvider({
    providerName: paymentProviderName ?? process.env.PAYMENT_PROVIDER ?? "local",
    stripeSecretKey: stripeSecretKey ?? process.env.STRIPE_SECRET_KEY,
    stripeApiBaseUrl: stripeApiBaseUrl ?? process.env.STRIPE_API_BASE_URL,
    stripeTimeoutMs: stripeTimeoutMs ?? process.env.STRIPE_TIMEOUT_MS,
    stripeDefaultPaymentMethod:
      stripeDefaultPaymentMethod ?? process.env.STRIPE_DEFAULT_PAYMENT_METHOD,
    localDefaultPaymentMethod:
      localDefaultPaymentMethod ?? process.env.PAYMENT_LOCAL_DEFAULT_METHOD
  });
  const resolvedListingsCacheTtlMs = parseOptionalNonNegativeInteger(
    listingsCacheTtlMs,
    listingsCacheTtlMsDefault,
    60000,
    "LISTINGS_CACHE_TTL_MS"
  );
  const resolvedListingsCacheMaxEntries = parseOptionalPositiveInteger(
    listingsCacheMaxEntries,
    listingsCacheMaxEntriesDefault,
    1,
    2048,
    "LISTINGS_CACHE_MAX_ENTRIES"
  );
  const resolvedTransactionCacheTtlMs = parseOptionalNonNegativeInteger(
    transactionCacheTtlMs,
    transactionCacheTtlMsDefault,
    60000,
    "TRANSACTION_CACHE_TTL_MS"
  );
  const resolvedTransactionCacheMaxEntries = parseOptionalPositiveInteger(
    transactionCacheMaxEntries,
    transactionCacheMaxEntriesDefault,
    1,
    8192,
    "TRANSACTION_CACHE_MAX_ENTRIES"
  );
  const resolvedNotificationDispatchLimit = parseOptionalPositiveInteger(
    notificationDispatchLimit,
    notificationDispatchDefaultLimit,
    1,
    notificationDispatchHardLimit,
    "NOTIFICATION_DISPATCH_DEFAULT_LIMIT"
  );
  const resolvedNotificationDispatchMaxProcessingMs = parseOptionalPositiveInteger(
    notificationDispatchMaxProcessingMs,
    notificationDispatchDefaultMaxProcessingMs,
    1,
    60000,
    "NOTIFICATION_DISPATCH_DEFAULT_MAX_PROCESSING_MS"
  );
  const resolvedPaymentReconciliationLimit = parseOptionalPositiveInteger(
    paymentReconciliationLimit,
    paymentReconciliationDefaultLimit,
    1,
    paymentReconciliationHardLimit,
    "PAYMENT_RECONCILIATION_DEFAULT_LIMIT"
  );
  const rateLimitState = new Map();
  const resolvedStripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  const resolvedStripeWebhookToleranceSeconds = Number(
    process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS ?? 300
  );
  const startedAt = new Date().toISOString();
  const counterMetrics = new Map();
  const flowLatencySamples = new Map();
  const listingsCache = new Map();
  const transactionCache = new Map();
  const launchControlDefaults = buildLaunchControlDefaults();

  const getLaunchControlConfig = (key) => {
    const normalizedKey = normalizeLaunchControlKey(key);
    const defaults = launchControlDefaults[normalizedKey];
    const persisted = store.getLaunchControlFlag(normalizedKey);
    if (!persisted) {
      return defaults;
    }
    if (persisted.environment && persisted.environment !== launchControlEnvironment) {
      return defaults;
    }
    return {
      ...defaults,
      enabled: persisted.enabled,
      rolloutPercentage: Number(persisted.rolloutPercentage ?? 100),
      allowlistUserIds: normalizeLaunchControlAllowlist(persisted.allowlistUserIds),
      regionAllowlist: normalizeLaunchControlAllowlist(persisted.regionAllowlist),
      reason: persisted.reason ?? null,
      updatedAt: persisted.updatedAt,
      updatedBy: persisted.updatedBy,
      deploymentRunId: persisted.deploymentRunId ?? null,
      metadata: persisted.metadata ?? {}
    };
  };

  const buildLaunchControlSnapshot = () =>
    Array.from(launchControlFlagKeys.values())
      .sort((left, right) => left.localeCompare(right))
      .map((key) => getLaunchControlConfig(key));

  const evaluateLaunchControl = ({ key, userId = null, region = null }) => {
    const config = getLaunchControlConfig(key);
    if (!config.enabled) {
      return { allowed: false, reason: "flag_disabled", config };
    }
    const normalizedUserId = typeof userId === "string" && userId.trim() ? userId.trim() : null;
    const normalizedRegion = typeof region === "string" && region.trim() ? region.trim() : null;
    const allowlist = normalizeLaunchControlAllowlist(config.allowlistUserIds);
    if (normalizedUserId && allowlist.includes(normalizedUserId)) {
      return { allowed: true, reason: "allowlisted_user", config };
    }
    const regionAllowlist = normalizeLaunchControlAllowlist(config.regionAllowlist);
    if (regionAllowlist.length > 0 && (!normalizedRegion || !regionAllowlist.includes(normalizedRegion))) {
      return { allowed: false, reason: "region_not_allowlisted", config };
    }
    const rolloutPercentage = Math.max(0, Math.min(100, Number(config.rolloutPercentage ?? 100)));
    if (rolloutPercentage >= 100) {
      return { allowed: true, reason: "rollout_full", config };
    }
    if (!normalizedUserId) {
      return { allowed: false, reason: "no_user_context", config };
    }
    const bucket = hashRolloutPercent(`${launchControlRolloutSalt}:${config.key}:${normalizedUserId}`);
    return {
      allowed: bucket < rolloutPercentage,
      reason: bucket < rolloutPercentage ? "rollout_bucket_enabled" : "rollout_bucket_disabled",
      config
    };
  };

  const getFromCache = (cache, key, ttlMs) => {
    if (ttlMs <= 0) {
      return null;
    }
    const record = cache.get(key);
    if (!record) {
      return null;
    }
    if (Date.now() - record.cachedAtMs > ttlMs) {
      cache.delete(key);
      return null;
    }
    return record.value;
  };

  const setInCache = (cache, key, value, maxEntries) => {
    if (maxEntries <= 0) {
      return;
    }
    if (cache.size >= maxEntries) {
      const firstKey = cache.keys().next().value;
      if (firstKey !== undefined) {
        cache.delete(firstKey);
      }
    }
    cache.set(key, { value, cachedAtMs: Date.now() });
  };

  const invalidateListingsCache = () => {
    listingsCache.clear();
  };

  const getCachedTransaction = (transactionId) =>
    getFromCache(transactionCache, transactionId, resolvedTransactionCacheTtlMs);

  const cacheTransaction = (transaction) => {
    if (!transaction?.id) {
      return;
    }
    setInCache(transactionCache, transaction.id, transaction, resolvedTransactionCacheMaxEntries);
  };

  const invalidateTransactionCache = (transactionId) => {
    if (!transactionId) {
      return;
    }
    transactionCache.delete(transactionId);
  };

  const incrementMetric = (name, labels = {}, delta = 1) => {
    const labelEntries = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right));
    const labelKey = labelEntries.map(([key, value]) => `${key}=${value}`).join(",");
    const key = `${name}|${labelKey}`;
    counterMetrics.set(key, {
      name,
      labels,
      value: (counterMetrics.get(key)?.value ?? 0) + delta
    });
  };

  const recordLatency = (flow, durationMs) => {
    const samples = flowLatencySamples.get(flow) ?? [];
    samples.push(durationMs);
    if (samples.length > 500) {
      samples.shift();
    }
    flowLatencySamples.set(flow, samples);
  };

  const metricsSnapshot = () => {
    const counters = Array.from(counterMetrics.values())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((item) => ({
        name: item.name,
        labels: item.labels,
        value: item.value
      }));

    const flowLatency = {};
    for (const [flow, samples] of flowLatencySamples.entries()) {
      const count = samples.length;
      const sumMs = samples.reduce((sum, value) => sum + value, 0);
      flowLatency[flow] = {
        count,
        avgMs: count === 0 ? 0 : Number((sumMs / count).toFixed(2)),
        p95Ms: Number(percentile(samples, 0.95).toFixed(2)),
        maxMs: Number(Math.max(...samples, 0).toFixed(2))
      };
    }

    const coreRequestCounters = counters.filter(
      (item) => item.name === "api.requests.total" && item.labels.scope === "core"
    );
    const coreTotal = coreRequestCounters.reduce((sum, item) => sum + Number(item.value ?? 0), 0);
    const coreErrors = coreRequestCounters
      .filter((item) => item.labels.outcome === "error")
      .reduce((sum, item) => sum + Number(item.value ?? 0), 0);
    const coreAvailability = coreTotal === 0 ? 1 : 1 - coreErrors / coreTotal;
    const coreErrorRate = coreTotal === 0 ? 0 : coreErrors / coreTotal;
    const errorBudget = Math.max(1e-9, 1 - coreFlowAvailabilityTarget);
    const burnRate = coreErrorRate / errorBudget;
    const coreP95Samples = Array.from(flowLatencySamples.entries())
      .filter(([flow]) => {
        const coreCounter = coreRequestCounters.find(
          (item) =>
            item.labels.flow === flow &&
            Number(item.value ?? 0) > 0
        );
        return Boolean(coreCounter);
      })
      .flatMap((entry) => entry[1]);
    const coreP95 = percentile(coreP95Samples, 0.95);
    const outboxStats = store.getNotificationOutboxStats();
    const trustOpsStats = store.getTrustOperationsStats({ lookbackHours: 24 });

    return {
      service: "grejiji-api",
      startedAt,
      generatedAt: new Date().toISOString(),
      launchControl: {
        environment: launchControlEnvironment,
        autoRollbackThresholds: {
          burnRate: launchControlAutoRollbackBurnRateThreshold,
          errorRate: launchControlAutoRollbackErrorRateThreshold,
          webhookFailureCount: launchControlAutoRollbackWebhookFailureThreshold
        },
        flags: buildLaunchControlSnapshot()
      },
      counters,
      flowLatency,
      queue: {
        notificationOutbox: outboxStats,
        trustOperations: trustOpsStats.queue
      },
      trustOperations: trustOpsStats,
      slo: {
        coreFlow: {
          totalRequests: coreTotal,
          errorRequests: coreErrors,
          availability: Number(coreAvailability.toFixed(6)),
          availabilityTarget: coreFlowAvailabilityTarget,
          p95LatencyMs: Number(coreP95.toFixed(2)),
          p95LatencyTargetMs: coreFlowP95LatencyMsTarget,
          errorBudgetBurnRate: Number(burnRate.toFixed(3)),
          burnRateAlertThreshold: coreFlowBurnRateAlertThreshold,
          alerting: {
            availabilityBurn: burnRate >= coreFlowBurnRateAlertThreshold,
            latencyBreach: coreP95 > coreFlowP95LatencyMsTarget
          }
        }
      }
    };
  };

  const requestHandler = async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const incomingRequestId =
      typeof req.headers["x-request-id"] === "string" && req.headers["x-request-id"].trim()
        ? req.headers["x-request-id"].trim()
        : null;
    const incomingCorrelationId =
      typeof req.headers["x-correlation-id"] === "string" && req.headers["x-correlation-id"].trim()
        ? req.headers["x-correlation-id"].trim()
        : null;
    const correlationId = incomingCorrelationId ?? incomingRequestId ?? crypto.randomUUID();
    const requestId = incomingRequestId ?? correlationId;
    const startedAtMs = Date.now();
    const method = String(req.method ?? "GET").toUpperCase();
    const metricLabels = getRouteMetricLabels(method, url.pathname);
    const clientIp = getClientIp(req);
    req.requestContext = {
      requestId,
      correlationId,
      clientIp,
      authenticatedUserId: null
    };
    const recordRiskSignal = ({
      transactionId,
      userId,
      signalType,
      severity,
      details,
      createdBy = "system:risk"
    }) => {
      if (!transactionId && !userId) {
        return null;
      }
      try {
        return store.recordRiskSignal({
          transactionId,
          userId,
          signalType,
          severity,
          details,
          createdBy,
          requestId,
          correlationId
        });
      } catch {
        return null;
      }
    };
    const requestRegion =
      typeof req.headers["x-region"] === "string" && req.headers["x-region"].trim()
        ? req.headers["x-region"].trim()
        : typeof req.headers["x-user-region"] === "string" && req.headers["x-user-region"].trim()
          ? req.headers["x-user-region"].trim()
          : null;
    const enforceLaunchControlGate = ({ key, userId = null, contextMessage = "operation is gated" }) => {
      const evaluation = evaluateLaunchControl({
        key,
        userId,
        region: requestRegion
      });
      if (!evaluation.allowed) {
        incrementMetric("launch_control.blocked_total", { key: normalizeLaunchControlKey(key) }, 1);
        throw new StoreError("forbidden", `${contextMessage} (launch control: ${evaluation.reason})`);
      }
      return evaluation;
    };

    res.setHeader("x-request-id", requestId);
    res.setHeader("x-correlation-id", correlationId);

    res.on("finish", () => {
      const durationMs = Date.now() - startedAtMs;
      const outcome = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "rejected" : "success";
      const scope = metricLabels.coreFlow ? "core" : "supporting";
      incrementMetric("api.requests.total", {
        flow: metricLabels.flow,
        scope,
        outcome
      });
      recordLatency(metricLabels.flow, durationMs);

      if (requestLogEnabled) {
        logLine("info", {
          event: "request.complete",
          requestId,
          correlationId,
          method,
          path: metricLabels.pathTemplate,
          pathActual: url.pathname,
          flow: metricLabels.flow,
          statusCode: res.statusCode,
          durationMs,
          clientIp,
          authenticatedUserId: req.requestContext?.authenticatedUserId ?? null
        });
      }
    });

    try {
      if (rateLimitEnabled) {
        const policy = getRateLimitPolicy(method, url.pathname);
        if (policy) {
          const nowMs = Date.now();
          const bucketKey = `${policy.key}:${clientIp}`;
          const bucket = rateLimitState.get(bucketKey);
          if (!bucket || nowMs - bucket.startedAtMs >= rateLimitWindowMs) {
            rateLimitState.set(bucketKey, { startedAtMs: nowMs, count: 1 });
          } else {
            bucket.count += 1;
            if (bucket.count > policy.max) {
              const retryAfterSeconds = Math.max(
                1,
                Math.ceil((rateLimitWindowMs - (nowMs - bucket.startedAtMs)) / 1000)
              );
              res.setHeader("Retry-After", String(retryAfterSeconds));
              sendJson(res, 429, {
                error: "rate limit exceeded",
                routeKey: policy.key,
                retryAfterSeconds
              });
              return;
            }
          }
        }
      }

      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { status: "ok", service: "grejiji-api", env: nodeEnv });
        return;
      }

      if (req.method === "GET" && url.pathname === "/ready") {
        sendJson(res, 200, {
          status: "ready",
          service: "grejiji-api",
          db: store.checkReadiness() ? "ok" : "not_ready"
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/metrics") {
        sendJson(res, 200, metricsSnapshot());
        return;
      }

      if (req.method === "GET" && url.pathname === "/docs") {
        sendHtml(res, 200, renderDocsPage());
        return;
      }

      if (req.method === "GET" && url.pathname === "/app") {
        sendHtml(res, 200, renderWebAppPage());
        return;
      }

      if (req.method === "GET" && url.pathname === "/app/client.js") {
        const script = await fs.readFile(webClientFilePath, "utf8");
        res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
        res.end(script);
        return;
      }

      if (req.method === "GET" && url.pathname === "/app/styles.css") {
        const styles = await fs.readFile(webStylesFilePath, "utf8");
        res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
        res.end(styles);
        return;
      }

      if (req.method === "POST" && url.pathname === "/webhooks/stripe") {
        const rawBody = await readRawRequestBody(req, { maxBytes: defaultBodyMaxBytes * 2 });
        let event;
        try {
          event = JSON.parse(rawBody.toString("utf8") || "{}");
        } catch {
          throw new StoreError("validation", "request body must be valid JSON");
        }

        if (!event?.id || !event?.type) {
          throw new StoreError("validation", "stripe webhook event must include id and type");
        }

        const signatureHeader = req.headers["stripe-signature"];
        const signatureValid = verifyStripeWebhookSignature({
          rawBody,
          signatureHeader: typeof signatureHeader === "string" ? signatureHeader : "",
          secret: resolvedStripeWebhookSecret,
          toleranceSeconds: resolvedStripeWebhookToleranceSeconds
        });
        const occurredAt =
          Number.isInteger(event?.created) && event.created > 0
            ? new Date(event.created * 1000).toISOString()
            : new Date().toISOString();
        const transactionId =
          event?.data?.object?.metadata?.transaction_id && typeof event.data.object.metadata.transaction_id === "string"
            ? event.data.object.metadata.transaction_id
            : null;

        const ingested = store.ingestProviderWebhookEvent({
          provider: "stripe",
          eventId: event.id,
          eventType: event.type,
          transactionId,
          occurredAt,
          payload: event,
          signatureValid,
          initialStatus: signatureValid ? "received" : "failed",
          processingError: signatureValid ? null : "invalid webhook signature"
        });

        if (!signatureValid) {
          if (transactionId) {
            recordRiskSignal({
              transactionId,
              signalType: "webhook_abuse",
              severity: 35,
              details: {
                provider: "stripe",
                eventType: event.type,
                eventId: event.id,
                reason: "invalid_signature"
              },
              createdBy: "system:webhook"
            });
          }
          incrementMetric("webhook.stripe.received_total", { signature: "invalid" }, 1);
          sendJson(res, 400, {
            error: "invalid webhook signature",
            event: {
              id: ingested.id,
              provider: ingested.provider,
              eventId: ingested.eventId,
              status: ingested.status
            }
          });
          return;
        }

        const processed = store.processProviderWebhookEvent({
          provider: ingested.provider,
          eventId: ingested.eventId
        });
        if (
          processed.transaction?.id &&
          (processed.reason === "out_of_order_ignored" ||
            processed.reason === "transaction_not_found" ||
            processed.reason === "unsupported_event")
        ) {
          recordRiskSignal({
            transactionId: processed.transaction.id,
            signalType: "payment_mismatch",
            severity: processed.reason === "out_of_order_ignored" ? 20 : 30,
            details: {
              provider: ingested.provider,
              eventType: ingested.eventType,
              eventId: ingested.eventId,
              reason: processed.reason
            },
            createdBy: "system:webhook"
          });
        } else if (processed.transaction?.id) {
          store.refreshTransactionRiskProfile({ transactionId: processed.transaction.id });
        }
        if (processed.transaction?.id) {
          invalidateTransactionCache(processed.transaction.id);
          const refreshedTransaction = store.getTransactionById(processed.transaction.id);
          if (refreshedTransaction) {
            cacheTransaction(refreshedTransaction);
          }
        }
        const webhookLagMs = Math.max(0, Date.now() - new Date(occurredAt).valueOf());
        incrementMetric("webhook.stripe.received_total", { signature: "valid" }, 1);
        incrementMetric("webhook.stripe.lag_ms_total", {}, webhookLagMs);
        incrementMetric(
          "webhook.stripe.processed_total",
          { applied: processed.applied ? "true" : "false", reason: processed.reason },
          1
        );
        sendJson(res, 200, {
          ok: true,
          event: {
            id: processed.event.id,
            provider: processed.event.provider,
            eventId: processed.event.eventId,
            status: processed.event.status
          },
          result: {
            applied: processed.applied,
            reason: processed.reason,
            transactionId: processed.transaction?.id ?? null,
            paymentStatus: processed.transaction?.paymentStatus ?? null
          }
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/auth/register") {
        const body = await readJsonBody(req);
        if (!body.email || !body.password || !body.role) {
          throw new StoreError("validation", "email, password, and role are required");
        }
        assertSafeId(body.userId, "userId");
        const normalizedEmail = normalizeEmail(body.email);

        if (typeof body.password !== "string" || body.password.length < 8) {
          throw new StoreError("validation", "password must be at least 8 characters");
        }

        const salt = crypto.randomBytes(16).toString("hex");
        const user = store.createUser({
          id: body.userId ?? crypto.randomUUID(),
          email: normalizedEmail,
          role: body.role,
          passwordHash: hashPassword(body.password, salt),
          passwordSalt: salt
        });

        const auth = buildAuthResponse(user);
        incrementMetric("auth.register.success_total", {}, 1);
        sendJson(res, 201, { user, ...auth });
        return;
      }

      if (req.method === "POST" && url.pathname === "/auth/login") {
        const body = await readJsonBody(req);
        if (!body.email || !body.password) {
          throw new StoreError("validation", "email and password are required");
        }
        const normalizedEmail = normalizeEmail(body.email);

        const authRecord = store.getUserAuthByEmail(normalizedEmail);
        if (!authRecord) {
          throw new StoreError("forbidden", "invalid email or password");
        }

        const candidateHash = hashPassword(body.password, authRecord.passwordSalt);
        if (!timingSafeEqualHex(candidateHash, authRecord.passwordHash)) {
          recordRiskSignal({
            userId: authRecord.user.id,
            signalType: "auth_failures",
            severity: 20,
            details: {
              reason: "password_mismatch",
              email: normalizedEmail,
              clientIp
            },
            createdBy: "system:auth"
          });
          throw new StoreError("forbidden", "invalid email or password");
        }

        const user = store.recordUserLogin(authRecord.user.id);
        const auth = buildAuthResponse(user);
        incrementMetric("auth.login.success_total", {}, 1);
        sendJson(res, 200, { user, ...auth });
        return;
      }

      if (req.method === "GET" && url.pathname === "/listings") {
        const limitRaw = url.searchParams.get("limit");
        const limit = limitRaw === null ? 100 : Number(limitRaw);
        const sellerId = url.searchParams.get("sellerId") ?? undefined;
        const localArea = url.searchParams.get("localArea") ?? undefined;
        const cursorCreatedAt = url.searchParams.get("cursorCreatedAt") ?? undefined;
        const cursorId = url.searchParams.get("cursorId") ?? undefined;
        const moderationStatus = sellerId ? undefined : "approved";
        const cacheKey = JSON.stringify({
          limit,
          sellerId: sellerId ?? null,
          localArea: localArea ?? null,
          moderationStatus: moderationStatus ?? null,
          cursorCreatedAt: cursorCreatedAt ?? null,
          cursorId: cursorId ?? null
        });
        const cachedListings = getFromCache(
          listingsCache,
          cacheKey,
          resolvedListingsCacheTtlMs
        );
        if (cachedListings) {
          incrementMetric("cache.hit_total", { cache: "listings" }, 1);
          sendJson(res, 200, { listings: cachedListings });
          return;
        }

        const listings = store.listListings({
          limit,
          sellerId,
          localArea,
          moderationStatus,
          cursorCreatedAt,
          cursorId
        });
        setInCache(listingsCache, cacheKey, listings, resolvedListingsCacheMaxEntries);
        incrementMetric("cache.miss_total", { cache: "listings" }, 1);
        sendJson(res, 200, { listings });
        return;
      }

      if (req.method === "GET") {
        const listingPhotoDownloadParams = getPathParams(
          url.pathname,
          /^\/listings\/([^/]+)\/photos\/([^/]+)$/
        );
        if (listingPhotoDownloadParams) {
          const [listingId, photoId] = listingPhotoDownloadParams;
          assertSafeId(listingId, "listingId");
          assertSafeId(photoId, "photoId");
          const user = getOptionalAuthUser(req, store);
          const { listing, photo } = store.getListingUploadedPhotoStorage({
            listingId,
            photoId
          });
          const canRead =
            listing.moderationStatus === "approved" ||
            (user && (user.role === "admin" || user.id === listing.sellerId));
          if (!canRead) {
            throw new StoreError("forbidden", "listing photo is not available");
          }
          const filePath = path.join(resolvedListingPhotoStoragePath, photo.storageKey);
          let data;
          try {
            data = await fs.readFile(filePath);
          } catch (error) {
            if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
              throw new StoreError("not_found", "listing photo file not found");
            }
            throw error;
          }
          res.writeHead(200, {
            "Content-Type": photo.mimeType,
            "Content-Length": String(data.length),
            "Cache-Control": "public, max-age=3600",
            "Content-Disposition": `inline; filename=\"${sanitizeFileName(photo.originalFileName)}\"`
          });
          res.end(data);
          return;
        }
      }

      if (req.method === "GET" && url.pathname === "/notifications") {
        const currentUser = requireAuth(req, store);
        const limitRaw = url.searchParams.get("limit");
        const limit = limitRaw === null ? 100 : Number(limitRaw);
        const notifications = store.listUserNotifications({
          recipientUserId: currentUser.id,
          limit
        });
        sendJson(res, 200, { notifications });
        return;
      }

      if (req.method === "POST" && url.pathname === "/listings") {
        const currentUser = requireAuth(req, store);
        ensureAccountRiskAllowsWrite(currentUser);
        requireRole(currentUser, "seller");

        const body = await readJsonBody(req);
        assertSafeId(body.listingId, "listingId");
        const photoUrls = normalizeListingPhotoUrls(body.photoUrls);
        const moderationAutomation = evaluateLaunchControl({
          key: "moderation_auto_actions",
          userId: currentUser.id,
          region: requestRegion
        });
        const priceBaseline = store.evaluateListingPriceBaseline({
          sellerId: currentUser.id
        });
        const computedPolicy = evaluateListingPolicy({
          title: body.title,
          description: body.description,
          category: body.category,
          itemCondition: body.itemCondition,
          priceCents: body.priceCents,
          baselineAveragePriceCents: priceBaseline.averagePriceCents,
          baselineSampleSize: priceBaseline.sampleSize
        });
        const policy = moderationAutomation.allowed
          ? computedPolicy
          : {
              moderationStatus: "pending_review",
              reasonCode: "launch_control_manual_review",
              publicReason: "Listing was queued for manual moderation review.",
              internalNotes: `launch_control:${moderationAutomation.reason}`
            };
        const listing = store.createListing({
          id: body.listingId ?? crypto.randomUUID(),
          sellerId: currentUser.id,
          title: body.title,
          description: body.description,
          priceCents: body.priceCents,
          category: body.category,
          itemCondition: body.itemCondition,
          localArea: body.localArea,
          photoUrls,
          moderationStatus: policy.moderationStatus,
          moderationReasonCode: policy.reasonCode,
          moderationPublicReason: policy.publicReason,
          moderationInternalNotes: policy.internalNotes,
          moderationUpdatedBy: currentUser.id,
          moderationSource: "policy_create",
          requestId,
          correlationId
        });
        invalidateListingsCache();

        sendJson(res, 201, { listing, policy, launchControl: { moderationAutoActions: moderationAutomation } });
        return;
      }

      if (req.method === "PATCH") {
        const listingParams = getPathParams(url.pathname, /^\/listings\/([^/]+)$/);
        if (listingParams) {
          const currentUser = requireAuth(req, store);
          ensureAccountRiskAllowsWrite(currentUser);
          requireRole(currentUser, "seller");

          const [listingId] = listingParams;
          assertSafeId(listingId, "listingId");
          const body = await readJsonBody(req);
          const photoUrls =
            body.photoUrls === undefined
              ? undefined
              : normalizeListingPhotoUrls(body.photoUrls);
          const moderationAutomation = evaluateLaunchControl({
            key: "moderation_auto_actions",
            userId: currentUser.id,
            region: requestRegion
          });
          const priceBaseline = store.evaluateListingPriceBaseline({
            sellerId: currentUser.id,
            excludeListingId: listingId
          });
          const computedPolicy = evaluateListingPolicy({
            title: body.title,
            description: body.description,
            category: body.category,
            itemCondition: body.itemCondition,
            priceCents: body.priceCents,
            baselineAveragePriceCents: priceBaseline.averagePriceCents,
            baselineSampleSize: priceBaseline.sampleSize
          });
          const policy = moderationAutomation.allowed
            ? computedPolicy
            : {
                moderationStatus: "pending_review",
                reasonCode: "launch_control_manual_review",
                publicReason: "Listing was queued for manual moderation review.",
                internalNotes: `launch_control:${moderationAutomation.reason}`
              };
          const listing = store.updateListing({
            id: listingId,
            sellerId: currentUser.id,
            title: body.title,
            description: body.description,
            priceCents: body.priceCents,
            category: body.category,
            itemCondition: body.itemCondition,
            localArea: body.localArea,
            photoUrls,
            moderationStatus: policy.moderationStatus,
            moderationReasonCode: policy.reasonCode,
            moderationPublicReason: policy.publicReason,
            moderationInternalNotes: policy.internalNotes,
            moderationUpdatedBy: currentUser.id,
            moderationSource: "policy_update",
            requestId,
            correlationId
          });
          invalidateListingsCache();

          sendJson(res, 200, { listing, policy, launchControl: { moderationAutoActions: moderationAutomation } });
          return;
        }
      }

      if (req.method === "POST") {
        const listingPhotoUploadParams = getPathParams(
          url.pathname,
          /^\/listings\/([^/]+)\/photos$/
        );
        if (listingPhotoUploadParams) {
          const currentUser = requireAuth(req, store);
          ensureAccountRiskAllowsWrite(currentUser);
          requireRole(currentUser, "seller");
          const [listingId] = listingPhotoUploadParams;
          assertSafeId(listingId, "listingId");
          const body = await readJsonBody(req);
          if (!body.fileName || typeof body.fileName !== "string" || !body.fileName.trim()) {
            throw new StoreError("validation", "fileName is required");
          }
          if (body.fileName.length > 255) {
            throw new StoreError("validation", "fileName must be 255 characters or fewer");
          }
          if (!body.mimeType || typeof body.mimeType !== "string" || !body.mimeType.trim()) {
            throw new StoreError("validation", "mimeType is required");
          }
          const normalizedMimeType = body.mimeType.trim().toLowerCase();
          if (!allowedListingPhotoMimeTypes.has(normalizedMimeType)) {
            throw new StoreError("validation", "unsupported listing photo mimeType");
          }
          const content = parseBase64Content(body.contentBase64);
          if (content.length > resolvedListingPhotoMaxBytes) {
            throw new StoreError(
              "validation",
              `listing photo exceeds LISTING_PHOTO_MAX_BYTES (${resolvedListingPhotoMaxBytes})`
            );
          }

          const checksumSha256 = crypto.createHash("sha256").update(content).digest("hex");
          if (body.checksumSha256 && body.checksumSha256 !== checksumSha256) {
            throw new StoreError("validation", "checksumSha256 does not match content");
          }

          const photoId = body.photoId ?? crypto.randomUUID();
          assertSafeId(photoId, "photoId");
          const safeName = sanitizeFileName(body.fileName.trim());
          const storageKey = path.join(listingId, `${photoId}-${safeName}`);
          const filePath = path.join(resolvedListingPhotoStoragePath, storageKey);
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, content, { flag: "wx" });
          const createdAt = new Date().toISOString();
          let listing;
          try {
            listing = store.appendListingUploadedPhoto({
              listingId,
              sellerId: currentUser.id,
              photo: {
                id: photoId,
                originalFileName: body.fileName.trim(),
                mimeType: normalizedMimeType,
                sizeBytes: content.length,
                checksumSha256,
                storageKey,
                downloadUrl: `/listings/${encodeURIComponent(listingId)}/photos/${encodeURIComponent(photoId)}`,
                createdAt
              }
            });
          } catch (error) {
            await fs.rm(filePath, { force: true });
            throw error;
          }
          invalidateListingsCache();
          const uploadedPhoto =
            listing.uploadedPhotos.find((item) => item.id === photoId) ?? null;
          sendJson(res, 201, { listing, photo: uploadedPhoto });
          return;
        }

        const listingAbuseReportParams = getPathParams(
          url.pathname,
          /^\/listings\/([^/]+)\/abuse-reports$/
        );
        if (listingAbuseReportParams) {
          const currentUser = requireAuth(req, store);
          const [listingId] = listingAbuseReportParams;
          assertSafeId(listingId, "listingId");
          const body = await readJsonBody(req);
          const report = store.createListingAbuseReport({
            listingId,
            reporterUserId: currentUser.id,
            reasonCode: body.reasonCode,
            details: body.details,
            priorityScore: Number.isInteger(body.priorityScore) ? body.priorityScore : 1
          });

          const openReportsCount = store.countListingOpenAbuseReports(listingId);
          let listing = store.getListingById(listingId);
          if (
            listing &&
            listing.moderationStatus === "approved" &&
            openReportsCount >= listingAbuseAutoHideThreshold
          ) {
            const moderationAutomation = evaluateLaunchControl({
              key: "moderation_auto_actions",
              userId: currentUser.id,
              region: requestRegion
            });
            if (moderationAutomation.allowed) {
              listing = store.setListingModerationStatus({
                listingId,
                status: "temporarily_hidden",
                reasonCode: "abuse_reports_threshold",
                publicReason: normalizeModerationReasonMessage("abuse_reports_threshold"),
                internalNotes: `open_reports:${openReportsCount}`,
                actorId: "system:abuse",
                source: "abuse_threshold",
                requestId,
                correlationId
              });
              invalidateListingsCache();
            }
          }

          sendJson(res, 201, { report, openReportsCount, listing });
          return;
        }
      }

      if (req.method === "POST") {
        const markReadParams = getPathParams(url.pathname, /^\/notifications\/(\d+)\/read$/);
        if (markReadParams) {
          const currentUser = requireAuth(req, store);
          const [notificationId] = markReadParams;
          const notification = store.markNotificationAsRead({
            id: Number(notificationId),
            recipientUserId: currentUser.id
          });
          sendJson(res, 200, { notification });
          return;
        }

        const acknowledgeParams = getPathParams(
          url.pathname,
          /^\/notifications\/(\d+)\/acknowledge$/
        );
        if (acknowledgeParams) {
          const currentUser = requireAuth(req, store);
          const [notificationId] = acknowledgeParams;
          const notification = store.markNotificationAsAcknowledged({
            id: Number(notificationId),
            recipientUserId: currentUser.id
          });
          sendJson(res, 200, { notification });
          return;
        }
      }

      if (req.method === "POST" && url.pathname === "/transactions") {
        const currentUser = requireAuth(req, store);
        ensureAccountRiskAllowsWrite(currentUser);
        enforceLaunchControlGate({
          key: "transaction_initiation",
          userId: currentUser.id,
          contextMessage: "transaction initiation is currently disabled"
        });
        const body = await readJsonBody(req);
        assertSafeId(body.transactionId, "transactionId");
        assertSafeId(body.buyerId, "buyerId");
        assertSafeId(body.sellerId, "sellerId");

        if (currentUser.role === "buyer") {
          body.buyerId = currentUser.id;
        }

        if (currentUser.role === "seller") {
          body.sellerId = currentUser.id;
        }

        const transactionId = body.transactionId ?? crypto.randomUUID();
        const existing = store.getTransactionById(transactionId);
        if (existing) {
          throw new StoreError("conflict", "transaction id already exists");
        }
        evaluateAndEnforceRiskLimits({
          store,
          incrementMetricFn: incrementMetric,
          checkpoint: "transaction_initiation",
          transactionId,
          amountCents: body.amountCents,
          participants: [
            { userId: body.buyerId, role: "buyer" },
            { userId: body.sellerId, role: "seller" }
          ],
          requestId,
          correlationId
        });

        const quote = store.quoteTransaction({ amountCents: body.amountCents });
        const authorizeCaptureIdempotencyKey = `txn:${transactionId}:authorize_capture:v1`;
        const paymentResult = await paymentProvider.authorizeAndCapture({
          transactionId,
          amountCents: quote.totalBuyerChargeCents,
          currency: quote.currency,
          idempotencyKey: authorizeCaptureIdempotencyKey,
          requestId,
          correlationId,
          metadata: {
            buyer_id: body.buyerId,
            seller_id: body.sellerId,
            request_id: requestId,
            correlation_id: correlationId
          }
        });

        let transaction = store.createAcceptedTransactionWithPayment({
          id: transactionId,
          buyerId: body.buyerId,
          sellerId: body.sellerId,
          amountCents: body.amountCents,
          acceptedAt: body.acceptedAt,
          actorId: currentUser.id,
          paymentResult,
          paymentIdempotencyKey: authorizeCaptureIdempotencyKey
        });
        const velocityWindowSince = new Date(Date.now() - riskVelocityWindowMinutes * 60 * 1000).toISOString();
        const buyerVelocity = store.countRecentAcceptedTransactionsByUser({
          userId: transaction.buyerId,
          role: "buyer",
          sinceAt: velocityWindowSince
        });
        const sellerVelocity = store.countRecentAcceptedTransactionsByUser({
          userId: transaction.sellerId,
          role: "seller",
          sinceAt: velocityWindowSince
        });
        if (buyerVelocity > riskVelocityThreshold || sellerVelocity > riskVelocityThreshold) {
          recordRiskSignal({
            transactionId: transaction.id,
            signalType: "velocity_anomaly",
            severity: 45,
            details: {
              buyerVelocity,
              sellerVelocity,
              threshold: riskVelocityThreshold,
              windowMinutes: riskVelocityWindowMinutes
            },
            createdBy: "system:risk"
          });
        } else {
          store.refreshTransactionRiskProfile({ transactionId: transaction.id });
        }
        transaction = store.getTransactionById(transaction.id);
        cacheTransaction(transaction);
        incrementMetric("transaction.state_transition.total", { to: "accepted" }, 1);
        sendJson(res, 201, { transaction });
        return;
      }

      if (req.method === "GET") {
        const adminLaunchControlFlagsParams = getPathParams(url.pathname, /^\/admin\/launch-control\/flags$/);
        if (adminLaunchControlFlagsParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          sendJson(res, 200, {
            environment: launchControlEnvironment,
            flags: buildLaunchControlSnapshot()
          });
          return;
        }

        const adminLaunchControlAuditParams = getPathParams(url.pathname, /^\/admin\/launch-control\/audit$/);
        if (adminLaunchControlAuditParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const key = url.searchParams.get("key") ?? undefined;
          const limitRaw = url.searchParams.get("limit");
          const limit = limitRaw === null ? 100 : Number(limitRaw);
          const events = store.listLaunchControlAuditEvents({ key, limit });
          sendJson(res, 200, { events });
          return;
        }

        const adminLaunchControlIncidentsParams = getPathParams(
          url.pathname,
          /^\/admin\/launch-control\/incidents$/
        );
        if (adminLaunchControlIncidentsParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const limitRaw = url.searchParams.get("limit");
          const limit = limitRaw === null ? 100 : Number(limitRaw);
          const incidents = store.listLaunchControlIncidents({ limit });
          sendJson(res, 200, { incidents });
          return;
        }

        const adminRiskSignalsParams = getPathParams(url.pathname, /^\/admin\/risk-signals$/);
        if (adminRiskSignalsParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const transactionId = url.searchParams.get("transactionId") ?? undefined;
          const userId = url.searchParams.get("userId") ?? undefined;
          const signalType = url.searchParams.get("signalType") ?? undefined;
          const limitRaw = url.searchParams.get("limit");
          const limit = limitRaw === null ? 100 : Number(limitRaw);
          const signals = store.listRiskSignals({ transactionId, userId, signalType, limit });
          sendJson(res, 200, { signals });
          return;
        }

        const adminModerationQueueParams = getPathParams(
          url.pathname,
          /^\/admin\/listings\/moderation$/
        );
        if (adminModerationQueueParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const status = url.searchParams.get("status") ?? "pending_review";
          const limitRaw = url.searchParams.get("limit");
          const limit = limitRaw === null ? 100 : Number(limitRaw);
          const listings = store.listListings({
            moderationStatus: status,
            limit
          });
          const queue = listings.map((listing) => ({
            ...listing,
            openAbuseReports: store.countListingOpenAbuseReports(listing.id)
          }));
          sendJson(res, 200, { queue });
          return;
        }

        const adminListingModerationDetailParams = getPathParams(
          url.pathname,
          /^\/admin\/listings\/([^/]+)\/moderation$/
        );
        if (adminListingModerationDetailParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [listingId] = adminListingModerationDetailParams;
          assertSafeId(listingId, "listingId");
          const listing = store.getListingById(listingId);
          if (!listing) {
            sendJson(res, 404, { error: "listing not found" });
            return;
          }
          const events = store.listListingModerationEvents({ listingId, limit: 200 });
          const abuseReports = store.listListingAbuseReports({ listingId, limit: 200 });
          sendJson(res, 200, { listing, events, abuseReports });
          return;
        }

        const adminAccountRiskParams = getPathParams(url.pathname, /^\/admin\/accounts\/([^/]+)\/risk$/);
        if (adminAccountRiskParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [userId] = adminAccountRiskParams;
          assertSafeId(userId, "userId");
          const account = store.getUserById(userId);
          if (!account) {
            sendJson(res, 404, { error: "user not found" });
            return;
          }
          const signals = store.listRiskSignals({ userId, limit: 200 });
          const actions = store.listRiskOperatorActions({
            subjectType: "account",
            subjectId: userId,
            limit: 200
          });
          const tierEvents = store.listRiskTierEvents({ userId, limit: 200 });
          sendJson(res, 200, { account, signals, actions, tierEvents });
          return;
        }

        const adminAccountRiskLimitsParams = getPathParams(
          url.pathname,
          /^\/admin\/accounts\/([^/]+)\/risk\/limits$/
        );
        if (adminAccountRiskLimitsParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [userId] = adminAccountRiskLimitsParams;
          assertSafeId(userId, "userId");
          const checkpoint = url.searchParams.get("checkpoint") ?? undefined;
          const limitRaw = url.searchParams.get("limit");
          const limit = limitRaw === null ? 100 : Number(limitRaw);
          const decisions = store.listRiskLimitDecisions({ userId, checkpoint, limit });
          sendJson(res, 200, { decisions });
          return;
        }

        const adminAccountVerificationParams = getPathParams(
          url.pathname,
          /^\/admin\/accounts\/([^/]+)\/verification$/
        );
        if (adminAccountVerificationParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [userId] = adminAccountVerificationParams;
          assertSafeId(userId, "userId");
          const account = store.getUserById(userId);
          if (!account) {
            sendJson(res, 404, { error: "user not found" });
            return;
          }
          const events = store.listIdentityVerificationEvents({ userId, limit: 200 });
          sendJson(res, 200, { account, events });
          return;
        }

        const adminVerificationQueueParams = getPathParams(
          url.pathname,
          /^\/admin\/verification-submissions$/
        );
        if (adminVerificationQueueParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const status = url.searchParams.get("status") ?? "pending";
          const limitRaw = url.searchParams.get("limit");
          const limit = limitRaw === null ? 100 : Number(limitRaw);
          const accounts = store.listAccountsByVerificationStatus({ status, limit });
          sendJson(res, 200, { accounts });
          return;
        }

        const adminTransactionRiskParams = getPathParams(
          url.pathname,
          /^\/admin\/transactions\/([^/]+)\/risk$/
        );
        if (adminTransactionRiskParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [transactionId] = adminTransactionRiskParams;
          assertSafeId(transactionId, "transactionId");
          const transaction = store.getTransactionById(transactionId);
          if (!transaction) {
            sendJson(res, 404, { error: "transaction not found" });
            return;
          }
          const signals = store.listRiskSignals({ transactionId, limit: 200 });
          const actions = store.listRiskOperatorActions({
            subjectType: "transaction",
            subjectId: transactionId,
            limit: 200
          });
          sendJson(res, 200, { transaction, signals, actions });
          return;
        }

        const adminAccountIntegrityParams = getPathParams(
          url.pathname,
          /^\/admin\/accounts\/([^/]+)\/integrity$/
        );
        if (adminAccountIntegrityParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [userId] = adminAccountIntegrityParams;
          assertSafeId(userId, "userId");
          const lookbackRaw = url.searchParams.get("lookbackDays");
          const lookbackDays = lookbackRaw === null ? 30 : Number(lookbackRaw);
          const recompute = url.searchParams.get("recompute") !== "false";
          const integrity = store.getSellerIntegrityProfile({
            userId,
            lookbackDays,
            recompute
          });
          sendJson(res, 200, { integrity });
          return;
        }

        const adminAccountIdentityAssuranceParams = getPathParams(
          url.pathname,
          /^\/admin\/accounts\/([^/]+)\/identity-assurance$/
        );
        if (adminAccountIdentityAssuranceParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [userId] = adminAccountIdentityAssuranceParams;
          assertSafeId(userId, "userId");
          const lookbackRaw = url.searchParams.get("lookbackDays");
          const lookbackDays = lookbackRaw === null ? 90 : Number(lookbackRaw);
          const identityAssurance = store.getIdentityAssuranceProfile({
            userId,
            lookbackDays
          });
          sendJson(res, 200, { identityAssurance });
          return;
        }

        const adminAccountRecoveryStateParams = getPathParams(
          url.pathname,
          /^\/admin\/accounts\/([^/]+)\/recovery$/
        );
        if (adminAccountRecoveryStateParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [userId] = adminAccountRecoveryStateParams;
          assertSafeId(userId, "userId");
          const limitRaw = url.searchParams.get("limit");
          const limit = limitRaw === null ? 20 : Number(limitRaw);
          const recovery = store.getAccountRecoveryState({ userId, limit });
          sendJson(res, 200, recovery);
          return;
        }

        const adminTrustOperationsCasesParams = getPathParams(
          url.pathname,
          /^\/admin\/trust-operations\/cases$/
        );
        if (adminTrustOperationsCasesParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const status = url.searchParams.get("status") ?? undefined;
          const transactionId = url.searchParams.get("transactionId") ?? undefined;
          const limitRaw = url.searchParams.get("limit");
          const limit = limitRaw === null ? 100 : Number(limitRaw);
          const cases = store.listTrustOperationsCases({ status, transactionId, limit });
          sendJson(res, 200, { cases });
          return;
        }

        const adminTrustOperationsCaseDetailParams = getPathParams(
          url.pathname,
          /^\/admin\/trust-operations\/cases\/(\d+)$/
        );
        if (adminTrustOperationsCaseDetailParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [caseId] = adminTrustOperationsCaseDetailParams;
          const details = store.getTrustOperationsCase({
            caseId: Number(caseId),
            includeEvents: true,
            eventLimit: 200
          });
          sendJson(res, 200, details);
          return;
        }

        const adminTrustOperationsInterventionPreviewParams = getPathParams(
          url.pathname,
          /^\/admin\/trust-operations\/cases\/(\d+)\/intervention-preview$/
        );
        if (adminTrustOperationsInterventionPreviewParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [caseId] = adminTrustOperationsInterventionPreviewParams;
          const preview = store.previewTrustOpsIntervention({ caseId: Number(caseId) });
          sendJson(res, 200, preview);
          return;
        }

        const adminTrustOperationsCaseChallengesParams = getPathParams(
          url.pathname,
          /^\/admin\/trust-operations\/cases\/(\d+)\/challenges$/
        );
        if (adminTrustOperationsCaseChallengesParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [caseId] = adminTrustOperationsCaseChallengesParams;
          const status = url.searchParams.get("status") ?? null;
          const limitRaw = url.searchParams.get("limit");
          const limit = limitRaw === null ? 100 : Number(limitRaw);
          const challenges = store.listTrustStepUpChallenges({ caseId: Number(caseId), status, limit });
          sendJson(res, 200, { challenges });
          return;
        }

        const adminTrustOperationsNetworkInvestigationParams = getPathParams(
          url.pathname,
          /^\/admin\/trust-operations\/network\/investigation$/
        );
        if (adminTrustOperationsNetworkInvestigationParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const transactionId = url.searchParams.get("transactionId") ?? null;
          const userId = url.searchParams.get("userId") ?? null;
          const clusterId = url.searchParams.get("clusterId") ?? null;
          const limitRaw = url.searchParams.get("limit");
          const limit = limitRaw === null ? 200 : Number(limitRaw);
          const investigation = store.getTrustNetworkInvestigation({
            transactionId,
            userId,
            clusterId,
            limit
          });
          sendJson(res, 200, investigation);
          return;
        }

        const adminTrustOperationsPoliciesParams = getPathParams(
          url.pathname,
          /^\/admin\/trust-operations\/policies$/
        );
        if (adminTrustOperationsPoliciesParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const status = url.searchParams.get("status") ?? undefined;
          const limitRaw = url.searchParams.get("limit");
          const limit = limitRaw === null ? 100 : Number(limitRaw);
          const policies = store.listTrustOpsPolicyVersions({ status, limit });
          sendJson(res, 200, { policies });
          return;
        }

        const adminTrustOperationsPolicyRecommendationsParams = getPathParams(
          url.pathname,
          /^\/admin\/trust-operations\/policy-recommendations$/
        );
        if (adminTrustOperationsPolicyRecommendationsParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const lookbackRaw = url.searchParams.get("lookbackHours");
          const lookbackHours = lookbackRaw === null ? 168 : Number(lookbackRaw);
          const recommendations = store.generateTrustOpsPolicyRecommendations({ lookbackHours });
          sendJson(res, 200, { recommendations });
          return;
        }

        const adminTrustOperationsDashboardParams = getPathParams(
          url.pathname,
          /^\/admin\/trust-operations\/dashboard$/
        );
        if (adminTrustOperationsDashboardParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const lookbackRaw = url.searchParams.get("lookbackHours");
          const lookbackHours = lookbackRaw === null ? 24 : Number(lookbackRaw);
          const metrics = store.getTrustOperationsStats({ lookbackHours });
          const recommendations = store.generateTrustOpsPolicyRecommendations({ lookbackHours: 168 });
          sendJson(res, 200, { metrics, recommendations });
          return;
        }

        const adminTrustOperationsPayoutRiskMetricsParams = getPathParams(
          url.pathname,
          /^\/admin\/trust-operations\/payout-risk\/metrics$/
        );
        if (adminTrustOperationsPayoutRiskMetricsParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const lookbackRaw = url.searchParams.get("lookbackHours");
          const lookbackHours = lookbackRaw === null ? 24 : Number(lookbackRaw);
          const metrics = store.getTrustOperationsStats({ lookbackHours });
          sendJson(res, 200, {
            lookbackHours,
            payoutRiskQuality: metrics.payoutRiskQuality,
            queue: metrics.queue
          });
          return;
        }

        const adminTrustOperationsRecoveryQueueParams = getPathParams(
          url.pathname,
          /^\/admin\/trust-operations\/recovery\/queue$/
        );
        if (adminTrustOperationsRecoveryQueueParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const status = url.searchParams.get("status") ?? null;
          const limitRaw = url.searchParams.get("limit");
          const limit = limitRaw === null ? 100 : Number(limitRaw);
          const jobs = store.listTrustRecoveryJobs({ status, limit });
          sendJson(res, 200, { jobs });
          return;
        }

        const adminWebhookEventsParams = getPathParams(url.pathname, /^\/admin\/payment-webhooks$/);
        if (adminWebhookEventsParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const status = url.searchParams.get("status") ?? undefined;
          const provider = url.searchParams.get("provider") ?? undefined;
          const limitRaw = url.searchParams.get("limit");
          const limit = limitRaw === null ? 100 : Number(limitRaw);
          const events = store.listProviderWebhookEvents({ status, provider, limit });
          sendJson(res, 200, { events });
          return;
        }

        const adminDisputesParams = getPathParams(url.pathname, /^\/admin\/disputes$/);
        if (adminDisputesParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const filter = url.searchParams.get("filter") ?? "open";
          const sortBy = url.searchParams.get("sortBy") ?? "updatedAt";
          const sortOrder = url.searchParams.get("sortOrder") ?? "desc";
          const nowAt = url.searchParams.get("nowAt") ?? undefined;
          const disputes = store.listAdminDisputeQueue({ filter, sortBy, sortOrder, nowAt });
          sendJson(res, 200, { disputes });
          return;
        }

        const adminDisputeDetailParams = getPathParams(url.pathname, /^\/admin\/disputes\/([^/]+)$/);
        if (adminDisputeDetailParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [transactionId] = adminDisputeDetailParams;
          assertSafeId(transactionId, "transactionId");
          const transaction = store.getTransactionById(transactionId);
          if (!transaction) {
            sendJson(res, 404, { error: "transaction not found" });
            return;
          }

          const events = store.getTransactionEventHistory({ id: transactionId });
          const evidence = store.listDisputeEvidence({ transactionId });
          const riskSignals = store.listRiskSignals({ transactionId, limit: 200 });
          const riskActions = store.listRiskOperatorActions({
            subjectType: "transaction",
            subjectId: transactionId,
            limit: 200
          });
          const trustCases = store.listTrustOperationsCases({ transactionId, limit: 20 });
          const arbitrationTimeline = [];
          for (const trustCase of trustCases) {
            const details = store.getTrustOperationsCase({
              caseId: trustCase.id,
              includeEvents: true,
              eventLimit: 50
            });
            for (const item of details.payoutTimeline ?? []) {
              arbitrationTimeline.push({
                source: "payout_risk_action",
                actionType: item.actionType,
                reasonCode: item.reasonCode,
                createdAt: item.createdAt,
                metadata: item.metadata
              });
            }
            for (const event of details.events ?? []) {
              arbitrationTimeline.push({
                source: "trust_case_event",
                actionType: event.eventType,
                reasonCode: event.reasonCode ?? null,
                createdAt: event.createdAt,
                metadata: event.details ?? {}
              });
            }
          }
          arbitrationTimeline.sort(
            (left, right) => new Date(right.createdAt).valueOf() - new Date(left.createdAt).valueOf()
          );
          const evidenceByUploader = evidence.reduce((acc, item) => {
            const key = item.uploaderUserId;
            if (!acc[key]) {
              acc[key] = [];
            }
            acc[key].push(item);
            return acc;
          }, {});
          const evidenceComparison = {
            buyerEvidenceCount: Array.isArray(evidenceByUploader[transaction.buyerId])
              ? evidenceByUploader[transaction.buyerId].length
              : 0,
            sellerEvidenceCount: Array.isArray(evidenceByUploader[transaction.sellerId])
              ? evidenceByUploader[transaction.sellerId].length
              : 0,
            buyerEvidence: evidenceByUploader[transaction.buyerId] ?? [],
            sellerEvidence: evidenceByUploader[transaction.sellerId] ?? []
          };
          const adjudicationActions = events.filter(
            (event) =>
              event.eventType === "dispute_resolved" ||
              event.eventType === "dispute_adjudicated" ||
              event.eventType.startsWith("settlement_")
          );

          sendJson(res, 200, {
            dispute: {
              transaction,
              evidence,
              riskSignals,
              riskActions,
              trustCases,
              arbitrationTimeline,
              evidenceComparison,
              finalDecisionActions: [
                {
                  decision: "release_to_seller",
                  allowedReasonCodes: [
                    "delivery_verified",
                    "evidence_consistent",
                    "low_risk_profile",
                    "operator_override"
                  ]
                },
                {
                  decision: "refund_to_buyer",
                  allowedReasonCodes: [
                    "item_not_as_described",
                    "delivery_failure",
                    "evidence_conflict",
                    "operator_override"
                  ]
                },
                {
                  decision: "cancel_transaction",
                  allowedReasonCodes: [
                    "fraud_suspected",
                    "policy_violation",
                    "mutual_cancellation",
                    "operator_override"
                  ]
                }
              ],
              events,
              adjudicationActions
            }
          });
          return;
        }

        const evidenceDownloadParams = getPathParams(
          url.pathname,
          /^\/transactions\/([^/]+)\/disputes\/evidence\/([^/]+)\/download$/
        );
        if (evidenceDownloadParams) {
          const currentUser = requireAuth(req, store);
          const [transactionId, evidenceId] = evidenceDownloadParams;
          assertSafeId(transactionId, "transactionId");
          assertSafeId(evidenceId, "evidenceId");
          const transaction = store.getTransactionById(transactionId);
          if (!transaction) {
            sendJson(res, 404, { error: "transaction not found" });
            return;
          }
          if (!canReadTransaction(currentUser, transaction)) {
            throw new StoreError(
              "forbidden",
              "only participants or admin can download dispute evidence"
            );
          }

          const evidence = store.getDisputeEvidenceById({ transactionId, evidenceId });
          const filePath = path.join(resolvedEvidenceStoragePath, evidence.storageKey);
          let data;
          try {
            data = await fs.readFile(filePath);
          } catch (error) {
            if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
              throw new StoreError("not_found", "evidence file not found");
            }
            throw error;
          }

          res.writeHead(200, {
            "Content-Type": evidence.mimeType,
            "Content-Length": String(data.length),
            "Content-Disposition": `attachment; filename="${sanitizeFileName(evidence.originalFileName)}"`
          });
          res.end(data);
          return;
        }

        const evidenceListParams = getPathParams(
          url.pathname,
          /^\/transactions\/([^/]+)\/disputes\/evidence$/
        );
        if (evidenceListParams) {
          const currentUser = requireAuth(req, store);
          const [transactionId] = evidenceListParams;
          assertSafeId(transactionId, "transactionId");
          const transaction = store.getTransactionById(transactionId);
          if (!transaction) {
            sendJson(res, 404, { error: "transaction not found" });
            return;
          }
          if (!canReadTransaction(currentUser, transaction)) {
            throw new StoreError(
              "forbidden",
              "only participants or admin can view dispute evidence"
            );
          }
          const evidence = store.listDisputeEvidence({ transactionId });
          sendJson(res, 200, { evidence });
          return;
        }

        const eventsParams = getPathParams(url.pathname, /^\/transactions\/([^/]+)\/events$/);
        if (eventsParams) {
          const currentUser = requireAuth(req, store);
          const [transactionId] = eventsParams;
          assertSafeId(transactionId, "transactionId");
          const transaction = store.getTransactionById(transactionId);
          if (!transaction) {
            sendJson(res, 404, { error: "transaction not found" });
            return;
          }

          if (!canReadTransaction(currentUser, transaction)) {
            throw new StoreError(
              "forbidden",
              "only participants or admin can view transaction events"
            );
          }

          const events = store.getTransactionEventHistory({ id: transactionId });
          sendJson(res, 200, { events });
          return;
        }

        const reputationParams = getPathParams(url.pathname, /^\/users\/([^/]+)\/reputation$/);
        if (reputationParams) {
          const [userId] = reputationParams;
          assertSafeId(userId, "userId");
          const reputation = store.getUserReputationSummary({ userId, limit: 20 });
          sendJson(res, 200, { reputation });
          return;
        }

        const ratingsParams = getPathParams(url.pathname, /^\/transactions\/([^/]+)\/ratings$/);
        if (ratingsParams) {
          const currentUser = requireAuth(req, store);
          const [transactionId] = ratingsParams;
          assertSafeId(transactionId, "transactionId");
          const transaction = store.getTransactionById(transactionId);
          if (!transaction) {
            sendJson(res, 404, { error: "transaction not found" });
            return;
          }
          if (!canReadTransaction(currentUser, transaction)) {
            throw new StoreError(
              "forbidden",
              "only participants or admin can view transaction ratings"
            );
          }

          const ratings = store.listTransactionRatings({ transactionId });
          const buyerReputation = store.getUserReputationSummary({ userId: transaction.buyerId, limit: 10 });
          const sellerReputation = store.getUserReputationSummary({ userId: transaction.sellerId, limit: 10 });
          const trust = buildTrustSnapshot({
            transaction,
            ratings,
            buyerReputation,
            sellerReputation
          });
          sendJson(res, 200, { transaction, trust });
          return;
        }

        const params = getPathParams(url.pathname, /^\/transactions\/([^/]+)$/);
        if (params) {
          const currentUser = requireAuth(req, store);
          const [transactionId] = params;
          assertSafeId(transactionId, "transactionId");
          let transaction = getCachedTransaction(transactionId);
          if (transaction) {
            incrementMetric("cache.hit_total", { cache: "transaction" }, 1);
          } else {
            transaction = store.getTransactionById(transactionId);
            if (transaction) {
              cacheTransaction(transaction);
            }
            incrementMetric("cache.miss_total", { cache: "transaction" }, 1);
          }
          if (!transaction) {
            sendJson(res, 404, { error: "transaction not found" });
            return;
          }

          if (!canReadTransaction(currentUser, transaction)) {
            throw new StoreError("forbidden", "only participants or admin can view this transaction");
          }

          sendJson(res, 200, { transaction });
          return;
        }
      }

      if (req.method === "POST") {
        const adminSetLaunchControlFlagParams = getPathParams(
          url.pathname,
          /^\/admin\/launch-control\/flags\/([^/]+)$/
        );
        if (adminSetLaunchControlFlagParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [flagKey] = adminSetLaunchControlFlagParams;
          const body = await readJsonBody(req);
          const updated = store.setLaunchControlFlag({
            key: normalizeLaunchControlKey(flagKey),
            enabled: body.enabled,
            rolloutPercentage: body.rolloutPercentage,
            allowlistUserIds: body.allowlistUserIds,
            regionAllowlist: body.regionAllowlist,
            environment: body.environment ?? launchControlEnvironment,
            actorId: currentUser.id,
            reason: body.reason ?? null,
            source: "admin_console",
            deploymentRunId: body.deploymentRunId ?? null,
            metadata: {
              ...((body.metadata && typeof body.metadata === "object") ? body.metadata : {}),
              requestPath: url.pathname
            },
            requestId,
            correlationId
          });
          sendJson(res, 200, { flag: updated });
          return;
        }

        const adminApproveListingParams = getPathParams(
          url.pathname,
          /^\/admin\/listings\/([^/]+)\/moderation\/approve$/
        );
        if (adminApproveListingParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [listingId] = adminApproveListingParams;
          assertSafeId(listingId, "listingId");
          const body = await readJsonBody(req);
          const listing = store.setListingModerationStatus({
            listingId,
            status: "approved",
            reasonCode: body.reasonCode ?? null,
            publicReason: body.publicReason ?? null,
            internalNotes: body.notes ?? null,
            actorId: currentUser.id,
            source: "admin_approve",
            requestId,
            correlationId
          });
          invalidateListingsCache();
          sendJson(res, 200, { listing });
          return;
        }

        const adminRejectListingParams = getPathParams(
          url.pathname,
          /^\/admin\/listings\/([^/]+)\/moderation\/reject$/
        );
        if (adminRejectListingParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [listingId] = adminRejectListingParams;
          assertSafeId(listingId, "listingId");
          const body = await readJsonBody(req);
          const reasonCode = body.reasonCode ?? "manual_reject";
          const listing = store.setListingModerationStatus({
            listingId,
            status: "rejected",
            reasonCode,
            publicReason:
              body.publicReason ?? normalizeModerationReasonMessage(reasonCode),
            internalNotes: body.notes ?? null,
            actorId: currentUser.id,
            source: "admin_reject",
            requestId,
            correlationId
          });
          invalidateListingsCache();
          sendJson(res, 200, { listing });
          return;
        }

        const adminHideListingParams = getPathParams(
          url.pathname,
          /^\/admin\/listings\/([^/]+)\/moderation\/hide$/
        );
        if (adminHideListingParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [listingId] = adminHideListingParams;
          assertSafeId(listingId, "listingId");
          const body = await readJsonBody(req);
          const reasonCode = body.reasonCode ?? "manual_hide";
          const listing = store.setListingModerationStatus({
            listingId,
            status: "temporarily_hidden",
            reasonCode,
            publicReason:
              body.publicReason ?? normalizeModerationReasonMessage(reasonCode),
            internalNotes: body.notes ?? null,
            actorId: currentUser.id,
            source: "admin_hide",
            requestId,
            correlationId
          });
          invalidateListingsCache();
          sendJson(res, 200, { listing });
          return;
        }

        const adminUnhideListingParams = getPathParams(
          url.pathname,
          /^\/admin\/listings\/([^/]+)\/moderation\/unhide$/
        );
        if (adminUnhideListingParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [listingId] = adminUnhideListingParams;
          assertSafeId(listingId, "listingId");
          const body = await readJsonBody(req);
          const listing = store.setListingModerationStatus({
            listingId,
            status: "approved",
            reasonCode: body.reasonCode ?? null,
            publicReason: body.publicReason ?? null,
            internalNotes: body.notes ?? null,
            actorId: currentUser.id,
            source: "admin_unhide",
            requestId,
            correlationId
          });
          invalidateListingsCache();
          sendJson(res, 200, { listing });
          return;
        }

        const adminHoldParams = getPathParams(
          url.pathname,
          /^\/admin\/transactions\/([^/]+)\/risk\/hold$/
        );
        if (adminHoldParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [transactionId] = adminHoldParams;
          assertSafeId(transactionId, "transactionId");
          const body = await readJsonBody(req);
          const transaction = store.setTransactionHold({
            transactionId,
            hold: true,
            reason: body.reason,
            notes: body.notes,
            actorId: currentUser.id,
            requestId,
            correlationId
          });
          cacheTransaction(transaction);
          sendJson(res, 200, { transaction });
          return;
        }

        const adminUnholdParams = getPathParams(
          url.pathname,
          /^\/admin\/transactions\/([^/]+)\/risk\/unhold$/
        );
        if (adminUnholdParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [transactionId] = adminUnholdParams;
          assertSafeId(transactionId, "transactionId");
          const body = await readJsonBody(req);
          const transaction = store.setTransactionHold({
            transactionId,
            hold: false,
            reason: body.reason,
            notes: body.notes,
            actorId: currentUser.id,
            requestId,
            correlationId
          });
          cacheTransaction(transaction);
          sendJson(res, 200, { transaction });
          return;
        }

        const adminFlagAccountParams = getPathParams(
          url.pathname,
          /^\/admin\/accounts\/([^/]+)\/risk\/flag$/
        );
        if (adminFlagAccountParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [userId] = adminFlagAccountParams;
          assertSafeId(userId, "userId");
          const body = await readJsonBody(req);
          const account = store.setAccountRiskControls({
            userId,
            flagged: true,
            flagReason: body.reason,
            actorId: currentUser.id,
            reason: body.reason,
            notes: body.notes,
            requestId,
            correlationId
          });
          sendJson(res, 200, { account });
          return;
        }

        const adminUnflagAccountParams = getPathParams(
          url.pathname,
          /^\/admin\/accounts\/([^/]+)\/risk\/unflag$/
        );
        if (adminUnflagAccountParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [userId] = adminUnflagAccountParams;
          assertSafeId(userId, "userId");
          const body = await readJsonBody(req);
          const account = store.setAccountRiskControls({
            userId,
            flagged: false,
            actorId: currentUser.id,
            reason: body.reason,
            notes: body.notes,
            requestId,
            correlationId
          });
          sendJson(res, 200, { account });
          return;
        }

        const submitVerificationParams = getPathParams(
          url.pathname,
          /^\/accounts\/me\/verification-submissions$/
        );
        if (submitVerificationParams) {
          const currentUser = requireAuth(req, store);
          if (currentUser.role === "admin") {
            throw new StoreError("forbidden", "admin accounts cannot submit self verification");
          }
          const body = await readJsonBody(req);
          const evidence =
            body.evidence && typeof body.evidence === "object"
              ? body.evidence
              : {
                  documentType: body.documentType ?? null,
                  countryCode: body.countryCode ?? null,
                  referenceId: body.referenceId ?? null
                };
          const account = store.submitIdentityVerification({
            userId: currentUser.id,
            actorId: currentUser.id,
            evidence,
            reviewNotes: body.notes ?? null,
            reason: "user_submission",
            requestId,
            correlationId
          });
          incrementMetric(
            "risk.verification.outcome_total",
            { outcome: "pending", actorRole: currentUser.role },
            1
          );
          sendJson(res, 200, { account });
          return;
        }

        const adminRequireVerificationParams = getPathParams(
          url.pathname,
          /^\/admin\/accounts\/([^/]+)\/risk\/require-verification$/
        );
        if (adminRequireVerificationParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [userId] = adminRequireVerificationParams;
          assertSafeId(userId, "userId");
          const body = await readJsonBody(req);
          const account = store.setAccountRiskControls({
            userId,
            verificationRequired: true,
            actorId: currentUser.id,
            reason: body.reason,
            notes: body.notes,
            requestId,
            correlationId
          });
          sendJson(res, 200, { account });
          return;
        }

        const adminClearVerificationParams = getPathParams(
          url.pathname,
          /^\/admin\/accounts\/([^/]+)\/risk\/clear-verification$/
        );
        if (adminClearVerificationParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [userId] = adminClearVerificationParams;
          assertSafeId(userId, "userId");
          const body = await readJsonBody(req);
          const account = store.setAccountRiskControls({
            userId,
            verificationRequired: false,
            actorId: currentUser.id,
            reason: body.reason,
            notes: body.notes,
            requestId,
            correlationId
          });
          sendJson(res, 200, { account });
          return;
        }

        const adminApproveVerificationParams = getPathParams(
          url.pathname,
          /^\/admin\/accounts\/([^/]+)\/verification\/approve$/
        );
        if (adminApproveVerificationParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [userId] = adminApproveVerificationParams;
          assertSafeId(userId, "userId");
          const body = await readJsonBody(req);
          const account = store.reviewIdentityVerification({
            userId,
            status: "verified",
            actorId: currentUser.id,
            reviewNotes: body.notes ?? null,
            reason: body.reason ?? "approved_by_operator",
            requestId,
            correlationId
          });
          incrementMetric("risk.verification.outcome_total", { outcome: "verified" }, 1);
          sendJson(res, 200, { account });
          return;
        }

        const adminRejectVerificationParams = getPathParams(
          url.pathname,
          /^\/admin\/accounts\/([^/]+)\/verification\/reject$/
        );
        if (adminRejectVerificationParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [userId] = adminRejectVerificationParams;
          assertSafeId(userId, "userId");
          const body = await readJsonBody(req);
          const account = store.reviewIdentityVerification({
            userId,
            status: "rejected",
            actorId: currentUser.id,
            reviewNotes: body.notes ?? null,
            reason: body.reason ?? "rejected_by_operator",
            requestId,
            correlationId
          });
          incrementMetric("risk.verification.outcome_total", { outcome: "rejected" }, 1);
          sendJson(res, 200, { account });
          return;
        }

        const adminRiskTierOverrideParams = getPathParams(
          url.pathname,
          /^\/admin\/accounts\/([^/]+)\/risk\/override-tier$/
        );
        if (adminRiskTierOverrideParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [userId] = adminRiskTierOverrideParams;
          assertSafeId(userId, "userId");
          const body = await readJsonBody(req);
          const account = store.setAccountRiskTierOverride({
            userId,
            tier: body.tier,
            actorId: currentUser.id,
            reason: body.reason,
            details: {
              notes: body.notes ?? null,
              requestPath: url.pathname
            },
            requestId,
            correlationId
          });
          incrementMetric("risk.tier.changed_total", { source: "override", tier: account.riskTier }, 1);
          sendJson(res, 200, { account });
          return;
        }

        const adminRiskTierClearOverrideParams = getPathParams(
          url.pathname,
          /^\/admin\/accounts\/([^/]+)\/risk\/clear-tier-override$/
        );
        if (adminRiskTierClearOverrideParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [userId] = adminRiskTierClearOverrideParams;
          assertSafeId(userId, "userId");
          const body = await readJsonBody(req);
          const account = store.clearAccountRiskTierOverride({
            userId,
            actorId: currentUser.id,
            reason: body.reason ?? "override cleared by operator",
            requestId,
            correlationId
          });
          incrementMetric("risk.tier.changed_total", { source: "system", tier: account.riskTier }, 1);
          sendJson(res, 200, { account });
          return;
        }

        const adminAccountRecoveryStartParams = getPathParams(
          url.pathname,
          /^\/admin\/accounts\/([^/]+)\/recovery\/start$/
        );
        if (adminAccountRecoveryStartParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [userId] = adminAccountRecoveryStartParams;
          assertSafeId(userId, "userId");
          const body = await readJsonBody(req);
          const recoveryCase = store.startAccountRecoveryCase({
            userId,
            actorId: currentUser.id,
            compromiseSignal: body.compromiseSignal ?? {},
            requiredApprovalActorId: body.requiredApprovalActorId ?? null,
            decisionNotes: body.notes ?? null
          });
          sendJson(res, 201, { recoveryCase });
          return;
        }

        const adminAccountRecoveryApproveStageParams = getPathParams(
          url.pathname,
          /^\/admin\/accounts\/([^/]+)\/recovery\/approve-stage$/
        );
        if (adminAccountRecoveryApproveStageParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [userId] = adminAccountRecoveryApproveStageParams;
          assertSafeId(userId, "userId");
          const body = await readJsonBody(req);
          const recoveryState = store.getAccountRecoveryState({ userId, limit: 1 });
          const activeCase = recoveryState.activeCase;
          if (!activeCase) {
            sendJson(res, 404, { error: "no active account recovery case" });
            return;
          }
          const recoveryCase = store.approveAccountRecoveryStage({
            recoveryCaseId: activeCase.id,
            actorId: currentUser.id,
            requiredApprovalActorId: body.requiredApprovalActorId ?? null,
            decisionNotes: body.notes ?? null
          });
          sendJson(res, 200, { recoveryCase });
          return;
        }

        const adminTrustOperationsSimulateParams = getPathParams(
          url.pathname,
          /^\/admin\/trust-operations\/simulate-policy$/
        );
        if (adminTrustOperationsSimulateParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const body = await readJsonBody(req);
          let policy;
          let policyVersionId = null;
          let cohort = resolveTrustOpsCohort(body.cohort ?? {});
          if (body.policyVersionId !== undefined && body.policyVersionId !== null) {
            const version = store.getTrustOpsPolicyVersion({ id: Number(body.policyVersionId) });
            policy = resolveTrustOpsPolicy(version.policy ?? {});
            cohort = resolveTrustOpsCohort(version.cohort ?? {});
            policyVersionId = version.id;
          } else {
            policy = resolveTrustOpsPolicy(body.policy ?? {});
          }
          const limitRaw = body.limit ?? trustOpsRecomputeDefaultLimit;
          const limit = Number(limitRaw);
          if (!Number.isInteger(limit) || limit <= 0 || limit > trustOpsRecomputeHardLimit) {
            throw new StoreError(
              "validation",
              `limit must be an integer between 1 and ${trustOpsRecomputeHardLimit}`
            );
          }
          const items = store.simulateTrustOperationsPolicy({
            limit,
            policy,
            cohort,
            policyVersionId
          });
          incrementMetric("trust_ops.simulation.total", {}, 1);
          const summary = {
            scanned: items.length,
            hold: items.filter((item) => item.decision.recommendedAction === "hold").length,
            clear: items.filter((item) => item.decision.recommendedAction === "clear").length,
            none: items.filter((item) => item.decision.recommendedAction === "none").length,
            cohortMatched: items.filter((item) => item.cohortMatched).length
          };
          sendJson(res, 200, { policy, cohort, limit, summary, items });
          return;
        }

        const adminTrustOperationsPolicyCreateParams = getPathParams(
          url.pathname,
          /^\/admin\/trust-operations\/policies$/
        );
        if (adminTrustOperationsPolicyCreateParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const body = await readJsonBody(req);
          const policyVersion = store.createTrustOpsPolicyVersion({
            name: body.name,
            policy: resolveTrustOpsPolicy(body.policy ?? {}),
            cohort: resolveTrustOpsCohort(body.cohort ?? {}),
            activationWindowStartAt: body.activationWindowStartAt ?? null,
            activationWindowEndAt: body.activationWindowEndAt ?? null,
            actorId: currentUser.id
          });
          sendJson(res, 201, { policyVersion });
          return;
        }

        const adminTrustOperationsPolicyActivateParams = getPathParams(
          url.pathname,
          /^\/admin\/trust-operations\/policies\/(\d+)\/activate$/
        );
        if (adminTrustOperationsPolicyActivateParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [policyVersionId] = adminTrustOperationsPolicyActivateParams;
          const policyVersion = store.activateTrustOpsPolicyVersion({
            id: Number(policyVersionId),
            actorId: currentUser.id
          });
          sendJson(res, 200, { policyVersion });
          return;
        }

        const adminTrustOperationsBacktestParams = getPathParams(
          url.pathname,
          /^\/admin\/trust-operations\/backtest$/
        );
        if (adminTrustOperationsBacktestParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const body = await readJsonBody(req);
          let policy;
          let cohort;
          let policyVersionId = null;
          if (body.policyVersionId !== undefined && body.policyVersionId !== null) {
            const version = store.getTrustOpsPolicyVersion({ id: Number(body.policyVersionId) });
            policy = resolveTrustOpsPolicy(version.policy ?? {});
            cohort = resolveTrustOpsCohort(version.cohort ?? {});
            policyVersionId = version.id;
          } else {
            policy = resolveTrustOpsPolicy(body.policy ?? {});
            cohort = resolveTrustOpsCohort(body.cohort ?? {});
          }
          const limitRaw = body.limit ?? trustOpsRecomputeDefaultLimit;
          const limit = Number(limitRaw);
          if (!Number.isInteger(limit) || limit <= 0 || limit > trustOpsRecomputeHardLimit) {
            throw new StoreError(
              "validation",
              `limit must be an integer between 1 and ${trustOpsRecomputeHardLimit}`
            );
          }
          const items = store.simulateTrustOperationsPolicy({
            limit,
            policy,
            cohort,
            policyVersionId
          });
          const activePolicyVersion = store.getActiveTrustOpsPolicyVersion();
          const baselineItems = activePolicyVersion
            ? store.simulateTrustOperationsPolicy({
                limit,
                policy: resolveTrustOpsPolicy(activePolicyVersion.policy ?? {}),
                cohort: resolveTrustOpsCohort(activePolicyVersion.cohort ?? {}),
                policyVersionId: activePolicyVersion.id
              })
            : [];
          const countPayoutActions = (entries) =>
            entries.reduce(
              (acc, item) => {
                if (item.decision.payoutAction === "manual_review") {
                  acc.manualReview += 1;
                } else if (item.decision.payoutAction === "hold") {
                  acc.hold += 1;
                } else if (item.decision.payoutAction === "reserve") {
                  acc.reserve += 1;
                } else if (item.decision.payoutAction === "release") {
                  acc.release += 1;
                } else {
                  acc.none += 1;
                }
                return acc;
              },
              { hold: 0, reserve: 0, manualReview: 0, release: 0, none: 0 }
            );
          const impactSummary = {
            scanned: items.length,
            recommendations: {
              hold: items.filter((item) => item.decision.recommendedAction === "hold").length,
              clear: items.filter((item) => item.decision.recommendedAction === "clear").length,
              none: items.filter((item) => item.decision.recommendedAction === "none").length
            },
            severityMix: {
              critical: items.filter((item) => item.decision.severity === "critical").length,
              high: items.filter((item) => item.decision.severity === "high").length,
              medium: items.filter((item) => item.decision.severity === "medium").length,
              low: items.filter((item) => item.decision.severity === "low").length
            },
            cohortMatched: items.filter((item) => item.cohortMatched).length,
            payoutActions: countPayoutActions(items)
          };
          const baselinePayout = countPayoutActions(baselineItems);
          const payoutImpactDelta = {
            baselinePolicyVersionId: activePolicyVersion?.id ?? null,
            comparedPolicyVersionId: policyVersionId,
            holdDelta: impactSummary.payoutActions.hold - baselinePayout.hold,
            reserveDelta: impactSummary.payoutActions.reserve - baselinePayout.reserve,
            manualReviewDelta: impactSummary.payoutActions.manualReview - baselinePayout.manualReview,
            releaseDelta: impactSummary.payoutActions.release - baselinePayout.release
          };
          sendJson(res, 200, { policy, cohort, limit, impactSummary, payoutImpactDelta, items });
          return;
        }

        const adminTrustOperationsFeedbackParams = getPathParams(
          url.pathname,
          /^\/admin\/trust-operations\/feedback$/
        );
        if (adminTrustOperationsFeedbackParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const body = await readJsonBody(req);
          const feedback = store.ingestTrustOpsPolicyFeedback({
            transactionId: body.transactionId ?? null,
            caseId: body.caseId ?? null,
            feedbackType: body.feedbackType,
            outcome: body.outcome,
            source: body.source ?? "admin_console",
            actorId: currentUser.id,
            details: body.details ?? {}
          });
          sendJson(res, 201, { feedback });
          return;
        }

        const adminTrustOperationsNetworkSignalsParams = getPathParams(
          url.pathname,
          /^\/admin\/trust-operations\/network\/signals$/
        );
        if (adminTrustOperationsNetworkSignalsParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const body = await readJsonBody(req);
          const result = store.ingestTrustNetworkLinks({
            transactionId: body.transactionId,
            links: body.links,
            actorId: currentUser.id,
            policyVersionId: body.policyVersionId ?? null,
            propagationDecayHours: body.propagationDecayHours ?? 168
          });
          sendJson(res, 201, result);
          return;
        }

        const adminTrustOperationsCaseApproveParams = getPathParams(
          url.pathname,
          /^\/admin\/trust-operations\/cases\/(\d+)\/approve$/
        );
        if (adminTrustOperationsCaseApproveParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [caseId] = adminTrustOperationsCaseApproveParams;
          const body = await readJsonBody(req);
          const existing = store.getTrustOperationsCase({
            caseId: Number(caseId),
            includeEvents: false
          }).trustCase;
          const action = existing.recommendedAction === "none" ? "hold" : existing.recommendedAction;
          const result = store.applyTrustOperationsCaseDecision({
            caseId: Number(caseId),
            action,
            actorId: currentUser.id,
            reasonCode: body.reasonCode,
            notes: body.notes ?? null,
            overrideExpiresInHours: body.overrideExpiresInHours ?? null,
            requestId,
            correlationId
          });
          incrementMetric("trust_ops.case.approved_total", { action }, 1);
          sendJson(res, 200, result);
          return;
        }

        const adminTrustOperationsCaseChallengeCreateParams = getPathParams(
          url.pathname,
          /^\/admin\/trust-operations\/cases\/(\d+)\/challenges$/
        );
        if (adminTrustOperationsCaseChallengeCreateParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [caseId] = adminTrustOperationsCaseChallengeCreateParams;
          const body = await readJsonBody(req);
          const challenge = store.createTrustStepUpChallenge({
            caseId: Number(caseId),
            userId: body.userId,
            reasonCode: body.reasonCode,
            challengeType: body.challengeType ?? "identity_reverification",
            evidence: body.evidence ?? {},
            actorId: currentUser.id,
            expiresInHours: body.expiresInHours ?? 24
          });
          sendJson(res, 201, { challenge });
          return;
        }

        const adminTrustOperationsChallengeResolveParams = getPathParams(
          url.pathname,
          /^\/admin\/trust-operations\/challenges\/(\d+)\/resolve$/
        );
        if (adminTrustOperationsChallengeResolveParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [challengeId] = adminTrustOperationsChallengeResolveParams;
          const body = await readJsonBody(req);
          const challenge = store.resolveTrustStepUpChallenge({
            challengeId: Number(challengeId),
            status: body.status,
            actorId: currentUser.id,
            evidence: body.evidence ?? {}
          });
          sendJson(res, 200, { challenge });
          return;
        }

        const adminTrustOperationsCaseClusterPreviewParams = getPathParams(
          url.pathname,
          /^\/admin\/trust-operations\/cases\/(\d+)\/cluster-preview$/
        );
        if (adminTrustOperationsCaseClusterPreviewParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [caseId] = adminTrustOperationsCaseClusterPreviewParams;
          const body = await readJsonBody(req);
          const preview = store.previewTrustClusterAction({
            caseId: Number(caseId),
            action: body.action ?? "approve",
            actorId: currentUser.id,
            reasonCode: body.reasonCode ?? "cluster_action_preview"
          });
          sendJson(res, 200, { preview });
          return;
        }

        const adminTrustOperationsCaseClusterApplyParams = getPathParams(
          url.pathname,
          /^\/admin\/trust-operations\/cases\/(\d+)\/cluster-apply$/
        );
        if (adminTrustOperationsCaseClusterApplyParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [caseId] = adminTrustOperationsCaseClusterApplyParams;
          const body = await readJsonBody(req);
          const result = store.applyTrustClusterAction({
            caseId: Number(caseId),
            action: body.action ?? "approve",
            actorId: currentUser.id,
            reasonCode: body.reasonCode,
            notes: body.notes ?? null
          });
          sendJson(res, 200, result);
          return;
        }

        const adminTrustOperationsCaseOverrideParams = getPathParams(
          url.pathname,
          /^\/admin\/trust-operations\/cases\/(\d+)\/override$/
        );
        if (adminTrustOperationsCaseOverrideParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [caseId] = adminTrustOperationsCaseOverrideParams;
          const body = await readJsonBody(req);
          const result = store.applyTrustOperationsCaseDecision({
            caseId: Number(caseId),
            action: body.action,
            actorId: currentUser.id,
            reasonCode: body.reasonCode,
            notes: body.notes ?? null,
            overrideExpiresInHours: body.overrideExpiresInHours ?? null,
            requestId,
            correlationId
          });
          incrementMetric("trust_ops.case.overridden_total", { action: String(body.action ?? "") }, 1);
          sendJson(res, 200, result);
          return;
        }

        const adminTrustOperationsCaseClearParams = getPathParams(
          url.pathname,
          /^\/admin\/trust-operations\/cases\/(\d+)\/clear$/
        );
        if (adminTrustOperationsCaseClearParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [caseId] = adminTrustOperationsCaseClearParams;
          const body = await readJsonBody(req);
          const result = store.applyTrustOperationsCaseDecision({
            caseId: Number(caseId),
            action: "clear",
            actorId: currentUser.id,
            reasonCode: body.reasonCode,
            notes: body.notes ?? null,
            requestId,
            correlationId
          });
          incrementMetric("trust_ops.case.cleared_total", {}, 1);
          sendJson(res, 200, result);
          return;
        }

        const adminTrustOperationsCaseAssignParams = getPathParams(
          url.pathname,
          /^\/admin\/trust-operations\/cases\/(\d+)\/assign$/
        );
        if (adminTrustOperationsCaseAssignParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [caseId] = adminTrustOperationsCaseAssignParams;
          const body = await readJsonBody(req);
          const result = store.assignTrustOperationsCase({
            caseId: Number(caseId),
            investigatorId: body.investigatorId,
            actorId: currentUser.id,
            reasonCode: body.reasonCode ?? "investigator_assignment",
            notes: body.notes ?? null
          });
          sendJson(res, 200, result);
          return;
        }

        const adminTrustOperationsCaseClaimParams = getPathParams(
          url.pathname,
          /^\/admin\/trust-operations\/cases\/(\d+)\/claim$/
        );
        if (adminTrustOperationsCaseClaimParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [caseId] = adminTrustOperationsCaseClaimParams;
          const body = await readJsonBody(req);
          const investigatorId =
            body.investigatorId === undefined || body.investigatorId === null
              ? currentUser.id
              : body.investigatorId;
          const result = store.assignTrustOperationsCase({
            caseId: Number(caseId),
            investigatorId,
            actorId: currentUser.id,
            reasonCode: body.reasonCode ?? "investigator_claim",
            notes: body.notes ?? null
          });
          sendJson(res, 200, result);
          return;
        }

        const adminTrustOperationsCaseNoteParams = getPathParams(
          url.pathname,
          /^\/admin\/trust-operations\/cases\/(\d+)\/notes$/
        );
        if (adminTrustOperationsCaseNoteParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [caseId] = adminTrustOperationsCaseNoteParams;
          const body = await readJsonBody(req);
          const result = store.addTrustOperationsCaseNote({
            caseId: Number(caseId),
            note: body.note,
            actorId: currentUser.id
          });
          sendJson(res, 201, result);
          return;
        }

        const adminTrustOperationsCaseEvidenceBundleExportParams = getPathParams(
          url.pathname,
          /^\/admin\/trust-operations\/cases\/(\d+)\/evidence-bundle\/export$/
        );
        if (adminTrustOperationsCaseEvidenceBundleExportParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [caseId] = adminTrustOperationsCaseEvidenceBundleExportParams;
          const body = await readJsonBody(req);
          const exported = store.exportTrustOpsEvidenceBundle({
            caseId: Number(caseId),
            actorId: currentUser.id,
            requireDisputeArtifacts: body.requireDisputeArtifacts === true,
            expectedBundleHashSha256: body.expectedBundleHashSha256 ?? null,
            artifactHashAssertions: body.artifactHashAssertions
          });
          sendJson(res, 200, exported);
          return;
        }

        const adminTrustOperationsBulkActionParams = getPathParams(
          url.pathname,
          /^\/admin\/trust-operations\/cases\/bulk-action$/
        );
        if (adminTrustOperationsBulkActionParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const body = await readJsonBody(req);
          const result = store.bulkApplyTrustOperationsCaseDecision({
            caseIds: body.caseIds,
            action: body.action,
            actorId: currentUser.id,
            reasonCode: body.reasonCode,
            notes: body.notes ?? null
          });
          sendJson(res, 200, result);
          return;
        }

        const reprocessWebhookParams = getPathParams(
          url.pathname,
          /^\/admin\/payment-webhooks\/(\d+)\/reprocess$/
        );
        if (reprocessWebhookParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const [eventId] = reprocessWebhookParams;
          const requeued = store.requeueProviderWebhookEvent({ id: Number(eventId) });
          const processed = store.processProviderWebhookEvent({
            provider: requeued.provider,
            eventId: requeued.eventId
          });
          if (processed.transaction?.id) {
            invalidateTransactionCache(processed.transaction.id);
            const refreshedTransaction = store.getTransactionById(processed.transaction.id);
            if (refreshedTransaction) {
              cacheTransaction(refreshedTransaction);
            }
          }
          sendJson(res, 200, {
            event: processed.event,
            result: {
              applied: processed.applied,
              reason: processed.reason,
              transactionId: processed.transaction?.id ?? null,
              paymentStatus: processed.transaction?.paymentStatus ?? null
            }
          });
          return;
        }

        const evidenceUploadParams = getPathParams(
          url.pathname,
          /^\/transactions\/([^/]+)\/disputes\/evidence$/
        );
        if (evidenceUploadParams) {
          const currentUser = requireAuth(req, store);
          ensureAccountRiskAllowsWrite(currentUser);
          const [transactionId] = evidenceUploadParams;
          assertSafeId(transactionId, "transactionId");
          const transaction = store.getTransactionById(transactionId);
          if (!transaction) {
            sendJson(res, 404, { error: "transaction not found" });
            return;
          }
          if (!canUploadDisputeEvidence(currentUser, transaction)) {
            throw new StoreError(
              "forbidden",
              "only transaction participants can upload dispute evidence"
            );
          }

          const body = await readJsonBody(req);
          if (!body.fileName || typeof body.fileName !== "string" || !body.fileName.trim()) {
            throw new StoreError("validation", "fileName is required");
          }
          if (body.fileName.length > 255) {
            throw new StoreError("validation", "fileName must be 255 characters or fewer");
          }
          if (!body.mimeType || typeof body.mimeType !== "string" || !body.mimeType.trim()) {
            throw new StoreError("validation", "mimeType is required");
          }

          const content = parseBase64Content(body.contentBase64);
          if (content.length > resolvedEvidenceMaxBytes) {
            throw new StoreError(
              "validation",
              `evidence file exceeds EVIDENCE_MAX_BYTES (${resolvedEvidenceMaxBytes})`
            );
          }

          const checksumSha256 = crypto.createHash("sha256").update(content).digest("hex");
          if (body.checksumSha256 && body.checksumSha256 !== checksumSha256) {
            throw new StoreError("validation", "checksumSha256 does not match content");
          }
          const metadataConsistency = evaluateEvidenceMetadataConsistency({
            fileName: body.fileName,
            mimeType: body.mimeType
          });
          const duplicateWithinTransaction =
            store.countDisputeEvidenceByChecksum({
              transactionId,
              checksumSha256,
              global: false
            }) > 0;
          const replaySeenGlobally =
            store.countDisputeEvidenceByChecksum({
              checksumSha256,
              global: true
            }) > 0;
          const anomalyScore = Math.max(
            0,
            Math.min(
              100,
              (100 - metadataConsistency.metadataConsistencyScore) * 0.5 +
                (duplicateWithinTransaction ? 45 : 0) +
                (replaySeenGlobally ? 20 : 0)
            )
          );

          const evidenceId = body.evidenceId ?? crypto.randomUUID();
          assertSafeId(evidenceId, "evidenceId");
          const safeName = sanitizeFileName(body.fileName.trim());
          const storageKey = path.join(transactionId, `${evidenceId}-${safeName}`);
          const filePath = path.join(resolvedEvidenceStoragePath, storageKey);
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, content, { flag: "wx" });

          let evidence;
          try {
            evidence = store.createDisputeEvidence({
              id: evidenceId,
              transactionId,
              uploaderUserId: currentUser.id,
              originalFileName: body.fileName.trim(),
              mimeType: body.mimeType.trim(),
              sizeBytes: content.length,
              checksumSha256,
              storageKey,
              integrity: {
                metadataConsistencyScore: metadataConsistency.metadataConsistencyScore,
                duplicateWithinTransaction,
                replaySeenGlobally,
                anomalyScore,
                integrityFlags: [
                  ...metadataConsistency.integrityFlags,
                  ...(duplicateWithinTransaction ? ["duplicate_within_transaction"] : []),
                  ...(replaySeenGlobally ? ["replay_detected_globally"] : [])
                ]
              }
            });
          } catch (error) {
            await fs.rm(filePath, { force: true });
            throw error;
          }

          sendJson(res, 201, { evidence });
          return;
        }

        const confirmParams = getPathParams(
          url.pathname,
          /^\/transactions\/([^/]+)\/confirm-delivery$/
        );

        if (confirmParams) {
          const currentUser = requireAuth(req, store);
          ensureAccountRiskAllowsWrite(currentUser);
          enforceLaunchControlGate({
            key: "payout_release",
            userId: currentUser.id,
            contextMessage: "payout release is currently disabled"
          });
          const [transactionId] = confirmParams;
          assertSafeId(transactionId, "transactionId");
          const body = await readJsonBody(req);
          const currentTransaction = store.getTransactionById(transactionId);
          if (!currentTransaction) {
            sendJson(res, 404, { error: "transaction not found" });
            return;
          }
          const trustCases = store.listTrustOperationsCases({
            transactionId,
            limit: 20
          });
          const activeTrustCase =
            trustCases.find((item) => item.status === "open" || item.status === "in_review") ?? null;
          const preemptiveControls = activeTrustCase?.payoutDecision?.preemptiveDisputeControls?.controls ?? null;
          if (
            preemptiveControls?.requireShipmentConfirmation === true &&
            !body.fulfillmentProof
          ) {
            throw new StoreError(
              "conflict",
              "shipment confirmation is required for escrow release on this transaction risk profile"
            );
          }
          if (body.fulfillmentProof) {
            const proof = body.fulfillmentProof;
            const artifactChecksumSha256 =
              proof.artifactChecksumSha256 && typeof proof.artifactChecksumSha256 === "string"
                ? proof.artifactChecksumSha256.trim()
                : null;
            const recordedProof = store.recordFulfillmentProof({
              id: proof.id ?? crypto.randomUUID(),
              transactionId,
              submittedBy: currentUser.id,
              proofType: proof.proofType ?? "delivery_confirmation",
              artifactChecksumSha256,
              metadata: proof.metadata ?? {},
              recordedAt: proof.recordedAt ?? null
            });
            if (recordedProof.anomalyScore >= 85) {
              throw new StoreError(
                "conflict",
                "fulfillment proof flagged by integrity checks; escrow release requires manual adjudication"
              );
            }
          }
          if (preemptiveControls?.restrictPayoutProgression === true) {
            throw new StoreError(
              "conflict",
              "payout progression is restricted by trust policy; manual trust-ops review is required"
            );
          }
          evaluateAndEnforceRiskLimits({
            store,
            incrementMetricFn: incrementMetric,
            checkpoint: "payout_release",
            transactionId,
            transactionAcceptedAt: currentTransaction.acceptedAt,
            amountCents: currentTransaction.amountCents,
            participants: [
              { userId: currentTransaction.buyerId, role: "buyer" },
              { userId: currentTransaction.sellerId, role: "seller" }
            ],
            requestId,
            correlationId
          });
          const transaction = store.confirmDelivery({ id: transactionId, buyerId: currentUser.id });
          cacheTransaction(transaction);
          incrementMetric("transaction.state_transition.total", { to: "completed" }, 1);
          sendJson(res, 200, { transaction });
          return;
        }

        const acknowledgeCompletionParams = getPathParams(
          url.pathname,
          /^\/transactions\/([^/]+)\/acknowledge-completion$/
        );
        if (acknowledgeCompletionParams) {
          const currentUser = requireAuth(req, store);
          ensureAccountRiskAllowsWrite(currentUser);
          const [transactionId] = acknowledgeCompletionParams;
          assertSafeId(transactionId, "transactionId");
          const transaction = store.acknowledgeCompletionBySeller({
            id: transactionId,
            sellerId: currentUser.id
          });
          cacheTransaction(transaction);
          sendJson(res, 200, { transaction });
          return;
        }

        const ratingParams = getPathParams(url.pathname, /^\/transactions\/([^/]+)\/ratings$/);
        if (ratingParams) {
          const currentUser = requireAuth(req, store);
          ensureAccountRiskAllowsWrite(currentUser);
          const [transactionId] = ratingParams;
          assertSafeId(transactionId, "transactionId");
          const body = await readJsonBody(req);
          const rating = store.submitTransactionRating({
            transactionId,
            raterUserId: currentUser.id,
            score: Number(body.score),
            comment: body.comment,
            ratingId: body.ratingId
          });

          const transaction = store.getTransactionById(transactionId);
          const ratings = store.listTransactionRatings({ transactionId });
          const buyerReputation = store.getUserReputationSummary({ userId: transaction.buyerId, limit: 10 });
          const sellerReputation = store.getUserReputationSummary({ userId: transaction.sellerId, limit: 10 });
          const trust = buildTrustSnapshot({
            transaction,
            ratings,
            buyerReputation,
            sellerReputation
          });
          sendJson(res, 201, { rating, transaction, trust });
          return;
        }

        const disputeParams = getPathParams(url.pathname, /^\/transactions\/([^/]+)\/disputes$/);
        if (disputeParams) {
          const currentUser = requireAuth(req, store);
          ensureAccountRiskAllowsWrite(currentUser);
          const [transactionId] = disputeParams;
          assertSafeId(transactionId, "transactionId");
          let transaction = store.openDispute({ id: transactionId, actorId: currentUser.id });
          const disputeWindowSince = new Date(Date.now() - riskDisputeWindowHours * 60 * 60 * 1000).toISOString();
          const recentDisputes = store.countRecentDisputeOpeningsByActor({
            actorId: currentUser.id,
            sinceAt: disputeWindowSince
          });
          if (recentDisputes > riskDisputeThreshold) {
            recordRiskSignal({
              transactionId,
              userId: currentUser.id,
              signalType: "dispute_abuse",
              severity: 50,
              details: {
                recentDisputes,
                threshold: riskDisputeThreshold,
                windowHours: riskDisputeWindowHours
              },
              createdBy: "system:risk"
            });
          } else {
            store.refreshTransactionRiskProfile({ transactionId });
          }
          transaction = store.getTransactionById(transactionId);
          cacheTransaction(transaction);
          incrementMetric("dispute.state_transition.total", { to: "disputed" }, 1);
          sendJson(res, 200, { transaction });
          return;
        }

        const resolveParams = getPathParams(
          url.pathname,
          /^\/transactions\/([^/]+)\/disputes\/resolve$/
        );
        if (resolveParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          enforceLaunchControlGate({
            key: "dispute_auto_transitions",
            userId: currentUser.id,
            contextMessage: "dispute transition automation is currently disabled"
          });
          const [transactionId] = resolveParams;
          assertSafeId(transactionId, "transactionId");
          const transaction = store.resolveDispute({ id: transactionId });
          cacheTransaction(transaction);
          incrementMetric("dispute.state_transition.total", { to: "resolved" }, 1);
          sendJson(res, 200, { transaction });
          return;
        }

        const adjudicateParams = getPathParams(
          url.pathname,
          /^\/transactions\/([^/]+)\/disputes\/adjudicate$/
        );
        if (adjudicateParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          enforceLaunchControlGate({
            key: "dispute_auto_transitions",
            userId: currentUser.id,
            contextMessage: "dispute transition automation is currently disabled"
          });
          const [transactionId] = adjudicateParams;
          assertSafeId(transactionId, "transactionId");
          const body = await readJsonBody(req);
          const existing = store.getTransactionById(transactionId);
          if (!existing) {
            sendJson(res, 404, { error: "transaction not found" });
            return;
          }

          let paymentRefundResult = null;
          let refundIdempotencyKey = null;
          const shouldRefund =
            body.decision === "refund_to_buyer" || body.decision === "cancel_transaction";
          if (shouldRefund && existing.paymentStatus !== "refunded") {
            refundIdempotencyKey = `txn:${transactionId}:refund:${body.decision}:v1`;
            try {
              paymentRefundResult = await paymentProvider.refund({
                transactionId,
                paymentIntentId: existing.providerPaymentIntentId,
                chargeId: existing.providerChargeId,
                amountCents: existing.totalBuyerCharge,
                currency: existing.currency,
                idempotencyKey: refundIdempotencyKey,
                requestId,
                correlationId
              });
            } catch (error) {
              if (error instanceof PaymentProviderError) {
                store.upsertPaymentOperation({
                  transactionId,
                  operation: "refund",
                  provider: paymentProvider.name,
                  idempotencyKey: refundIdempotencyKey,
                  status: "failed",
                  errorCode: error.code,
                  errorMessage: error.message,
                  response: {
                    isTemporary: error.isTemporary,
                    cause: error.cause instanceof Error ? error.cause.message : null
                  }
                });
              }
              throw error;
            }
          }

          const transaction = store.adjudicateDispute({
            id: transactionId,
            decision: body.decision,
            decidedBy: body.decidedBy ?? currentUser.id,
            reasonCode: body.reasonCode ?? "operator_decision",
            notes: body.notes,
            paymentRefundResult,
            refundIdempotencyKey
          });
          cacheTransaction(transaction);
          incrementMetric("dispute.state_transition.total", { to: "adjudicated" }, 1);
          sendJson(res, 200, {
            transaction,
            decisionTransparency: buildDecisionTransparency({
              decision: body.decision,
              reasonCode: body.reasonCode ?? "operator_decision",
              decidedAt: transaction.adjudicationDecidedAt,
              policyVersionId: null
            })
          });
          return;
        }

        if (url.pathname === "/jobs/auto-release") {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          enforceLaunchControlGate({
            key: "payout_release",
            userId: currentUser.id,
            contextMessage: "auto payout release job is currently disabled"
          });
          const body = await readJsonBody(req);
          const result = store.runAutoRelease({ nowAt: body.nowAt });
          for (const transactionId of [
            ...(result.releasedTransactionIds ?? []),
            ...(result.delayedTransactionIds ?? []),
            ...(result.manualReviewTransactionIds ?? [])
          ]) {
            invalidateTransactionCache(transactionId);
          }
          sendJson(res, 200, result);
          return;
        }

        if (url.pathname === "/jobs/launch-control/auto-rollback") {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const body = await readJsonBody(req);
          const metrics = metricsSnapshot();
          const observedBurnRate =
            body.burnRate === undefined
              ? Number(metrics?.slo?.coreFlow?.errorBudgetBurnRate ?? 0)
              : Number(body.burnRate);
          const observedErrorRate =
            body.errorRate === undefined
              ? Number(
                  (metrics?.slo?.coreFlow?.errorRequests ?? 0) /
                    Math.max(1, metrics?.slo?.coreFlow?.totalRequests ?? 0)
                )
              : Number(body.errorRate);
          const observedWebhookFailures = Number(body.webhookFailureCount ?? 0);
          const force = body.force === true;
          const breachReasons = [];
          if (observedBurnRate >= launchControlAutoRollbackBurnRateThreshold) {
            breachReasons.push("burn_rate");
          }
          if (observedErrorRate >= launchControlAutoRollbackErrorRateThreshold) {
            breachReasons.push("error_rate");
          }
          if (observedWebhookFailures >= launchControlAutoRollbackWebhookFailureThreshold) {
            breachReasons.push("webhook_failures");
          }
          if (force) {
            breachReasons.push("forced");
          }

          const affectedFlags = normalizeLaunchControlAllowlist(
            Array.isArray(body.affectedFlags) ? body.affectedFlags : launchControlAutoRollbackDefaultFlags
          ).filter((key) => launchControlFlagKeys.has(key));
          const shouldRollback = breachReasons.length > 0 && affectedFlags.length > 0;
          const updatedFlags = [];
          if (shouldRollback) {
            for (const key of affectedFlags) {
              const updated = store.setLaunchControlFlag({
                key,
                enabled: false,
                actorId: "system:launch_control",
                reason:
                  body.reason ??
                  `Auto rollback due to ${breachReasons.join(", ")} (burnRate=${observedBurnRate.toFixed(3)}, errorRate=${observedErrorRate.toFixed(4)}, webhookFailures=${observedWebhookFailures}).`,
                source: "auto_rollback",
                deploymentRunId: body.deploymentRunId ?? null,
                metadata: {
                  breachReasons,
                  observedBurnRate,
                  observedErrorRate,
                  observedWebhookFailures,
                  triggeredBy: currentUser.id
                },
                requestId,
                correlationId
              });
              updatedFlags.push(updated);
            }
          }

          const incident = store.recordLaunchControlIncident({
            incidentKey: body.incidentKey ?? null,
            signalType: body.signalType ?? "slo_breach",
            severity: body.severity ?? (shouldRollback ? "critical" : "high"),
            details: {
              breachReasons,
              thresholds: {
                burnRate: launchControlAutoRollbackBurnRateThreshold,
                errorRate: launchControlAutoRollbackErrorRateThreshold,
                webhookFailures: launchControlAutoRollbackWebhookFailureThreshold
              },
              observed: {
                burnRate: observedBurnRate,
                errorRate: observedErrorRate,
                webhookFailures: observedWebhookFailures
              },
              affectedFlags,
              deploymentRunId: body.deploymentRunId ?? null
            },
            autoRollbackApplied: shouldRollback,
            requestId,
            correlationId
          });
          sendJson(res, 200, {
            triggered: shouldRollback,
            breachReasons,
            incident,
            updatedFlags
          });
          return;
        }

        if (url.pathname === "/jobs/notification-dispatch") {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const body = await readJsonBody(req);
          const requestedLimit = body.limit === undefined ? resolvedNotificationDispatchLimit : Number(body.limit);
          const requestedMaxProcessingMs =
            body.maxProcessingMs === undefined
              ? resolvedNotificationDispatchMaxProcessingMs
              : Number(body.maxProcessingMs);
          if (
            !Number.isInteger(requestedLimit) ||
            requestedLimit <= 0 ||
            requestedLimit > notificationDispatchHardLimit
          ) {
            throw new StoreError(
              "validation",
              `limit must be an integer between 1 and ${notificationDispatchHardLimit}`
            );
          }
          if (
            !Number.isInteger(requestedMaxProcessingMs) ||
            requestedMaxProcessingMs <= 0 ||
            requestedMaxProcessingMs > 60000
          ) {
            throw new StoreError("validation", "maxProcessingMs must be an integer between 1 and 60000");
          }
          const result = store.processNotificationOutbox({
            nowAt: body.nowAt,
            limit: requestedLimit,
            maxProcessingMs: requestedMaxProcessingMs
          });
          incrementMetric("notification.dispatch.sent_total", {}, result.sentCount ?? 0);
          incrementMetric("notification.dispatch.failed_total", {}, result.failedCount ?? 0);
          incrementMetric(
            "notification.dispatch.delivered_user_notifications_total",
            {},
            result.deliveredNotificationCount ?? 0
          );
          sendJson(res, 200, result);
          return;
        }

        if (url.pathname === "/jobs/trust-operations/recompute") {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const body = await readJsonBody(req);
          let policy;
          let cohort;
          let policyVersionId = null;
          if (body.policyVersionId !== undefined && body.policyVersionId !== null) {
            const version = store.getTrustOpsPolicyVersion({ id: Number(body.policyVersionId) });
            policy = resolveTrustOpsPolicy(version.policy ?? {});
            cohort = resolveTrustOpsCohort(version.cohort ?? {});
            policyVersionId = version.id;
          } else {
            policy = resolveTrustOpsPolicy(body.policy ?? {});
            cohort = resolveTrustOpsCohort(body.cohort ?? {});
          }
          const requestedLimit = body.limit === undefined ? trustOpsRecomputeDefaultLimit : Number(body.limit);
          if (
            !Number.isInteger(requestedLimit) ||
            requestedLimit <= 0 ||
            requestedLimit > trustOpsRecomputeHardLimit
          ) {
            throw new StoreError(
              "validation",
              `limit must be an integer between 1 and ${trustOpsRecomputeHardLimit}`
            );
          }
          const apply = body.apply === undefined ? true : body.apply === true;
          const result = store.runTrustOperationsSweep({
            limit: requestedLimit,
            policy,
            cohort,
            apply,
            actorId: `admin:${currentUser.id}`,
            policyVersionId,
            requestId,
            correlationId
          });
          const recommendation = store.generateTrustOpsPolicyRecommendations({ lookbackHours: 168 });
          incrementMetric("trust_ops.triggered_total", {}, result.recommendations.hold ?? 0);
          incrementMetric("trust_ops.false_positive_review_total", {}, result.recommendations.clear ?? 0);
          incrementMetric("trust_ops.override_total", {}, result.applied.casesUpdated ?? 0);
          incrementMetric("trust_ops.protective_hold_applied_total", {}, result.applied.holds ?? 0);
          incrementMetric("trust_ops.protective_hold_cleared_total", {}, result.applied.clears ?? 0);
          sendJson(res, 200, {
            policy,
            cohort,
            apply,
            recommendation,
            ...result
          });
          return;
        }

        if (url.pathname === "/jobs/trust-operations/recovery/process") {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const body = await readJsonBody(req);
          const requestedLimit = body.limit === undefined ? 50 : Number(body.limit);
          if (!Number.isInteger(requestedLimit) || requestedLimit <= 0 || requestedLimit > 500) {
            throw new StoreError("validation", "limit must be an integer between 1 and 500");
          }
          const result = store.processTrustRecoveryJobs({
            limit: requestedLimit,
            actorId: `admin:${currentUser.id}`
          });
          sendJson(res, 200, result);
          return;
        }

        if (url.pathname === "/jobs/payment-reconciliation") {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const body = await readJsonBody(req);
          const requestedLimit =
            body.limit === undefined ? resolvedPaymentReconciliationLimit : Number(body.limit);
          if (
            !Number.isInteger(requestedLimit) ||
            requestedLimit <= 0 ||
            requestedLimit > paymentReconciliationHardLimit
          ) {
            throw new StoreError(
              "validation",
              `limit must be an integer between 1 and ${paymentReconciliationHardLimit}`
            );
          }
          const result = store.runPaymentReconciliation({
            limit: requestedLimit
          });
          for (const correction of result.corrections ?? []) {
            invalidateTransactionCache(correction.transactionId);
          }
          incrementMetric("payment.reconciliation.corrected_total", {}, result.correctedCount ?? 0);
          sendJson(res, 200, result);
          return;
        }
      }

      if (req.method === "GET" && url.pathname === "/") {
        sendJson(res, 200, { message: "GreJiJi API baseline is running" });
        return;
      }

      sendJson(res, 404, { error: "route not found" });
    } catch (error) {
      const statusCode = mapStoreErrorToStatusCode(error);
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      try {
        await appendErrorEvent({
          event: "request.error",
          requestId,
          method,
          path: url.pathname,
          statusCode,
          message: normalizedError.message,
          stack: normalizedError.stack,
          clientIp,
          authenticatedUserId: req.requestContext?.authenticatedUserId ?? null
        });
      } catch (writeError) {
        const writeErrorMessage = writeError instanceof Error ? writeError.message : String(writeError);
        logLine("error", {
          event: "error.log.write_failed",
          requestId,
          message: writeErrorMessage
        });
      }

      logLine("error", {
        event: "request.error",
        requestId,
        correlationId,
        method,
        path: url.pathname,
        statusCode,
        message: normalizedError.message,
        clientIp,
        authenticatedUserId: req.requestContext?.authenticatedUserId ?? null
      });

      if (statusCode === 500) {
        sendJson(res, 500, { error: "internal server error" });
        return;
      }

      sendJson(res, statusCode, { error: error.message });
    }
  };

  const server = http.createServer(requestHandler);
  const originalClose = server.close.bind(server);

  server.close = (callback) =>
    originalClose((error) => {
      store.close();
      if (callback) {
        callback(error);
      }
    });

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createServer();

  server.listen(port, host, () => {
    console.log(`grejiji-api listening on http://${host}:${port}`);
  });
}
