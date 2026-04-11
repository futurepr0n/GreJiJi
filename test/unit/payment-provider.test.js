import assert from "node:assert/strict";
import test from "node:test";

import { PaymentProviderError, createPaymentProvider } from "../../src/payment-provider.js";

test("createPaymentProvider(local) returns deterministic local capture/refund ids", async () => {
  const provider = createPaymentProvider({
    providerName: "local",
    localDefaultPaymentMethod: "pm_local_ci"
  });

  const captureOne = await provider.authorizeAndCapture({
    transactionId: "txn-unit-1",
    amountCents: 12000,
    currency: "USD",
    idempotencyKey: "capture-key-1"
  });

  const captureTwo = await provider.authorizeAndCapture({
    transactionId: "txn-unit-1",
    amountCents: 12000,
    currency: "USD",
    idempotencyKey: "capture-key-1"
  });

  assert.equal(captureOne.provider, "local");
  assert.equal(captureOne.status, "captured");
  assert.match(captureOne.paymentIntentId, /^pi_local_/);
  assert.match(captureOne.chargeId, /^ch_local_/);
  assert.equal(captureOne.raw.paymentMethod, "pm_local_ci");
  assert.equal(captureOne.paymentIntentId, captureTwo.paymentIntentId);
  assert.equal(captureOne.chargeId, captureTwo.chargeId);

  const refund = await provider.refund({
    transactionId: "txn-unit-1",
    amountCents: 12000,
    currency: "USD",
    idempotencyKey: "refund-key-1"
  });

  assert.equal(refund.provider, "local");
  assert.equal(refund.status, "succeeded");
  assert.match(refund.refundId, /^re_local_/);
});

test("createPaymentProvider(stripe) validates required secret key", () => {
  assert.throws(
    () => {
      createPaymentProvider({ providerName: "stripe", stripeSecretKey: "" });
    },
    (error) => {
      assert.ok(error instanceof PaymentProviderError);
      assert.equal(error.code, "payment_provider_misconfigured");
      assert.match(error.message, /STRIPE_SECRET_KEY is required/i);
      return true;
    }
  );
});

test("createPaymentProvider rejects unknown provider names", () => {
  assert.throws(
    () => {
      createPaymentProvider({ providerName: "unknown" });
    },
    (error) => {
      assert.ok(error instanceof PaymentProviderError);
      assert.equal(error.code, "payment_provider_misconfigured");
      assert.match(error.message, /PAYMENT_PROVIDER must be either 'local' or 'stripe'/);
      return true;
    }
  );
});
