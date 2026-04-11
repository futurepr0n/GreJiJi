function encodeForm(params) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        form.append(key, String(item));
      }
      continue;
    }
    form.append(key, String(value));
  }
  return form.toString();
}

function toShortHash(input) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export class PaymentProviderError extends Error {
  constructor(message, { code = "payment_provider_error", isTemporary = false, cause = null } = {}) {
    super(message);
    this.name = "PaymentProviderError";
    this.code = code;
    this.isTemporary = isTemporary;
    this.cause = cause;
  }
}

class LocalPaymentProvider {
  constructor({ defaultPaymentMethod = "pm_local_dev" } = {}) {
    this.name = "local";
    this.defaultPaymentMethod = defaultPaymentMethod;
  }

  async authorizeAndCapture({
    transactionId,
    amountCents,
    currency,
    idempotencyKey,
    metadata = {},
    requestId = null,
    correlationId = null
  }) {
    const hash = toShortHash(`${transactionId}:${idempotencyKey}:${amountCents}:${currency}`);
    const paymentIntentId = `pi_local_${hash}`;
    const chargeId = `ch_local_${hash}`;
    return {
      provider: this.name,
      paymentIntentId,
      chargeId,
      status: "captured",
      raw: {
        mode: "local",
        paymentMethod: this.defaultPaymentMethod,
        transactionId,
        amountCents,
        currency,
        metadata,
        requestId,
        correlationId
      }
    };
  }

  async refund({
    transactionId,
    amountCents,
    currency,
    idempotencyKey,
    reason = "requested_by_customer",
    requestId = null,
    correlationId = null
  }) {
    const hash = toShortHash(`${transactionId}:${idempotencyKey}:${amountCents}:${currency}:${reason}`);
    return {
      provider: this.name,
      refundId: `re_local_${hash}`,
      status: "succeeded",
      raw: {
        mode: "local",
        transactionId,
        amountCents,
        currency,
        reason,
        requestId,
        correlationId
      }
    };
  }
}

class StripePaymentProvider {
  constructor({ apiKey, apiBaseUrl = "https://api.stripe.com/v1", timeoutMs = 10000, defaultPaymentMethod }) {
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      throw new PaymentProviderError("STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER=stripe", {
        code: "payment_provider_misconfigured"
      });
    }

    this.name = "stripe";
    this.apiKey = apiKey.trim();
    this.apiBaseUrl = apiBaseUrl;
    this.timeoutMs = timeoutMs;
    this.defaultPaymentMethod = defaultPaymentMethod || "pm_card_visa";
  }

  async post(path, payload, idempotencyKey, { requestId = null, correlationId = null } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.apiBaseUrl}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/x-www-form-urlencoded",
          "idempotency-key": idempotencyKey,
          ...(requestId ? { "x-request-id": requestId } : {}),
          ...(correlationId ? { "x-correlation-id": correlationId } : {})
        },
        body: encodeForm(payload),
        signal: controller.signal
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = body?.error?.message || `Stripe request failed with status ${response.status}`;
        throw new PaymentProviderError(message, {
          code: body?.error?.code || "stripe_request_failed",
          isTemporary: response.status >= 500 || response.status === 429
        });
      }
      return body;
    } catch (error) {
      if (error instanceof PaymentProviderError) {
        throw error;
      }
      if (error && typeof error === "object" && error.name === "AbortError") {
        throw new PaymentProviderError("Stripe request timed out", {
          code: "stripe_timeout",
          isTemporary: true,
          cause: error
        });
      }
      throw new PaymentProviderError("Stripe request failed", {
        code: "stripe_network_error",
        isTemporary: true,
        cause: error
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async authorizeAndCapture({
    transactionId,
    amountCents,
    currency,
    idempotencyKey,
    metadata = {},
    requestId = null,
    correlationId = null
  }) {
    const payload = {
      amount: amountCents,
      currency: String(currency).toLowerCase(),
      confirm: "true",
      capture_method: "automatic",
      payment_method: this.defaultPaymentMethod,
      "automatic_payment_methods[enabled]": "false",
      "metadata[transaction_id]": transactionId
    };

    for (const [key, value] of Object.entries(metadata)) {
      payload[`metadata[${key}]`] = value;
    }
    if (requestId) {
      payload["metadata[request_id]"] = requestId;
    }
    if (correlationId) {
      payload["metadata[correlation_id]"] = correlationId;
    }

    const paymentIntent = await this.post("/payment_intents", payload, idempotencyKey, {
      requestId,
      correlationId
    });
    const chargeId = paymentIntent?.latest_charge ?? null;
    return {
      provider: this.name,
      paymentIntentId: paymentIntent.id,
      chargeId,
      status: paymentIntent.status,
      raw: paymentIntent
    };
  }

  async refund({
    transactionId,
    paymentIntentId,
    chargeId,
    amountCents,
    idempotencyKey,
    reason = "requested_by_customer",
    requestId = null,
    correlationId = null
  }) {
    const payload = {
      amount: amountCents,
      reason,
      "metadata[transaction_id]": transactionId
    };
    if (chargeId) {
      payload.charge = chargeId;
    } else if (paymentIntentId) {
      payload.payment_intent = paymentIntentId;
    } else {
      throw new PaymentProviderError(
        "Stripe refund requires chargeId or paymentIntentId on the transaction",
        {
          code: "stripe_missing_reference",
          isTemporary: false
        }
      );
    }

    if (requestId) {
      payload["metadata[request_id]"] = requestId;
    }
    if (correlationId) {
      payload["metadata[correlation_id]"] = correlationId;
    }

    const refund = await this.post("/refunds", payload, idempotencyKey, { requestId, correlationId });
    return {
      provider: this.name,
      refundId: refund.id,
      status: refund.status,
      raw: refund
    };
  }
}

function parseInteger(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new PaymentProviderError("payment timeout must be a positive integer", {
      code: "payment_provider_misconfigured"
    });
  }
  return parsed;
}

export function createPaymentProvider({
  providerName,
  stripeSecretKey,
  stripeApiBaseUrl,
  stripeTimeoutMs,
  stripeDefaultPaymentMethod,
  localDefaultPaymentMethod
}) {
  const normalized = String(providerName ?? "local").trim().toLowerCase();

  if (normalized === "local") {
    return new LocalPaymentProvider({ defaultPaymentMethod: localDefaultPaymentMethod });
  }

  if (normalized === "stripe") {
    return new StripePaymentProvider({
      apiKey: stripeSecretKey,
      apiBaseUrl: stripeApiBaseUrl,
      timeoutMs: parseInteger(stripeTimeoutMs, 10000),
      defaultPaymentMethod: stripeDefaultPaymentMethod
    });
  }

  throw new PaymentProviderError(
    "PAYMENT_PROVIDER must be either 'local' or 'stripe'",
    { code: "payment_provider_misconfigured" }
  );
}
