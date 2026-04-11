import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import Database from "better-sqlite3";

const VALID_STATUSES = new Set(["accepted", "disputed", "completed"]);
const VALID_ROLES = new Set(["buyer", "seller", "admin"]);
const VALID_ADJUDICATION_DECISIONS = new Set([
  "release_to_seller",
  "refund_to_buyer",
  "cancel_transaction"
]);
const VALID_EVENT_TYPES = new Set([
  "payment_captured",
  "buyer_confirmed",
  "dispute_opened",
  "dispute_resolved",
  "dispute_adjudicated",
  "settlement_completed",
  "settlement_refunded",
  "settlement_cancelled"
]);
const VALID_OUTBOX_STATUSES = new Set(["pending", "processing", "sent", "failed"]);
const VALID_NOTIFICATION_STATUSES = new Set(["unread", "read", "acknowledged"]);
const VALID_PROVIDER_WEBHOOK_EVENT_STATUSES = new Set(["received", "processed", "failed"]);
const VALID_RISK_SIGNAL_TYPES = new Set([
  "auth_failures",
  "velocity_anomaly",
  "payment_mismatch",
  "dispute_abuse",
  "webhook_abuse",
  "manual_review"
]);
const VALID_RISK_LEVELS = new Set(["low", "medium", "high"]);
const VALID_VERIFICATION_STATUSES = new Set(["unverified", "pending", "verified", "rejected"]);
const VALID_RISK_TIERS = new Set(["low", "medium", "high"]);
const VALID_RISK_TIER_SOURCES = new Set(["system", "override"]);
const VALID_RISK_OPERATOR_ACTION_TYPES = new Set([
  "hold",
  "unhold",
  "flag_account",
  "unflag_account",
  "require_verification",
  "clear_verification"
]);
const VALID_TRUST_OPS_CASE_STATUSES = new Set(["open", "in_review", "resolved"]);
const VALID_TRUST_OPS_RECOMMENDED_ACTIONS = new Set(["hold", "clear", "none"]);
const VALID_TRUST_OPS_SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const VALID_TRUST_OPS_PAYOUT_ACTIONS = new Set(["none", "hold", "reserve", "manual_review", "release"]);
const VALID_TRUST_OPS_INTERVENTION_STEPS = new Set([
  "none",
  "listing_throttle",
  "transaction_cooloff",
  "reserve_increase",
  "verification_rechallenge",
  "manual_review_gate"
]);
const VALID_TRUST_OPS_RECOVERY_STATUSES = new Set([
  "not_applicable",
  "queued",
  "processing",
  "completed",
  "failed"
]);
const VALID_TRUST_NETWORK_LINK_TYPES = new Set([
  "account",
  "device",
  "payment_instrument",
  "interaction_pattern",
  "fulfillment_endpoint",
  "communication_fingerprint",
  "listing_interaction"
]);
const VALID_TRUST_OPS_EVENT_TYPES = new Set([
  "case_created",
  "case_retriggered",
  "auto_hold_applied",
  "auto_hold_cleared",
  "operator_approved",
  "operator_overridden",
  "operator_cleared",
  "policy_simulated"
]);
const VALID_TRUST_LISTING_AUTH_SIGNAL_TYPES = new Set([
  "image_reuse",
  "duplicate_listing_cluster",
  "price_outlier",
  "seller_history_mismatch"
]);
const VALID_TRUST_REMEDIATION_ACTION_TYPES = new Set([
  "listing_quarantine",
  "offer_throttle",
  "account_capability_restriction",
  "payout_reserve_escalation",
  "remediation_unwind"
]);
const VALID_TRUST_BUYER_RISK_SIGNAL_TYPES = new Set([
  "payment_behavior",
  "messaging_intent",
  "dispute_history",
  "trust_history",
  "escrow_anomaly_forecast"
]);
const VALID_TRUST_PREEMPTION_ACTION_TYPES = new Set([
  "proactive_evidence_prompt",
  "milestone_confirmation_nudge",
  "conditional_hold_checkpoint",
  "conditional_release_checkpoint",
  "verification_step_up",
  "transaction_velocity_control",
  "temporary_settlement_delay",
  "preemption_unwind"
]);
const VALID_TRUST_REMEDIATION_CONFIDENCE_TIERS = new Set(["low", "medium", "high", "critical"]);
const VALID_TRUST_REMEDIATION_ACTION_STATUSES = new Set(["proposed", "applied", "rolled_back"]);
const VALID_TRUST_OPS_POLICY_STATUSES = new Set(["draft", "active", "retired"]);
const VALID_TRUST_OPS_FEEDBACK_TYPES = new Set([
  "operator_action",
  "dispute_outcome",
  "chargeback_outcome"
]);
const VALID_TRUST_STEP_UP_CHALLENGE_STATUSES = new Set(["pending", "passed", "failed", "expired"]);
const VALID_ACCOUNT_RECOVERY_STATUSES = new Set(["open", "resolved", "cancelled"]);
const VALID_ACCOUNT_RECOVERY_STAGES = new Set([
  "lockdown",
  "identity_reverification",
  "limited_restore",
  "full_restore"
]);
const VALID_TRUST_POLICY_GUARDRAIL_EVENT_TYPES = new Set([
  "evaluation_passed",
  "kill_switch_triggered",
  "rollback_applied"
]);
const VALID_LISTING_MODERATION_STATUSES = new Set([
  "pending_review",
  "approved",
  "rejected",
  "temporarily_hidden"
]);
const VALID_LAUNCH_CONTROL_FLAG_KEYS = new Set([
  "transaction_initiation",
  "payout_release",
  "dispute_auto_transitions",
  "moderation_auto_actions"
]);
const VALID_LAUNCH_CONTROL_SEVERITIES = new Set(["critical", "high", "medium", "low"]);

function ensureParentDirectory(filePath) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
}

function assertValidStatus(status) {
  if (!VALID_STATUSES.has(status)) {
    throw new Error(`Unexpected transaction status: ${status}`);
  }
}

function assertValidRole(role) {
  if (!VALID_ROLES.has(role)) {
    throw new Error(`Unexpected user role: ${role}`);
  }
}

function assertValidAdjudicationDecision(decision) {
  if (decision === null || decision === undefined) {
    return;
  }

  if (!VALID_ADJUDICATION_DECISIONS.has(decision)) {
    throw new Error(`Unexpected adjudication decision: ${decision}`);
  }
}

function toIsoString(value) {
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.valueOf())) {
      throw new Error("Invalid ISO datetime string");
    }
    return parsed.toISOString();
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.valueOf())) {
      throw new Error("Invalid date value");
    }
    return value.toISOString();
  }

  throw new Error("Datetime value must be a Date or ISO string");
}

function addHours(isoTimestamp, hours) {
  const source = new Date(isoTimestamp);
  source.setHours(source.getHours() + hours);
  return source.toISOString();
}

function normalizeCurrencyCode(currency) {
  if (typeof currency !== "string") {
    throw new StoreError("validation", "settlement currency must be a 3-letter ISO code");
  }
  const normalized = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new StoreError("validation", "settlement currency must be a 3-letter ISO code");
  }
  return normalized;
}

export class StoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StoreError";
    this.code = code;
  }
}

function mapTransaction(row) {
  if (!row) {
    return null;
  }

  assertValidStatus(row.status);
  assertValidAdjudicationDecision(row.adjudication_decision);

  return {
    id: row.id,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    amountCents: row.amount_cents,
    feeFixedCents: row.fee_fixed_cents,
    feeRateBps: row.fee_rate_bps,
    itemPrice: row.amount_cents,
    serviceFee: row.service_fee_cents,
    totalBuyerCharge: row.total_buyer_charge_cents,
    sellerNet: row.seller_net_cents,
    currency: row.currency_code,
    status: row.status,
    acceptedAt: row.accepted_at,
    autoReleaseDueAt: row.auto_release_due_at,
    buyerConfirmedAt: row.buyer_confirmed_at,
    autoReleasedAt: row.auto_released_at,
    payoutReleasedAt: row.payout_released_at,
    payoutReleaseReason: row.payout_release_reason,
    sellerCompletionAcknowledgedAt: row.seller_completion_acknowledged_at ?? null,
    disputeOpenedAt: row.dispute_opened_at,
    disputeResolvedAt: row.dispute_resolved_at,
    adjudicationDecision: row.adjudication_decision,
    adjudicationDecidedAt: row.adjudication_decided_at,
    adjudicationDecidedBy: row.adjudication_decided_by,
    adjudicationNotes: row.adjudication_notes,
    refundIssuedAt: row.refund_issued_at,
    cancelledAt: row.cancelled_at,
    settlementOutcome: row.settlement_outcome,
    settledBuyerCharge: row.settled_buyer_charge_cents,
    settledSellerPayout: row.settled_seller_payout_cents,
    settledPlatformFee: row.settled_platform_fee_cents,
    paymentProvider: row.payment_provider ?? "local",
    paymentStatus: row.payment_status ?? "captured",
    providerPaymentIntentId: row.provider_payment_intent_id ?? null,
    providerChargeId: row.provider_charge_id ?? null,
    providerLastRefundId: row.provider_last_refund_id ?? null,
    paymentReconciliation: parseJsonOrEmpty(row.payment_reconciliation_json),
    riskScore: Number(row.risk_score ?? 0),
    riskLevel: VALID_RISK_LEVELS.has(row.risk_level) ? row.risk_level : "low",
    riskFlags: Object.keys(parseJsonOrEmpty(row.risk_flags_json)),
    holdStatus: row.hold_status ?? "none",
    holdReason: row.hold_reason ?? null,
    holdAppliedAt: row.hold_applied_at ?? null,
    holdReleasedAt: row.hold_released_at ?? null,
    holdAppliedBy: row.hold_applied_by ?? null,
    holdReleasedBy: row.hold_released_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapUser(row) {
  if (!row) {
    return null;
  }

  assertValidRole(row.role);

  return {
    id: row.id,
    email: row.email,
    role: row.role,
    riskFlagged: Number(row.risk_flagged ?? 0) === 1,
    riskFlagReason: row.risk_flag_reason ?? null,
    riskFlagUpdatedAt: row.risk_flag_updated_at ?? null,
    verificationRequired: Number(row.verification_required ?? 0) === 1,
    verificationStatus: VALID_VERIFICATION_STATUSES.has(row.verification_status)
      ? row.verification_status
      : "unverified",
    verificationSubmittedAt: row.verification_submitted_at ?? null,
    verificationDecidedAt: row.verification_decided_at ?? null,
    verificationDecidedBy: row.verification_decided_by ?? null,
    verificationEvidence: parseJsonOrEmpty(row.verification_evidence_json),
    verificationReviewNotes: row.verification_review_notes ?? null,
    riskTier: VALID_RISK_TIERS.has(row.risk_tier) ? row.risk_tier : "low",
    riskTierSource: VALID_RISK_TIER_SOURCES.has(row.risk_tier_source) ? row.risk_tier_source : "system",
    riskTierOverrideReason: row.risk_tier_override_reason ?? null,
    riskTierUpdatedAt: row.risk_tier_updated_at ?? null,
    riskTierUpdatedBy: row.risk_tier_updated_by ?? null,
    lastLoginAt: row.last_login_at,
    passwordUpdatedAt: row.password_updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapListing(row) {
  if (!row) {
    return null;
  }

  const moderationStatus = VALID_LISTING_MODERATION_STATUSES.has(row.moderation_status)
    ? row.moderation_status
    : "approved";
  const photoUrls = parseJsonArrayOrEmpty(row.listing_photo_urls_json)
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
  const uploadedPhotos = parseJsonArrayOrEmpty(row.listing_uploaded_photos_json)
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      id: String(item.id ?? "").trim(),
      originalFileName: String(item.originalFileName ?? "").trim(),
      mimeType: String(item.mimeType ?? "").trim(),
      sizeBytes: Number(item.sizeBytes ?? 0),
      checksumSha256: String(item.checksumSha256 ?? "").trim(),
      downloadUrl: String(item.downloadUrl ?? "").trim(),
      createdAt: item.createdAt ?? null
    }))
    .filter((item) => {
      return (
        item.id &&
        item.originalFileName &&
        item.mimeType &&
        Number.isInteger(item.sizeBytes) &&
        item.sizeBytes >= 0 &&
        item.checksumSha256 &&
        item.downloadUrl
      );
    });
  return {
    id: row.id,
    sellerId: row.seller_id,
    title: row.title,
    description: row.description,
    priceCents: row.price_cents,
    category: row.category ?? null,
    itemCondition: row.item_condition ?? null,
    localArea: row.local_area,
    moderationStatus,
    moderationReasonCode: row.moderation_reason_code ?? null,
    moderationPublicReason: row.moderation_public_reason ?? null,
    moderationUpdatedAt: row.moderation_updated_at ?? null,
    moderationUpdatedBy: row.moderation_updated_by ?? null,
    photoUrls,
    uploadedPhotos,
    sellerFeedback:
      moderationStatus === "approved"
        ? null
        : {
            status: moderationStatus,
            reasonCode: row.moderation_reason_code ?? "moderation_action",
            message: row.moderation_public_reason ?? "Listing requires moderation action."
          },
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapListingModerationEvent(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    listingId: row.listing_id,
    fromStatus: row.from_status ?? null,
    toStatus: row.to_status,
    reasonCode: row.reason_code ?? null,
    publicReason: row.public_reason ?? null,
    internalNotes: row.internal_notes ?? null,
    source: row.source,
    actorId: row.actor_id,
    requestId: row.request_id ?? null,
    correlationId: row.correlation_id ?? null,
    createdAt: row.created_at
  };
}

function mapListingAbuseReport(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    listingId: row.listing_id,
    reporterUserId: row.reporter_user_id ?? null,
    reasonCode: row.reason_code,
    details: row.details ?? null,
    status: row.status,
    priorityScore: Number(row.priority_score ?? 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseJsonOrEmpty(value) {
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function parseJsonArrayOrEmpty(value) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapTransactionEvent(row) {
  if (!row) {
    return null;
  }

  if (!VALID_EVENT_TYPES.has(row.event_type)) {
    throw new Error(`Unexpected transaction event type: ${row.event_type}`);
  }

  return {
    id: row.id,
    transactionId: row.transaction_id,
    eventType: row.event_type,
    actorId: row.actor_id,
    occurredAt: row.occurred_at,
    payload: parseJsonOrEmpty(row.payload_json),
    createdAt: row.created_at
  };
}

function mapOutboxRecord(row) {
  if (!row) {
    return null;
  }

  if (!VALID_OUTBOX_STATUSES.has(row.status)) {
    throw new Error(`Unexpected outbox status: ${row.status}`);
  }

  return {
    id: row.id,
    transactionId: row.transaction_id,
    sourceEventId: row.source_event_id,
    topic: row.topic,
    recipientUserId: row.recipient_user_id,
    status: row.status,
    payload: parseJsonOrEmpty(row.payload_json),
    createdAt: row.created_at,
    availableAt: row.available_at,
    nextRetryAt: row.next_retry_at,
    attemptCount: row.attempt_count,
    lastAttemptAt: row.last_attempt_at,
    processingStartedAt: row.processing_started_at,
    processedAt: row.processed_at,
    sentAt: row.sent_at,
    failedAt: row.failed_at,
    failureReason: row.failure_reason
  };
}

function mapUserNotification(row) {
  if (!row) {
    return null;
  }

  if (!VALID_NOTIFICATION_STATUSES.has(row.status)) {
    throw new Error(`Unexpected notification status: ${row.status}`);
  }

  return {
    id: row.id,
    recipientUserId: row.recipient_user_id,
    transactionId: row.transaction_id,
    sourceEventId: row.source_event_id,
    sourceOutboxId: row.source_outbox_id,
    topic: row.topic,
    payload: parseJsonOrEmpty(row.payload_json),
    status: row.status,
    createdAt: row.created_at,
    readAt: row.read_at,
    acknowledgedAt: row.acknowledged_at,
    updatedAt: row.updated_at
  };
}

function mapDisputeEvidence(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    transactionId: row.transaction_id,
    uploaderUserId: row.uploader_user_id,
    originalFileName: row.original_file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    checksumSha256: row.checksum_sha256,
    storageKey: row.storage_key,
    createdAt: row.created_at
  };
}

function mapDisputeEvidenceIntegrity(row) {
  if (!row) {
    return null;
  }
  return {
    evidenceId: row.evidence_id,
    transactionId: row.transaction_id,
    metadataConsistencyScore: Number(row.metadata_consistency_score ?? 0),
    duplicateWithinTransaction: Number(row.duplicate_within_transaction ?? 0) === 1,
    replaySeenGlobally: Number(row.replay_seen_globally ?? 0) === 1,
    anomalyScore: Number(row.anomaly_score ?? 0),
    integrityFlags: parseJsonOrEmpty(row.integrity_flags_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapFulfillmentProof(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    transactionId: row.transaction_id,
    submittedBy: row.submitted_by,
    proofType: row.proof_type,
    artifactChecksumSha256: row.artifact_checksum_sha256 ?? null,
    metadata: parseJsonOrEmpty(row.metadata_json),
    recordedAt: row.recorded_at ?? null,
    integrityScore: Number(row.integrity_score ?? 0),
    anomalyScore: Number(row.anomaly_score ?? 0),
    replayDetected: Number(row.replay_detected ?? 0) === 1,
    createdAt: row.created_at
  };
}

function mapTransactionRating(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    transactionId: row.transaction_id,
    raterUserId: row.rater_user_id,
    rateeUserId: row.ratee_user_id,
    score: Number(row.score),
    comment: row.comment ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapProviderWebhookEvent(row) {
  if (!row) {
    return null;
  }

  if (!VALID_PROVIDER_WEBHOOK_EVENT_STATUSES.has(row.status)) {
    throw new Error(`Unexpected provider webhook event status: ${row.status}`);
  }

  return {
    id: Number(row.id),
    provider: row.provider,
    eventId: row.event_id,
    eventType: row.event_type,
    transactionId: row.transaction_id ?? null,
    occurredAt: row.occurred_at ?? null,
    status: row.status,
    deliveryCount: Number(row.delivery_count ?? 0),
    processingAttempts: Number(row.processing_attempts ?? 0),
    signatureValid: Number(row.signature_valid ?? 0) === 1,
    payload: parseJsonOrEmpty(row.payload_json),
    processingError: row.processing_error ?? null,
    firstReceivedAt: row.first_received_at,
    lastReceivedAt: row.last_received_at,
    processedAt: row.processed_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapRiskSignal(row) {
  if (!row) {
    return null;
  }
  if (!VALID_RISK_SIGNAL_TYPES.has(row.signal_type)) {
    throw new Error(`Unexpected risk signal type: ${row.signal_type}`);
  }
  return {
    id: Number(row.id),
    transactionId: row.transaction_id ?? null,
    userId: row.user_id ?? null,
    signalType: row.signal_type,
    severity: Number(row.severity),
    details: parseJsonOrEmpty(row.details_json),
    createdBy: row.created_by ?? null,
    correlationId: row.correlation_id ?? null,
    requestId: row.request_id ?? null,
    createdAt: row.created_at
  };
}

function mapRiskOperatorAction(row) {
  if (!row) {
    return null;
  }
  if (!VALID_RISK_OPERATOR_ACTION_TYPES.has(row.action_type)) {
    throw new Error(`Unexpected risk operator action type: ${row.action_type}`);
  }
  return {
    id: Number(row.id),
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    actionType: row.action_type,
    reason: row.reason ?? null,
    notes: row.notes ?? null,
    actorId: row.actor_id,
    correlationId: row.correlation_id ?? null,
    requestId: row.request_id ?? null,
    createdAt: row.created_at
  };
}

function mapIdentityVerificationEvent(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    userId: row.user_id,
    fromStatus: row.from_status ?? null,
    toStatus: row.to_status,
    actorId: row.actor_id,
    reason: row.reason ?? null,
    reviewNotes: row.review_notes ?? null,
    evidence: parseJsonOrEmpty(row.evidence_json),
    requestId: row.request_id ?? null,
    correlationId: row.correlation_id ?? null,
    createdAt: row.created_at
  };
}

function mapRiskTierEvent(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    userId: row.user_id,
    previousTier: row.previous_tier ?? null,
    nextTier: row.next_tier,
    source: row.source,
    actorId: row.actor_id ?? null,
    reason: row.reason ?? null,
    details: parseJsonOrEmpty(row.details_json),
    requestId: row.request_id ?? null,
    correlationId: row.correlation_id ?? null,
    createdAt: row.created_at
  };
}

function mapRiskLimitDecision(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    checkpoint: row.checkpoint,
    decision: row.decision,
    reasonCode: row.reason_code ?? null,
    transactionId: row.transaction_id ?? null,
    userId: row.user_id,
    amountCents: Number(row.amount_cents),
    dailyVolumeCents: Number(row.daily_volume_cents),
    maxTransactionCents: Number(row.max_transaction_cents),
    dailyVolumeCapCents: Number(row.daily_volume_cap_cents),
    cooldownHours: Number(row.cooldown_hours),
    cooldownUntil: row.cooldown_until ?? null,
    riskTier: row.risk_tier,
    verificationStatus: row.verification_status,
    policySnapshot: parseJsonOrEmpty(row.policy_snapshot_json),
    requestId: row.request_id ?? null,
    correlationId: row.correlation_id ?? null,
    createdAt: row.created_at
  };
}

function mapTrustOperationsCase(row) {
  if (!row) {
    return null;
  }
  if (!VALID_TRUST_OPS_CASE_STATUSES.has(row.status)) {
    throw new Error(`Unexpected trust operations case status: ${row.status}`);
  }
  if (!VALID_TRUST_OPS_RECOMMENDED_ACTIONS.has(row.recommended_action)) {
    throw new Error(`Unexpected trust operations recommended action: ${row.recommended_action}`);
  }
  const severity = VALID_TRUST_OPS_SEVERITIES.has(row.severity) ? row.severity : "medium";
  const payoutAction = VALID_TRUST_OPS_PAYOUT_ACTIONS.has(row.payout_action)
    ? row.payout_action
    : "none";
  const interventionLadderStep = VALID_TRUST_OPS_INTERVENTION_STEPS.has(row.intervention_ladder_step)
    ? row.intervention_ladder_step
    : "none";
  const recoveryStatus = VALID_TRUST_OPS_RECOVERY_STATUSES.has(row.recovery_status)
    ? row.recovery_status
    : "not_applicable";
  return {
    id: Number(row.id),
    transactionId: row.transaction_id,
    status: row.status,
    recommendedAction: row.recommended_action,
    reasonCode: row.reason_code ?? null,
    policySnapshot: parseJsonOrEmpty(row.policy_snapshot_json),
    triggeredBySignalId:
      row.triggered_by_signal_id === null || row.triggered_by_signal_id === undefined
        ? null
        : Number(row.triggered_by_signal_id),
    riskScoreAtTrigger: Number(row.risk_score_at_trigger ?? 0),
    sellerIntegrityScoreAtTrigger: Number(row.seller_integrity_score_at_trigger ?? 0),
    severity,
    priorityScore: Number(row.priority_score ?? 0),
    slaDueAt: row.sla_due_at ?? null,
    assignedInvestigatorId: row.assigned_investigator_id ?? null,
    claimedAt: row.claimed_at ?? null,
    firstActionAt: row.first_action_at ?? null,
    lastActionAt: row.last_action_at ?? null,
    falsePositiveFlag: Number(row.false_positive_flag ?? 0) === 1,
    payoutAction,
    payoutDecision: parseJsonOrEmpty(row.payout_decision_json),
    policyVersionId:
      row.policy_version_id === null || row.policy_version_id === undefined
        ? null
        : Number(row.policy_version_id),
    overrideExpiresAt: row.override_expires_at ?? null,
    holdExpiresAt: row.hold_expires_at ?? null,
    networkRiskScoreAtTrigger: Number(row.network_risk_score_at_trigger ?? 0),
    interventionLadderStep,
    clusterId: row.cluster_id ?? null,
    recoveryStatus,
    resolvedAt: row.resolved_at ?? null,
    resolvedBy: row.resolved_by ?? null,
    resolutionCode: row.resolution_code ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapTrustNetworkLink(row) {
  if (!row) {
    return null;
  }
  const linkType = VALID_TRUST_NETWORK_LINK_TYPES.has(row.link_type) ? row.link_type : "account";
  return {
    id: Number(row.id),
    clusterId: row.cluster_id,
    sourceEntityKey: row.source_entity_key,
    targetEntityKey: row.target_entity_key,
    linkType,
    confidenceScore: Number(row.confidence_score ?? 0),
    propagatedRiskScore: Number(row.propagated_risk_score ?? 0),
    decayExpiresAt: row.decay_expires_at ?? null,
    evidence: parseJsonOrEmpty(row.evidence_json),
    policyVersionId:
      row.policy_version_id === null || row.policy_version_id === undefined
        ? null
        : Number(row.policy_version_id),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapTrustClusterAction(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    caseId: Number(row.case_id),
    clusterId: row.cluster_id,
    actionType: row.action_type,
    reasonCode: row.reason_code,
    actorId: row.actor_id,
    details: parseJsonOrEmpty(row.details_json),
    createdAt: row.created_at
  };
}

function mapTrustRecoveryJob(row) {
  if (!row) {
    return null;
  }
  const status = ["queued", "processing", "completed", "failed"].includes(row.status)
    ? row.status
    : "queued";
  return {
    id: Number(row.id),
    caseId: Number(row.case_id),
    transactionId: row.transaction_id,
    status,
    reasonCode: row.reason_code,
    templateKey: row.template_key,
    payload: parseJsonOrEmpty(row.payload_json),
    scheduledFor: row.scheduled_for,
    slaDueAt: row.sla_due_at,
    processedAt: row.processed_at ?? null,
    failureReason: row.failure_reason ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapTrustListingAuthenticitySignal(row) {
  if (!row) {
    return null;
  }
  const signalType = VALID_TRUST_LISTING_AUTH_SIGNAL_TYPES.has(row.signal_type)
    ? row.signal_type
    : "price_outlier";
  return {
    id: Number(row.id),
    caseId: row.case_id === null || row.case_id === undefined ? null : Number(row.case_id),
    transactionId: row.transaction_id,
    listingId: row.listing_id ?? null,
    sellerId: row.seller_id,
    signalType,
    reasonCode: row.reason_code,
    confidenceScore: Number(row.confidence_score ?? 0),
    signalDetails: parseJsonOrEmpty(row.signal_details_json),
    policyVersionId:
      row.policy_version_id === null || row.policy_version_id === undefined
        ? null
        : Number(row.policy_version_id),
    createdBy: row.created_by,
    createdAt: row.created_at
  };
}

function mapTrustCaseRemediationAction(row) {
  if (!row) {
    return null;
  }
  const actionType = VALID_TRUST_REMEDIATION_ACTION_TYPES.has(row.action_type)
    ? row.action_type
    : "offer_throttle";
  const confidenceTier = VALID_TRUST_REMEDIATION_CONFIDENCE_TIERS.has(row.confidence_tier)
    ? row.confidence_tier
    : "low";
  const status = VALID_TRUST_REMEDIATION_ACTION_STATUSES.has(row.status)
    ? row.status
    : "proposed";
  return {
    id: Number(row.id),
    caseId: Number(row.case_id),
    transactionId: row.transaction_id,
    actionType,
    confidenceTier,
    status,
    reasonCode: row.reason_code,
    policyVersionId:
      row.policy_version_id === null || row.policy_version_id === undefined
        ? null
        : Number(row.policy_version_id),
    machineDecision: parseJsonOrEmpty(row.machine_decision_json),
    humanDecision: parseJsonOrEmpty(row.human_decision_json),
    rollbackOfActionId:
      row.rollback_of_action_id === null || row.rollback_of_action_id === undefined
        ? null
        : Number(row.rollback_of_action_id),
    auditChainHash: row.audit_chain_hash,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapTrustBuyerRiskSignal(row) {
  if (!row) {
    return null;
  }
  const signalType = VALID_TRUST_BUYER_RISK_SIGNAL_TYPES.has(row.signal_type)
    ? row.signal_type
    : "payment_behavior";
  return {
    id: Number(row.id),
    caseId: row.case_id === null || row.case_id === undefined ? null : Number(row.case_id),
    transactionId: row.transaction_id,
    buyerId: row.buyer_id,
    signalType,
    reasonCode: row.reason_code,
    featureWeight: Number(row.feature_weight ?? 0),
    featureValue: Number(row.feature_value ?? 0),
    contributionScore: Number(row.contribution_score ?? 0),
    signalDetails: parseJsonOrEmpty(row.signal_details_json),
    policyVersionId:
      row.policy_version_id === null || row.policy_version_id === undefined
        ? null
        : Number(row.policy_version_id),
    createdBy: row.created_by,
    createdAt: row.created_at
  };
}

function mapTrustDisputePreemptionAction(row) {
  if (!row) {
    return null;
  }
  const actionType = VALID_TRUST_PREEMPTION_ACTION_TYPES.has(row.action_type)
    ? row.action_type
    : "proactive_evidence_prompt";
  const confidenceTier = VALID_TRUST_REMEDIATION_CONFIDENCE_TIERS.has(row.confidence_tier)
    ? row.confidence_tier
    : "low";
  const status = VALID_TRUST_REMEDIATION_ACTION_STATUSES.has(row.status)
    ? row.status
    : "proposed";
  return {
    id: Number(row.id),
    caseId: Number(row.case_id),
    transactionId: row.transaction_id,
    actionType,
    confidenceTier,
    status,
    reasonCode: row.reason_code,
    policyVersionId:
      row.policy_version_id === null || row.policy_version_id === undefined
        ? null
        : Number(row.policy_version_id),
    machineDecision: parseJsonOrEmpty(row.machine_decision_json),
    humanDecision: parseJsonOrEmpty(row.human_decision_json),
    rollbackOfActionId:
      row.rollback_of_action_id === null || row.rollback_of_action_id === undefined
        ? null
        : Number(row.rollback_of_action_id),
    auditChainHash: row.audit_chain_hash,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapTrustStepUpChallenge(row) {
  if (!row) {
    return null;
  }
  const status = VALID_TRUST_STEP_UP_CHALLENGE_STATUSES.has(row.status) ? row.status : "pending";
  return {
    id: Number(row.id),
    caseId: Number(row.case_id),
    transactionId: row.transaction_id,
    userId: row.user_id,
    status,
    reasonCode: row.reason_code,
    challengeType: row.challenge_type,
    evidence: parseJsonOrEmpty(row.evidence_json),
    createdBy: row.created_by,
    resolvedBy: row.resolved_by ?? null,
    resolvedAt: row.resolved_at ?? null,
    expiresAt: row.expires_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapAccountRecoveryCase(row) {
  if (!row) {
    return null;
  }
  const status = VALID_ACCOUNT_RECOVERY_STATUSES.has(row.status) ? row.status : "open";
  const stage = VALID_ACCOUNT_RECOVERY_STAGES.has(row.stage) ? row.stage : "lockdown";
  return {
    id: Number(row.id),
    userId: row.user_id,
    status,
    stage,
    compromiseSignal: parseJsonOrEmpty(row.compromise_signal_json),
    requiredApprovalActorId: row.required_approval_actor_id ?? null,
    approvedByActorId: row.approved_by_actor_id ?? null,
    approvedAt: row.approved_at ?? null,
    decisionNotes: row.decision_notes ?? null,
    restoredCapabilities: parseJsonOrEmpty(row.restored_capabilities_json),
    createdBy: row.created_by,
    resolvedBy: row.resolved_by ?? null,
    resolvedAt: row.resolved_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapPayoutRiskAction(row) {
  if (!row) {
    return null;
  }
  const actionType = VALID_TRUST_OPS_PAYOUT_ACTIONS.has(row.action_type) ? row.action_type : "none";
  return {
    id: Number(row.id),
    transactionId: row.transaction_id,
    caseId: row.case_id === null || row.case_id === undefined ? null : Number(row.case_id),
    sellerId: row.seller_id,
    actionType,
    reservePercent: row.reserve_percent === null || row.reserve_percent === undefined ? null : Number(row.reserve_percent),
    holdHours: row.hold_hours === null || row.hold_hours === undefined ? null : Number(row.hold_hours),
    reviewRequired: Number(row.review_required ?? 0) === 1,
    reasonCode: row.reason_code,
    source: row.source,
    policyVersionId:
      row.policy_version_id === null || row.policy_version_id === undefined
        ? null
        : Number(row.policy_version_id),
    policySnapshot: parseJsonOrEmpty(row.policy_snapshot_json),
    actorId: row.actor_id,
    overrideExpiresAt: row.override_expires_at ?? null,
    metadata: parseJsonOrEmpty(row.metadata_json),
    createdAt: row.created_at
  };
}

function mapTrustOperationsCaseEvent(row) {
  if (!row) {
    return null;
  }
  if (!VALID_TRUST_OPS_EVENT_TYPES.has(row.event_type)) {
    throw new Error(`Unexpected trust operations case event type: ${row.event_type}`);
  }
  return {
    id: Number(row.id),
    caseId: Number(row.case_id),
    transactionId: row.transaction_id,
    eventType: row.event_type,
    actorId: row.actor_id,
    reasonCode: row.reason_code ?? null,
    details: parseJsonOrEmpty(row.details_json),
    createdAt: row.created_at
  };
}

function mapTrustOpsPolicyVersion(row) {
  if (!row) {
    return null;
  }
  if (!VALID_TRUST_OPS_POLICY_STATUSES.has(row.status)) {
    throw new Error(`Unexpected trust operations policy status: ${row.status}`);
  }
  return {
    id: Number(row.id),
    name: row.name,
    status: row.status,
    activationWindowStartAt: row.activation_window_start_at ?? null,
    activationWindowEndAt: row.activation_window_end_at ?? null,
    policy: parseJsonOrEmpty(row.policy_json),
    cohort: parseJsonOrEmpty(row.cohort_json),
    createdBy: row.created_by,
    activatedBy: row.activated_by ?? null,
    activatedAt: row.activated_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapTrustOpsPolicyFeedback(row) {
  if (!row) {
    return null;
  }
  if (!VALID_TRUST_OPS_FEEDBACK_TYPES.has(row.feedback_type)) {
    throw new Error(`Unexpected trust operations feedback type: ${row.feedback_type}`);
  }
  return {
    id: Number(row.id),
    transactionId: row.transaction_id ?? null,
    caseId: row.case_id === null || row.case_id === undefined ? null : Number(row.case_id),
    feedbackType: row.feedback_type,
    outcome: row.outcome,
    source: row.source,
    actorId: row.actor_id ?? null,
    details: parseJsonOrEmpty(row.details_json),
    createdAt: row.created_at
  };
}

function mapTrustOperationsCaseNote(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    caseId: Number(row.case_id),
    transactionId: row.transaction_id,
    note: row.note,
    authorId: row.author_id,
    createdAt: row.created_at
  };
}

function mapTrustPolicyGuardrailEvent(row) {
  if (!row) {
    return null;
  }
  if (!VALID_TRUST_POLICY_GUARDRAIL_EVENT_TYPES.has(row.event_type)) {
    throw new Error(`Unexpected trust policy guardrail event type: ${row.event_type}`);
  }
  return {
    id: Number(row.id),
    policyVersionId:
      row.policy_version_id === null || row.policy_version_id === undefined
        ? null
        : Number(row.policy_version_id),
    eventType: row.event_type,
    reasonCode: row.reason_code,
    metricsSnapshot: parseJsonOrEmpty(row.metrics_snapshot_json),
    actorId: row.actor_id,
    createdAt: row.created_at
  };
}

function mapLaunchControlFlag(row) {
  if (!row) {
    return null;
  }
  if (!VALID_LAUNCH_CONTROL_FLAG_KEYS.has(row.key)) {
    throw new Error(`Unexpected launch control flag key: ${row.key}`);
  }
  return {
    key: row.key,
    enabled: Number(row.enabled ?? 0) === 1,
    rolloutPercentage: Number(row.rollout_percentage ?? 100),
    allowlistUserIds: parseJsonOrEmpty(row.allowlist_user_ids_json),
    regionAllowlist: parseJsonOrEmpty(row.region_allowlist_json),
    environment: row.environment ?? null,
    reason: row.reason ?? null,
    deploymentRunId: row.deployment_run_id ?? null,
    metadata: parseJsonOrEmpty(row.metadata_json),
    updatedBy: row.updated_by ?? null,
    updatedAt: row.updated_at
  };
}

function mapLaunchControlAuditEvent(row) {
  if (!row) {
    return null;
  }
  if (!VALID_LAUNCH_CONTROL_FLAG_KEYS.has(row.flag_key)) {
    throw new Error(`Unexpected launch control audit flag key: ${row.flag_key}`);
  }
  return {
    id: Number(row.id),
    flagKey: row.flag_key,
    previousEnabled:
      row.previous_enabled === null || row.previous_enabled === undefined
        ? null
        : Number(row.previous_enabled) === 1,
    nextEnabled: Number(row.next_enabled ?? 0) === 1,
    previousRolloutPercentage:
      row.previous_rollout_percentage === null || row.previous_rollout_percentage === undefined
        ? null
        : Number(row.previous_rollout_percentage),
    nextRolloutPercentage: Number(row.next_rollout_percentage ?? 100),
    previousAllowlistUserIds: parseJsonOrEmpty(row.previous_allowlist_user_ids_json),
    nextAllowlistUserIds: parseJsonOrEmpty(row.next_allowlist_user_ids_json),
    previousRegionAllowlist: parseJsonOrEmpty(row.previous_region_allowlist_json),
    nextRegionAllowlist: parseJsonOrEmpty(row.next_region_allowlist_json),
    actorId: row.actor_id,
    reason: row.reason ?? null,
    source: row.source,
    deploymentRunId: row.deployment_run_id ?? null,
    metadata: parseJsonOrEmpty(row.metadata_json),
    correlationId: row.correlation_id ?? null,
    requestId: row.request_id ?? null,
    createdAt: row.created_at
  };
}

function mapLaunchControlIncident(row) {
  if (!row) {
    return null;
  }
  if (!VALID_LAUNCH_CONTROL_SEVERITIES.has(row.severity)) {
    throw new Error(`Unexpected launch control severity: ${row.severity}`);
  }
  return {
    id: Number(row.id),
    incidentKey: row.incident_key ?? null,
    signalType: row.signal_type,
    severity: row.severity,
    details: parseJsonOrEmpty(row.details_json),
    autoRollbackApplied: Number(row.auto_rollback_applied ?? 0) === 1,
    correlationId: row.correlation_id ?? null,
    requestId: row.request_id ?? null,
    createdAt: row.created_at
  };
}

function addMinutes(isoTimestamp, minutes) {
  const source = new Date(isoTimestamp);
  source.setMinutes(source.getMinutes() + minutes);
  return source.toISOString();
}

function calculateSettlementAmounts({
  amountCents,
  serviceFeeFixedCents,
  serviceFeeRateBps,
  currency
}) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new StoreError("validation", "amountCents must be a positive integer");
  }

  const serviceFeeCents =
    serviceFeeFixedCents + Math.round((amountCents * serviceFeeRateBps) / 10000);
  if (serviceFeeCents < 0) {
    throw new StoreError("validation", "service fee cannot be negative");
  }

  const totalBuyerChargeCents = amountCents + serviceFeeCents;
  const sellerNetCents = amountCents;
  return {
    amountCents,
    itemPriceCents: amountCents,
    serviceFeeCents,
    totalBuyerChargeCents,
    sellerNetCents,
    currency
  };
}

export function createTransactionStore({
  databasePath,
  migrationsDirectory,
  releaseTimeoutHours = 72,
  serviceFeeFixedCents = 0,
  serviceFeeRateBps = 0,
  settlementCurrency = "USD",
  dispatchNotification = () => {},
  now = () => new Date()
}) {
  ensureParentDirectory(databasePath);

  if (!Number.isInteger(serviceFeeFixedCents) || serviceFeeFixedCents < 0) {
    throw new StoreError("validation", "serviceFeeFixedCents must be a non-negative integer");
  }
  if (!Number.isInteger(serviceFeeRateBps) || serviceFeeRateBps < 0) {
    throw new StoreError("validation", "serviceFeeRateBps must be a non-negative integer");
  }
  const normalizedSettlementCurrency = normalizeCurrencyCode(settlementCurrency);

  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const migrationFiles = fs
    .readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const hasMigration = db.prepare("SELECT 1 FROM schema_migrations WHERE name = ?");
  const applyMigrationRecord = db.prepare(
    "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)"
  );

  for (const migrationFile of migrationFiles) {
    const existing = hasMigration.get(migrationFile);
    if (existing) {
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDirectory, migrationFile), "utf8");
    db.exec(sql);
    applyMigrationRecord.run(migrationFile, now().toISOString());
  }

  const insertTransaction = db.prepare(`
    INSERT INTO transactions (
      id,
      buyer_id,
      seller_id,
      amount_cents,
      fee_fixed_cents,
      fee_rate_bps,
      service_fee_cents,
      total_buyer_charge_cents,
      seller_net_cents,
      currency_code,
      payment_provider,
      payment_status,
      provider_payment_intent_id,
      provider_charge_id,
      payment_reconciliation_json,
      status,
      accepted_at,
      auto_release_due_at,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @buyer_id,
      @seller_id,
      @amount_cents,
      @fee_fixed_cents,
      @fee_rate_bps,
      @service_fee_cents,
      @total_buyer_charge_cents,
      @seller_net_cents,
      @currency_code,
      @payment_provider,
      @payment_status,
      @provider_payment_intent_id,
      @provider_charge_id,
      @payment_reconciliation_json,
      'accepted',
      @accepted_at,
      @auto_release_due_at,
      @created_at,
      @updated_at
    )
  `);

  const getTransactionByIdQuery = db.prepare("SELECT * FROM transactions WHERE id = ?");
  const insertTransactionEvent = db.prepare(`
    INSERT INTO transaction_events (
      transaction_id,
      event_type,
      actor_id,
      occurred_at,
      payload_json,
      created_at
    ) VALUES (
      @transaction_id,
      @event_type,
      @actor_id,
      @occurred_at,
      @payload_json,
      @created_at
    )
  `);
  const listTransactionEventsByTransactionId = db.prepare(`
    SELECT *
    FROM transaction_events
    WHERE transaction_id = ?
    ORDER BY occurred_at ASC, id ASC
  `);
  const upsertPaymentOperation = db.prepare(`
    INSERT INTO payment_operations (
      transaction_id,
      operation,
      provider,
      idempotency_key,
      status,
      external_reference,
      error_code,
      error_message,
      response_json,
      created_at,
      updated_at
    ) VALUES (
      @transaction_id,
      @operation,
      @provider,
      @idempotency_key,
      @status,
      @external_reference,
      @error_code,
      @error_message,
      @response_json,
      @created_at,
      @updated_at
    )
    ON CONFLICT(transaction_id, operation, idempotency_key) DO UPDATE SET
      status = excluded.status,
      provider = excluded.provider,
      external_reference = excluded.external_reference,
      error_code = excluded.error_code,
      error_message = excluded.error_message,
      response_json = excluded.response_json,
      updated_at = excluded.updated_at
  `);
  const upsertProviderWebhookEvent = db.prepare(`
    INSERT INTO provider_webhook_events (
      provider,
      event_id,
      event_type,
      transaction_id,
      occurred_at,
      status,
      signature_valid,
      payload_json,
      processing_error,
      first_received_at,
      last_received_at,
      created_at,
      updated_at
    ) VALUES (
      @provider,
      @event_id,
      @event_type,
      @transaction_id,
      @occurred_at,
      @status,
      @signature_valid,
      @payload_json,
      @processing_error,
      @first_received_at,
      @last_received_at,
      @created_at,
      @updated_at
    )
    ON CONFLICT(provider, event_id) DO UPDATE SET
      event_type = excluded.event_type,
      transaction_id = COALESCE(excluded.transaction_id, provider_webhook_events.transaction_id),
      occurred_at = COALESCE(excluded.occurred_at, provider_webhook_events.occurred_at),
      delivery_count = provider_webhook_events.delivery_count + 1,
      signature_valid = CASE
        WHEN excluded.signature_valid = 1 THEN 1
        ELSE provider_webhook_events.signature_valid
      END,
      payload_json = excluded.payload_json,
      status = CASE
        WHEN provider_webhook_events.status = 'processed' THEN 'processed'
        WHEN excluded.status = 'failed' THEN 'failed'
        ELSE 'received'
      END,
      processing_error = CASE
        WHEN excluded.status = 'failed' THEN excluded.processing_error
        ELSE provider_webhook_events.processing_error
      END,
      last_received_at = excluded.last_received_at,
      updated_at = excluded.updated_at
  `);
  const getProviderWebhookEventByProviderAndEventId = db.prepare(`
    SELECT *
    FROM provider_webhook_events
    WHERE provider = @provider
      AND event_id = @event_id
    LIMIT 1
  `);
  const getProviderWebhookEventById = db.prepare(`
    SELECT *
    FROM provider_webhook_events
    WHERE id = @id
    LIMIT 1
  `);
  const listProviderWebhookEventsAll = db.prepare(`
    SELECT *
    FROM provider_webhook_events
    ORDER BY updated_at DESC, id DESC
    LIMIT @limit
  `);
  const listProviderWebhookEventsByStatus = db.prepare(`
    SELECT *
    FROM provider_webhook_events
    WHERE status = @status
    ORDER BY updated_at DESC, id DESC
    LIMIT @limit
  `);
  const listProviderWebhookEventsByProvider = db.prepare(`
    SELECT *
    FROM provider_webhook_events
    WHERE provider = @provider
    ORDER BY updated_at DESC, id DESC
    LIMIT @limit
  `);
  const listProviderWebhookEventsByProviderAndStatus = db.prepare(`
    SELECT *
    FROM provider_webhook_events
    WHERE provider = @provider
      AND status = @status
    ORDER BY updated_at DESC, id DESC
    LIMIT @limit
  `);
  const markProviderWebhookEventProcessed = db.prepare(`
    UPDATE provider_webhook_events
    SET
      status = 'processed',
      processing_attempts = processing_attempts + 1,
      processing_error = NULL,
      processed_at = @processed_at,
      updated_at = @updated_at
    WHERE provider = @provider
      AND event_id = @event_id
      AND status != 'processed'
  `);
  const markProviderWebhookEventFailed = db.prepare(`
    UPDATE provider_webhook_events
    SET
      status = 'failed',
      processing_attempts = processing_attempts + 1,
      processing_error = @processing_error,
      updated_at = @updated_at
    WHERE provider = @provider
      AND event_id = @event_id
      AND status != 'processed'
  `);
  const markProviderWebhookEventReceivedById = db.prepare(`
    UPDATE provider_webhook_events
    SET
      status = 'received',
      processing_error = NULL,
      updated_at = @updated_at
    WHERE id = @id
      AND status = 'failed'
  `);
  const listProcessedProviderWebhookEventsForTransaction = db.prepare(`
    SELECT *
    FROM provider_webhook_events
    WHERE transaction_id = @transaction_id
      AND status = 'processed'
      AND event_type IN (
        'payment_intent.succeeded',
        'charge.succeeded',
        'payment_intent.payment_failed',
        'charge.failed',
        'refund.succeeded',
        'charge.refunded',
        'charge.dispute.created',
        'charge.dispute.closed'
      )
    ORDER BY COALESCE(occurred_at, last_received_at) DESC, id DESC
  `);
  const listTransactionsWithProcessedWebhookEvents = db.prepare(`
    SELECT DISTINCT t.id
    FROM transactions t
    INNER JOIN provider_webhook_events e
      ON e.transaction_id = t.id
    WHERE e.status = 'processed'
    ORDER BY t.updated_at ASC, t.id ASC
    LIMIT @limit
  `);
  const updateTransactionPaymentFromWebhook = db.prepare(`
    UPDATE transactions
    SET
      payment_status = @payment_status,
      provider_payment_intent_id = COALESCE(@provider_payment_intent_id, provider_payment_intent_id),
      provider_charge_id = COALESCE(@provider_charge_id, provider_charge_id),
      provider_last_refund_id = COALESCE(@provider_last_refund_id, provider_last_refund_id),
      payment_reconciliation_json = @payment_reconciliation_json,
      updated_at = @updated_at
    WHERE id = @id
  `);
  const insertDisputeEvidence = db.prepare(`
    INSERT INTO dispute_evidence (
      id,
      transaction_id,
      uploader_user_id,
      original_file_name,
      mime_type,
      size_bytes,
      checksum_sha256,
      storage_key,
      created_at
    ) VALUES (
      @id,
      @transaction_id,
      @uploader_user_id,
      @original_file_name,
      @mime_type,
      @size_bytes,
      @checksum_sha256,
      @storage_key,
      @created_at
    )
  `);
  const listDisputeEvidenceByTransactionId = db.prepare(`
    SELECT *
    FROM dispute_evidence
    WHERE transaction_id = ?
    ORDER BY created_at ASC, id ASC
  `);
  const getDisputeEvidenceById = db.prepare(`
    SELECT *
    FROM dispute_evidence
    WHERE id = ?
  `);
  const countDisputeEvidenceByTransactionChecksum = db.prepare(`
    SELECT COUNT(1) AS count
    FROM dispute_evidence
    WHERE transaction_id = @transaction_id
      AND checksum_sha256 = @checksum_sha256
  `);
  const countDisputeEvidenceByChecksum = db.prepare(`
    SELECT COUNT(1) AS count
    FROM dispute_evidence
    WHERE checksum_sha256 = @checksum_sha256
  `);
  const upsertDisputeEvidenceIntegrity = db.prepare(`
    INSERT INTO dispute_evidence_integrity (
      evidence_id,
      transaction_id,
      metadata_consistency_score,
      duplicate_within_transaction,
      replay_seen_globally,
      anomaly_score,
      integrity_flags_json,
      created_at,
      updated_at
    ) VALUES (
      @evidence_id,
      @transaction_id,
      @metadata_consistency_score,
      @duplicate_within_transaction,
      @replay_seen_globally,
      @anomaly_score,
      @integrity_flags_json,
      @created_at,
      @updated_at
    )
    ON CONFLICT(evidence_id) DO UPDATE SET
      metadata_consistency_score = excluded.metadata_consistency_score,
      duplicate_within_transaction = excluded.duplicate_within_transaction,
      replay_seen_globally = excluded.replay_seen_globally,
      anomaly_score = excluded.anomaly_score,
      integrity_flags_json = excluded.integrity_flags_json,
      updated_at = excluded.updated_at
  `);
  const getDisputeEvidenceIntegrityByEvidenceId = db.prepare(`
    SELECT *
    FROM dispute_evidence_integrity
    WHERE evidence_id = @evidence_id
    LIMIT 1
  `);
  const listDisputeEvidenceIntegrityByTransaction = db.prepare(`
    SELECT *
    FROM dispute_evidence_integrity
    WHERE transaction_id = @transaction_id
    ORDER BY updated_at DESC, evidence_id DESC
    LIMIT @limit
  `);
  const insertFulfillmentProof = db.prepare(`
    INSERT INTO fulfillment_proofs (
      id,
      transaction_id,
      submitted_by,
      proof_type,
      artifact_checksum_sha256,
      metadata_json,
      recorded_at,
      integrity_score,
      anomaly_score,
      replay_detected,
      created_at
    ) VALUES (
      @id,
      @transaction_id,
      @submitted_by,
      @proof_type,
      @artifact_checksum_sha256,
      @metadata_json,
      @recorded_at,
      @integrity_score,
      @anomaly_score,
      @replay_detected,
      @created_at
    )
  `);
  const listFulfillmentProofsByTransaction = db.prepare(`
    SELECT *
    FROM fulfillment_proofs
    WHERE transaction_id = @transaction_id
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const countFulfillmentProofByChecksum = db.prepare(`
    SELECT COUNT(1) AS count
    FROM fulfillment_proofs
    WHERE artifact_checksum_sha256 = @artifact_checksum_sha256
  `);
  const countFulfillmentProofByTransactionChecksum = db.prepare(`
    SELECT COUNT(1) AS count
    FROM fulfillment_proofs
    WHERE transaction_id = @transaction_id
      AND artifact_checksum_sha256 = @artifact_checksum_sha256
  `);
  const listDisputeQueueRows = db.prepare(`
    SELECT
      t.*,
      COALESCE(ev.evidence_count, 0) AS evidence_count,
      ev.latest_evidence_at
    FROM transactions t
    LEFT JOIN (
      SELECT
        transaction_id,
        COUNT(1) AS evidence_count,
        MAX(created_at) AS latest_evidence_at
      FROM dispute_evidence
      GROUP BY transaction_id
    ) ev ON ev.transaction_id = t.id
    WHERE t.dispute_opened_at IS NOT NULL
    ORDER BY t.updated_at DESC, t.id DESC
  `);

  const insertOutboxRecord = db.prepare(`
    INSERT INTO notification_outbox (
      transaction_id,
      source_event_id,
      topic,
      recipient_user_id,
      status,
      payload_json,
      created_at,
      available_at
    ) VALUES (
      @transaction_id,
      @source_event_id,
      @topic,
      @recipient_user_id,
      'pending',
      @payload_json,
      @created_at,
      @available_at
    )
  `);
  const listPendingOutboxRecords = db.prepare(`
    SELECT *
    FROM notification_outbox
    WHERE status = 'pending'
      AND transaction_id = @transaction_id
    ORDER BY id ASC
  `);
  const listDispatchableOutboxRecords = db.prepare(`
    SELECT *
    FROM notification_outbox
    WHERE status IN ('pending', 'failed')
      AND available_at <= @now_at
      AND (next_retry_at IS NULL OR next_retry_at <= @now_at)
    ORDER BY id ASC
    LIMIT @limit
  `);
  const countPendingOrFailedOutboxRecords = db.prepare(`
    SELECT COUNT(1) AS count
    FROM notification_outbox
    WHERE status IN ('pending', 'failed')
  `);
  const countOutboxRecordsByStatus = db.prepare(`
    SELECT COUNT(1) AS count
    FROM notification_outbox
    WHERE status = @status
  `);
  const getOutboxRecordById = db.prepare("SELECT * FROM notification_outbox WHERE id = ?");
  const markOutboxRecordProcessing = db.prepare(`
    UPDATE notification_outbox
    SET
      status = 'processing',
      processing_started_at = @processing_started_at,
      last_attempt_at = @last_attempt_at,
      attempt_count = COALESCE(attempt_count, 0) + 1,
      failure_reason = NULL,
      updated_at = @updated_at
    WHERE id = @id
      AND status IN ('pending', 'failed')
      AND (next_retry_at IS NULL OR next_retry_at <= @processing_started_at)
  `);
  const markOutboxRecordSent = db.prepare(`
    UPDATE notification_outbox
    SET
      status = 'sent',
      sent_at = @sent_at,
      processed_at = @processed_at,
      next_retry_at = NULL,
      failure_reason = NULL,
      failed_at = NULL,
      updated_at = @updated_at
    WHERE id = @id
      AND status = 'processing'
  `);
  const markOutboxRecordFailed = db.prepare(`
    UPDATE notification_outbox
    SET
      status = 'failed',
      failed_at = @failed_at,
      processed_at = @processed_at,
      next_retry_at = @next_retry_at,
      failure_reason = @failure_reason,
      updated_at = @updated_at
    WHERE id = @id
      AND status = 'processing'
  `);
  const insertUserNotification = db.prepare(`
    INSERT INTO user_notifications (
      recipient_user_id,
      transaction_id,
      source_event_id,
      source_outbox_id,
      topic,
      payload_json,
      status,
      created_at,
      updated_at
    ) VALUES (
      @recipient_user_id,
      @transaction_id,
      @source_event_id,
      @source_outbox_id,
      @topic,
      @payload_json,
      'unread',
      @created_at,
      @updated_at
    )
    ON CONFLICT(source_outbox_id) DO NOTHING
  `);
  const listNotificationsByUserId = db.prepare(`
    SELECT *
    FROM user_notifications
    WHERE recipient_user_id = @recipient_user_id
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const getNotificationById = db.prepare(`
    SELECT *
    FROM user_notifications
    WHERE id = @id
  `);
  const markNotificationRead = db.prepare(`
    UPDATE user_notifications
    SET
      status = CASE WHEN status = 'acknowledged' THEN status ELSE 'read' END,
      read_at = COALESCE(read_at, @read_at),
      updated_at = @updated_at
    WHERE id = @id
      AND recipient_user_id = @recipient_user_id
  `);
  const markNotificationAcknowledged = db.prepare(`
    UPDATE user_notifications
    SET
      status = 'acknowledged',
      read_at = COALESCE(read_at, @read_at),
      acknowledged_at = COALESCE(acknowledged_at, @acknowledged_at),
      updated_at = @updated_at
    WHERE id = @id
      AND recipient_user_id = @recipient_user_id
  `);

  const markConfirmed = db.prepare(`
    UPDATE transactions
    SET
      status = 'completed',
      buyer_confirmed_at = @buyer_confirmed_at,
      payout_released_at = @payout_released_at,
      payout_release_reason = 'buyer_confirmation',
      settlement_outcome = 'completed',
      settled_buyer_charge_cents = total_buyer_charge_cents,
      settled_seller_payout_cents = seller_net_cents,
      settled_platform_fee_cents = service_fee_cents,
      updated_at = @updated_at
    WHERE id = @id
      AND status = 'accepted'
      AND hold_status != 'held'
      AND payout_released_at IS NULL
      AND settlement_outcome IS NULL
      AND (dispute_opened_at IS NULL OR dispute_resolved_at IS NOT NULL)
  `);

  const markSellerCompletionAcknowledged = db.prepare(`
    UPDATE transactions
    SET
      seller_completion_acknowledged_at = @seller_completion_acknowledged_at,
      updated_at = @updated_at
    WHERE id = @id
      AND status = 'completed'
      AND seller_completion_acknowledged_at IS NULL
  `);

  const insertTransactionRating = db.prepare(`
    INSERT INTO transaction_ratings (
      id,
      transaction_id,
      rater_user_id,
      ratee_user_id,
      score,
      comment,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @transaction_id,
      @rater_user_id,
      @ratee_user_id,
      @score,
      @comment,
      @created_at,
      @updated_at
    )
  `);
  const listTransactionRatingsByTransactionId = db.prepare(`
    SELECT *
    FROM transaction_ratings
    WHERE transaction_id = @transaction_id
    ORDER BY created_at ASC, id ASC
  `);
  const listTransactionRatingsByRateeUserId = db.prepare(`
    SELECT *
    FROM transaction_ratings
    WHERE ratee_user_id = @ratee_user_id
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const getReputationSummaryByUserId = db.prepare(`
    SELECT
      COUNT(1) AS rating_count,
      AVG(score) AS average_score,
      MIN(score) AS min_score,
      MAX(score) AS max_score
    FROM transaction_ratings
    WHERE ratee_user_id = @ratee_user_id
  `);

  const openDisputeStatement = db.prepare(`
    UPDATE transactions
    SET
      status = 'disputed',
      dispute_opened_at = @dispute_opened_at,
      dispute_resolved_at = NULL,
      updated_at = @updated_at
    WHERE id = @id
      AND status = 'accepted'
      AND hold_status != 'held'
      AND payout_released_at IS NULL
  `);

  const resolveDisputeStatement = db.prepare(`
    UPDATE transactions
    SET
      status = 'accepted',
      dispute_resolved_at = @dispute_resolved_at,
      updated_at = @updated_at
    WHERE id = @id
      AND status = 'disputed'
      AND hold_status != 'held'
  `);

  const findEligibleAutoReleaseIds = db.prepare(`
    SELECT id
    FROM transactions
    WHERE status = 'accepted'
      AND hold_status != 'held'
      AND payout_released_at IS NULL
      AND auto_release_due_at <= ?
      AND (dispute_opened_at IS NULL OR dispute_resolved_at IS NOT NULL)
    ORDER BY accepted_at ASC
  `);

  const markAutoReleased = db.prepare(`
    UPDATE transactions
    SET
      status = 'completed',
      auto_released_at = @auto_released_at,
      payout_released_at = @payout_released_at,
      payout_release_reason = 'auto_release',
      settlement_outcome = 'completed',
      settled_buyer_charge_cents = total_buyer_charge_cents,
      settled_seller_payout_cents = seller_net_cents,
      settled_platform_fee_cents = service_fee_cents,
      updated_at = @updated_at
    WHERE id = @id
      AND status = 'accepted'
      AND hold_status != 'held'
      AND payout_released_at IS NULL
      AND settlement_outcome IS NULL
  `);
  const delayAutoRelease = db.prepare(`
    UPDATE transactions
    SET
      auto_release_due_at = @auto_release_due_at,
      updated_at = @updated_at
    WHERE id = @id
      AND status = 'accepted'
      AND hold_status != 'held'
      AND payout_released_at IS NULL
      AND settlement_outcome IS NULL
  `);

  const adjudicateToReleaseSellerStatement = db.prepare(`
    UPDATE transactions
    SET
      status = 'completed',
      dispute_resolved_at = @dispute_resolved_at,
      adjudication_decision = 'release_to_seller',
      adjudication_decided_at = @adjudication_decided_at,
      adjudication_decided_by = @adjudication_decided_by,
      adjudication_notes = @adjudication_notes,
      payout_released_at = @payout_released_at,
      payout_release_reason = 'dispute_adjudication_release_to_seller',
      refund_issued_at = NULL,
      cancelled_at = NULL,
      settlement_outcome = 'completed',
      settled_buyer_charge_cents = total_buyer_charge_cents,
      settled_seller_payout_cents = seller_net_cents,
      settled_platform_fee_cents = service_fee_cents,
      payment_status = 'captured',
      updated_at = @updated_at
    WHERE id = @id
      AND status = 'disputed'
      AND hold_status != 'held'
      AND payout_released_at IS NULL
      AND adjudication_decision IS NULL
      AND settlement_outcome IS NULL
  `);

  const adjudicateToRefundBuyerStatement = db.prepare(`
    UPDATE transactions
    SET
      status = 'completed',
      dispute_resolved_at = @dispute_resolved_at,
      adjudication_decision = 'refund_to_buyer',
      adjudication_decided_at = @adjudication_decided_at,
      adjudication_decided_by = @adjudication_decided_by,
      adjudication_notes = @adjudication_notes,
      payout_released_at = NULL,
      payout_release_reason = NULL,
      refund_issued_at = @refund_issued_at,
      cancelled_at = NULL,
      settlement_outcome = 'refunded',
      settled_buyer_charge_cents = 0,
      settled_seller_payout_cents = 0,
      settled_platform_fee_cents = 0,
      payment_status = 'refunded',
      provider_last_refund_id = @provider_last_refund_id,
      payment_reconciliation_json = @payment_reconciliation_json,
      updated_at = @updated_at
    WHERE id = @id
      AND status = 'disputed'
      AND hold_status != 'held'
      AND payout_released_at IS NULL
      AND adjudication_decision IS NULL
      AND settlement_outcome IS NULL
  `);

  const adjudicateToCancelTransactionStatement = db.prepare(`
    UPDATE transactions
    SET
      status = 'completed',
      dispute_resolved_at = @dispute_resolved_at,
      adjudication_decision = 'cancel_transaction',
      adjudication_decided_at = @adjudication_decided_at,
      adjudication_decided_by = @adjudication_decided_by,
      adjudication_notes = @adjudication_notes,
      payout_released_at = NULL,
      payout_release_reason = NULL,
      refund_issued_at = NULL,
      cancelled_at = @cancelled_at,
      settlement_outcome = 'cancelled',
      settled_buyer_charge_cents = 0,
      settled_seller_payout_cents = 0,
      settled_platform_fee_cents = 0,
      payment_status = 'refunded',
      provider_last_refund_id = @provider_last_refund_id,
      payment_reconciliation_json = @payment_reconciliation_json,
      updated_at = @updated_at
    WHERE id = @id
      AND status = 'disputed'
      AND hold_status != 'held'
      AND payout_released_at IS NULL
      AND adjudication_decision IS NULL
      AND settlement_outcome IS NULL
  `);

  const insertUser = db.prepare(`
    INSERT INTO users (
      id,
      email,
      role,
      password_hash,
      password_salt,
      password_updated_at,
      last_login_at,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @email,
      @role,
      @password_hash,
      @password_salt,
      @password_updated_at,
      NULL,
      @created_at,
      @updated_at
    )
  `);

  const getUserByEmail = db.prepare("SELECT * FROM users WHERE email = ?");
  const getUserById = db.prepare("SELECT * FROM users WHERE id = ?");
  const pingStatement = db.prepare("SELECT 1 AS ok");
  const updateUserRiskControls = db.prepare(`
    UPDATE users
    SET
      risk_flagged = @risk_flagged,
      risk_flag_reason = @risk_flag_reason,
      risk_flag_updated_at = @risk_flag_updated_at,
      verification_required = @verification_required,
      updated_at = @updated_at
    WHERE id = @id
  `);
  const updateUserVerificationProfile = db.prepare(`
    UPDATE users
    SET
      verification_status = @verification_status,
      verification_submitted_at = @verification_submitted_at,
      verification_decided_at = @verification_decided_at,
      verification_decided_by = @verification_decided_by,
      verification_evidence_json = @verification_evidence_json,
      verification_review_notes = @verification_review_notes,
      updated_at = @updated_at
    WHERE id = @id
  `);
  const insertIdentityVerificationEvent = db.prepare(`
    INSERT INTO identity_verification_events (
      user_id,
      from_status,
      to_status,
      actor_id,
      reason,
      review_notes,
      evidence_json,
      request_id,
      correlation_id,
      created_at
    ) VALUES (
      @user_id,
      @from_status,
      @to_status,
      @actor_id,
      @reason,
      @review_notes,
      @evidence_json,
      @request_id,
      @correlation_id,
      @created_at
    )
  `);
  const listIdentityVerificationEventsByUser = db.prepare(`
    SELECT *
    FROM identity_verification_events
    WHERE user_id = @user_id
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const listUsersByVerificationStatus = db.prepare(`
    SELECT *
    FROM users
    WHERE verification_status = @verification_status
    ORDER BY verification_submitted_at ASC, created_at ASC, id ASC
    LIMIT @limit
  `);
  const updateUserRiskTierProfile = db.prepare(`
    UPDATE users
    SET
      risk_tier = @risk_tier,
      risk_tier_source = @risk_tier_source,
      risk_tier_override_reason = @risk_tier_override_reason,
      risk_tier_updated_at = @risk_tier_updated_at,
      risk_tier_updated_by = @risk_tier_updated_by,
      updated_at = @updated_at
    WHERE id = @id
  `);
  const insertRiskTierEvent = db.prepare(`
    INSERT INTO risk_tier_events (
      user_id,
      previous_tier,
      next_tier,
      source,
      actor_id,
      reason,
      details_json,
      request_id,
      correlation_id,
      created_at
    ) VALUES (
      @user_id,
      @previous_tier,
      @next_tier,
      @source,
      @actor_id,
      @reason,
      @details_json,
      @request_id,
      @correlation_id,
      @created_at
    )
  `);
  const listRiskTierEventsByUser = db.prepare(`
    SELECT *
    FROM risk_tier_events
    WHERE user_id = @user_id
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const insertRiskSignal = db.prepare(`
    INSERT INTO risk_signals (
      transaction_id,
      user_id,
      signal_type,
      severity,
      details_json,
      created_by,
      correlation_id,
      request_id,
      created_at
    ) VALUES (
      @transaction_id,
      @user_id,
      @signal_type,
      @severity,
      @details_json,
      @created_by,
      @correlation_id,
      @request_id,
      @created_at
    )
  `);
  const listRiskSignalsAll = db.prepare(`
    SELECT *
    FROM risk_signals
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const listRiskSignalsByTransaction = db.prepare(`
    SELECT *
    FROM risk_signals
    WHERE transaction_id = @transaction_id
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const listRiskSignalsByUser = db.prepare(`
    SELECT *
    FROM risk_signals
    WHERE user_id = @user_id
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const listRiskSignalsBySignalType = db.prepare(`
    SELECT *
    FROM risk_signals
    WHERE signal_type = @signal_type
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const listRiskSignalsByTransactionAndUser = db.prepare(`
    SELECT *
    FROM risk_signals
    WHERE transaction_id = @transaction_id
      AND user_id = @user_id
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const listRiskSignalsByTransactionAndSignalType = db.prepare(`
    SELECT *
    FROM risk_signals
    WHERE transaction_id = @transaction_id
      AND signal_type = @signal_type
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const listRiskSignalsByUserAndSignalType = db.prepare(`
    SELECT *
    FROM risk_signals
    WHERE user_id = @user_id
      AND signal_type = @signal_type
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const listRiskSignalsByTransactionUserAndSignalType = db.prepare(`
    SELECT *
    FROM risk_signals
    WHERE transaction_id = @transaction_id
      AND user_id = @user_id
      AND signal_type = @signal_type
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const sumRiskSeverityByTransaction = db.prepare(`
    SELECT COALESCE(SUM(severity), 0) AS total_severity
    FROM risk_signals
    WHERE transaction_id = @transaction_id
  `);
  const sumRiskSeverityByUser = db.prepare(`
    SELECT COALESCE(SUM(severity), 0) AS total_severity
    FROM risk_signals
    WHERE user_id = @user_id
  `);
  const listRiskSignalTypesByTransaction = db.prepare(`
    SELECT DISTINCT signal_type
    FROM risk_signals
    WHERE transaction_id = @transaction_id
    ORDER BY signal_type ASC
  `);
  const updateTransactionRiskProfile = db.prepare(`
    UPDATE transactions
    SET
      risk_score = @risk_score,
      risk_level = @risk_level,
      risk_flags_json = @risk_flags_json,
      updated_at = @updated_at
    WHERE id = @id
  `);
  const insertRiskOperatorAction = db.prepare(`
    INSERT INTO risk_operator_actions (
      subject_type,
      subject_id,
      action_type,
      reason,
      notes,
      actor_id,
      correlation_id,
      request_id,
      created_at
    ) VALUES (
      @subject_type,
      @subject_id,
      @action_type,
      @reason,
      @notes,
      @actor_id,
      @correlation_id,
      @request_id,
      @created_at
    )
  `);
  const listRiskOperatorActionsBySubject = db.prepare(`
    SELECT *
    FROM risk_operator_actions
    WHERE subject_type = @subject_type
      AND subject_id = @subject_id
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const listRecentTransactionsForTrustOps = db.prepare(`
    SELECT *
    FROM transactions
    WHERE status IN ('accepted', 'disputed')
    ORDER BY updated_at DESC, id DESC
    LIMIT @limit
  `);
  const countSellerDisputesSince = db.prepare(`
    SELECT COUNT(1) AS count
    FROM transactions
    WHERE seller_id = @seller_id
      AND dispute_opened_at IS NOT NULL
      AND dispute_opened_at >= @since_at
  `);
  const countSellerHighRiskTransactionsSince = db.prepare(`
    SELECT COUNT(1) AS count
    FROM transactions
    WHERE seller_id = @seller_id
      AND risk_score >= @min_risk_score
      AND created_at >= @since_at
  `);
  const countSellerCompletedTransactionsSince = db.prepare(`
    SELECT COUNT(1) AS count
    FROM transactions
    WHERE seller_id = @seller_id
      AND status = 'completed'
      AND created_at >= @since_at
  `);
  const countSellerChargebackFeedbackSince = db.prepare(`
    SELECT COUNT(1) AS count
    FROM trust_ops_policy_feedback f
    JOIN transactions t
      ON t.id = f.transaction_id
    WHERE t.seller_id = @seller_id
      AND f.feedback_type = 'chargeback_outcome'
      AND f.created_at >= @since_at
      AND (
        lower(f.outcome) LIKE '%chargeback%'
        OR lower(f.outcome) LIKE '%won_by_buyer%'
      )
  `);
  const countSellerModerationRejectsSince = db.prepare(`
    SELECT COUNT(1) AS count
    FROM listing_moderation_events e
    JOIN listings l
      ON l.id = e.listing_id
    WHERE l.seller_id = @seller_id
      AND e.created_at >= @since_at
      AND e.to_status IN ('rejected', 'temporarily_hidden')
  `);
  const upsertSellerIntegrityProfile = db.prepare(`
    INSERT INTO seller_integrity_profiles (
      user_id,
      integrity_score,
      reason_factors_json,
      computed_at,
      updated_at
    ) VALUES (
      @user_id,
      @integrity_score,
      @reason_factors_json,
      @computed_at,
      @updated_at
    )
    ON CONFLICT(user_id) DO UPDATE SET
      integrity_score = excluded.integrity_score,
      reason_factors_json = excluded.reason_factors_json,
      computed_at = excluded.computed_at,
      updated_at = excluded.updated_at
  `);
  const getSellerIntegrityProfileByUser = db.prepare(`
    SELECT *
    FROM seller_integrity_profiles
    WHERE user_id = @user_id
    LIMIT 1
  `);
  const insertTrustOpsPolicyVersion = db.prepare(`
    INSERT INTO trust_ops_policy_versions (
      name,
      status,
      activation_window_start_at,
      activation_window_end_at,
      policy_json,
      cohort_json,
      created_by,
      activated_by,
      activated_at,
      created_at,
      updated_at
    ) VALUES (
      @name,
      @status,
      @activation_window_start_at,
      @activation_window_end_at,
      @policy_json,
      @cohort_json,
      @created_by,
      @activated_by,
      @activated_at,
      @created_at,
      @updated_at
    )
  `);
  const updateTrustOpsPolicyVersionStatus = db.prepare(`
    UPDATE trust_ops_policy_versions
    SET
      status = @status,
      activated_by = @activated_by,
      activated_at = @activated_at,
      updated_at = @updated_at
    WHERE id = @id
  `);
  const retireActiveTrustOpsPolicies = db.prepare(`
    UPDATE trust_ops_policy_versions
    SET
      status = 'retired',
      updated_at = @updated_at
    WHERE status = 'active'
      AND id != @id
  `);
  const getTrustOpsPolicyVersionById = db.prepare(`
    SELECT *
    FROM trust_ops_policy_versions
    WHERE id = @id
    LIMIT 1
  `);
  const listTrustOpsPolicyVersionsAll = db.prepare(`
    SELECT *
    FROM trust_ops_policy_versions
    ORDER BY updated_at DESC, id DESC
    LIMIT @limit
  `);
  const listTrustOpsPolicyVersionsByStatus = db.prepare(`
    SELECT *
    FROM trust_ops_policy_versions
    WHERE status = @status
    ORDER BY updated_at DESC, id DESC
    LIMIT @limit
  `);
  const getActiveTrustOpsPolicyVersion = db.prepare(`
    SELECT *
    FROM trust_ops_policy_versions
    WHERE status = 'active'
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `);
  const insertTrustOperationsCase = db.prepare(`
    INSERT INTO trust_operations_cases (
      transaction_id,
      status,
      recommended_action,
      reason_code,
      policy_snapshot_json,
      triggered_by_signal_id,
      risk_score_at_trigger,
      seller_integrity_score_at_trigger,
      severity,
      priority_score,
      sla_due_at,
      assigned_investigator_id,
      claimed_at,
      first_action_at,
      last_action_at,
      false_positive_flag,
      payout_action,
      payout_decision_json,
      policy_version_id,
      override_expires_at,
      hold_expires_at,
      created_at,
      updated_at
    ) VALUES (
      @transaction_id,
      @status,
      @recommended_action,
      @reason_code,
      @policy_snapshot_json,
      @triggered_by_signal_id,
      @risk_score_at_trigger,
      @seller_integrity_score_at_trigger,
      @severity,
      @priority_score,
      @sla_due_at,
      @assigned_investigator_id,
      @claimed_at,
      @first_action_at,
      @last_action_at,
      @false_positive_flag,
      @payout_action,
      @payout_decision_json,
      @policy_version_id,
      @override_expires_at,
      @hold_expires_at,
      @created_at,
      @updated_at
    )
  `);
  const updateTrustOperationsCase = db.prepare(`
    UPDATE trust_operations_cases
    SET
      status = @status,
      recommended_action = @recommended_action,
      reason_code = @reason_code,
      policy_snapshot_json = @policy_snapshot_json,
      triggered_by_signal_id = @triggered_by_signal_id,
      risk_score_at_trigger = @risk_score_at_trigger,
      seller_integrity_score_at_trigger = @seller_integrity_score_at_trigger,
      severity = @severity,
      priority_score = @priority_score,
      sla_due_at = @sla_due_at,
      assigned_investigator_id = @assigned_investigator_id,
      claimed_at = @claimed_at,
      first_action_at = @first_action_at,
      last_action_at = @last_action_at,
      false_positive_flag = @false_positive_flag,
      payout_action = @payout_action,
      payout_decision_json = @payout_decision_json,
      policy_version_id = @policy_version_id,
      override_expires_at = @override_expires_at,
      hold_expires_at = @hold_expires_at,
      resolved_at = @resolved_at,
      resolved_by = @resolved_by,
      resolution_code = @resolution_code,
      updated_at = @updated_at
    WHERE id = @id
  `);
  const getTrustOperationsCaseById = db.prepare(`
    SELECT *
    FROM trust_operations_cases
    WHERE id = @id
    LIMIT 1
  `);
  const getActiveTrustOperationsCaseByTransaction = db.prepare(`
    SELECT *
    FROM trust_operations_cases
    WHERE transaction_id = @transaction_id
      AND status IN ('open', 'in_review')
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `);
  const listTrustOperationsCasesAll = db.prepare(`
    SELECT *
    FROM trust_operations_cases
    ORDER BY priority_score DESC, sla_due_at ASC, updated_at DESC, id DESC
    LIMIT @limit
  `);
  const listTrustOperationsCasesByStatus = db.prepare(`
    SELECT *
    FROM trust_operations_cases
    WHERE status = @status
    ORDER BY priority_score DESC, sla_due_at ASC, updated_at DESC, id DESC
    LIMIT @limit
  `);
  const listTrustOperationsCasesByTransaction = db.prepare(`
    SELECT *
    FROM trust_operations_cases
    WHERE transaction_id = @transaction_id
    ORDER BY updated_at DESC, id DESC
    LIMIT @limit
  `);
  const claimTrustOperationsCase = db.prepare(`
    UPDATE trust_operations_cases
    SET
      assigned_investigator_id = @assigned_investigator_id,
      claimed_at = CASE
        WHEN claimed_at IS NULL THEN @claimed_at
        ELSE claimed_at
      END,
      first_action_at = CASE
        WHEN first_action_at IS NULL THEN @first_action_at
        ELSE first_action_at
      END,
      last_action_at = @last_action_at,
      updated_at = @updated_at
    WHERE id = @id
  `);
  const insertTrustOperationsCaseNote = db.prepare(`
    INSERT INTO trust_operations_case_notes (
      case_id,
      transaction_id,
      note,
      author_id,
      created_at
    ) VALUES (
      @case_id,
      @transaction_id,
      @note,
      @author_id,
      @created_at
    )
  `);
  const listTrustOperationsCaseNotesByCase = db.prepare(`
    SELECT *
    FROM trust_operations_case_notes
    WHERE case_id = @case_id
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const insertTrustOpsPolicyFeedback = db.prepare(`
    INSERT INTO trust_ops_policy_feedback (
      transaction_id,
      case_id,
      feedback_type,
      outcome,
      source,
      actor_id,
      details_json,
      created_at
    ) VALUES (
      @transaction_id,
      @case_id,
      @feedback_type,
      @outcome,
      @source,
      @actor_id,
      @details_json,
      @created_at
    )
  `);
  const listTrustOpsPolicyFeedbackByCreated = db.prepare(`
    SELECT *
    FROM trust_ops_policy_feedback
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const listTrustOpsPolicyFeedbackSince = db.prepare(`
    SELECT *
    FROM trust_ops_policy_feedback
    WHERE created_at >= @since_at
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const countAppealOverturnFeedbackSince = db.prepare(`
    SELECT COUNT(1) AS count
    FROM trust_ops_policy_feedback
    WHERE feedback_type = 'dispute_outcome'
      AND lower(outcome) LIKE '%appeal_overturned%'
      AND created_at >= @since_at
  `);
  const countAppealFeedbackSince = db.prepare(`
    SELECT COUNT(1) AS count
    FROM trust_ops_policy_feedback
    WHERE feedback_type = 'dispute_outcome'
      AND lower(outcome) LIKE '%appeal%'
      AND created_at >= @since_at
  `);
  const insertTrustPolicyGuardrailEvent = db.prepare(`
    INSERT INTO trust_policy_guardrail_events (
      policy_version_id,
      event_type,
      reason_code,
      metrics_snapshot_json,
      actor_id,
      created_at
    ) VALUES (
      @policy_version_id,
      @event_type,
      @reason_code,
      @metrics_snapshot_json,
      @actor_id,
      @created_at
    )
  `);
  const listTrustPolicyGuardrailEventsByPolicy = db.prepare(`
    SELECT *
    FROM trust_policy_guardrail_events
    WHERE policy_version_id = @policy_version_id
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const countTrustPolicyGuardrailRollbacksByPolicySince = db.prepare(`
    SELECT policy_version_id, COUNT(1) AS count
    FROM trust_policy_guardrail_events
    WHERE event_type = 'rollback_applied'
      AND created_at >= @since_at
    GROUP BY policy_version_id
  `);
  const insertPayoutRiskAction = db.prepare(`
    INSERT INTO payout_risk_actions (
      transaction_id,
      case_id,
      seller_id,
      action_type,
      reserve_percent,
      hold_hours,
      review_required,
      reason_code,
      source,
      policy_version_id,
      policy_snapshot_json,
      actor_id,
      override_expires_at,
      metadata_json,
      created_at
    ) VALUES (
      @transaction_id,
      @case_id,
      @seller_id,
      @action_type,
      @reserve_percent,
      @hold_hours,
      @review_required,
      @reason_code,
      @source,
      @policy_version_id,
      @policy_snapshot_json,
      @actor_id,
      @override_expires_at,
      @metadata_json,
      @created_at
    )
  `);
  const listPayoutRiskActionsByCase = db.prepare(`
    SELECT *
    FROM payout_risk_actions
    WHERE case_id = @case_id
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const listPayoutRiskActionsSince = db.prepare(`
    SELECT *
    FROM payout_risk_actions
    WHERE created_at >= @since_at
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const upsertTrustNetworkLink = db.prepare(`
    INSERT INTO trust_network_links (
      cluster_id,
      source_entity_key,
      target_entity_key,
      link_type,
      confidence_score,
      propagated_risk_score,
      decay_expires_at,
      evidence_json,
      policy_version_id,
      created_by,
      created_at,
      updated_at
    ) VALUES (
      @cluster_id,
      @source_entity_key,
      @target_entity_key,
      @link_type,
      @confidence_score,
      @propagated_risk_score,
      @decay_expires_at,
      @evidence_json,
      @policy_version_id,
      @created_by,
      @created_at,
      @updated_at
    )
    ON CONFLICT(source_entity_key, target_entity_key, link_type) DO UPDATE SET
      cluster_id = excluded.cluster_id,
      confidence_score = excluded.confidence_score,
      propagated_risk_score = excluded.propagated_risk_score,
      decay_expires_at = excluded.decay_expires_at,
      evidence_json = excluded.evidence_json,
      policy_version_id = excluded.policy_version_id,
      created_by = excluded.created_by,
      updated_at = excluded.updated_at
  `);
  const listTrustNetworkLinksByCluster = db.prepare(`
    SELECT *
    FROM trust_network_links
    WHERE cluster_id = @cluster_id
    ORDER BY updated_at DESC, id DESC
    LIMIT @limit
  `);
  const listTrustNetworkLinksByEntity = db.prepare(`
    SELECT *
    FROM trust_network_links
    WHERE source_entity_key = @entity_key
       OR target_entity_key = @entity_key
    ORDER BY updated_at DESC, id DESC
    LIMIT @limit
  `);
  const updateTrustOperationsCaseV6Context = db.prepare(`
    UPDATE trust_operations_cases
    SET
      network_risk_score_at_trigger = @network_risk_score_at_trigger,
      intervention_ladder_step = @intervention_ladder_step,
      cluster_id = @cluster_id,
      recovery_status = @recovery_status,
      updated_at = @updated_at
    WHERE id = @id
  `);
  const insertTrustClusterAction = db.prepare(`
    INSERT INTO trust_cluster_actions (
      case_id,
      cluster_id,
      action_type,
      reason_code,
      actor_id,
      details_json,
      created_at
    ) VALUES (
      @case_id,
      @cluster_id,
      @action_type,
      @reason_code,
      @actor_id,
      @details_json,
      @created_at
    )
  `);
  const listTrustClusterActionsByCase = db.prepare(`
    SELECT *
    FROM trust_cluster_actions
    WHERE case_id = @case_id
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const listTrustClusterActionsByCluster = db.prepare(`
    SELECT *
    FROM trust_cluster_actions
    WHERE cluster_id = @cluster_id
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const insertTrustRecoveryJob = db.prepare(`
    INSERT INTO trust_recovery_jobs (
      case_id,
      transaction_id,
      status,
      reason_code,
      template_key,
      payload_json,
      scheduled_for,
      sla_due_at,
      processed_at,
      failure_reason,
      created_at,
      updated_at
    ) VALUES (
      @case_id,
      @transaction_id,
      @status,
      @reason_code,
      @template_key,
      @payload_json,
      @scheduled_for,
      @sla_due_at,
      @processed_at,
      @failure_reason,
      @created_at,
      @updated_at
    )
  `);
  const updateTrustRecoveryJob = db.prepare(`
    UPDATE trust_recovery_jobs
    SET
      status = @status,
      processed_at = @processed_at,
      failure_reason = @failure_reason,
      updated_at = @updated_at
    WHERE id = @id
  `);
  const listTrustRecoveryJobsByStatus = db.prepare(`
    SELECT *
    FROM trust_recovery_jobs
    WHERE status = @status
    ORDER BY scheduled_for ASC, id ASC
    LIMIT @limit
  `);
  const listTrustRecoveryJobsByCase = db.prepare(`
    SELECT *
    FROM trust_recovery_jobs
    WHERE case_id = @case_id
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const listTrustRecoveryJobsAll = db.prepare(`
    SELECT *
    FROM trust_recovery_jobs
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const insertTrustListingAuthenticitySignal = db.prepare(`
    INSERT INTO trust_listing_authenticity_signals (
      case_id,
      transaction_id,
      listing_id,
      seller_id,
      signal_type,
      reason_code,
      confidence_score,
      signal_details_json,
      policy_version_id,
      created_by,
      created_at
    ) VALUES (
      @case_id,
      @transaction_id,
      @listing_id,
      @seller_id,
      @signal_type,
      @reason_code,
      @confidence_score,
      @signal_details_json,
      @policy_version_id,
      @created_by,
      @created_at
    )
  `);
  const listTrustListingAuthenticitySignalsByCase = db.prepare(`
    SELECT *
    FROM trust_listing_authenticity_signals
    WHERE case_id = @case_id
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const insertTrustCaseRemediationAction = db.prepare(`
    INSERT INTO trust_case_remediation_actions (
      case_id,
      transaction_id,
      action_type,
      confidence_tier,
      status,
      reason_code,
      policy_version_id,
      machine_decision_json,
      human_decision_json,
      rollback_of_action_id,
      audit_chain_hash,
      created_by,
      created_at,
      updated_at
    ) VALUES (
      @case_id,
      @transaction_id,
      @action_type,
      @confidence_tier,
      @status,
      @reason_code,
      @policy_version_id,
      @machine_decision_json,
      @human_decision_json,
      @rollback_of_action_id,
      @audit_chain_hash,
      @created_by,
      @created_at,
      @updated_at
    )
  `);
  const updateTrustCaseRemediationActionStatus = db.prepare(`
    UPDATE trust_case_remediation_actions
    SET
      status = @status,
      updated_at = @updated_at
    WHERE id = @id
  `);
  const listTrustCaseRemediationActionsByCase = db.prepare(`
    SELECT *
    FROM trust_case_remediation_actions
    WHERE case_id = @case_id
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const listAppliedTrustCaseRemediationActionsByCase = db.prepare(`
    SELECT *
    FROM trust_case_remediation_actions
    WHERE case_id = @case_id
      AND status = 'applied'
    ORDER BY created_at ASC, id ASC
    LIMIT @limit
  `);
  const getLatestTrustCaseRemediationActionByCase = db.prepare(`
    SELECT *
    FROM trust_case_remediation_actions
    WHERE case_id = @case_id
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `);
  const insertTrustBuyerRiskSignal = db.prepare(`
    INSERT INTO trust_buyer_risk_signals (
      case_id,
      transaction_id,
      buyer_id,
      signal_type,
      reason_code,
      feature_weight,
      feature_value,
      contribution_score,
      signal_details_json,
      policy_version_id,
      created_by,
      created_at
    ) VALUES (
      @case_id,
      @transaction_id,
      @buyer_id,
      @signal_type,
      @reason_code,
      @feature_weight,
      @feature_value,
      @contribution_score,
      @signal_details_json,
      @policy_version_id,
      @created_by,
      @created_at
    )
  `);
  const listTrustBuyerRiskSignalsByCase = db.prepare(`
    SELECT *
    FROM trust_buyer_risk_signals
    WHERE case_id = @case_id
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const listTrustBuyerRiskSignalsSince = db.prepare(`
    SELECT *
    FROM trust_buyer_risk_signals
    WHERE created_at >= @since_at
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const insertTrustDisputePreemptionAction = db.prepare(`
    INSERT INTO trust_dispute_preemption_actions (
      case_id,
      transaction_id,
      action_type,
      confidence_tier,
      status,
      reason_code,
      policy_version_id,
      machine_decision_json,
      human_decision_json,
      rollback_of_action_id,
      audit_chain_hash,
      created_by,
      created_at,
      updated_at
    ) VALUES (
      @case_id,
      @transaction_id,
      @action_type,
      @confidence_tier,
      @status,
      @reason_code,
      @policy_version_id,
      @machine_decision_json,
      @human_decision_json,
      @rollback_of_action_id,
      @audit_chain_hash,
      @created_by,
      @created_at,
      @updated_at
    )
  `);
  const updateTrustDisputePreemptionActionStatus = db.prepare(`
    UPDATE trust_dispute_preemption_actions
    SET
      status = @status,
      updated_at = @updated_at
    WHERE id = @id
  `);
  const listTrustDisputePreemptionActionsByCase = db.prepare(`
    SELECT *
    FROM trust_dispute_preemption_actions
    WHERE case_id = @case_id
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const listAppliedTrustDisputePreemptionActionsByCase = db.prepare(`
    SELECT *
    FROM trust_dispute_preemption_actions
    WHERE case_id = @case_id
      AND status = 'applied'
    ORDER BY created_at ASC, id ASC
    LIMIT @limit
  `);
  const getLatestTrustDisputePreemptionActionByCase = db.prepare(`
    SELECT *
    FROM trust_dispute_preemption_actions
    WHERE case_id = @case_id
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `);
  const listTrustDisputePreemptionActionsSince = db.prepare(`
    SELECT *
    FROM trust_dispute_preemption_actions
    WHERE created_at >= @since_at
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const insertTrustStepUpChallenge = db.prepare(`
    INSERT INTO trust_step_up_challenges (
      case_id,
      transaction_id,
      user_id,
      status,
      reason_code,
      challenge_type,
      evidence_json,
      created_by,
      resolved_by,
      resolved_at,
      expires_at,
      created_at,
      updated_at
    ) VALUES (
      @case_id,
      @transaction_id,
      @user_id,
      @status,
      @reason_code,
      @challenge_type,
      @evidence_json,
      @created_by,
      @resolved_by,
      @resolved_at,
      @expires_at,
      @created_at,
      @updated_at
    )
  `);
  const updateTrustStepUpChallenge = db.prepare(`
    UPDATE trust_step_up_challenges
    SET
      status = @status,
      evidence_json = @evidence_json,
      resolved_by = @resolved_by,
      resolved_at = @resolved_at,
      updated_at = @updated_at
    WHERE id = @id
  `);
  const getTrustStepUpChallengeById = db.prepare(`
    SELECT *
    FROM trust_step_up_challenges
    WHERE id = @id
    LIMIT 1
  `);
  const listTrustStepUpChallengesByCase = db.prepare(`
    SELECT *
    FROM trust_step_up_challenges
    WHERE case_id = @case_id
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const listTrustStepUpChallengesByCaseStatus = db.prepare(`
    SELECT *
    FROM trust_step_up_challenges
    WHERE case_id = @case_id
      AND status = @status
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const insertAccountRecoveryCase = db.prepare(`
    INSERT INTO account_recovery_cases (
      user_id,
      status,
      stage,
      compromise_signal_json,
      required_approval_actor_id,
      approved_by_actor_id,
      approved_at,
      decision_notes,
      restored_capabilities_json,
      created_by,
      resolved_by,
      resolved_at,
      created_at,
      updated_at
    ) VALUES (
      @user_id,
      @status,
      @stage,
      @compromise_signal_json,
      @required_approval_actor_id,
      @approved_by_actor_id,
      @approved_at,
      @decision_notes,
      @restored_capabilities_json,
      @created_by,
      @resolved_by,
      @resolved_at,
      @created_at,
      @updated_at
    )
  `);
  const updateAccountRecoveryCase = db.prepare(`
    UPDATE account_recovery_cases
    SET
      status = @status,
      stage = @stage,
      required_approval_actor_id = @required_approval_actor_id,
      approved_by_actor_id = @approved_by_actor_id,
      approved_at = @approved_at,
      decision_notes = @decision_notes,
      restored_capabilities_json = @restored_capabilities_json,
      resolved_by = @resolved_by,
      resolved_at = @resolved_at,
      updated_at = @updated_at
    WHERE id = @id
  `);
  const getAccountRecoveryCaseById = db.prepare(`
    SELECT *
    FROM account_recovery_cases
    WHERE id = @id
    LIMIT 1
  `);
  const getActiveAccountRecoveryCaseByUser = db.prepare(`
    SELECT *
    FROM account_recovery_cases
    WHERE user_id = @user_id
      AND status = 'open'
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `);
  const listAccountRecoveryCasesByUser = db.prepare(`
    SELECT *
    FROM account_recovery_cases
    WHERE user_id = @user_id
    ORDER BY updated_at DESC, id DESC
    LIMIT @limit
  `);
  const countTrustOpsCasesByLadderStepSince = db.prepare(`
    SELECT
      intervention_ladder_step AS step,
      COUNT(1) AS count
    FROM trust_operations_cases
    WHERE updated_at >= @since_at
    GROUP BY intervention_ladder_step
  `);
  const countTrustOpsRecoveryJobsByStatusSince = db.prepare(`
    SELECT status, COUNT(1) AS count
    FROM trust_recovery_jobs
    WHERE created_at >= @since_at
    GROUP BY status
  `);
  const countTrustStepUpChallengesByStatusSince = db.prepare(`
    SELECT status, COUNT(1) AS count
    FROM trust_step_up_challenges
    WHERE created_at >= @since_at
    GROUP BY status
  `);
  const countAccountRecoveryCasesByStatusSince = db.prepare(`
    SELECT status, COUNT(1) AS count
    FROM account_recovery_cases
    WHERE created_at >= @since_at
    GROUP BY status
  `);
  const countTrustClusterActionsSince = db.prepare(`
    SELECT COUNT(1) AS count
    FROM trust_cluster_actions
    WHERE created_at >= @since_at
  `);
  const listTrustCaseRemediationActionsSince = db.prepare(`
    SELECT *
    FROM trust_case_remediation_actions
    WHERE created_at >= @since_at
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const listTrustListingAuthenticitySignalsSince = db.prepare(`
    SELECT *
    FROM trust_listing_authenticity_signals
    WHERE created_at >= @since_at
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const listOpenTrustOperationsCasesByCluster = db.prepare(`
    SELECT *
    FROM trust_operations_cases
    WHERE cluster_id = @cluster_id
      AND status IN ('open', 'in_review')
    ORDER BY priority_score DESC, updated_at DESC, id DESC
    LIMIT @limit
  `);
  const countTrustOpsFalsePositiveCases = db.prepare(`
    SELECT COUNT(1) AS count
    FROM trust_operations_cases
    WHERE false_positive_flag = 1
  `);
  const avgTrustOpsOpenCaseAgeHours = db.prepare(`
    SELECT AVG((julianday(@now_at) - julianday(created_at)) * 24.0) AS avg_hours
    FROM trust_operations_cases
    WHERE status IN ('open', 'in_review')
  `);
  const avgTrustOpsResolutionHours = db.prepare(`
    SELECT AVG((julianday(resolved_at) - julianday(created_at)) * 24.0) AS avg_hours
    FROM trust_operations_cases
    WHERE status = 'resolved'
      AND resolved_at IS NOT NULL
  `);
  const insertTrustOperationsCaseEvent = db.prepare(`
    INSERT INTO trust_operations_case_events (
      case_id,
      transaction_id,
      event_type,
      actor_id,
      reason_code,
      details_json,
      created_at
    ) VALUES (
      @case_id,
      @transaction_id,
      @event_type,
      @actor_id,
      @reason_code,
      @details_json,
      @created_at
    )
  `);
  const listTrustOperationsCaseEventsByCase = db.prepare(`
    SELECT *
    FROM trust_operations_case_events
    WHERE case_id = @case_id
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const countTrustOperationsCasesByStatus = db.prepare(`
    SELECT COUNT(1) AS count
    FROM trust_operations_cases
    WHERE status = @status
  `);
  const countTrustOperationsCaseEventsByTypeSince = db.prepare(`
    SELECT COUNT(1) AS count
    FROM trust_operations_case_events
    WHERE event_type = @event_type
      AND created_at >= @since_at
  `);
  const getLaunchControlFlagByKey = db.prepare(`
    SELECT *
    FROM launch_control_flags
    WHERE key = @key
    LIMIT 1
  `);
  const listLaunchControlFlagsAll = db.prepare(`
    SELECT *
    FROM launch_control_flags
    ORDER BY key ASC
  `);
  const upsertLaunchControlFlag = db.prepare(`
    INSERT INTO launch_control_flags (
      key,
      enabled,
      rollout_percentage,
      allowlist_user_ids_json,
      region_allowlist_json,
      environment,
      reason,
      deployment_run_id,
      metadata_json,
      updated_by,
      updated_at
    ) VALUES (
      @key,
      @enabled,
      @rollout_percentage,
      @allowlist_user_ids_json,
      @region_allowlist_json,
      @environment,
      @reason,
      @deployment_run_id,
      @metadata_json,
      @updated_by,
      @updated_at
    )
    ON CONFLICT(key) DO UPDATE SET
      enabled = excluded.enabled,
      rollout_percentage = excluded.rollout_percentage,
      allowlist_user_ids_json = excluded.allowlist_user_ids_json,
      region_allowlist_json = excluded.region_allowlist_json,
      environment = excluded.environment,
      reason = excluded.reason,
      deployment_run_id = excluded.deployment_run_id,
      metadata_json = excluded.metadata_json,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `);
  const insertLaunchControlAuditEvent = db.prepare(`
    INSERT INTO launch_control_audit_events (
      flag_key,
      previous_enabled,
      next_enabled,
      previous_rollout_percentage,
      next_rollout_percentage,
      previous_allowlist_user_ids_json,
      next_allowlist_user_ids_json,
      previous_region_allowlist_json,
      next_region_allowlist_json,
      actor_id,
      reason,
      source,
      deployment_run_id,
      metadata_json,
      correlation_id,
      request_id,
      created_at
    ) VALUES (
      @flag_key,
      @previous_enabled,
      @next_enabled,
      @previous_rollout_percentage,
      @next_rollout_percentage,
      @previous_allowlist_user_ids_json,
      @next_allowlist_user_ids_json,
      @previous_region_allowlist_json,
      @next_region_allowlist_json,
      @actor_id,
      @reason,
      @source,
      @deployment_run_id,
      @metadata_json,
      @correlation_id,
      @request_id,
      @created_at
    )
  `);
  const listLaunchControlAuditEventsByFlag = db.prepare(`
    SELECT *
    FROM launch_control_audit_events
    WHERE flag_key = @flag_key
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const listLaunchControlAuditEventsAll = db.prepare(`
    SELECT *
    FROM launch_control_audit_events
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const upsertLaunchControlIncident = db.prepare(`
    INSERT INTO launch_control_incidents (
      incident_key,
      signal_type,
      severity,
      details_json,
      auto_rollback_applied,
      correlation_id,
      request_id,
      created_at
    ) VALUES (
      @incident_key,
      @signal_type,
      @severity,
      @details_json,
      @auto_rollback_applied,
      @correlation_id,
      @request_id,
      @created_at
    )
    ON CONFLICT(incident_key) DO UPDATE SET
      signal_type = excluded.signal_type,
      severity = excluded.severity,
      details_json = excluded.details_json,
      auto_rollback_applied = excluded.auto_rollback_applied,
      correlation_id = excluded.correlation_id,
      request_id = excluded.request_id,
      created_at = excluded.created_at
  `);
  const getLaunchControlIncidentByIncidentKey = db.prepare(`
    SELECT *
    FROM launch_control_incidents
    WHERE incident_key = @incident_key
    LIMIT 1
  `);
  const getLaunchControlIncidentById = db.prepare(`
    SELECT *
    FROM launch_control_incidents
    WHERE id = @id
    LIMIT 1
  `);
  const listLaunchControlIncidents = db.prepare(`
    SELECT *
    FROM launch_control_incidents
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const updateTransactionHoldState = db.prepare(`
    UPDATE transactions
    SET
      hold_status = @hold_status,
      hold_reason = @hold_reason,
      hold_applied_at = @hold_applied_at,
      hold_released_at = @hold_released_at,
      hold_applied_by = @hold_applied_by,
      hold_released_by = @hold_released_by,
      updated_at = @updated_at
    WHERE id = @id
  `);
  const countRecentAcceptedTransactionsByBuyer = db.prepare(`
    SELECT COUNT(1) AS count
    FROM transactions
    WHERE buyer_id = @user_id
      AND accepted_at >= @since_at
  `);
  const countRecentAcceptedTransactionsBySeller = db.prepare(`
    SELECT COUNT(1) AS count
    FROM transactions
    WHERE seller_id = @user_id
      AND accepted_at >= @since_at
  `);
  const sumRecentAcceptedAmountByBuyer = db.prepare(`
    SELECT COALESCE(SUM(amount_cents), 0) AS total_amount
    FROM transactions
    WHERE buyer_id = @user_id
      AND accepted_at >= @since_at
  `);
  const sumRecentAcceptedAmountBySeller = db.prepare(`
    SELECT COALESCE(SUM(amount_cents), 0) AS total_amount
    FROM transactions
    WHERE seller_id = @user_id
      AND accepted_at >= @since_at
  `);
  const countRecentDisputeOpenedByActor = db.prepare(`
    SELECT COUNT(1) AS count
    FROM transaction_events
    WHERE actor_id = @actor_id
      AND event_type = 'dispute_opened'
      AND created_at >= @since_at
  `);
  const insertRiskLimitDecision = db.prepare(`
    INSERT INTO risk_limit_decisions (
      checkpoint,
      decision,
      reason_code,
      transaction_id,
      user_id,
      amount_cents,
      daily_volume_cents,
      max_transaction_cents,
      daily_volume_cap_cents,
      cooldown_hours,
      cooldown_until,
      risk_tier,
      verification_status,
      policy_snapshot_json,
      request_id,
      correlation_id,
      created_at
    ) VALUES (
      @checkpoint,
      @decision,
      @reason_code,
      @transaction_id,
      @user_id,
      @amount_cents,
      @daily_volume_cents,
      @max_transaction_cents,
      @daily_volume_cap_cents,
      @cooldown_hours,
      @cooldown_until,
      @risk_tier,
      @verification_status,
      @policy_snapshot_json,
      @request_id,
      @correlation_id,
      @created_at
    )
  `);
  const listRiskLimitDecisionsByUser = db.prepare(`
    SELECT *
    FROM risk_limit_decisions
    WHERE user_id = @user_id
      AND (@checkpoint IS NULL OR checkpoint = @checkpoint)
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);

  const markUserLogin = db.prepare(`
    UPDATE users
    SET
      last_login_at = @last_login_at,
      updated_at = @updated_at
    WHERE id = @id
  `);

  const insertListing = db.prepare(`
    INSERT INTO listings (
      id,
      seller_id,
      title,
      description,
      price_cents,
      category,
      item_condition,
      local_area,
      listing_photo_urls_json,
      listing_uploaded_photos_json,
      moderation_status,
      moderation_reason_code,
      moderation_public_reason,
      moderation_internal_notes,
      moderation_updated_at,
      moderation_updated_by,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @seller_id,
      @title,
      @description,
      @price_cents,
      @category,
      @item_condition,
      @local_area,
      @listing_photo_urls_json,
      @listing_uploaded_photos_json,
      @moderation_status,
      @moderation_reason_code,
      @moderation_public_reason,
      @moderation_internal_notes,
      @moderation_updated_at,
      @moderation_updated_by,
      @created_at,
      @updated_at
    )
  `);

  const getListingById = db.prepare("SELECT * FROM listings WHERE id = ?");
  const listListingsAll = db.prepare(`
    SELECT *
    FROM listings
    WHERE (@moderation_status IS NULL OR moderation_status = @moderation_status)
      AND (@cursor_created_at IS NULL OR created_at < @cursor_created_at OR (created_at = @cursor_created_at AND id < @cursor_id))
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const listListingsBySeller = db.prepare(`
    SELECT *
    FROM listings
    WHERE seller_id = @seller_id
      AND (@moderation_status IS NULL OR moderation_status = @moderation_status)
      AND (@cursor_created_at IS NULL OR created_at < @cursor_created_at OR (created_at = @cursor_created_at AND id < @cursor_id))
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const listListingsByArea = db.prepare(`
    SELECT *
    FROM listings
    WHERE local_area = @local_area
      AND (@moderation_status IS NULL OR moderation_status = @moderation_status)
      AND (@cursor_created_at IS NULL OR created_at < @cursor_created_at OR (created_at = @cursor_created_at AND id < @cursor_id))
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const listListingsBySellerAndArea = db.prepare(`
    SELECT *
    FROM listings
    WHERE seller_id = @seller_id
      AND local_area = @local_area
      AND (@moderation_status IS NULL OR moderation_status = @moderation_status)
      AND (@cursor_created_at IS NULL OR created_at < @cursor_created_at OR (created_at = @cursor_created_at AND id < @cursor_id))
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);

  const updateListingStatement = db.prepare(`
    UPDATE listings
    SET
      title = @title,
      description = @description,
      price_cents = @price_cents,
      category = @category,
      item_condition = @item_condition,
      local_area = @local_area,
      listing_photo_urls_json = @listing_photo_urls_json,
      moderation_status = @moderation_status,
      moderation_reason_code = @moderation_reason_code,
      moderation_public_reason = @moderation_public_reason,
      moderation_internal_notes = @moderation_internal_notes,
      moderation_updated_at = @moderation_updated_at,
      moderation_updated_by = @moderation_updated_by,
      updated_at = @updated_at
    WHERE id = @id
  `);
  const updateListingUploadedPhotosStatement = db.prepare(`
    UPDATE listings
    SET
      listing_uploaded_photos_json = @listing_uploaded_photos_json,
      updated_at = @updated_at
    WHERE id = @id
  `);
  const updateListingModerationStatement = db.prepare(`
    UPDATE listings
    SET
      moderation_status = @moderation_status,
      moderation_reason_code = @moderation_reason_code,
      moderation_public_reason = @moderation_public_reason,
      moderation_internal_notes = @moderation_internal_notes,
      moderation_updated_at = @moderation_updated_at,
      moderation_updated_by = @moderation_updated_by,
      updated_at = @updated_at
    WHERE id = @id
  `);
  const insertListingModerationEvent = db.prepare(`
    INSERT INTO listing_moderation_events (
      listing_id,
      from_status,
      to_status,
      reason_code,
      public_reason,
      internal_notes,
      source,
      actor_id,
      request_id,
      correlation_id,
      created_at
    ) VALUES (
      @listing_id,
      @from_status,
      @to_status,
      @reason_code,
      @public_reason,
      @internal_notes,
      @source,
      @actor_id,
      @request_id,
      @correlation_id,
      @created_at
    )
  `);
  const listListingModerationEventsByListing = db.prepare(`
    SELECT *
    FROM listing_moderation_events
    WHERE listing_id = @listing_id
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const insertListingAbuseReport = db.prepare(`
    INSERT INTO listing_abuse_reports (
      listing_id,
      reporter_user_id,
      reason_code,
      details,
      status,
      priority_score,
      created_at,
      updated_at
    ) VALUES (
      @listing_id,
      @reporter_user_id,
      @reason_code,
      @details,
      @status,
      @priority_score,
      @created_at,
      @updated_at
    )
  `);
  const getListingAbuseReportById = db.prepare("SELECT * FROM listing_abuse_reports WHERE id = ?");
  const listListingAbuseReportsByListing = db.prepare(`
    SELECT *
    FROM listing_abuse_reports
    WHERE listing_id = @listing_id
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const listListingAbuseReportsAll = db.prepare(`
    SELECT *
    FROM listing_abuse_reports
    WHERE (@status IS NULL OR status = @status)
    ORDER BY priority_score DESC, created_at DESC, id DESC
    LIMIT @limit
  `);
  const countOpenAbuseReportsByListing = db.prepare(`
    SELECT COUNT(1) AS count
    FROM listing_abuse_reports
    WHERE listing_id = @listing_id
      AND status = 'open'
  `);
  const averageListingPriceBySeller = db.prepare(`
    SELECT AVG(price_cents) AS average_price_cents, COUNT(1) AS count
    FROM listings
    WHERE seller_id = @seller_id
  `);
  const averageListingPriceBySellerExcludingListing = db.prepare(`
    SELECT AVG(price_cents) AS average_price_cents, COUNT(1) AS count
    FROM listings
    WHERE seller_id = @seller_id
      AND id != @listing_id
  `);

  function appendListingModerationEvent({
    listingId,
    fromStatus,
    toStatus,
    reasonCode,
    publicReason,
    internalNotes,
    source,
    actorId,
    requestId,
    correlationId,
    createdAt
  }) {
    if (!listingId || typeof listingId !== "string") {
      throw new StoreError("validation", "listingId is required");
    }
    if (!VALID_LISTING_MODERATION_STATUSES.has(toStatus)) {
      throw new StoreError("validation", "invalid listing moderation status");
    }
    if (!source || typeof source !== "string") {
      throw new StoreError("validation", "source is required");
    }
    if (!actorId || typeof actorId !== "string") {
      throw new StoreError("validation", "actorId is required");
    }
    const timestamp = createdAt ?? now().toISOString();
    insertListingModerationEvent.run({
      listing_id: listingId,
      from_status: fromStatus ?? null,
      to_status: toStatus,
      reason_code: reasonCode ?? null,
      public_reason: publicReason ?? null,
      internal_notes: internalNotes ?? null,
      source: source.trim(),
      actor_id: actorId.trim(),
      request_id: requestId ?? null,
      correlation_id: correlationId ?? null,
      created_at: timestamp
    });
  }

  function appendTransactionEvent({
    transactionId,
    eventType,
    actorId,
    occurredAt,
    payload
  }) {
    if (!VALID_EVENT_TYPES.has(eventType)) {
      throw new StoreError("validation", `unexpected eventType: ${eventType}`);
    }

    if (!actorId || typeof actorId !== "string" || !actorId.trim()) {
      throw new StoreError("validation", "actorId is required for transaction events");
    }

    const timestamp = occurredAt ?? now().toISOString();
    const serializedPayload = JSON.stringify(payload ?? {});
    const result = insertTransactionEvent.run({
      transaction_id: transactionId,
      event_type: eventType,
      actor_id: actorId.trim(),
      occurred_at: timestamp,
      payload_json: serializedPayload,
      created_at: timestamp
    });

    return Number(result.lastInsertRowid);
  }

  function enqueueOutboxRecords({ transactionId, sourceEventId, occurredAt, records }) {
    if (!Array.isArray(records) || records.length === 0) {
      return;
    }

    for (const record of records) {
      insertOutboxRecord.run({
        transaction_id: transactionId,
        source_event_id: sourceEventId,
        topic: record.topic,
        recipient_user_id: record.recipientUserId ?? null,
        payload_json: JSON.stringify(record.payload ?? {}),
        created_at: occurredAt,
        available_at: occurredAt
      });
    }
  }

  const runAutoReleaseTransaction = db.transaction((timestampIso) => {
    const rows = findEligibleAutoReleaseIds.all(timestampIso);
    const releasedIds = [];
    const delayedIds = [];
    const manualReviewIds = [];
    const activePolicy = mapTrustOpsPolicyVersion(getActiveTrustOpsPolicyVersion.get());
    const policy = activePolicy?.policy ?? {};
    const v7Enabled = policy?.v7Enabled === true;

    for (const row of rows) {
      const transaction = mapTransaction(getTransactionByIdQuery.get(row.id));
      if (!transaction) {
        continue;
      }
      const arbitration = v7Enabled
        ? computeEscrowArbitrationDecision({
            transaction,
            policy
          })
        : { path: "auto_release", arbitrationRiskScore: transaction.riskScore, evidenceConfidenceScore: 50, delayHours: 0 };

      if (arbitration.path === "delayed_release") {
        const delayedUntil = addHours(timestampIso, arbitration.delayHours);
        const delayed = delayAutoRelease.run({
          id: row.id,
          auto_release_due_at: delayedUntil,
          updated_at: timestampIso
        });
        if (delayed.changes === 1) {
          delayedIds.push(row.id);
          recordPayoutRiskAction({
            transactionId: row.id,
            sellerId: transaction.sellerId,
            actionType: "hold",
            holdHours: arbitration.delayHours,
            reviewRequired: false,
            reasonCode: "escrow_arbitration_delayed_release",
            source: "system",
            policyVersionId: activePolicy?.id ?? null,
            policySnapshot: policy,
            actorId: "system:auto_release",
            metadata: {
              arbitrationPath: arbitration.path,
              arbitrationRiskScore: arbitration.arbitrationRiskScore,
              evidenceConfidenceScore: arbitration.evidenceConfidenceScore
            },
            createdAt: timestampIso
          });
        }
        continue;
      }

      if (arbitration.path === "manual_adjudication") {
        updateTransactionHoldState.run({
          id: row.id,
          hold_status: "held",
          hold_reason: "policy_auto_hold:escrow_arbitration_manual_review",
          hold_applied_at: timestampIso,
          hold_released_at: transaction.holdReleasedAt,
          hold_applied_by: "system:auto_release",
          hold_released_by: transaction.holdReleasedBy,
          updated_at: timestampIso
        });
        appendTransactionEvent({
          transactionId: row.id,
          eventType: "dispute_opened",
          actorId: "system:auto_release",
          occurredAt: timestampIso,
          payload: {
            reason: "escrow_arbitration_manual_adjudication",
            arbitrationRiskScore: arbitration.arbitrationRiskScore,
            evidenceConfidenceScore: arbitration.evidenceConfidenceScore
          }
        });
        manualReviewIds.push(row.id);
        recordPayoutRiskAction({
          transactionId: row.id,
          sellerId: transaction.sellerId,
          actionType: "manual_review",
          holdHours: arbitration.delayHours,
          reviewRequired: true,
          reasonCode: "escrow_arbitration_manual_adjudication",
          source: "system",
          policyVersionId: activePolicy?.id ?? null,
          policySnapshot: policy,
          actorId: "system:auto_release",
          metadata: {
            arbitrationPath: arbitration.path,
            arbitrationRiskScore: arbitration.arbitrationRiskScore,
            evidenceConfidenceScore: arbitration.evidenceConfidenceScore
          },
          createdAt: timestampIso
        });
        continue;
      }

      const result = markAutoReleased.run({
        id: row.id,
        auto_released_at: timestampIso,
        payout_released_at: timestampIso,
        updated_at: timestampIso
      });

      if (result.changes === 1) {
        const sourceEventId = appendTransactionEvent({
          transactionId: row.id,
          eventType: "settlement_completed",
          actorId: "system:auto_release",
          occurredAt: timestampIso,
          payload: {
            reason: "auto_release",
            arbitrationPath: arbitration.path,
            arbitrationRiskScore: arbitration.arbitrationRiskScore,
            evidenceConfidenceScore: arbitration.evidenceConfidenceScore
          }
        });
        enqueueOutboxRecords({
          transactionId: row.id,
          sourceEventId,
          occurredAt: timestampIso,
          records: [
            {
              topic: "dispute_update",
              recipientUserId: null,
              payload: {
                transactionId: row.id,
                eventType: "settlement_completed",
                reason: "auto_release",
                decisionTransparency: {
                  policyReasonCategory: "escrow_auto_release",
                  nextActions: ["monitor_delivery_confirmation", "open_dispute_if_needed"],
                  appealWindow: {
                    eligible: true,
                    closesAt: addHours(timestampIso, 72)
                  }
                }
              }
            }
          ]
        });
        releasedIds.push(row.id);
      }
    }

    return {
      releasedIds,
      delayedIds,
      manualReviewIds
    };
  });

  function resolveTransactionIdFromProviderPayload(event) {
    if (!event || typeof event !== "object") {
      return null;
    }
    const dataObject = event.data?.object;
    const metadataTransactionId = dataObject?.metadata?.transaction_id;
    if (typeof metadataTransactionId === "string" && metadataTransactionId.trim()) {
      return metadataTransactionId.trim();
    }
    const description = dataObject?.description;
    if (typeof description === "string") {
      const match = description.match(/\btxn:[a-zA-Z0-9_-]{1,64}\b/);
      if (match) {
        return match[0].slice("txn:".length);
      }
    }
    return null;
  }

  function deriveWebhookPaymentState(eventType) {
    if (eventType === "payment_intent.succeeded" || eventType === "charge.succeeded") {
      return "captured";
    }
    if (eventType === "payment_intent.payment_failed" || eventType === "charge.failed") {
      return "failed";
    }
    if (eventType === "refund.succeeded" || eventType === "charge.refunded") {
      return "refunded";
    }
    if (eventType === "charge.dispute.created") {
      return "disputed";
    }
    if (eventType === "charge.dispute.closed") {
      return "captured";
    }
    return null;
  }

  function eventTimestampMs(eventRow) {
    const eventTimestampRaw = eventRow.occurredAt ?? eventRow.lastReceivedAt;
    return new Date(eventTimestampRaw).valueOf();
  }

  function clampRiskSeverity(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new StoreError("validation", "severity must be a number");
    }
    const rounded = Math.round(parsed);
    if (rounded < 1 || rounded > 100) {
      throw new StoreError("validation", "severity must be between 1 and 100");
    }
    return rounded;
  }

  function deriveRiskLevel(score) {
    if (score >= 70) {
      return "high";
    }
    if (score >= 40) {
      return "medium";
    }
    return "low";
  }

  function deriveRiskTier(score) {
    if (score >= 70) {
      return "high";
    }
    if (score >= 35) {
      return "medium";
    }
    return "low";
  }

  function refreshTransactionRiskProfile({ transactionId, updatedAt, extraFlags = [] }) {
    const transaction = mapTransaction(getTransactionByIdQuery.get(transactionId));
    if (!transaction) {
      throw new StoreError("not_found", "transaction not found");
    }

    const totalSignalSeverity = Number(
      sumRiskSeverityByTransaction.get({ transaction_id: transactionId })?.total_severity ?? 0
    );
    const types = listRiskSignalTypesByTransaction
      .all({ transaction_id: transactionId })
      .map((row) => String(row.signal_type));
    const flags = new Set(types);

    const buyer = mapUser(getUserById.get(transaction.buyerId));
    const seller = mapUser(getUserById.get(transaction.sellerId));
    const participants = [buyer, seller].filter(Boolean);
    let accountControlsWeight = 0;
    for (const user of participants) {
      if (user.riskFlagged) {
        flags.add("account_flagged");
        accountControlsWeight += 20;
      }
      if (user.verificationRequired) {
        flags.add("verification_required");
        accountControlsWeight += 20;
      }
    }
    for (const extraFlag of extraFlags) {
      if (typeof extraFlag === "string" && extraFlag.trim()) {
        flags.add(extraFlag.trim());
      }
    }
    if (transaction.holdStatus === "held") {
      flags.add("manual_hold");
      accountControlsWeight += 10;
    }

    const score = Math.max(0, Math.min(100, totalSignalSeverity + accountControlsWeight));
    updateTransactionRiskProfile.run({
      id: transactionId,
      risk_score: score,
      risk_level: deriveRiskLevel(score),
      risk_flags_json: JSON.stringify(Object.fromEntries(Array.from(flags).map((f) => [f, true]))),
      updated_at: updatedAt
    });
    return mapTransaction(getTransactionByIdQuery.get(transactionId));
  }

  function normalizeVerificationStatus(status) {
    const normalized = String(status ?? "").trim();
    if (!VALID_VERIFICATION_STATUSES.has(normalized)) {
      throw new StoreError("validation", "invalid verification status");
    }
    return normalized;
  }

  function normalizeRiskTier(tier) {
    const normalized = String(tier ?? "").trim();
    if (!VALID_RISK_TIERS.has(normalized)) {
      throw new StoreError("validation", "risk tier must be one of: low, medium, high");
    }
    return normalized;
  }

  function normalizeTrustOperationsCaseStatus(status) {
    const normalized = String(status ?? "").trim();
    if (!VALID_TRUST_OPS_CASE_STATUSES.has(normalized)) {
      throw new StoreError("validation", "invalid trust operations case status");
    }
    return normalized;
  }

  function normalizeTrustOperationsRecommendedAction(action) {
    const normalized = String(action ?? "").trim();
    if (!VALID_TRUST_OPS_RECOMMENDED_ACTIONS.has(normalized)) {
      throw new StoreError("validation", "invalid trust operations recommendedAction");
    }
    return normalized;
  }

  function normalizeTrustOpsPayoutAction(action) {
    const normalized = String(action ?? "").trim();
    if (!VALID_TRUST_OPS_PAYOUT_ACTIONS.has(normalized)) {
      throw new StoreError("validation", "invalid trust operations payout action");
    }
    return normalized;
  }

  function normalizeTrustOpsInterventionStep(step) {
    const normalized = String(step ?? "").trim();
    if (!VALID_TRUST_OPS_INTERVENTION_STEPS.has(normalized)) {
      throw new StoreError("validation", "invalid trust operations intervention ladder step");
    }
    return normalized;
  }

  function normalizeTrustOpsRecoveryStatus(status) {
    const normalized = String(status ?? "").trim();
    if (!VALID_TRUST_OPS_RECOVERY_STATUSES.has(normalized)) {
      throw new StoreError("validation", "invalid trust operations recovery status");
    }
    return normalized;
  }

  function normalizeTrustStepUpChallengeStatus(status) {
    const normalized = String(status ?? "").trim();
    if (!VALID_TRUST_STEP_UP_CHALLENGE_STATUSES.has(normalized)) {
      throw new StoreError("validation", "invalid trust step-up challenge status");
    }
    return normalized;
  }

  function normalizeAccountRecoveryStage(stage) {
    const normalized = String(stage ?? "").trim();
    if (!VALID_ACCOUNT_RECOVERY_STAGES.has(normalized)) {
      throw new StoreError("validation", "invalid account recovery stage");
    }
    return normalized;
  }

  function normalizeTrustNetworkLinkType(linkType) {
    const normalized = String(linkType ?? "").trim();
    if (!VALID_TRUST_NETWORK_LINK_TYPES.has(normalized)) {
      throw new StoreError("validation", "invalid trust network link type");
    }
    return normalized;
  }

  function normalizeTrustOperationsEventType(eventType) {
    const normalized = String(eventType ?? "").trim();
    if (!VALID_TRUST_OPS_EVENT_TYPES.has(normalized)) {
      throw new StoreError("validation", "invalid trust operations eventType");
    }
    return normalized;
  }

  function normalizeTrustOperationsSeverity(severity) {
    const normalized = String(severity ?? "").trim();
    if (!VALID_TRUST_OPS_SEVERITIES.has(normalized)) {
      throw new StoreError("validation", "invalid trust operations severity");
    }
    return normalized;
  }

  function normalizeTrustOpsPolicyStatus(status) {
    const normalized = String(status ?? "").trim();
    if (!VALID_TRUST_OPS_POLICY_STATUSES.has(normalized)) {
      throw new StoreError("validation", "invalid trust operations policy status");
    }
    return normalized;
  }

  function normalizeTrustOpsFeedbackType(feedbackType) {
    const normalized = String(feedbackType ?? "").trim();
    if (!VALID_TRUST_OPS_FEEDBACK_TYPES.has(normalized)) {
      throw new StoreError("validation", "invalid trust operations feedback type");
    }
    return normalized;
  }

  function deriveTrustOpsSeverity(riskScore) {
    const score = Math.max(0, Math.min(100, Number(riskScore ?? 0)));
    if (score >= 85) {
      return "critical";
    }
    if (score >= 70) {
      return "high";
    }
    if (score >= 40) {
      return "medium";
    }
    return "low";
  }

  function computeTrustOpsPriorityScore({ riskScore, recommendedAction }) {
    const score = Math.max(0, Math.min(100, Number(riskScore ?? 0)));
    const actionBoost = recommendedAction === "hold" ? 25 : recommendedAction === "clear" ? 10 : 0;
    return Math.max(0, Math.min(200, score + actionBoost));
  }

  function deriveTrustOpsInterventionLadderStep({ combinedRiskScore, networkRiskScore, payoutAction }) {
    const risk = Math.max(0, Math.min(100, Number(combinedRiskScore ?? 0)));
    const network = Math.max(0, Math.min(100, Number(networkRiskScore ?? 0)));
    if (payoutAction === "manual_review" || risk >= 90 || network >= 85) {
      return "manual_review_gate";
    }
    if (risk >= 80 || network >= 75) {
      return "verification_rechallenge";
    }
    if (payoutAction === "reserve" || risk >= 70 || network >= 65) {
      return "reserve_increase";
    }
    if (payoutAction === "hold" || risk >= 60 || network >= 55) {
      return "transaction_cooloff";
    }
    if (risk >= 45 || network >= 45) {
      return "listing_throttle";
    }
    return "none";
  }

  function deriveClusterIdForTransaction(transaction) {
    if (!transaction) {
      return null;
    }
    const buyer = String(transaction.buyerId ?? "").trim();
    const seller = String(transaction.sellerId ?? "").trim();
    if (!buyer || !seller) {
      return null;
    }
    return `cluster:${[buyer, seller].sort().join("|")}`;
  }

  function computeNetworkRiskProfileForTransaction({ transaction, propagationDecayHours = 168 }) {
    const nowIso = now().toISOString();
    const clusterId = deriveClusterIdForTransaction(transaction);
    if (!clusterId) {
      return {
        clusterId: null,
        networkRiskScore: 0,
        linkedEntities: [],
        evidenceBundle: { links: [], propagationDecayHours }
      };
    }
    const rawLinks = listTrustNetworkLinksByCluster
      .all({ cluster_id: clusterId, limit: 500 })
      .map(mapTrustNetworkLink);
    const activeLinks = rawLinks.filter((item) => {
      if (!item.decayExpiresAt) {
        return true;
      }
      return new Date(item.decayExpiresAt).valueOf() >= new Date(nowIso).valueOf();
    });
    const networkRiskScore =
      activeLinks.length === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              100,
              Math.round(
                activeLinks.reduce((sum, item) => sum + item.propagatedRiskScore * (item.confidenceScore / 100), 0) /
                  activeLinks.length
              )
            )
          );
    const linkedEntities = Array.from(
      new Set(
        activeLinks.flatMap((item) => [item.sourceEntityKey, item.targetEntityKey])
      )
    );
    return {
      clusterId,
      networkRiskScore,
      linkedEntities,
      evidenceBundle: {
        propagationDecayHours,
        links: activeLinks
      }
    };
  }

  function mapConfidenceBand(score) {
    const normalized = Math.max(0, Math.min(100, Number(score ?? 0)));
    if (normalized >= 80) {
      return "high";
    }
    if (normalized >= 50) {
      return "medium";
    }
    return "low";
  }

  function computeSellerIntegrityProfile({ sellerId, lookbackDays = 30 } = {}) {
    const normalizedSellerId = String(sellerId ?? "").trim();
    if (!normalizedSellerId) {
      throw new StoreError("validation", "sellerId is required");
    }
    const windowDays = Math.max(7, Math.min(90, Number(lookbackDays ?? 30)));
    const sinceAt = addHours(now().toISOString(), -24 * windowDays);
    const disputes = Number(
      countSellerDisputesSince.get({ seller_id: normalizedSellerId, since_at: sinceAt })?.count ?? 0
    );
    const highRiskTransactions = Number(
      countSellerHighRiskTransactionsSince
        .get({ seller_id: normalizedSellerId, min_risk_score: 70, since_at: sinceAt })
        ?.count ?? 0
    );
    const chargebacks = Number(
      countSellerChargebackFeedbackSince.get({ seller_id: normalizedSellerId, since_at: sinceAt })?.count ?? 0
    );
    const moderationRejects = Number(
      countSellerModerationRejectsSince.get({ seller_id: normalizedSellerId, since_at: sinceAt })?.count ?? 0
    );
    const completedTransactions = Number(
      countSellerCompletedTransactionsSince.get({ seller_id: normalizedSellerId, since_at: sinceAt })?.count ?? 0
    );
    const penalty =
      Math.min(40, disputes * 12) +
      Math.min(24, highRiskTransactions * 6) +
      Math.min(45, chargebacks * 15) +
      Math.min(20, moderationRejects * 5);
    const bonus = Math.min(10, completedTransactions);
    const integrityScore = Math.max(0, Math.min(100, 100 - penalty + bonus));
    const factors = {
      lookbackDays: windowDays,
      disputes,
      highRiskTransactions,
      chargebacks,
      moderationRejects,
      completedTransactions,
      penalty,
      bonus
    };
    const timestamp = now().toISOString();
    upsertSellerIntegrityProfile.run({
      user_id: normalizedSellerId,
      integrity_score: integrityScore,
      reason_factors_json: JSON.stringify(factors),
      computed_at: timestamp,
      updated_at: timestamp
    });
    const profileRow = getSellerIntegrityProfileByUser.get({ user_id: normalizedSellerId });
    return profileRow
      ? {
          userId: profileRow.user_id,
          integrityScore: Number(profileRow.integrity_score),
          reasonFactors: parseJsonOrEmpty(profileRow.reason_factors_json),
          computedAt: profileRow.computed_at,
          updatedAt: profileRow.updated_at
        }
      : {
          userId: normalizedSellerId,
          integrityScore,
          reasonFactors: factors,
          computedAt: timestamp,
          updatedAt: timestamp
        };
  }

  function computeIdentityAssuranceProfileForUser({ userId, role = "buyer", lookbackDays = 90 }) {
    const user = mapUser(getUserById.get(userId));
    if (!user) {
      throw new StoreError("not_found", "user not found");
    }
    const windowDays = Math.max(30, Math.min(180, Number(lookbackDays ?? 90)));
    const sinceAt = addHours(now().toISOString(), -24 * windowDays);
    const verificationLevelScore =
      user.verificationStatus === "verified"
        ? 100
        : user.verificationStatus === "pending"
          ? 60
          : user.verificationStatus === "rejected"
            ? 10
            : 35;
    const authFailureSignals = listRiskSignalsByUserAndSignalType
      .all({ user_id: userId, signal_type: "auth_failures", limit: 50 })
      .map(mapRiskSignal);
    const recentAuthFailures = authFailureSignals.filter(
      (signal) => new Date(signal.createdAt).valueOf() >= new Date(sinceAt).valueOf()
    ).length;
    const lastAuthFailureAt = authFailureSignals[0]?.createdAt ?? null;
    const deviceContinuityScore = Math.max(5, 95 - Math.min(80, recentAuthFailures * 15));
    const credentialAnchor = user.passwordUpdatedAt ?? user.createdAt;
    const credentialAgeDays = Math.max(
      0,
      Math.floor((Date.now() - new Date(credentialAnchor).valueOf()) / (24 * 3600 * 1000))
    );
    const credentialAgeScore = Math.max(20, Math.min(100, Math.round(25 + Math.min(365, credentialAgeDays) * 0.2)));
    const aggregatedRiskSeverity = Number(sumRiskSeverityByUser.get({ user_id: userId })?.total_severity ?? 0);
    const riskWeightedHistoryScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          100 -
            Math.min(70, aggregatedRiskSeverity / 3) -
            (user.riskTier === "high" ? 18 : user.riskTier === "medium" ? 9 : 0) -
            (user.riskFlagged ? 12 : 0) -
            (user.verificationRequired ? 12 : 0)
        )
      )
    );
    const assuranceScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          verificationLevelScore * 0.35 +
            deviceContinuityScore * 0.25 +
            credentialAgeScore * 0.15 +
            riskWeightedHistoryScore * 0.25
        )
      )
    );
    return {
      userId,
      role,
      assuranceScore,
      verificationLevelScore,
      deviceContinuityScore,
      credentialAgeScore,
      credentialAgeDays,
      riskWeightedHistoryScore,
      riskTier: user.riskTier,
      verificationStatus: user.verificationStatus,
      riskFlagged: user.riskFlagged,
      verificationRequired: user.verificationRequired,
      recentAuthFailures,
      lastAuthFailureAt
    };
  }

  function computeIdentityAssuranceForTransaction({ transaction, lookbackDays = 90 }) {
    const buyer = computeIdentityAssuranceProfileForUser({
      userId: transaction.buyerId,
      role: "buyer",
      lookbackDays
    });
    const seller = computeIdentityAssuranceProfileForUser({
      userId: transaction.sellerId,
      role: "seller",
      lookbackDays
    });
    const blendedScore = Math.round(buyer.assuranceScore * 0.45 + seller.assuranceScore * 0.55);
    return {
      blendedScore,
      buyer,
      seller
    };
  }

  function resolveV8GatingDecision({
    transaction,
    combinedRiskScore,
    identityAssurance,
    policy = {},
    payoutAction
  }) {
    const highRiskGateScore = Math.max(30, Math.min(100, Number(policy.highRiskGateScore ?? 70)));
    const challengeGateScore = Math.max(20, Math.min(100, Number(policy.challengeGateScore ?? 60)));
    const assuranceBypassScore = Math.max(0, Math.min(100, Number(policy.assuranceBypassScore ?? 78)));
    const v8Enabled = policy.v8Enabled === true;
    const isHighRisk = Number(combinedRiskScore) >= highRiskGateScore;
    const isLowAssurance = Number(identityAssurance.blendedScore) < assuranceBypassScore;
    const shouldGate = v8Enabled && isHighRisk && isLowAssurance;
    const challengeRequired = shouldGate && Number(combinedRiskScore) < Math.max(85, challengeGateScore + 20);
    const reasonCodes = [];
    if (isHighRisk) {
      reasonCodes.push("high_risk_transaction");
    }
    if (isLowAssurance) {
      reasonCodes.push("low_identity_assurance");
    }
    if (!v8Enabled) {
      reasonCodes.push("v8_disabled");
    }
    const action = !shouldGate
      ? "none"
      : challengeRequired
        ? "step_up_challenge"
        : payoutAction === "manual_review"
          ? "manual_review_gate"
          : "temporary_hold";
    const policyReasonCategory = !shouldGate
      ? "identity_gating_not_required"
      : challengeRequired
        ? "identity_step_up_challenge_required"
        : "identity_manual_review_gate";
    return {
      shouldGate,
      challengeRequired,
      action,
      reasonCodes,
      policyReasonCategory,
      thresholds: {
        highRiskGateScore,
        challengeGateScore,
        assuranceBypassScore
      }
    };
  }

  function resolveV9PreemptiveDisputeControls({
    combinedRiskScore,
    networkRiskScore,
    policy = {}
  }) {
    const v9Enabled = policy.v9Enabled === true;
    const risk = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          Math.max(Number(combinedRiskScore ?? 0), Number(networkRiskScore ?? 0))
        )
      )
    );
    const escalationRiskScore = Math.max(
      0,
      Math.min(100, Number(policy.collusionEscalationRiskScore ?? 72))
    );
    const shipmentConfirmationRiskScore = Math.max(
      0,
      Math.min(100, Number(policy.preemptiveShipmentConfirmationRiskScore ?? 65))
    );
    const payoutRestrictionRiskScore = Math.max(
      0,
      Math.min(100, Number(policy.preemptivePayoutRestrictionRiskScore ?? 82))
    );
    const escrowDelayHours = Math.max(
      0,
      Math.min(168, Number(policy.preemptiveEscrowDelayHours ?? 24))
    );
    const escrowDelayRiskScore = Math.max(
      0,
      Math.min(100, Number(policy.preemptiveEscrowDelayRiskScore ?? 55))
    );
    const controls = {
      requireShipmentConfirmation:
        v9Enabled && risk >= shipmentConfirmationRiskScore,
      restrictPayoutProgression:
        v9Enabled && risk >= payoutRestrictionRiskScore,
      conditionalEscrowDelayHours:
        v9Enabled && risk >= escrowDelayRiskScore ? escrowDelayHours : 0
    };
    const rationaleCards = [];
    if (v9Enabled && risk >= escalationRiskScore) {
      rationaleCards.push({
        code: "collusion_network_escalation",
        title: "Cluster Escalation Detected",
        confidenceBand: mapConfidenceBand(risk),
        reason:
          "Network-linked collusion posture exceeded policy escalation threshold.",
        policyVersionTrace: {
          v9Enabled: true,
          collusionEscalationRiskScore: escalationRiskScore
        }
      });
    }
    if (controls.requireShipmentConfirmation) {
      rationaleCards.push({
        code: "shipment_confirmation_required",
        title: "Shipment Confirmation Required",
        confidenceBand: mapConfidenceBand(risk),
        reason: "Escrow release requires fulfillment proof for this risk band.",
        policyVersionTrace: {
          v9Enabled: true,
          preemptiveShipmentConfirmationRiskScore: shipmentConfirmationRiskScore
        }
      });
    }
    if (controls.restrictPayoutProgression) {
      rationaleCards.push({
        code: "payout_progression_restricted",
        title: "Payout Progression Restricted",
        confidenceBand: mapConfidenceBand(risk),
        reason: "Manual trust-ops review is required before payout progression.",
        policyVersionTrace: {
          v9Enabled: true,
          preemptivePayoutRestrictionRiskScore: payoutRestrictionRiskScore
        }
      });
    }
    if (controls.conditionalEscrowDelayHours > 0) {
      rationaleCards.push({
        code: "conditional_escrow_delay",
        title: "Conditional Escrow Delay",
        confidenceBand: mapConfidenceBand(risk),
        reason: `Escrow progression delay of ${controls.conditionalEscrowDelayHours}h is active.`,
        policyVersionTrace: {
          v9Enabled: true,
          preemptiveEscrowDelayHours: escrowDelayHours,
          preemptiveEscrowDelayRiskScore: escrowDelayRiskScore
        }
      });
    }
    return {
      enabled: v9Enabled,
      riskScore: risk,
      confidenceBand: mapConfidenceBand(risk),
      controls,
      rationaleCards
    };
  }

  function computeEvidenceConfidenceProfile({ transactionId }) {
    const normalizedTransactionId = String(transactionId ?? "").trim();
    if (!normalizedTransactionId) {
      throw new StoreError("validation", "transactionId is required");
    }
    const evidence = listDisputeEvidenceByTransactionId
      .all(normalizedTransactionId)
      .map(mapDisputeEvidence);
    const integrityRows = listDisputeEvidenceIntegrityByTransaction
      .all({ transaction_id: normalizedTransactionId, limit: 500 })
      .map(mapDisputeEvidenceIntegrity);
    if (evidence.length === 0) {
      return {
        confidenceScore: 45,
        anomalyScore: 55,
        evidenceCount: 0,
        duplicateCount: 0,
        replayCount: 0,
        integrityRows
      };
    }
    const duplicateCount = integrityRows.filter((row) => row.duplicateWithinTransaction).length;
    const replayCount = integrityRows.filter((row) => row.replaySeenGlobally).length;
    const integrityScore =
      integrityRows.length === 0
        ? 60
        : Math.round(
            integrityRows.reduce((sum, row) => sum + row.metadataConsistencyScore, 0) /
              integrityRows.length
          );
    const anomalyScore =
      integrityRows.length === 0
        ? 35
        : Math.round(integrityRows.reduce((sum, row) => sum + row.anomalyScore, 0) / integrityRows.length);
    const confidenceScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          integrityScore * 0.7 +
            Math.max(0, 100 - anomalyScore) * 0.2 +
            Math.max(0, 100 - duplicateCount * 20 - replayCount * 15) * 0.1
        )
      )
    );
    return {
      confidenceScore,
      anomalyScore,
      evidenceCount: evidence.length,
      duplicateCount,
      replayCount,
      integrityRows
    };
  }

  function resolveEscrowArbitrationPolicy(rawPolicy = {}) {
    const autoReleaseRiskScore = Math.max(
      0,
      Math.min(100, Number(rawPolicy.arbitrationAutoReleaseRiskScore ?? 35))
    );
    const delayedReleaseRiskScore = Math.max(
      autoReleaseRiskScore,
      Math.min(100, Number(rawPolicy.arbitrationDelayedReleaseRiskScore ?? 70))
    );
    const delayHours = Math.max(1, Math.min(168, Number(rawPolicy.arbitrationDelayHours ?? 12)));
    const evidenceConfidenceWeight = Math.max(
      0,
      Math.min(90, Number(rawPolicy.evidenceConfidenceWeight ?? 35))
    );
    return {
      autoReleaseRiskScore,
      delayedReleaseRiskScore,
      delayHours,
      evidenceConfidenceWeight
    };
  }

  function computeEscrowArbitrationDecision({ transaction, policy = {} }) {
    const resolvedPolicy = resolveEscrowArbitrationPolicy(policy);
    const evidence = computeEvidenceConfidenceProfile({ transactionId: transaction.id });
    const riskPosture = Math.max(0, Math.min(100, Number(transaction.riskScore ?? 0)));
    const confidenceWeight = resolvedPolicy.evidenceConfidenceWeight / 100;
    const arbitrationRiskScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          riskPosture * (1 - confidenceWeight) +
            Math.max(0, 100 - evidence.confidenceScore) * confidenceWeight
        )
      )
    );
    if (arbitrationRiskScore <= resolvedPolicy.autoReleaseRiskScore) {
      return {
        path: "auto_release",
        arbitrationRiskScore,
        evidenceConfidenceScore: evidence.confidenceScore,
        delayHours: 0
      };
    }
    if (arbitrationRiskScore <= resolvedPolicy.delayedReleaseRiskScore) {
      return {
        path: "delayed_release",
        arbitrationRiskScore,
        evidenceConfidenceScore: evidence.confidenceScore,
        delayHours: resolvedPolicy.delayHours
      };
    }
    return {
      path: "manual_adjudication",
      arbitrationRiskScore,
      evidenceConfidenceScore: evidence.confidenceScore,
      delayHours: resolvedPolicy.delayHours
    };
  }

  function computeTrustOpsSlaDueAt({ severity, fromIso }) {
    const baseIso = fromIso ?? now().toISOString();
    const slaHours = severity === "critical" ? 2 : severity === "high" ? 6 : severity === "medium" ? 24 : 48;
    return addHours(baseIso, slaHours);
  }

  function transactionMatchesTrustOpsCohort(transaction, cohort = {}) {
    if (!cohort || typeof cohort !== "object") {
      return true;
    }
    const minAmount =
      cohort.minAmountCents === undefined || cohort.minAmountCents === null
        ? null
        : Number(cohort.minAmountCents);
    const maxAmount =
      cohort.maxAmountCents === undefined || cohort.maxAmountCents === null
        ? null
        : Number(cohort.maxAmountCents);
    if (minAmount !== null && Number.isFinite(minAmount) && transaction.amountCents < minAmount) {
      return false;
    }
    if (maxAmount !== null && Number.isFinite(maxAmount) && transaction.amountCents > maxAmount) {
      return false;
    }
    if (Array.isArray(cohort.riskLevelAllowlist) && cohort.riskLevelAllowlist.length > 0) {
      if (!cohort.riskLevelAllowlist.includes(transaction.riskLevel)) {
        return false;
      }
    }
    if (typeof cohort.transactionIdPrefix === "string" && cohort.transactionIdPrefix.trim()) {
      if (!transaction.id.startsWith(cohort.transactionIdPrefix.trim())) {
        return false;
      }
    }
    return true;
  }

  function appendTrustOperationsCaseEvent({
    caseId,
    transactionId,
    eventType,
    actorId,
    reasonCode = null,
    details = {},
    createdAt = null
  }) {
    const timestamp = createdAt ?? now().toISOString();
    const normalizedEventType = normalizeTrustOperationsEventType(eventType);
    const normalizedActorId = String(actorId ?? "").trim();
    if (!normalizedActorId) {
      throw new StoreError("validation", "actorId is required");
    }
    insertTrustOperationsCaseEvent.run({
      case_id: Number(caseId),
      transaction_id: transactionId,
      event_type: normalizedEventType,
      actor_id: normalizedActorId,
      reason_code: reasonCode ? String(reasonCode).trim() : null,
      details_json: JSON.stringify(details ?? {}),
      created_at: timestamp
    });
  }

  function updateTrustOperationsCaseV6({
    caseId,
    networkRiskScoreAtTrigger = 0,
    interventionLadderStep = "none",
    clusterId = null,
    recoveryStatus = "not_applicable"
  }) {
    updateTrustOperationsCaseV6Context.run({
      id: caseId,
      network_risk_score_at_trigger: Math.max(
        0,
        Math.min(100, Number(networkRiskScoreAtTrigger ?? 0))
      ),
      intervention_ladder_step: normalizeTrustOpsInterventionStep(interventionLadderStep),
      cluster_id: clusterId ?? null,
      recovery_status: normalizeTrustOpsRecoveryStatus(recoveryStatus),
      updated_at: now().toISOString()
    });
  }

  function appendTrustClusterAction({
    caseId,
    clusterId,
    actionType,
    reasonCode,
    actorId,
    details = {}
  }) {
    const normalizedActorId = String(actorId ?? "").trim();
    const normalizedReasonCode = String(reasonCode ?? "").trim();
    const normalizedActionType = String(actionType ?? "").trim();
    if (!normalizedActorId || !normalizedReasonCode || !normalizedActionType) {
      throw new StoreError("validation", "actorId, reasonCode, and actionType are required");
    }
    insertTrustClusterAction.run({
      case_id: Number(caseId),
      cluster_id: String(clusterId ?? "").trim(),
      action_type: normalizedActionType,
      reason_code: normalizedReasonCode,
      actor_id: normalizedActorId,
      details_json: JSON.stringify(details ?? {}),
      created_at: now().toISOString()
    });
  }

  function enqueueTrustRecoveryJob({
    caseId,
    transactionId,
    reasonCode,
    templateKey = "trust_recovery_false_positive_release",
    payload = {},
    scheduledFor = null
  }) {
    const timestamp = now().toISOString();
    const normalizedScheduledFor = scheduledFor ?? timestamp;
    const existingJobs = listTrustRecoveryJobsByCase
      .all({ case_id: Number(caseId), limit: 50 })
      .map(mapTrustRecoveryJob);
    if (existingJobs.some((item) => ["queued", "processing", "completed"].includes(item.status))) {
      return;
    }
    insertTrustRecoveryJob.run({
      case_id: Number(caseId),
      transaction_id: String(transactionId ?? "").trim(),
      status: "queued",
      reason_code: String(reasonCode ?? "recovery_queued"),
      template_key: String(templateKey ?? "trust_recovery_false_positive_release"),
      payload_json: JSON.stringify(payload ?? {}),
      scheduled_for: normalizedScheduledFor,
      sla_due_at: addHours(normalizedScheduledFor, 24),
      processed_at: null,
      failure_reason: null,
      created_at: timestamp,
      updated_at: timestamp
    });
    const existing = mapTrustOperationsCase(getTrustOperationsCaseById.get({ id: Number(caseId) }));
    updateTrustOperationsCaseV6({
      caseId,
      networkRiskScoreAtTrigger: existing?.networkRiskScoreAtTrigger ?? 0,
      interventionLadderStep: existing?.interventionLadderStep ?? "none",
      clusterId: existing?.clusterId ?? null,
      recoveryStatus: "queued"
    });
  }

  function recordPayoutRiskAction({
    transactionId,
    caseId = null,
    sellerId,
    actionType,
    reservePercent = null,
    holdHours = null,
    reviewRequired = false,
    reasonCode,
    source = "policy",
    policyVersionId = null,
    policySnapshot = {},
    actorId,
    overrideExpiresAt = null,
    metadata = {},
    createdAt = null
  }) {
    const normalizedTransactionId = String(transactionId ?? "").trim();
    const normalizedSellerId = String(sellerId ?? "").trim();
    const normalizedReasonCode = String(reasonCode ?? "").trim();
    const normalizedActorId = String(actorId ?? "").trim();
    if (!normalizedTransactionId || !normalizedSellerId || !normalizedReasonCode || !normalizedActorId) {
      throw new StoreError("validation", "transactionId, sellerId, reasonCode, and actorId are required");
    }
    const normalizedActionType = normalizeTrustOpsPayoutAction(actionType);
    const normalizedSource = String(source ?? "").trim() || "policy";
    if (!["policy", "override", "system"].includes(normalizedSource)) {
      throw new StoreError("validation", "source must be policy, override, or system");
    }
    const safeReservePercent =
      reservePercent === null || reservePercent === undefined ? null : Math.max(0, Math.min(100, Number(reservePercent)));
    const safeHoldHours =
      holdHours === null || holdHours === undefined ? null : Math.max(1, Math.min(240, Number(holdHours)));
    insertPayoutRiskAction.run({
      transaction_id: normalizedTransactionId,
      case_id: caseId === null || caseId === undefined ? null : Number(caseId),
      seller_id: normalizedSellerId,
      action_type: normalizedActionType,
      reserve_percent: safeReservePercent,
      hold_hours: safeHoldHours,
      review_required: reviewRequired ? 1 : 0,
      reason_code: normalizedReasonCode,
      source: normalizedSource,
      policy_version_id:
        policyVersionId === null || policyVersionId === undefined ? null : Number(policyVersionId),
      policy_snapshot_json: JSON.stringify(policySnapshot ?? {}),
      actor_id: normalizedActorId,
      override_expires_at: overrideExpiresAt ?? null,
      metadata_json: JSON.stringify(metadata ?? {}),
      created_at: createdAt ?? now().toISOString()
    });
  }

  function deriveTrustRemediationConfidenceTier(score) {
    const normalized = Math.max(0, Math.min(100, Number(score ?? 0)));
    if (normalized >= 90) {
      return "critical";
    }
    if (normalized >= 75) {
      return "high";
    }
    if (normalized >= 55) {
      return "medium";
    }
    return "low";
  }

  function computeTrustRemediationAuditHash({ caseId, payload }) {
    const previous = mapTrustCaseRemediationAction(
      getLatestTrustCaseRemediationActionByCase.get({ case_id: Number(caseId) })
    );
    const digest = createHash("sha256");
    digest.update(String(caseId));
    digest.update("|");
    digest.update(previous?.auditChainHash ?? "root");
    digest.update("|");
    digest.update(JSON.stringify(payload ?? {}));
    return digest.digest("hex");
  }

  function computeTrustPreemptionAuditHash({ caseId, payload }) {
    const previous = mapTrustDisputePreemptionAction(
      getLatestTrustDisputePreemptionActionByCase.get({ case_id: Number(caseId) })
    );
    const digest = createHash("sha256");
    digest.update(String(caseId));
    digest.update("|");
    digest.update(previous?.auditChainHash ?? "root");
    digest.update("|");
    digest.update(JSON.stringify(payload ?? {}));
    return digest.digest("hex");
  }

  function computeListingAuthenticityForTransaction({
    transaction,
    policy = {},
    lookbackDays = 30
  }) {
    const sellerListings = listListingsBySeller
      .all({
        seller_id: transaction.sellerId,
        moderation_status: null,
        cursor_created_at: null,
        cursor_id: null,
        limit: 200
      })
      .map(mapListing);
    const normalizedTitles = sellerListings.map((listing) =>
      String(listing.title ?? "").trim().toLowerCase()
    );
    const normalizedDescriptions = sellerListings.map((listing) =>
      String(listing.description ?? "").trim().toLowerCase()
    );
    const titleOccurrences = new Map();
    for (const value of normalizedTitles) {
      if (!value) {
        continue;
      }
      titleOccurrences.set(value, (titleOccurrences.get(value) ?? 0) + 1);
    }
    const duplicateListingClusterCount = Array.from(titleOccurrences.values()).filter(
      (count) => count >= 2
    ).length;
    const avgPriceBaseline = averageListingPriceBySeller.get({ seller_id: transaction.sellerId });
    const baselineAveragePrice = Number(avgPriceBaseline?.average_price_cents ?? 0);
    const baselineCount = Number(avgPriceBaseline?.count ?? 0);
    const priceRatio =
      baselineAveragePrice > 0 ? Number(transaction.amountCents) / baselineAveragePrice : 1;
    const lookbackSinceAt = addHours(now().toISOString(), -Math.max(1, Number(lookbackDays)) * 24);
    const moderationRejectCount = Number(
      countSellerModerationRejectsSince.get({
        seller_id: transaction.sellerId,
        since_at: lookbackSinceAt
      })?.count ?? 0
    );
    const imageReuseHookKeywords = ["stock photo", "catalog image", "screenshot", "google image"];
    const imageReuseKeywordHits = normalizedDescriptions.filter((description) =>
      imageReuseHookKeywords.some((keyword) => description.includes(keyword))
    ).length;
    const imageReuseScore = Math.max(
      5,
      Math.min(
        100,
        Math.round(
          imageReuseKeywordHits > 0 ? 70 + imageReuseKeywordHits * 8 : duplicateListingClusterCount * 22
        )
      )
    );
    const duplicateClusterScore = Math.max(
      0,
      Math.min(100, duplicateListingClusterCount === 0 ? 8 : 35 + duplicateListingClusterCount * 18)
    );
    const isPriceOutlierHigh = baselineCount >= 2 && priceRatio >= Number(policy.authenticityPriceHighRatio ?? 2.6);
    const isPriceOutlierLow = baselineCount >= 2 && priceRatio <= Number(policy.authenticityPriceLowRatio ?? 0.35);
    const priceOutlierScore =
      isPriceOutlierHigh || isPriceOutlierLow
        ? Math.max(50, Math.min(100, Math.round(Math.abs(priceRatio - 1) * 45 + 40)))
        : 10;
    const sellerHistoryMismatchScore = Math.max(
      0,
      Math.min(100, moderationRejectCount === 0 ? 5 : 30 + moderationRejectCount * 12)
    );
    const authenticityRiskScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          imageReuseScore * 0.3 +
            duplicateClusterScore * 0.25 +
            priceOutlierScore * 0.2 +
            sellerHistoryMismatchScore * 0.25
        )
      )
    );
    const signals = [
      {
        signalType: "image_reuse",
        reasonCode: imageReuseKeywordHits > 0 ? "image_reuse_keyword_match" : "image_reuse_similarity_hook",
        confidenceScore: imageReuseScore,
        signalDetails: {
          imageReuseKeywordHits,
          duplicateListingClusterCount
        }
      },
      {
        signalType: "duplicate_listing_cluster",
        reasonCode:
          duplicateListingClusterCount > 0
            ? "duplicate_cluster_detected"
            : "duplicate_cluster_not_detected",
        confidenceScore: duplicateClusterScore,
        signalDetails: {
          duplicateListingClusterCount
        }
      },
      {
        signalType: "price_outlier",
        reasonCode:
          isPriceOutlierHigh || isPriceOutlierLow ? "price_outlier_detected" : "price_outlier_not_detected",
        confidenceScore: priceOutlierScore,
        signalDetails: {
          baselineAveragePriceCents: baselineAveragePrice,
          baselineSampleCount: baselineCount,
          transactionAmountCents: transaction.amountCents,
          priceRatio: Number(priceRatio.toFixed(4))
        }
      },
      {
        signalType: "seller_history_mismatch",
        reasonCode:
          moderationRejectCount > 0 ? "seller_history_mismatch_detected" : "seller_history_consistent",
        confidenceScore: sellerHistoryMismatchScore,
        signalDetails: {
          moderationRejectCount30d: moderationRejectCount
        }
      }
    ];
    return {
      authenticityRiskScore,
      signals,
      summary: {
        duplicateListingClusterCount,
        imageReuseKeywordHits,
        priceRatio: Number(priceRatio.toFixed(4)),
        moderationRejectCount30d: moderationRejectCount
      }
    };
  }

  function resolveV10InterdictionPlan({
    transaction,
    combinedRiskScore,
    networkRiskScore,
    policy = {}
  }) {
    const v10Enabled = policy.v10Enabled === true;
    const listingAuthenticity = computeListingAuthenticityForTransaction({
      transaction,
      policy,
      lookbackDays: Number(policy.authenticityLookbackDays ?? 30)
    });
    const behavioralAnomalyScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          Math.max(Number(transaction.riskScore ?? 0), Number(networkRiskScore ?? 0)) * 0.6 +
            Math.min(100, Number(transaction.amountCents ?? 0) / 1000) * 0.4
        )
      )
    );
    const proactiveInterdictionScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          Number(combinedRiskScore ?? 0) * 0.35 +
            Number(networkRiskScore ?? 0) * 0.25 +
            Number(listingAuthenticity.authenticityRiskScore ?? 0) * 0.3 +
            behavioralAnomalyScore * 0.1
        )
      )
    );
    const confidenceTier = deriveTrustRemediationConfidenceTier(proactiveInterdictionScore);
    const reserveEscalationPercentByTier = {
      low: 0,
      medium: Number(policy.v10ReserveEscalationMediumPercent ?? 20),
      high: Number(policy.v10ReserveEscalationHighPercent ?? 35),
      critical: Number(policy.v10ReserveEscalationCriticalPercent ?? 50)
    };
    const actions = [];
    if (confidenceTier !== "low") {
      actions.push({
        actionType: "offer_throttle",
        reasonCode: "v10_offer_throttle",
        confidenceTier,
        machineEligible: true,
        highImpact: false
      });
      actions.push({
        actionType: "payout_reserve_escalation",
        reasonCode: "v10_payout_reserve_escalation",
        confidenceTier,
        machineEligible: true,
        highImpact: false,
        reservePercent: Math.max(0, Math.min(80, Number(reserveEscalationPercentByTier[confidenceTier] ?? 0)))
      });
    }
    if (confidenceTier === "high" || confidenceTier === "critical") {
      actions.push({
        actionType: "listing_quarantine",
        reasonCode: "v10_listing_quarantine",
        confidenceTier,
        machineEligible: true,
        highImpact: true
      });
      actions.push({
        actionType: "account_capability_restriction",
        reasonCode: "v10_account_capability_restriction",
        confidenceTier,
        machineEligible: confidenceTier === "critical",
        highImpact: true
      });
    }
    const machineHumanDecisionBoundary = {
      autoAppliedActions: actions
        .filter((item) => item.machineEligible)
        .map((item) => item.actionType),
      humanReviewRequiredActions: actions
        .filter((item) => !item.machineEligible || item.highImpact)
        .map((item) => item.actionType),
      overridePath: {
        route: "/admin/trust-operations/cases/:id/override",
        allowedActions: ["hold", "clear", "none"],
        requiredFields: ["reasonCode"],
        decisionBoundary:
          "Machine may auto-apply low-impact actions. High-impact controls require operator confirmation or are reversible via operator clear."
      }
    };
    const evidenceBundleExportPayload = {
      version: "trust_v10_evidence_bundle",
      generatedAt: now().toISOString(),
      transactionId: transaction.id,
      sellerId: transaction.sellerId,
      scores: {
        combinedRiskScore,
        networkRiskScore,
        behavioralAnomalyScore,
        listingAuthenticityRiskScore: listingAuthenticity.authenticityRiskScore,
        proactiveInterdictionScore
      },
      confidenceTier,
      signals: listingAuthenticity.signals,
      actions
    };
    return {
      enabled: v10Enabled,
      proactiveInterdictionScore,
      confidenceTier,
      listingAuthenticity,
      behavioralAnomalyScore,
      actions,
      machineHumanDecisionBoundary,
      evidenceBundleExportPayload
    };
  }

  function resolveV11BuyerRiskIntelligence({
    transaction,
    combinedRiskScore,
    networkRiskScore,
    policy = {}
  }) {
    const v11Enabled = policy.v11Enabled === true;
    const highScore = Math.max(0, Math.min(100, Number(policy.v11BuyerRiskHighScore ?? 68)));
    const criticalScore = Math.max(
      highScore,
      Math.min(100, Number(policy.v11BuyerRiskCriticalScore ?? 85))
    );
    const escrowAnomalyHighScore = Math.max(
      0,
      Math.min(100, Number(policy.v11EscrowAnomalyHighScore ?? 70))
    );
    const preemptionHighScore = Math.max(
      0,
      Math.min(100, Number(policy.v11DisputePreemptionHighScore ?? 65))
    );
    const delayHours = Math.max(
      0,
      Math.min(168, Number(policy.v11TemporarySettlementDelayHours ?? 24))
    );
    const velocityControlWindowHours = Math.max(
      0,
      Math.min(168, Number(policy.v11VelocityControlWindowHours ?? 48))
    );
    const nowIso = now().toISOString();
    const velocitySinceAt = addHours(nowIso, -24);
    const disputeSinceAt = addHours(nowIso, -30 * 24);
    const buyerVelocity24h = Number(
      countRecentAcceptedTransactionsByBuyer.get({
        user_id: transaction.buyerId,
        since_at: velocitySinceAt
      })?.count ?? 0
    );
    const buyerDisputes30d = Number(
      countRecentDisputeOpenedByActor.get({
        actor_id: transaction.buyerId,
        since_at: disputeSinceAt
      })?.count ?? 0
    );
    const paymentBehaviorValue = Math.max(
      0,
      Math.min(
        100,
        Math.round(Number(transaction.riskScore ?? 0) * 0.55 + Math.min(100, buyerVelocity24h * 12) * 0.45)
      )
    );
    const messagingIntentValue = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          Math.min(100, buyerDisputes30d * 22) * 0.65 +
            Math.max(0, Number(networkRiskScore ?? 0)) * 0.35
        )
      )
    );
    const disputeHistoryValue = Math.max(0, Math.min(100, Math.round(Math.min(100, buyerDisputes30d * 18))));
    const trustHistoryValue = Math.max(
      0,
      Math.min(
        100,
        Math.round(Math.max(0, 100 - paymentBehaviorValue) * 0.55 + Math.max(0, 100 - disputeHistoryValue) * 0.45)
      )
    );
    const escrowAnomalyValue = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          Number(combinedRiskScore ?? 0) * 0.45 +
            Number(networkRiskScore ?? 0) * 0.35 +
            paymentBehaviorValue * 0.2
        )
      )
    );
    const featureAttributions = [
      {
        signalType: "payment_behavior",
        reasonCode: "buyer_payment_behavior_signal",
        featureWeight: 0.3,
        featureValue: paymentBehaviorValue,
        contributionScore: Number((paymentBehaviorValue * 0.3).toFixed(4)),
        signalDetails: {
          buyerVelocity24h,
          transactionRiskScore: Number(transaction.riskScore ?? 0)
        }
      },
      {
        signalType: "messaging_intent",
        reasonCode: "buyer_messaging_intent_signal",
        featureWeight: 0.22,
        featureValue: messagingIntentValue,
        contributionScore: Number((messagingIntentValue * 0.22).toFixed(4)),
        signalDetails: {
          buyerDisputes30d,
          networkRiskScore: Number(networkRiskScore ?? 0)
        }
      },
      {
        signalType: "dispute_history",
        reasonCode: "buyer_dispute_history_signal",
        featureWeight: 0.18,
        featureValue: disputeHistoryValue,
        contributionScore: Number((disputeHistoryValue * 0.18).toFixed(4)),
        signalDetails: {
          buyerDisputes30d
        }
      },
      {
        signalType: "trust_history",
        reasonCode: "buyer_trust_history_signal",
        featureWeight: 0.14,
        featureValue: trustHistoryValue,
        contributionScore: Number((trustHistoryValue * 0.14).toFixed(4)),
        signalDetails: {
          inverseBehaviorIndex: Math.max(0, Number((100 - paymentBehaviorValue).toFixed(2))),
          inverseDisputeIndex: Math.max(0, Number((100 - disputeHistoryValue).toFixed(2)))
        }
      },
      {
        signalType: "escrow_anomaly_forecast",
        reasonCode: "escrow_anomaly_forecast_signal",
        featureWeight: 0.16,
        featureValue: escrowAnomalyValue,
        contributionScore: Number((escrowAnomalyValue * 0.16).toFixed(4)),
        signalDetails: {
          combinedRiskScore: Number(combinedRiskScore ?? 0),
          networkRiskScore: Number(networkRiskScore ?? 0)
        }
      }
    ];
    const buyerRiskScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(featureAttributions.reduce((sum, item) => sum + item.contributionScore, 0))
      )
    );
    const escrowAnomalyScore = escrowAnomalyValue;
    const disputePreemptionScore = Math.max(buyerRiskScore, escrowAnomalyScore, Number(combinedRiskScore ?? 0));
    const confidenceTier = deriveTrustRemediationConfidenceTier(disputePreemptionScore);
    const highOrCritical = ["high", "critical"].includes(confidenceTier);
    const actions = [];
    if (disputePreemptionScore >= preemptionHighScore) {
      actions.push({
        actionType: "proactive_evidence_prompt",
        reasonCode: "v11_proactive_evidence_prompt",
        confidenceTier,
        machineEligible: true,
        highImpact: false
      });
      actions.push({
        actionType: "milestone_confirmation_nudge",
        reasonCode: "v11_milestone_confirmation_nudge",
        confidenceTier,
        machineEligible: true,
        highImpact: false
      });
      actions.push({
        actionType: "conditional_hold_checkpoint",
        reasonCode: "v11_conditional_hold_checkpoint",
        confidenceTier,
        machineEligible: true,
        highImpact: false
      });
      actions.push({
        actionType: "conditional_release_checkpoint",
        reasonCode: "v11_conditional_release_checkpoint",
        confidenceTier,
        machineEligible: true,
        highImpact: false
      });
    }
    if (highOrCritical || buyerRiskScore >= highScore || escrowAnomalyScore >= escrowAnomalyHighScore) {
      actions.push({
        actionType: "verification_step_up",
        reasonCode: "v11_verification_step_up",
        confidenceTier,
        machineEligible: false,
        highImpact: true
      });
      actions.push({
        actionType: "transaction_velocity_control",
        reasonCode: "v11_transaction_velocity_control",
        confidenceTier,
        machineEligible: true,
        highImpact: false,
        windowHours: velocityControlWindowHours
      });
      if (delayHours > 0) {
        actions.push({
          actionType: "temporary_settlement_delay",
          reasonCode: "v11_temporary_settlement_delay",
          confidenceTier,
          machineEligible: true,
          highImpact: false,
          delayHours
        });
      }
    }
    const machineHumanDecisionBoundary = {
      autoAppliedActions: actions
        .filter((item) => item.machineEligible)
        .map((item) => item.actionType),
      humanReviewRequiredActions: actions
        .filter((item) => !item.machineEligible || item.highImpact)
        .map((item) => item.actionType),
      overridePath: {
        route: "/admin/trust-operations/cases/:id/override",
        allowedActions: ["hold", "clear", "none"],
        requiredFields: ["reasonCode"],
        decisionBoundary:
          "Machine can run low-impact preemption actions; high-impact verification and irreversible controls require operator review."
      }
    };
    const alternativePaths = {
      conservative: actions.filter((item) =>
        ["verification_step_up", "temporary_settlement_delay", "conditional_hold_checkpoint"].includes(
          item.actionType
        )
      ),
      balanced: actions,
      permissive: actions.filter((item) =>
        ["proactive_evidence_prompt", "milestone_confirmation_nudge", "conditional_release_checkpoint"].includes(
          item.actionType
        )
      )
    };
    return {
      enabled: v11Enabled,
      buyerRiskScore,
      escrowAnomalyScore,
      disputePreemptionScore,
      confidenceTier,
      featureAttributions,
      attributionSummary: {
        topSignals: featureAttributions
          .slice()
          .sort((left, right) => right.contributionScore - left.contributionScore)
          .slice(0, 3)
          .map((item) => ({
            signalType: item.signalType,
            contributionScore: item.contributionScore
          })),
        buyerVelocity24h,
        buyerDisputes30d
      },
      actions,
      machineHumanDecisionBoundary,
      alternativePaths,
      policyThresholds: {
        v11BuyerRiskHighScore: highScore,
        v11BuyerRiskCriticalScore: criticalScore,
        v11EscrowAnomalyHighScore: escrowAnomalyHighScore,
        v11DisputePreemptionHighScore: preemptionHighScore,
        v11TemporarySettlementDelayHours: delayHours,
        v11VelocityControlWindowHours: velocityControlWindowHours
      }
    };
  }

  function appendTrustListingAuthenticitySignals({
    caseId = null,
    transactionId,
    sellerId,
    signals = [],
    policyVersionId = null,
    createdBy
  }) {
    const normalizedTransactionId = String(transactionId ?? "").trim();
    const normalizedSellerId = String(sellerId ?? "").trim();
    const normalizedCreatedBy = String(createdBy ?? "").trim();
    if (!normalizedTransactionId || !normalizedSellerId || !normalizedCreatedBy) {
      throw new StoreError(
        "validation",
        "transactionId, sellerId, and createdBy are required for authenticity signals"
      );
    }
    const inserted = [];
    for (const item of signals) {
      const signalType = String(item.signalType ?? "").trim();
      if (!VALID_TRUST_LISTING_AUTH_SIGNAL_TYPES.has(signalType)) {
        continue;
      }
      const reasonCode = String(item.reasonCode ?? "").trim() || "trust_forensics_signal";
      const confidenceScore = Math.max(0, Math.min(100, Number(item.confidenceScore ?? 0)));
      const createdAt = now().toISOString();
      insertTrustListingAuthenticitySignal.run({
        case_id: caseId === null || caseId === undefined ? null : Number(caseId),
        transaction_id: normalizedTransactionId,
        listing_id: item.listingId ? String(item.listingId).trim() : null,
        seller_id: normalizedSellerId,
        signal_type: signalType,
        reason_code: reasonCode,
        confidence_score: confidenceScore,
        signal_details_json: JSON.stringify(item.signalDetails ?? {}),
        policy_version_id:
          policyVersionId === null || policyVersionId === undefined ? null : Number(policyVersionId),
        created_by: normalizedCreatedBy,
        created_at: createdAt
      });
      inserted.push({
        signalType,
        reasonCode,
        confidenceScore
      });
    }
    return inserted;
  }

  function appendTrustCaseRemediationAction({
    caseId,
    transactionId,
    actionType,
    confidenceTier,
    status,
    reasonCode,
    policyVersionId = null,
    machineDecision = {},
    humanDecision = {},
    rollbackOfActionId = null,
    createdBy
  }) {
    if (!Number.isInteger(caseId) || caseId <= 0) {
      throw new StoreError("validation", "caseId must be a positive integer");
    }
    const normalizedActionType = String(actionType ?? "").trim();
    if (!VALID_TRUST_REMEDIATION_ACTION_TYPES.has(normalizedActionType)) {
      throw new StoreError("validation", "invalid trust remediation actionType");
    }
    const normalizedConfidenceTier = String(confidenceTier ?? "").trim();
    if (!VALID_TRUST_REMEDIATION_CONFIDENCE_TIERS.has(normalizedConfidenceTier)) {
      throw new StoreError("validation", "invalid trust remediation confidenceTier");
    }
    const normalizedStatus = String(status ?? "").trim();
    if (!VALID_TRUST_REMEDIATION_ACTION_STATUSES.has(normalizedStatus)) {
      throw new StoreError("validation", "invalid trust remediation status");
    }
    const normalizedTransactionId = String(transactionId ?? "").trim();
    const normalizedReasonCode = String(reasonCode ?? "").trim();
    const normalizedCreatedBy = String(createdBy ?? "").trim();
    if (!normalizedTransactionId || !normalizedReasonCode || !normalizedCreatedBy) {
      throw new StoreError("validation", "transactionId, reasonCode, and createdBy are required");
    }
    const createdAt = now().toISOString();
    const payload = {
      transactionId: normalizedTransactionId,
      actionType: normalizedActionType,
      confidenceTier: normalizedConfidenceTier,
      status: normalizedStatus,
      reasonCode: normalizedReasonCode,
      machineDecision,
      humanDecision,
      rollbackOfActionId
    };
    const auditChainHash = computeTrustRemediationAuditHash({
      caseId,
      payload
    });
    const result = insertTrustCaseRemediationAction.run({
      case_id: caseId,
      transaction_id: normalizedTransactionId,
      action_type: normalizedActionType,
      confidence_tier: normalizedConfidenceTier,
      status: normalizedStatus,
      reason_code: normalizedReasonCode,
      policy_version_id:
        policyVersionId === null || policyVersionId === undefined ? null : Number(policyVersionId),
      machine_decision_json: JSON.stringify(machineDecision ?? {}),
      human_decision_json: JSON.stringify(humanDecision ?? {}),
      rollback_of_action_id:
        rollbackOfActionId === null || rollbackOfActionId === undefined ? null : Number(rollbackOfActionId),
      audit_chain_hash: auditChainHash,
      created_by: normalizedCreatedBy,
      created_at: createdAt,
      updated_at: createdAt
    });
    const inserted = listTrustCaseRemediationActionsByCase
      .all({ case_id: caseId, limit: 1 })
      .map(mapTrustCaseRemediationAction)
      .find((item) => item.id === Number(result.lastInsertRowid));
    return inserted ?? null;
  }

  function appendTrustBuyerRiskSignals({
    caseId = null,
    transactionId,
    buyerId,
    featureAttributions = [],
    policyVersionId = null,
    createdBy
  }) {
    const normalizedTransactionId = String(transactionId ?? "").trim();
    const normalizedBuyerId = String(buyerId ?? "").trim();
    const normalizedCreatedBy = String(createdBy ?? "").trim();
    if (!normalizedTransactionId || !normalizedBuyerId || !normalizedCreatedBy) {
      throw new StoreError(
        "validation",
        "transactionId, buyerId, and createdBy are required for buyer risk signals"
      );
    }
    const inserted = [];
    for (const item of featureAttributions) {
      const signalType = String(item.signalType ?? "").trim();
      if (!VALID_TRUST_BUYER_RISK_SIGNAL_TYPES.has(signalType)) {
        continue;
      }
      const reasonCode = String(item.reasonCode ?? "").trim() || "v11_buyer_risk_signal";
      const featureWeight = Number(item.featureWeight ?? 0);
      const featureValue = Number(item.featureValue ?? 0);
      const contributionScore = Number(item.contributionScore ?? 0);
      const createdAt = now().toISOString();
      insertTrustBuyerRiskSignal.run({
        case_id: caseId === null || caseId === undefined ? null : Number(caseId),
        transaction_id: normalizedTransactionId,
        buyer_id: normalizedBuyerId,
        signal_type: signalType,
        reason_code: reasonCode,
        feature_weight: Number.isFinite(featureWeight) ? featureWeight : 0,
        feature_value: Number.isFinite(featureValue) ? featureValue : 0,
        contribution_score: Number.isFinite(contributionScore) ? contributionScore : 0,
        signal_details_json: JSON.stringify(item.signalDetails ?? {}),
        policy_version_id:
          policyVersionId === null || policyVersionId === undefined ? null : Number(policyVersionId),
        created_by: normalizedCreatedBy,
        created_at: createdAt
      });
      inserted.push({
        signalType,
        reasonCode,
        featureWeight,
        featureValue,
        contributionScore
      });
    }
    return inserted;
  }

  function appendTrustDisputePreemptionAction({
    caseId,
    transactionId,
    actionType,
    confidenceTier,
    status,
    reasonCode,
    policyVersionId = null,
    machineDecision = {},
    humanDecision = {},
    rollbackOfActionId = null,
    createdBy
  }) {
    if (!Number.isInteger(caseId) || caseId <= 0) {
      throw new StoreError("validation", "caseId must be a positive integer");
    }
    const normalizedActionType = String(actionType ?? "").trim();
    if (!VALID_TRUST_PREEMPTION_ACTION_TYPES.has(normalizedActionType)) {
      throw new StoreError("validation", "invalid trust preemption actionType");
    }
    const normalizedConfidenceTier = String(confidenceTier ?? "").trim();
    if (!VALID_TRUST_REMEDIATION_CONFIDENCE_TIERS.has(normalizedConfidenceTier)) {
      throw new StoreError("validation", "invalid trust preemption confidenceTier");
    }
    const normalizedStatus = String(status ?? "").trim();
    if (!VALID_TRUST_REMEDIATION_ACTION_STATUSES.has(normalizedStatus)) {
      throw new StoreError("validation", "invalid trust preemption status");
    }
    const normalizedTransactionId = String(transactionId ?? "").trim();
    const normalizedReasonCode = String(reasonCode ?? "").trim();
    const normalizedCreatedBy = String(createdBy ?? "").trim();
    if (!normalizedTransactionId || !normalizedReasonCode || !normalizedCreatedBy) {
      throw new StoreError("validation", "transactionId, reasonCode, and createdBy are required");
    }
    const createdAt = now().toISOString();
    const payload = {
      transactionId: normalizedTransactionId,
      actionType: normalizedActionType,
      confidenceTier: normalizedConfidenceTier,
      status: normalizedStatus,
      reasonCode: normalizedReasonCode,
      machineDecision,
      humanDecision,
      rollbackOfActionId
    };
    const auditChainHash = computeTrustPreemptionAuditHash({
      caseId,
      payload
    });
    const result = insertTrustDisputePreemptionAction.run({
      case_id: caseId,
      transaction_id: normalizedTransactionId,
      action_type: normalizedActionType,
      confidence_tier: normalizedConfidenceTier,
      status: normalizedStatus,
      reason_code: normalizedReasonCode,
      policy_version_id:
        policyVersionId === null || policyVersionId === undefined ? null : Number(policyVersionId),
      machine_decision_json: JSON.stringify(machineDecision ?? {}),
      human_decision_json: JSON.stringify(humanDecision ?? {}),
      rollback_of_action_id:
        rollbackOfActionId === null || rollbackOfActionId === undefined ? null : Number(rollbackOfActionId),
      audit_chain_hash: auditChainHash,
      created_by: normalizedCreatedBy,
      created_at: createdAt,
      updated_at: createdAt
    });
    const inserted = listTrustDisputePreemptionActionsByCase
      .all({ case_id: caseId, limit: 1 })
      .map(mapTrustDisputePreemptionAction)
      .find((item) => item.id === Number(result.lastInsertRowid));
    return inserted ?? null;
  }

  function refreshUserRiskTierProfile({
    userId,
    actorId = null,
    reason = null,
    source = "system",
    requestId = null,
    correlationId = null,
    force = false
  }) {
    const user = mapUser(getUserById.get(userId));
    if (!user) {
      throw new StoreError("not_found", "user not found");
    }
    const normalizedSource = String(source ?? "system").trim();
    if (!VALID_RISK_TIER_SOURCES.has(normalizedSource)) {
      throw new StoreError("validation", "risk tier source must be system or override");
    }

    if (normalizedSource === "system" && user.riskTierSource === "override" && !force) {
      return user;
    }

    const nowIso = now().toISOString();
    const nowTs = new Date(nowIso);
    const disputeWindowIso = new Date(nowTs.valueOf() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const velocityWindowIso = new Date(nowTs.valueOf() - 24 * 60 * 60 * 1000).toISOString();
    const accountAgeDays = Math.max(
      0,
      Math.floor((nowTs.valueOf() - new Date(user.createdAt).valueOf()) / (24 * 60 * 60 * 1000))
    );

    const signalsSeverity = Number(sumRiskSeverityByUser.get({ user_id: user.id })?.total_severity ?? 0);
    const disputesOpened = Number(
      countRecentDisputeOpenedByActor.get({ actor_id: user.id, since_at: disputeWindowIso })?.count ?? 0
    );
    const buyerVelocity = Number(
      countRecentAcceptedTransactionsByBuyer.get({ user_id: user.id, since_at: velocityWindowIso })?.count ?? 0
    );
    const sellerVelocity = Number(
      countRecentAcceptedTransactionsBySeller.get({ user_id: user.id, since_at: velocityWindowIso })?.count ?? 0
    );

    let score = Math.round(Math.min(100, signalsSeverity * 0.5));
    if (user.riskFlagged) {
      score += 55;
    }
    if (user.verificationStatus === "rejected") {
      score += 35;
    } else if (user.verificationStatus === "pending") {
      score += 8;
    }
    if (disputesOpened >= 2) {
      score += 20;
    }
    if (buyerVelocity > 5 || sellerVelocity > 5) {
      score += 20;
    }
    if (accountAgeDays < 14) {
      score += 10;
    }
    score = Math.max(0, Math.min(100, score));

    const nextTier = deriveRiskTier(score);
    const previousTier = user.riskTier;
    const nextSource = normalizedSource;
    if (
      nextTier === previousTier &&
      user.riskTierSource === nextSource &&
      normalizedSource === "system"
    ) {
      return user;
    }

    const details = {
      score,
      factors: {
        signalsSeverity,
        disputesOpened30d: disputesOpened,
        buyerVelocity24h: buyerVelocity,
        sellerVelocity24h: sellerVelocity,
        accountAgeDays,
        riskFlagged: user.riskFlagged,
        verificationStatus: user.verificationStatus
      }
    };
    const run = db.transaction(() => {
      updateUserRiskTierProfile.run({
        id: user.id,
        risk_tier: nextTier,
        risk_tier_source: nextSource,
        risk_tier_override_reason: nextSource === "override" ? String(reason ?? "").trim() || null : null,
        risk_tier_updated_at: nowIso,
        risk_tier_updated_by: actorId ? String(actorId).trim() : null,
        updated_at: nowIso
      });
      insertRiskTierEvent.run({
        user_id: user.id,
        previous_tier: previousTier,
        next_tier: nextTier,
        source: nextSource,
        actor_id: actorId ? String(actorId).trim() : null,
        reason: reason ? String(reason).trim() : null,
        details_json: JSON.stringify(details),
        request_id: requestId ? String(requestId).trim() : null,
        correlation_id: correlationId ? String(correlationId).trim() : null,
        created_at: nowIso
      });
    });
    run();
    return mapUser(getUserById.get(user.id));
  }

  function normalizeLaunchControlKey(key) {
    const normalized = String(key ?? "").trim();
    if (!VALID_LAUNCH_CONTROL_FLAG_KEYS.has(normalized)) {
      throw new StoreError(
        "validation",
        "launch control key must be one of: transaction_initiation, payout_release, dispute_auto_transitions, moderation_auto_actions"
      );
    }
    return normalized;
  }

  function normalizeAllowlist(values) {
    const source = Array.isArray(values) ? values : [];
    return Array.from(
      new Set(
        source
          .map((value) => String(value ?? "").trim())
          .filter(Boolean)
      )
    ).sort((left, right) => left.localeCompare(right));
  }

  return {
    close() {
      db.close();
    },

    checkReadiness() {
      const row = pingStatement.get();
      return row?.ok === 1;
    },

    createUser({ id, email, role, passwordHash, passwordSalt }) {
      if (!id || !email || !role || !passwordHash || !passwordSalt) {
        throw new StoreError("validation", "id, email, role, and password credentials are required");
      }

      if (!VALID_ROLES.has(role)) {
        throw new StoreError("validation", "role must be one of: buyer, seller, admin");
      }

      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail) {
        throw new StoreError("validation", "email is required");
      }

      const timestamp = now().toISOString();

      try {
        insertUser.run({
          id,
          email: normalizedEmail,
          role,
          password_hash: passwordHash,
          password_salt: passwordSalt,
          password_updated_at: timestamp,
          created_at: timestamp,
          updated_at: timestamp
        });
      } catch (error) {
        if (error && typeof error.message === "string" && error.message.includes("UNIQUE")) {
          throw new StoreError("conflict", "email already exists");
        }
        throw error;
      }

      return mapUser(getUserById.get(id));
    },

    getUserById(id) {
      return mapUser(getUserById.get(id));
    },

    getUserAuthByEmail(email) {
      if (!email) {
        return null;
      }

      const normalizedEmail = email.trim().toLowerCase();
      const user = getUserByEmail.get(normalizedEmail);
      if (!user) {
        return null;
      }

      return {
        user: mapUser(user),
        passwordHash: user.password_hash,
        passwordSalt: user.password_salt
      };
    },

    recordUserLogin(id) {
      const existing = getUserById.get(id);
      if (!existing) {
        throw new StoreError("not_found", "user not found");
      }

      const timestamp = now().toISOString();
      markUserLogin.run({ id, last_login_at: timestamp, updated_at: timestamp });
      return mapUser(getUserById.get(id));
    },

    setAccountRiskControls({
      userId,
      flagged,
      flagReason,
      verificationRequired,
      actorId,
      reason,
      notes,
      requestId,
      correlationId
    }) {
      const existing = mapUser(getUserById.get(userId));
      if (!existing) {
        throw new StoreError("not_found", "user not found");
      }
      if (!actorId || typeof actorId !== "string" || !actorId.trim()) {
        throw new StoreError("validation", "actorId is required");
      }

      const nextFlagged = flagged === undefined ? existing.riskFlagged : Boolean(flagged);
      const nextVerificationRequired =
        verificationRequired === undefined
          ? existing.verificationRequired
          : Boolean(verificationRequired);
      const timestamp = now().toISOString();
      const run = db.transaction(() => {
        updateUserRiskControls.run({
          id: userId,
          risk_flagged: nextFlagged ? 1 : 0,
          risk_flag_reason: nextFlagged ? String(flagReason ?? reason ?? "").trim() || null : null,
          risk_flag_updated_at: timestamp,
          verification_required: nextVerificationRequired ? 1 : 0,
          updated_at: timestamp
        });

        if (flagged !== undefined) {
          insertRiskOperatorAction.run({
            subject_type: "account",
            subject_id: userId,
            action_type: nextFlagged ? "flag_account" : "unflag_account",
            reason: reason ?? null,
            notes: notes ?? null,
            actor_id: actorId.trim(),
            correlation_id: correlationId ?? null,
            request_id: requestId ?? null,
            created_at: timestamp
          });
        }
        if (verificationRequired !== undefined) {
          insertRiskOperatorAction.run({
            subject_type: "account",
            subject_id: userId,
            action_type: nextVerificationRequired ? "require_verification" : "clear_verification",
            reason: reason ?? null,
            notes: notes ?? null,
            actor_id: actorId.trim(),
            correlation_id: correlationId ?? null,
            request_id: requestId ?? null,
            created_at: timestamp
          });
        }
      });
      run();

      return refreshUserRiskTierProfile({
        userId,
        actorId,
        reason,
        source: "system",
        requestId,
        correlationId
      });
    },

    submitIdentityVerification({
      userId,
      actorId,
      evidence = {},
      reviewNotes = null,
      reason = null,
      requestId = null,
      correlationId = null
    }) {
      if (!userId || typeof userId !== "string") {
        throw new StoreError("validation", "userId is required");
      }
      if (!actorId || typeof actorId !== "string" || !actorId.trim()) {
        throw new StoreError("validation", "actorId is required");
      }
      const existing = mapUser(getUserById.get(userId));
      if (!existing) {
        throw new StoreError("not_found", "user not found");
      }
      const timestamp = now().toISOString();
      const run = db.transaction(() => {
        updateUserVerificationProfile.run({
          id: userId,
          verification_status: "pending",
          verification_submitted_at: timestamp,
          verification_decided_at: null,
          verification_decided_by: null,
          verification_evidence_json: JSON.stringify(evidence ?? {}),
          verification_review_notes: reviewNotes ? String(reviewNotes).trim() : null,
          updated_at: timestamp
        });
        insertIdentityVerificationEvent.run({
          user_id: userId,
          from_status: existing.verificationStatus,
          to_status: "pending",
          actor_id: actorId.trim(),
          reason: reason ? String(reason).trim() : null,
          review_notes: reviewNotes ? String(reviewNotes).trim() : null,
          evidence_json: JSON.stringify(evidence ?? {}),
          request_id: requestId ? String(requestId).trim() : null,
          correlation_id: correlationId ? String(correlationId).trim() : null,
          created_at: timestamp
        });
      });
      run();
      return refreshUserRiskTierProfile({
        userId,
        actorId,
        reason,
        source: "system",
        requestId,
        correlationId
      });
    },

    reviewIdentityVerification({
      userId,
      status,
      actorId,
      reviewNotes = null,
      reason = null,
      requestId = null,
      correlationId = null
    }) {
      if (!userId || typeof userId !== "string") {
        throw new StoreError("validation", "userId is required");
      }
      if (!actorId || typeof actorId !== "string" || !actorId.trim()) {
        throw new StoreError("validation", "actorId is required");
      }
      const nextStatus = normalizeVerificationStatus(status);
      if (nextStatus !== "verified" && nextStatus !== "rejected") {
        throw new StoreError("validation", "status must be verified or rejected");
      }
      const existing = mapUser(getUserById.get(userId));
      if (!existing) {
        throw new StoreError("not_found", "user not found");
      }
      const timestamp = now().toISOString();
      const run = db.transaction(() => {
        updateUserVerificationProfile.run({
          id: userId,
          verification_status: nextStatus,
          verification_submitted_at: existing.verificationSubmittedAt ?? timestamp,
          verification_decided_at: timestamp,
          verification_decided_by: actorId.trim(),
          verification_evidence_json: JSON.stringify(existing.verificationEvidence ?? {}),
          verification_review_notes: reviewNotes ? String(reviewNotes).trim() : null,
          updated_at: timestamp
        });
        insertIdentityVerificationEvent.run({
          user_id: userId,
          from_status: existing.verificationStatus,
          to_status: nextStatus,
          actor_id: actorId.trim(),
          reason: reason ? String(reason).trim() : null,
          review_notes: reviewNotes ? String(reviewNotes).trim() : null,
          evidence_json: JSON.stringify(existing.verificationEvidence ?? {}),
          request_id: requestId ? String(requestId).trim() : null,
          correlation_id: correlationId ? String(correlationId).trim() : null,
          created_at: timestamp
        });
      });
      run();
      return refreshUserRiskTierProfile({
        userId,
        actorId,
        reason,
        source: "system",
        requestId,
        correlationId
      });
    },

    listIdentityVerificationEvents({ userId, limit = 100 } = {}) {
      if (!userId || typeof userId !== "string") {
        throw new StoreError("validation", "userId is required");
      }
      if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
        throw new StoreError("validation", "limit must be an integer between 1 and 500");
      }
      return listIdentityVerificationEventsByUser
        .all({ user_id: userId, limit })
        .map(mapIdentityVerificationEvent);
    },

    listAccountsByVerificationStatus({ status = "pending", limit = 100 } = {}) {
      const normalizedStatus = normalizeVerificationStatus(status);
      if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
        throw new StoreError("validation", "limit must be an integer between 1 and 500");
      }
      return listUsersByVerificationStatus
        .all({ verification_status: normalizedStatus, limit })
        .map(mapUser);
    },

    setAccountRiskTierOverride({
      userId,
      tier,
      actorId,
      reason,
      details = {},
      requestId = null,
      correlationId = null
    }) {
      if (!userId || typeof userId !== "string") {
        throw new StoreError("validation", "userId is required");
      }
      if (!actorId || typeof actorId !== "string" || !actorId.trim()) {
        throw new StoreError("validation", "actorId is required");
      }
      if (!reason || typeof reason !== "string" || !reason.trim()) {
        throw new StoreError("validation", "reason is required");
      }
      const nextTier = normalizeRiskTier(tier);
      const existing = mapUser(getUserById.get(userId));
      if (!existing) {
        throw new StoreError("not_found", "user not found");
      }
      const timestamp = now().toISOString();
      const run = db.transaction(() => {
        updateUserRiskTierProfile.run({
          id: userId,
          risk_tier: nextTier,
          risk_tier_source: "override",
          risk_tier_override_reason: reason.trim(),
          risk_tier_updated_at: timestamp,
          risk_tier_updated_by: actorId.trim(),
          updated_at: timestamp
        });
        insertRiskTierEvent.run({
          user_id: userId,
          previous_tier: existing.riskTier,
          next_tier: nextTier,
          source: "override",
          actor_id: actorId.trim(),
          reason: reason.trim(),
          details_json: JSON.stringify(details ?? {}),
          request_id: requestId ? String(requestId).trim() : null,
          correlation_id: correlationId ? String(correlationId).trim() : null,
          created_at: timestamp
        });
      });
      run();
      return mapUser(getUserById.get(userId));
    },

    clearAccountRiskTierOverride({
      userId,
      actorId,
      reason = null,
      requestId = null,
      correlationId = null
    }) {
      if (!userId || typeof userId !== "string") {
        throw new StoreError("validation", "userId is required");
      }
      if (!actorId || typeof actorId !== "string" || !actorId.trim()) {
        throw new StoreError("validation", "actorId is required");
      }
      const existing = mapUser(getUserById.get(userId));
      if (!existing) {
        throw new StoreError("not_found", "user not found");
      }
      if (existing.riskTierSource !== "override") {
        return existing;
      }
      return refreshUserRiskTierProfile({
        userId,
        actorId,
        reason: reason ?? "clear override",
        source: "system",
        requestId,
        correlationId,
        force: true
      });
    },

    listRiskTierEvents({ userId, limit = 100 } = {}) {
      if (!userId || typeof userId !== "string") {
        throw new StoreError("validation", "userId is required");
      }
      if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
        throw new StoreError("validation", "limit must be an integer between 1 and 500");
      }
      return listRiskTierEventsByUser.all({ user_id: userId, limit }).map(mapRiskTierEvent);
    },

    recordRiskSignal({
      transactionId,
      userId,
      signalType,
      severity,
      details,
      createdBy,
      requestId,
      correlationId
    }) {
      const normalizedType = String(signalType ?? "").trim();
      if (!VALID_RISK_SIGNAL_TYPES.has(normalizedType)) {
        throw new StoreError("validation", "unsupported risk signal type");
      }
      if (!transactionId && !userId) {
        throw new StoreError("validation", "transactionId or userId is required");
      }
      if (transactionId && !getTransactionByIdQuery.get(transactionId)) {
        throw new StoreError("not_found", "transaction not found");
      }
      if (userId && !getUserById.get(userId)) {
        throw new StoreError("not_found", "user not found");
      }
      const timestamp = now().toISOString();
      const signal = db.transaction(() => {
        const result = insertRiskSignal.run({
          transaction_id: transactionId ?? null,
          user_id: userId ?? null,
          signal_type: normalizedType,
          severity: clampRiskSeverity(severity),
          details_json: JSON.stringify(details ?? {}),
          created_by: createdBy ?? null,
          correlation_id: correlationId ?? null,
          request_id: requestId ?? null,
          created_at: timestamp
        });
        const row = db.prepare("SELECT * FROM risk_signals WHERE id = ?").get(Number(result.lastInsertRowid));
        const mapped = mapRiskSignal(row);
        if (transactionId) {
          refreshTransactionRiskProfile({ transactionId, updatedAt: timestamp });
        }
        if (userId) {
          refreshUserRiskTierProfile({
            userId,
            actorId: createdBy ?? null,
            reason: "risk signal recorded",
            source: "system",
            requestId,
            correlationId
          });
        }
        return mapped;
      })();
      return signal;
    },

    listRiskSignals({ transactionId, userId, signalType, limit = 100 } = {}) {
      if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
        throw new StoreError("validation", "limit must be an integer between 1 and 500");
      }
      const normalizedSignalType =
        signalType === undefined || signalType === null ? null : String(signalType).trim();
      if (normalizedSignalType && !VALID_RISK_SIGNAL_TYPES.has(normalizedSignalType)) {
        throw new StoreError("validation", "unsupported signalType");
      }
      const params = {
        transaction_id: transactionId ?? null,
        user_id: userId ?? null,
        signal_type: normalizedSignalType,
        limit
      };
      let rows;
      if (params.transaction_id && params.user_id && params.signal_type) {
        rows = listRiskSignalsByTransactionUserAndSignalType.all(params);
      } else if (params.transaction_id && params.user_id) {
        rows = listRiskSignalsByTransactionAndUser.all(params);
      } else if (params.transaction_id && params.signal_type) {
        rows = listRiskSignalsByTransactionAndSignalType.all(params);
      } else if (params.user_id && params.signal_type) {
        rows = listRiskSignalsByUserAndSignalType.all(params);
      } else if (params.transaction_id) {
        rows = listRiskSignalsByTransaction.all(params);
      } else if (params.user_id) {
        rows = listRiskSignalsByUser.all(params);
      } else if (params.signal_type) {
        rows = listRiskSignalsBySignalType.all(params);
      } else {
        rows = listRiskSignalsAll.all(params);
      }
      return rows.map(mapRiskSignal);
    },

    listRiskOperatorActions({ subjectType, subjectId, limit = 100 }) {
      if (subjectType !== "transaction" && subjectType !== "account") {
        throw new StoreError("validation", "subjectType must be transaction or account");
      }
      if (!subjectId || typeof subjectId !== "string") {
        throw new StoreError("validation", "subjectId is required");
      }
      if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
        throw new StoreError("validation", "limit must be an integer between 1 and 500");
      }
      return listRiskOperatorActionsBySubject
        .all({ subject_type: subjectType, subject_id: subjectId, limit })
        .map(mapRiskOperatorAction);
    },

    getSellerIntegrityProfile({ userId, lookbackDays = 30, recompute = true } = {}) {
      const normalizedUserId = String(userId ?? "").trim();
      if (!normalizedUserId) {
        throw new StoreError("validation", "userId is required");
      }
      if (recompute) {
        return computeSellerIntegrityProfile({ sellerId: normalizedUserId, lookbackDays });
      }
      const row = getSellerIntegrityProfileByUser.get({ user_id: normalizedUserId });
      if (!row) {
        return computeSellerIntegrityProfile({ sellerId: normalizedUserId, lookbackDays });
      }
      return {
        userId: row.user_id,
        integrityScore: Number(row.integrity_score),
        reasonFactors: parseJsonOrEmpty(row.reason_factors_json),
        computedAt: row.computed_at,
        updatedAt: row.updated_at
      };
    },

    ingestTrustNetworkLinks({
      transactionId,
      links = [],
      actorId,
      policyVersionId = null,
      propagationDecayHours = 168
    } = {}) {
      const normalizedTransactionId = String(transactionId ?? "").trim();
      if (!normalizedTransactionId) {
        throw new StoreError("validation", "transactionId is required");
      }
      const normalizedActorId = String(actorId ?? "").trim();
      if (!normalizedActorId) {
        throw new StoreError("validation", "actorId is required");
      }
      if (!Array.isArray(links) || links.length === 0) {
        throw new StoreError("validation", "links must include at least one item");
      }
      const transaction = mapTransaction(getTransactionByIdQuery.get(normalizedTransactionId));
      if (!transaction) {
        throw new StoreError("not_found", "transaction not found");
      }
      const clusterId = deriveClusterIdForTransaction(transaction);
      const timestamp = now().toISOString();
      const decayHours = Math.max(1, Math.min(720, Number(propagationDecayHours ?? 168)));
      for (const item of links) {
        const linkType = normalizeTrustNetworkLinkType(item.linkType ?? item.type ?? "account");
        const sourceEntityKey = String(item.sourceEntityKey ?? "").trim();
        const targetEntityKey = String(item.targetEntityKey ?? "").trim();
        if (!sourceEntityKey || !targetEntityKey) {
          throw new StoreError("validation", "sourceEntityKey and targetEntityKey are required for each link");
        }
        upsertTrustNetworkLink.run({
          cluster_id: clusterId,
          source_entity_key: sourceEntityKey,
          target_entity_key: targetEntityKey,
          link_type: linkType,
          confidence_score: Math.max(0, Math.min(100, Number(item.confidenceScore ?? 50))),
          propagated_risk_score: Math.max(0, Math.min(100, Number(item.propagatedRiskScore ?? 0))),
          decay_expires_at: addHours(timestamp, decayHours),
          evidence_json: JSON.stringify(item.evidence ?? {}),
          policy_version_id:
            policyVersionId === null || policyVersionId === undefined ? null : Number(policyVersionId),
          created_by: normalizedActorId,
          created_at: timestamp,
          updated_at: timestamp
        });
      }
      const network = computeNetworkRiskProfileForTransaction({
        transaction,
        propagationDecayHours: decayHours
      });
      return {
        transactionId: normalizedTransactionId,
        clusterId,
        networkRiskScore: network.networkRiskScore,
        links: listTrustNetworkLinksByCluster
          .all({ cluster_id: clusterId, limit: 500 })
          .map(mapTrustNetworkLink)
      };
    },

    getTrustNetworkInvestigation({
      transactionId = null,
      userId = null,
      clusterId = null,
      limit = 200
    } = {}) {
      if (!Number.isInteger(limit) || limit <= 0 || limit > 1000) {
        throw new StoreError("validation", "limit must be an integer between 1 and 1000");
      }
      let resolvedClusterId = clusterId ? String(clusterId).trim() : null;
      let transaction = null;
      if (transactionId) {
        const normalizedTransactionId = String(transactionId).trim();
        transaction = mapTransaction(getTransactionByIdQuery.get(normalizedTransactionId));
        if (!transaction) {
          throw new StoreError("not_found", "transaction not found");
        }
        resolvedClusterId = resolvedClusterId ?? deriveClusterIdForTransaction(transaction);
      }
      if (!resolvedClusterId && userId) {
        const entityKey = `account:${String(userId).trim()}`;
        const links = listTrustNetworkLinksByEntity.all({ entity_key: entityKey, limit }).map(mapTrustNetworkLink);
        resolvedClusterId = links[0]?.clusterId ?? null;
      }
      const links = resolvedClusterId
        ? listTrustNetworkLinksByCluster.all({ cluster_id: resolvedClusterId, limit }).map(mapTrustNetworkLink)
        : userId
          ? listTrustNetworkLinksByEntity.all({ entity_key: `account:${String(userId).trim()}`, limit }).map(mapTrustNetworkLink)
          : [];
      const cases = resolvedClusterId
        ? listOpenTrustOperationsCasesByCluster
            .all({ cluster_id: resolvedClusterId, limit })
            .map(mapTrustOperationsCase)
        : [];
      const clusterActions = resolvedClusterId
        ? listTrustClusterActionsByCluster
            .all({ cluster_id: resolvedClusterId, limit })
            .map(mapTrustClusterAction)
        : [];
      const nodes = Array.from(
        new Set(
          links.flatMap((item) => [item.sourceEntityKey, item.targetEntityKey])
        )
      ).map((entityKey) => ({
        entityKey,
        type: String(entityKey).split(":")[0] || "unknown"
      }));
      const edges = links.map((item) => ({
        sourceEntityKey: item.sourceEntityKey,
        targetEntityKey: item.targetEntityKey,
        linkType: item.linkType,
        confidenceScore: item.confidenceScore,
        confidenceBand: mapConfidenceBand(item.confidenceScore),
        propagatedRiskScore: item.propagatedRiskScore,
        policyVersionId: item.policyVersionId
      }));
      const openCases = cases.filter((item) => item.status === "open" || item.status === "in_review");
      const interventionRationaleCards = openCases.flatMap((item) => {
        const cards = item.payoutDecision?.preemptiveDisputeControls?.rationaleCards;
        return Array.isArray(cards) ? cards : [];
      });
      return {
        clusterId: resolvedClusterId,
        transaction,
        links,
        linkedEntities: Array.from(new Set(links.flatMap((item) => [item.sourceEntityKey, item.targetEntityKey]))),
        graph: {
          nodes,
          edges,
          summary: {
            nodeCount: nodes.length,
            edgeCount: edges.length,
            highConfidenceEdgeCount: edges.filter((edge) => edge.confidenceBand === "high").length
          }
        },
        linkedCaseExpansion: {
          openCaseCount: openCases.length,
          linkedTransactionIds: Array.from(new Set(openCases.map((item) => item.transactionId)))
        },
        interventionRationaleCards,
        cases,
        clusterActions
      };
    },

    previewTrustClusterAction({
      caseId,
      action,
      actorId,
      reasonCode = "cluster_action_preview"
    }) {
      if (!Number.isInteger(caseId) || caseId <= 0) {
        throw new StoreError("validation", "caseId must be a positive integer");
      }
      const trustCase = this.getTrustOperationsCase({ caseId, includeEvents: false }).trustCase;
      const clusterId = trustCase.clusterId ?? null;
      if (!clusterId) {
        throw new StoreError("validation", "case has no cluster context");
      }
      const openCases = listOpenTrustOperationsCasesByCluster
        .all({ cluster_id: clusterId, limit: 200 })
        .map(mapTrustOperationsCase);
      const decisionAction = action === "clear" ? "clear" : "hold";
      const preview = {
        caseId,
        clusterId,
        action,
        decisionAction,
        impactedCaseIds: openCases.map((item) => item.id),
        impactedCount: openCases.length
      };
      appendTrustClusterAction({
        caseId,
        clusterId,
        actionType: "preview",
        reasonCode,
        actorId,
        details: preview
      });
      return preview;
    },

    applyTrustClusterAction({
      caseId,
      action,
      actorId,
      reasonCode,
      notes = null
    }) {
      if (!Number.isInteger(caseId) || caseId <= 0) {
        throw new StoreError("validation", "caseId must be a positive integer");
      }
      const normalizedActorId = String(actorId ?? "").trim();
      if (!normalizedActorId) {
        throw new StoreError("validation", "actorId is required");
      }
      const normalizedReasonCode = String(reasonCode ?? "").trim();
      if (!normalizedReasonCode) {
        throw new StoreError("validation", "reasonCode is required");
      }
      const anchorCase = this.getTrustOperationsCase({ caseId, includeEvents: false }).trustCase;
      if (!anchorCase.clusterId) {
        throw new StoreError("validation", "case has no cluster context");
      }
      const openCases = listOpenTrustOperationsCasesByCluster
        .all({ cluster_id: anchorCase.clusterId, limit: 200 })
        .map(mapTrustOperationsCase);
      const decisionAction = action === "clear" ? "clear" : action === "none" ? "none" : "hold";
      const results = [];
      for (const item of openCases) {
        const result = this.applyTrustOperationsCaseDecision({
          caseId: item.id,
          action: decisionAction,
          actorId: normalizedActorId,
          reasonCode: normalizedReasonCode,
          notes
        });
        results.push(result.trustCase);
      }
      const accountControls = [];
      if (decisionAction === "hold") {
        const accountIds = new Set();
        for (const item of results) {
          const transaction = mapTransaction(getTransactionByIdQuery.get(item.transactionId));
          if (!transaction) {
            continue;
          }
          if (transaction.buyerId) {
            accountIds.add(transaction.buyerId);
          }
          if (transaction.sellerId) {
            accountIds.add(transaction.sellerId);
          }
        }
        for (const userId of accountIds) {
          const updated = this.setAccountRiskControls({
            userId,
            flagged: true,
            verificationRequired: true,
            flagReason: "collusion_cluster_confirmed",
            actorId: normalizedActorId,
            reason: normalizedReasonCode,
            notes:
              notes ??
              "Automated trust-ops cluster mitigation: account temporarily throttled pending investigation."
          });
          accountControls.push({
            userId,
            riskTier: updated.riskTier,
            riskFlagged: updated.riskFlagged,
            verificationRequired: updated.verificationRequired
          });
        }
      }
      appendTrustClusterAction({
        caseId,
        clusterId: anchorCase.clusterId,
        actionType: action === "clear" ? "clear" : action === "override" ? "override" : "approve",
        reasonCode: normalizedReasonCode,
        actorId: normalizedActorId,
        details: {
          action,
          decisionAction,
          affectedCaseIds: results.map((item) => item.id),
          accountControls,
          notes: notes ?? null
        }
      });
      return {
        clusterId: anchorCase.clusterId,
        action,
        decisionAction,
        accountControls,
        affectedCases: results
      };
    },

    listTrustRecoveryJobs({ status = null, limit = 100 } = {}) {
      if (!Number.isInteger(limit) || limit <= 0 || limit > 1000) {
        throw new StoreError("validation", "limit must be an integer between 1 and 1000");
      }
      if (status === null || status === undefined || status === "") {
        return listTrustRecoveryJobsAll.all({ limit }).map(mapTrustRecoveryJob);
      }
      const normalizedStatus = String(status).trim();
      if (!["queued", "processing", "completed", "failed"].includes(normalizedStatus)) {
        throw new StoreError("validation", "invalid recovery job status");
      }
      return listTrustRecoveryJobsByStatus
        .all({ status: normalizedStatus, limit })
        .map(mapTrustRecoveryJob);
    },

    getIdentityAssuranceProfile({ userId, lookbackDays = 90 } = {}) {
      if (!userId || typeof userId !== "string") {
        throw new StoreError("validation", "userId is required");
      }
      return computeIdentityAssuranceProfileForUser({
        userId: String(userId).trim(),
        role: "account",
        lookbackDays
      });
    },

    listTrustStepUpChallenges({ caseId, status = null, limit = 100 } = {}) {
      if (!Number.isInteger(caseId) || caseId <= 0) {
        throw new StoreError("validation", "caseId must be a positive integer");
      }
      if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
        throw new StoreError("validation", "limit must be an integer between 1 and 500");
      }
      if (status === null || status === undefined || status === "") {
        return listTrustStepUpChallengesByCase.all({ case_id: caseId, limit }).map(mapTrustStepUpChallenge);
      }
      const normalizedStatus = normalizeTrustStepUpChallengeStatus(status);
      return listTrustStepUpChallengesByCaseStatus
        .all({ case_id: caseId, status: normalizedStatus, limit })
        .map(mapTrustStepUpChallenge);
    },

    createTrustStepUpChallenge({
      caseId,
      userId,
      reasonCode,
      challengeType = "identity_reverification",
      evidence = {},
      actorId,
      expiresInHours = 24
    }) {
      if (!Number.isInteger(caseId) || caseId <= 0) {
        throw new StoreError("validation", "caseId must be a positive integer");
      }
      const normalizedUserId = String(userId ?? "").trim();
      if (!normalizedUserId) {
        throw new StoreError("validation", "userId is required");
      }
      const normalizedActorId = String(actorId ?? "").trim();
      if (!normalizedActorId) {
        throw new StoreError("validation", "actorId is required");
      }
      const normalizedReasonCode = String(reasonCode ?? "").trim();
      if (!normalizedReasonCode) {
        throw new StoreError("validation", "reasonCode is required");
      }
      const trustCase = mapTrustOperationsCase(getTrustOperationsCaseById.get({ id: caseId }));
      if (!trustCase) {
        throw new StoreError("not_found", "trust operations case not found");
      }
      const user = mapUser(getUserById.get(normalizedUserId));
      if (!user) {
        throw new StoreError("not_found", "user not found");
      }
      const hours = Math.max(1, Math.min(168, Number(expiresInHours ?? 24)));
      const timestamp = now().toISOString();
      const insert = insertTrustStepUpChallenge.run({
        case_id: caseId,
        transaction_id: trustCase.transactionId,
        user_id: normalizedUserId,
        status: "pending",
        reason_code: normalizedReasonCode,
        challenge_type: String(challengeType ?? "identity_reverification").trim() || "identity_reverification",
        evidence_json: JSON.stringify(evidence ?? {}),
        created_by: normalizedActorId,
        resolved_by: null,
        resolved_at: null,
        expires_at: addHours(timestamp, hours),
        created_at: timestamp,
        updated_at: timestamp
      });
      appendTrustOperationsCaseEvent({
        caseId,
        transactionId: trustCase.transactionId,
        eventType: "operator_overridden",
        actorId: normalizedActorId,
        reasonCode: "step_up_challenge_created",
        details: {
          challengeId: Number(insert.lastInsertRowid),
          userId: normalizedUserId,
          reasonCode: normalizedReasonCode
        },
        createdAt: timestamp
      });
      return mapTrustStepUpChallenge(getTrustStepUpChallengeById.get({ id: Number(insert.lastInsertRowid) }));
    },

    resolveTrustStepUpChallenge({ challengeId, status, actorId, evidence = {} }) {
      if (!Number.isInteger(challengeId) || challengeId <= 0) {
        throw new StoreError("validation", "challengeId must be a positive integer");
      }
      const nextStatus = normalizeTrustStepUpChallengeStatus(status);
      if (nextStatus === "pending") {
        throw new StoreError("validation", "status must be passed, failed, or expired");
      }
      const normalizedActorId = String(actorId ?? "").trim();
      if (!normalizedActorId) {
        throw new StoreError("validation", "actorId is required");
      }
      const existing = mapTrustStepUpChallenge(getTrustStepUpChallengeById.get({ id: challengeId }));
      if (!existing) {
        throw new StoreError("not_found", "trust step-up challenge not found");
      }
      const timestamp = now().toISOString();
      updateTrustStepUpChallenge.run({
        id: challengeId,
        status: nextStatus,
        evidence_json: JSON.stringify({
          ...(existing.evidence ?? {}),
          ...(evidence ?? {})
        }),
        resolved_by: normalizedActorId,
        resolved_at: timestamp,
        updated_at: timestamp
      });
      appendTrustOperationsCaseEvent({
        caseId: existing.caseId,
        transactionId: existing.transactionId,
        eventType: "operator_overridden",
        actorId: normalizedActorId,
        reasonCode: `step_up_challenge_${nextStatus}`,
        details: {
          challengeId,
          userId: existing.userId,
          status: nextStatus
        },
        createdAt: timestamp
      });
      return mapTrustStepUpChallenge(getTrustStepUpChallengeById.get({ id: challengeId }));
    },

    startAccountRecoveryCase({
      userId,
      actorId,
      compromiseSignal = {},
      requiredApprovalActorId = null,
      decisionNotes = null
    }) {
      const normalizedUserId = String(userId ?? "").trim();
      if (!normalizedUserId) {
        throw new StoreError("validation", "userId is required");
      }
      const normalizedActorId = String(actorId ?? "").trim();
      if (!normalizedActorId) {
        throw new StoreError("validation", "actorId is required");
      }
      const user = mapUser(getUserById.get(normalizedUserId));
      if (!user) {
        throw new StoreError("not_found", "user not found");
      }
      const existing = mapAccountRecoveryCase(
        getActiveAccountRecoveryCaseByUser.get({ user_id: normalizedUserId })
      );
      if (existing) {
        throw new StoreError("conflict", "an open account recovery case already exists");
      }
      const timestamp = now().toISOString();
      this.setAccountRiskControls({
        userId: normalizedUserId,
        flagged: true,
        verificationRequired: true,
        flagReason: "suspected_account_compromise",
        actorId: normalizedActorId,
        reason: "account_recovery_lockdown",
        notes: decisionNotes ?? "Recovery lockdown initiated"
      });
      const insert = insertAccountRecoveryCase.run({
        user_id: normalizedUserId,
        status: "open",
        stage: "lockdown",
        compromise_signal_json: JSON.stringify(compromiseSignal ?? {}),
        required_approval_actor_id:
          requiredApprovalActorId === null || requiredApprovalActorId === undefined
            ? null
            : String(requiredApprovalActorId).trim() || null,
        approved_by_actor_id: null,
        approved_at: null,
        decision_notes: decisionNotes === null || decisionNotes === undefined ? null : String(decisionNotes),
        restored_capabilities_json: JSON.stringify({
          payoutsEnabled: false,
          listingWritesEnabled: false,
          transactionWritesEnabled: false
        }),
        created_by: normalizedActorId,
        resolved_by: null,
        resolved_at: null,
        created_at: timestamp,
        updated_at: timestamp
      });
      return mapAccountRecoveryCase(getAccountRecoveryCaseById.get({ id: Number(insert.lastInsertRowid) }));
    },

    approveAccountRecoveryStage({
      recoveryCaseId,
      actorId,
      requiredApprovalActorId = null,
      decisionNotes = null
    }) {
      if (!Number.isInteger(recoveryCaseId) || recoveryCaseId <= 0) {
        throw new StoreError("validation", "recoveryCaseId must be a positive integer");
      }
      const normalizedActorId = String(actorId ?? "").trim();
      if (!normalizedActorId) {
        throw new StoreError("validation", "actorId is required");
      }
      const existing = mapAccountRecoveryCase(getAccountRecoveryCaseById.get({ id: recoveryCaseId }));
      if (!existing) {
        throw new StoreError("not_found", "account recovery case not found");
      }
      if (existing.status !== "open") {
        throw new StoreError("conflict", "account recovery case is not open");
      }
      const stageOrder = ["lockdown", "identity_reverification", "limited_restore", "full_restore"];
      const currentIndex = stageOrder.indexOf(existing.stage);
      if (currentIndex < 0) {
        throw new StoreError("validation", "invalid account recovery stage");
      }
      const isFinalApproval = currentIndex === stageOrder.length - 1;
      const nextStage = isFinalApproval ? "full_restore" : stageOrder[currentIndex + 1];
      const nextStatus = isFinalApproval ? "resolved" : "open";
      const timestamp = now().toISOString();
      const restoredCapabilities =
        nextStage === "identity_reverification"
          ? { payoutsEnabled: false, listingWritesEnabled: false, transactionWritesEnabled: false }
          : nextStage === "limited_restore"
            ? { payoutsEnabled: false, listingWritesEnabled: true, transactionWritesEnabled: true }
            : { payoutsEnabled: true, listingWritesEnabled: true, transactionWritesEnabled: true };
      if (nextStage === "limited_restore") {
        this.setAccountRiskControls({
          userId: existing.userId,
          flagged: true,
          verificationRequired: false,
          actorId: normalizedActorId,
          reason: "account_recovery_limited_restore",
          notes: decisionNotes ?? "Limited account restoration approved"
        });
      } else if (nextStatus === "resolved") {
        this.setAccountRiskControls({
          userId: existing.userId,
          flagged: false,
          verificationRequired: false,
          actorId: normalizedActorId,
          reason: "account_recovery_resolved",
          notes: decisionNotes ?? "Full account restoration approved"
        });
      }
      updateAccountRecoveryCase.run({
        id: recoveryCaseId,
        status: nextStatus,
        stage: nextStage,
        required_approval_actor_id:
          requiredApprovalActorId === null || requiredApprovalActorId === undefined
            ? existing.requiredApprovalActorId
            : String(requiredApprovalActorId).trim() || null,
        approved_by_actor_id: normalizedActorId,
        approved_at: timestamp,
        decision_notes:
          decisionNotes === null || decisionNotes === undefined ? existing.decisionNotes : String(decisionNotes),
        restored_capabilities_json: JSON.stringify(restoredCapabilities),
        resolved_by: nextStatus === "resolved" ? normalizedActorId : null,
        resolved_at: nextStatus === "resolved" ? timestamp : null,
        updated_at: timestamp
      });
      return mapAccountRecoveryCase(getAccountRecoveryCaseById.get({ id: recoveryCaseId }));
    },

    getAccountRecoveryState({ userId, limit = 20 } = {}) {
      const normalizedUserId = String(userId ?? "").trim();
      if (!normalizedUserId) {
        throw new StoreError("validation", "userId is required");
      }
      if (!Number.isInteger(limit) || limit <= 0 || limit > 200) {
        throw new StoreError("validation", "limit must be an integer between 1 and 200");
      }
      const activeCase = mapAccountRecoveryCase(
        getActiveAccountRecoveryCaseByUser.get({ user_id: normalizedUserId })
      );
      const history = listAccountRecoveryCasesByUser
        .all({ user_id: normalizedUserId, limit })
        .map(mapAccountRecoveryCase);
      return {
        activeCase,
        history
      };
    },

    processTrustRecoveryJobs({ limit = 50, actorId = "system:trust_recovery" } = {}) {
      if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
        throw new StoreError("validation", "limit must be an integer between 1 and 500");
      }
      const normalizedActorId = String(actorId ?? "").trim();
      if (!normalizedActorId) {
        throw new StoreError("validation", "actorId is required");
      }
      const queuedJobs = listTrustRecoveryJobsByStatus
        .all({ status: "queued", limit })
        .map(mapTrustRecoveryJob);
      const nowIso = now().toISOString();
      const processed = [];
      for (const job of queuedJobs) {
        if (new Date(job.scheduledFor).valueOf() > new Date(nowIso).valueOf()) {
          continue;
        }
        updateTrustRecoveryJob.run({
          id: job.id,
          status: "processing",
          processed_at: null,
          failure_reason: null,
          updated_at: nowIso
        });
        try {
          const transaction = mapTransaction(getTransactionByIdQuery.get(job.transactionId));
          if (!transaction) {
            throw new StoreError("not_found", "transaction not found");
          }
          if (transaction.holdStatus === "held") {
            this.setTransactionHold({
              transactionId: transaction.id,
              hold: false,
              reason: "policy_auto_clear:recovery_automation",
              notes: "Automated false-positive recovery release",
              actorId: normalizedActorId
            });
          }
          enqueueOutboxRecords({
            transactionId: transaction.id,
            sourceEventId: null,
            occurredAt: nowIso,
            records: [
              {
                topic: "dispute_update",
                recipientUserId: transaction.buyerId,
                payload: {
                  transactionId: transaction.id,
                  eventType: "trust_recovery_processed",
                  templateKey: job.templateKey,
                  reasonCode: job.reasonCode
                }
              },
              {
                topic: "dispute_update",
                recipientUserId: transaction.sellerId,
                payload: {
                  transactionId: transaction.id,
                  eventType: "trust_recovery_processed",
                  templateKey: job.templateKey,
                  reasonCode: job.reasonCode
                }
              }
            ]
          });
          updateTrustRecoveryJob.run({
            id: job.id,
            status: "completed",
            processed_at: nowIso,
            failure_reason: null,
            updated_at: nowIso
          });
          const existing = mapTrustOperationsCase(getTrustOperationsCaseById.get({ id: job.caseId }));
          if (existing) {
            updateTrustOperationsCaseV6({
              caseId: existing.id,
              networkRiskScoreAtTrigger: existing.networkRiskScoreAtTrigger,
              interventionLadderStep: existing.interventionLadderStep,
              clusterId: existing.clusterId,
              recoveryStatus: "completed"
            });
          }
          processed.push({ id: job.id, status: "completed", caseId: job.caseId });
        } catch (error) {
          updateTrustRecoveryJob.run({
            id: job.id,
            status: "failed",
            processed_at: nowIso,
            failure_reason: error instanceof Error ? error.message : "unknown recovery error",
            updated_at: nowIso
          });
          const existing = mapTrustOperationsCase(getTrustOperationsCaseById.get({ id: job.caseId }));
          if (existing) {
            updateTrustOperationsCaseV6({
              caseId: existing.id,
              networkRiskScoreAtTrigger: existing.networkRiskScoreAtTrigger,
              interventionLadderStep: existing.interventionLadderStep,
              clusterId: existing.clusterId,
              recoveryStatus: "failed"
            });
          }
          processed.push({
            id: job.id,
            status: "failed",
            caseId: job.caseId,
            error: error instanceof Error ? error.message : "unknown recovery error"
          });
        }
      }
      return {
        scanned: queuedJobs.length,
        processedCount: processed.length,
        jobs: processed
      };
    },

    simulateTrustOperationsPolicy({
      limit = 100,
      policy = {},
      cohort = {},
      policyVersionId = null
    } = {}) {
      if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
        throw new StoreError("validation", "limit must be an integer between 1 and 500");
      }
      const autoHoldRiskScore = Math.max(1, Math.min(100, Number(policy.autoHoldRiskScore ?? 70)));
      const clearRiskScore = Math.max(0, Math.min(100, Number(policy.clearRiskScore ?? 30)));
      const holdDurationHours = Math.max(1, Math.min(240, Number(policy.holdDurationHours ?? 24)));
      const reserveRiskScore = Math.max(0, Math.min(100, Number(policy.reserveRiskScore ?? 55)));
      const manualReviewRiskScore = Math.max(1, Math.min(100, Number(policy.manualReviewRiskScore ?? 85)));
      const reservePercent = Math.max(0, Math.min(80, Number(policy.reservePercent ?? 25)));
      const integrityLookbackDays = Math.max(7, Math.min(90, Number(policy.integrityLookbackDays ?? 30)));
      const v5Enabled = policy.v5Enabled === true;
      const v6Enabled = policy.v6Enabled === true;
      const v8Enabled = policy.v8Enabled === true;
      const v9Enabled = policy.v9Enabled === true;
      const v10Enabled = policy.v10Enabled === true;
      const v11Enabled = policy.v11Enabled === true;
      const networkRiskWeight = Math.max(0, Math.min(100, Number(policy.networkRiskWeight ?? 35)));
      const propagationDecayHours = Math.max(1, Math.min(720, Number(policy.propagationDecayHours ?? 168)));
      const identityAssuranceLookbackDays = Math.max(
        30,
        Math.min(180, Number(policy.identityAssuranceLookbackDays ?? 90))
      );
      const nowIso = now().toISOString();
      const transactions = listRecentTransactionsForTrustOps.all({ limit }).map(mapTransaction);
      return transactions.map((transaction) => {
        const cohortMatched = transactionMatchesTrustOpsCohort(transaction, cohort);
        const network = v6Enabled
          ? computeNetworkRiskProfileForTransaction({
              transaction,
              propagationDecayHours
            })
          : {
              clusterId: deriveClusterIdForTransaction(transaction),
              networkRiskScore: 0,
              linkedEntities: [],
              evidenceBundle: { links: [], propagationDecayHours }
            };
        const integrity = v5Enabled
          ? computeSellerIntegrityProfile({
              sellerId: transaction.sellerId,
              lookbackDays: integrityLookbackDays
            })
          : {
              userId: transaction.sellerId,
              integrityScore: 100,
              reasonFactors: {},
              computedAt: nowIso,
              updatedAt: nowIso
            };
        const activeCase = mapTrustOperationsCase(
          getActiveTrustOperationsCaseByTransaction.get({ transaction_id: transaction.id })
        );
        const expiresAt = activeCase?.holdExpiresAt ?? null;
        const holdExpired = Boolean(
          expiresAt && new Date(expiresAt).valueOf() <= new Date(nowIso).valueOf()
        );
        const hasAutoHold = transaction.holdStatus === "held" && (transaction.holdReason ?? "").startsWith("policy_auto_hold:");
        const baseRiskScore = v5Enabled
          ? Math.max(
              0,
              Math.min(
                100,
                Math.round(transaction.riskScore * 0.6 + (100 - integrity.integrityScore) * 0.4)
              )
            )
          : transaction.riskScore;
        const combinedRiskScore = v6Enabled
          ? Math.max(
              0,
              Math.min(
                100,
                Math.round(
                  baseRiskScore * ((100 - networkRiskWeight) / 100) +
                    network.networkRiskScore * (networkRiskWeight / 100)
                )
              )
            )
          : baseRiskScore;
        const recommendManualReview = v5Enabled && cohortMatched && combinedRiskScore >= manualReviewRiskScore;
        const recommendHold =
          cohortMatched &&
          !recommendManualReview &&
          combinedRiskScore >= autoHoldRiskScore &&
          transaction.holdStatus !== "held";
        const recommendReserve =
          v5Enabled &&
          cohortMatched &&
          !recommendManualReview &&
          !recommendHold &&
          combinedRiskScore >= reserveRiskScore;
        const recommendClear =
          cohortMatched &&
          hasAutoHold &&
          (combinedRiskScore <= clearRiskScore || holdExpired);
        const payoutAction = v5Enabled
          ? recommendManualReview
            ? "manual_review"
            : recommendHold
              ? "hold"
              : recommendReserve
                ? "reserve"
                : recommendClear
                  ? "release"
                  : "none"
          : recommendHold
            ? "hold"
            : recommendClear
              ? "release"
              : "none";
        const identityAssurance = v8Enabled
          ? computeIdentityAssuranceForTransaction({
              transaction,
              lookbackDays: identityAssuranceLookbackDays
            })
          : { blendedScore: 100, buyer: null, seller: null };
        const gating = resolveV8GatingDecision({
          transaction,
          combinedRiskScore,
          identityAssurance,
          policy,
          payoutAction
        });
        const payoutActionWithGating =
          gating.shouldGate && payoutAction !== "manual_review"
            ? gating.challengeRequired
              ? "hold"
              : "manual_review"
            : payoutAction;
        const preemptiveDisputeControls = resolveV9PreemptiveDisputeControls({
          combinedRiskScore,
          networkRiskScore: network.networkRiskScore,
          policy
        });
        const payoutActionWithPreemptiveControls =
          v9Enabled &&
          preemptiveDisputeControls.controls.restrictPayoutProgression &&
          payoutActionWithGating !== "manual_review"
            ? "manual_review"
            : payoutActionWithGating;
        const v10Interdiction = resolveV10InterdictionPlan({
          transaction,
          combinedRiskScore,
          networkRiskScore: network.networkRiskScore,
          policy
        });
        const payoutActionWithV10 =
          v10Enabled &&
          ["high", "critical"].includes(v10Interdiction.confidenceTier) &&
          payoutActionWithPreemptiveControls !== "manual_review"
            ? "manual_review"
            : payoutActionWithPreemptiveControls;
        const v11BuyerRiskIntelligence = resolveV11BuyerRiskIntelligence({
          transaction,
          combinedRiskScore,
          networkRiskScore: network.networkRiskScore,
          policy
        });
        const payoutActionWithV11 =
          v11Enabled &&
          ["high", "critical"].includes(v11BuyerRiskIntelligence.confidenceTier) &&
          payoutActionWithV10 !== "manual_review"
            ? "manual_review"
            : payoutActionWithV10;
        const v10ReserveEscalationAction = v10Interdiction.actions.find(
          (item) => item.actionType === "payout_reserve_escalation"
        );
        const reservePercentWithV10 =
          v10Enabled && v10ReserveEscalationAction
            ? Math.max(reservePercent, Number(v10ReserveEscalationAction.reservePercent ?? 0))
            : reservePercent;
        const recommendedAction =
          payoutActionWithV11 === "release"
            ? "clear"
            : payoutActionWithV11 === "none"
              ? "none"
              : "hold";
        const reasonCode =
          v11Enabled && ["high", "critical"].includes(v11BuyerRiskIntelligence.confidenceTier)
            ? "buyer_risk_preemption_high_confidence"
            :
          v10Enabled && ["high", "critical"].includes(v10Interdiction.confidenceTier)
            ? "scam_ring_interdiction_high_confidence"
            : v9Enabled && preemptiveDisputeControls.controls.restrictPayoutProgression
            ? "collusion_preemptive_payout_restriction"
            : gating.shouldGate
            ? gating.policyReasonCategory
            : payoutActionWithV11 === "manual_review"
            ? "integrity_manual_review_gate"
            : payoutActionWithV11 === "hold"
              ? "integrity_hold_threshold"
            : payoutActionWithV11 === "reserve"
                ? "integrity_reserve_threshold"
                : payoutActionWithV11 === "release"
                  ? holdExpired
                    ? "hold_expired"
                    : "risk_score_recovered"
                  : cohortMatched
                    ? "no_policy_action"
                    : "cohort_mismatch";
        const severity = deriveTrustOpsSeverity(combinedRiskScore);
        const priorityScore = computeTrustOpsPriorityScore({
          riskScore: combinedRiskScore,
          recommendedAction
        });
        const interventionLadderStep = deriveTrustOpsInterventionLadderStep({
          combinedRiskScore,
          networkRiskScore: network.networkRiskScore,
          payoutAction: payoutActionWithV11
        });
        const computedHoldHours =
          payoutActionWithV11 === "hold" ||
          payoutActionWithV11 === "manual_review"
            ? Math.max(holdDurationHours, preemptiveDisputeControls.controls.conditionalEscrowDelayHours)
            : 0;
        const payoutDecision = {
          payoutAction: payoutActionWithV11,
          reservePercent: payoutActionWithV11 === "reserve" ? reservePercentWithV10 : 0,
          holdHours:
            payoutActionWithV11 === "hold" ||
            payoutActionWithV11 === "manual_review"
              ? computedHoldHours
              : 0,
          reviewRequired: payoutActionWithV11 === "manual_review",
          combinedRiskScore,
          integrityScore: integrity.integrityScore,
          integrityFactors: integrity.reasonFactors,
          networkRiskScore: network.networkRiskScore,
          interventionLadderStep,
          clusterId: network.clusterId,
          evidenceBundle: network.evidenceBundle,
          identityAssurance,
          gating,
          preemptiveDisputeControls,
          interventionRationaleCards: preemptiveDisputeControls.rationaleCards,
          listingAuthenticityForensics: {
            score: v10Interdiction.listingAuthenticity.authenticityRiskScore,
            summary: v10Interdiction.listingAuthenticity.summary,
            signalCount: v10Interdiction.listingAuthenticity.signals.length,
            signals: v10Interdiction.listingAuthenticity.signals
          },
          scamRingInterdiction: {
            score: v10Interdiction.proactiveInterdictionScore,
            confidenceTier: v10Interdiction.confidenceTier,
            behavioralAnomalyScore: v10Interdiction.behavioralAnomalyScore
          },
          remediationPlan: {
            actions: v10Interdiction.actions
          },
          machineHumanDecisionBoundary: v10Interdiction.machineHumanDecisionBoundary,
          evidenceBundleExportPayload: v10Interdiction.evidenceBundleExportPayload,
          buyerRiskIntelligence: {
            score: v11BuyerRiskIntelligence.buyerRiskScore,
            confidenceTier: v11BuyerRiskIntelligence.confidenceTier,
            attributionSummary: v11BuyerRiskIntelligence.attributionSummary,
            featureAttributions: v11BuyerRiskIntelligence.featureAttributions
          },
          escrowAnomalyForecast: {
            score: v11BuyerRiskIntelligence.escrowAnomalyScore,
            highRisk:
              v11BuyerRiskIntelligence.escrowAnomalyScore >=
              Number(policy.v11EscrowAnomalyHighScore ?? 70)
          },
          disputePreemptionAutomation: {
            score: v11BuyerRiskIntelligence.disputePreemptionScore,
            actions: v11BuyerRiskIntelligence.actions,
            machineHumanDecisionBoundary: v11BuyerRiskIntelligence.machineHumanDecisionBoundary,
            alternativePaths: v11BuyerRiskIntelligence.alternativePaths
          },
          policyVersionId
        };
        return {
          transaction,
          integrity,
          network,
          activeCase,
          cohortMatched,
          decision: {
            recommendedAction,
            payoutAction: payoutActionWithV11,
            payoutDecision,
            reasonCode,
            severity,
            priorityScore,
            interventionLadderStep,
            networkRiskScore: network.networkRiskScore,
            clusterId: network.clusterId,
            evidenceBundle: network.evidenceBundle,
            slaDueAt: computeTrustOpsSlaDueAt({ severity, fromIso: nowIso }),
            holdExpiresAt:
              payoutActionWithV11 === "hold" ||
              payoutActionWithV11 === "manual_review"
                ? addHours(nowIso, computedHoldHours)
                : expiresAt
          }
        };
      });
    },

    evaluateTrustPolicyGuardrails({
      policyVersionId,
      policy = {},
      actorId = "system:trust_ops",
      lookbackHours = 24
    } = {}) {
      if (!Number.isInteger(policyVersionId) || policyVersionId <= 0) {
        return {
          triggered: false,
          rollbackApplied: false,
          reasonCodes: [],
          metrics: {}
        };
      }
      const activePolicy = this.getTrustOpsPolicyVersion({ id: policyVersionId });
      const stats = this.getTrustOperationsStats({ lookbackHours });
      const falsePositiveReleaseRateThreshold = Number(
        policy.experimentKillSwitchFalsePositiveReleaseRate ?? 0.45
      );
      const appealOverturnRateThreshold = Number(
        policy.experimentKillSwitchAppealOverturnRate ?? 0.35
      );
      const rollbackFrequencyThreshold = Number(
        policy.experimentKillSwitchRollbackFrequency ?? 3
      );
      const reasonCodes = [];
      if (Number(stats.payoutRiskQuality.falsePositiveReleaseRate ?? 0) >= falsePositiveReleaseRateThreshold) {
        reasonCodes.push("false_positive_release_rate");
      }
      if (Number(stats.policyGuardrails.appealOverturnRate ?? 0) >= appealOverturnRateThreshold) {
        reasonCodes.push("appeal_overturn_rate");
      }
      const rollbackFrequency =
        Number(stats.policyGuardrails.rollbackFrequencyByPolicyVersion?.[String(policyVersionId)] ?? 0);
      if (rollbackFrequency >= rollbackFrequencyThreshold) {
        reasonCodes.push("rollback_frequency");
      }
      const timestamp = now().toISOString();
      const metricsSnapshot = {
        lookbackHours,
        payoutRiskQuality: stats.payoutRiskQuality,
        policyGuardrails: stats.policyGuardrails
      };
      if (reasonCodes.length === 0) {
        insertTrustPolicyGuardrailEvent.run({
          policy_version_id: policyVersionId,
          event_type: "evaluation_passed",
          reason_code: "within_threshold",
          metrics_snapshot_json: JSON.stringify(metricsSnapshot),
          actor_id: String(actorId ?? "system:trust_ops"),
          created_at: timestamp
        });
        return {
          triggered: false,
          rollbackApplied: false,
          reasonCodes: [],
          metrics: metricsSnapshot
        };
      }

      insertTrustPolicyGuardrailEvent.run({
        policy_version_id: policyVersionId,
        event_type: "kill_switch_triggered",
        reason_code: reasonCodes.join(","),
        metrics_snapshot_json: JSON.stringify(metricsSnapshot),
        actor_id: String(actorId ?? "system:trust_ops"),
        created_at: timestamp
      });

      let rollbackApplied = false;
      if (activePolicy.status === "active") {
        updateTrustOpsPolicyVersionStatus.run({
          id: policyVersionId,
          status: "retired",
          activated_by: activePolicy.activatedBy,
          activated_at: activePolicy.activatedAt,
          updated_at: timestamp
        });
        rollbackApplied = true;
      }

      insertTrustPolicyGuardrailEvent.run({
        policy_version_id: policyVersionId,
        event_type: "rollback_applied",
        reason_code: reasonCodes.join(","),
        metrics_snapshot_json: JSON.stringify(metricsSnapshot),
        actor_id: String(actorId ?? "system:trust_ops"),
        created_at: timestamp
      });
      return {
        triggered: true,
        rollbackApplied,
        reasonCodes,
        metrics: metricsSnapshot
      };
    },

    runTrustOperationsSweep({
      limit = 100,
      policy = {},
      cohort = {},
      apply = true,
      actorId = "system:trust_ops",
      policyVersionId = null,
      requestId = null,
      correlationId = null
    } = {}) {
      const simulations = this.simulateTrustOperationsPolicy({
        limit,
        policy,
        cohort,
        policyVersionId
      });
      const summary = {
        scanned: simulations.length,
        recommendations: {
          hold: 0,
          clear: 0,
          none: 0
        },
        payoutActions: {
          hold: 0,
          reserve: 0,
          manualReview: 0,
          release: 0,
          none: 0
        },
        applied: {
          holds: 0,
          clears: 0,
          reserves: 0,
          manualReviews: 0,
          casesCreated: 0,
          casesUpdated: 0
        },
        v10: {
          listingSignalsLogged: 0,
          remediationApplied: 0,
          remediationProposed: 0
        },
        v11: {
          buyerSignalsLogged: 0,
          preemptionActionsApplied: 0,
          preemptionActionsProposed: 0
        },
        guardrails: {
          triggered: false,
          rollbackApplied: false,
          reasonCodes: []
        },
        items: []
      };
      const nowIso = now().toISOString();
      const trafficCapPercent = Math.max(
        1,
        Math.min(100, Number(policy.experimentTrafficCapPercent ?? 100))
      );
      const isWithinTrafficCap = (transactionId) => {
        if (trafficCapPercent >= 100) {
          return true;
        }
        const normalized = String(transactionId ?? "");
        let hash = 0;
        for (let index = 0; index < normalized.length; index += 1) {
          hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0;
        }
        return hash % 100 < trafficCapPercent;
      };

      for (const entry of simulations) {
        const applyForTransaction = apply && isWithinTrafficCap(entry.transaction.id);
        summary.recommendations[entry.decision.recommendedAction] += 1;
        if (entry.decision.payoutAction === "hold") {
          summary.payoutActions.hold += 1;
        } else if (entry.decision.payoutAction === "reserve") {
          summary.payoutActions.reserve += 1;
        } else if (entry.decision.payoutAction === "manual_review") {
          summary.payoutActions.manualReview += 1;
        } else if (entry.decision.payoutAction === "release") {
          summary.payoutActions.release += 1;
        } else {
          summary.payoutActions.none += 1;
        }
        let activeCase = entry.activeCase;
        let caseChanged = false;
        let holdApplied = false;
        let holdCleared = false;

        if (
          applyForTransaction &&
          (entry.decision.recommendedAction === "hold" || entry.decision.payoutAction === "manual_review")
        ) {
          if (
            (entry.decision.payoutAction === "hold" || entry.decision.payoutAction === "manual_review") &&
            entry.transaction.holdStatus !== "held"
          ) {
            this.setTransactionHold({
              transactionId: entry.transaction.id,
              hold: true,
              reason: `policy_auto_hold:risk_score_${entry.decision.payoutDecision.combinedRiskScore}`,
              notes: "Applied by trust operations policy sweep",
              actorId,
              requestId,
              correlationId
            });
            holdApplied = true;
          }
          const nextStatus = activeCase ? "in_review" : "open";
          const timestamp = now().toISOString();
          if (activeCase) {
            updateTrustOperationsCase.run({
              id: activeCase.id,
              status: nextStatus,
              recommended_action: "hold",
              reason_code: entry.decision.reasonCode,
              policy_snapshot_json: JSON.stringify(policy ?? {}),
              triggered_by_signal_id: activeCase.triggeredBySignalId,
              risk_score_at_trigger: entry.transaction.riskScore,
              seller_integrity_score_at_trigger: entry.integrity.integrityScore,
              severity: entry.decision.severity,
              priority_score: entry.decision.priorityScore,
              sla_due_at: entry.decision.slaDueAt,
              assigned_investigator_id: activeCase.assignedInvestigatorId,
              claimed_at: activeCase.claimedAt,
              first_action_at: activeCase.firstActionAt,
              last_action_at: now().toISOString(),
              false_positive_flag: activeCase.falsePositiveFlag ? 1 : 0,
              payout_action: entry.decision.payoutAction,
              payout_decision_json: JSON.stringify(entry.decision.payoutDecision),
              policy_version_id: policyVersionId,
              override_expires_at: activeCase.overrideExpiresAt,
              hold_expires_at: entry.decision.holdExpiresAt ?? null,
              resolved_at: null,
              resolved_by: null,
              resolution_code: null,
              updated_at: timestamp
            });
            summary.applied.casesUpdated += 1;
            appendTrustOperationsCaseEvent({
              caseId: activeCase.id,
              transactionId: entry.transaction.id,
              eventType: "case_retriggered",
              actorId,
              reasonCode: entry.decision.reasonCode,
              details: {
                policy,
                cohort,
                recommendedAction: "hold",
                riskScore: entry.transaction.riskScore,
                sellerIntegrityScore: entry.integrity.integrityScore,
                payoutDecision: entry.decision.payoutDecision
              },
              createdAt: timestamp
            });
            activeCase = mapTrustOperationsCase(getTrustOperationsCaseById.get({ id: activeCase.id }));
          } else {
            const insertResult = insertTrustOperationsCase.run({
              transaction_id: entry.transaction.id,
              status: nextStatus,
              recommended_action: "hold",
              reason_code: entry.decision.reasonCode,
              policy_snapshot_json: JSON.stringify(policy ?? {}),
              triggered_by_signal_id: null,
              risk_score_at_trigger: entry.transaction.riskScore,
              seller_integrity_score_at_trigger: entry.integrity.integrityScore,
              severity: entry.decision.severity,
              priority_score: entry.decision.priorityScore,
              sla_due_at: entry.decision.slaDueAt,
              assigned_investigator_id: null,
              claimed_at: null,
              first_action_at: null,
              last_action_at: null,
              false_positive_flag: 0,
              payout_action: entry.decision.payoutAction,
              payout_decision_json: JSON.stringify(entry.decision.payoutDecision),
              policy_version_id: policyVersionId,
              override_expires_at: null,
              hold_expires_at: entry.decision.holdExpiresAt ?? null,
              created_at: timestamp,
              updated_at: timestamp
            });
            const caseId = Number(insertResult.lastInsertRowid);
            appendTrustOperationsCaseEvent({
              caseId,
              transactionId: entry.transaction.id,
              eventType: "case_created",
              actorId,
              reasonCode: entry.decision.reasonCode,
              details: {
                policy,
                cohort,
                recommendedAction: "hold",
                riskScore: entry.transaction.riskScore,
                sellerIntegrityScore: entry.integrity.integrityScore,
                payoutDecision: entry.decision.payoutDecision
              },
              createdAt: timestamp
            });
            summary.applied.casesCreated += 1;
            activeCase = mapTrustOperationsCase(getTrustOperationsCaseById.get({ id: caseId }));
          }
          if (activeCase) {
            updateTrustOperationsCaseV6({
              caseId: activeCase.id,
              networkRiskScoreAtTrigger: entry.decision.networkRiskScore,
              interventionLadderStep: entry.decision.interventionLadderStep,
              clusterId: entry.decision.clusterId,
              recoveryStatus: "not_applicable"
            });
            activeCase = mapTrustOperationsCase(getTrustOperationsCaseById.get({ id: activeCase.id }));
          }
          if (activeCase && policy.v10Enabled === true) {
            const listingForensics = entry.decision.payoutDecision.listingAuthenticityForensics ?? {};
            appendTrustListingAuthenticitySignals({
              caseId: activeCase.id,
              transactionId: entry.transaction.id,
              sellerId: entry.transaction.sellerId,
              signals: Array.isArray(listingForensics.signals) ? listingForensics.signals : [],
              policyVersionId,
              createdBy: actorId
            });
            summary.v10.listingSignalsLogged += Array.isArray(listingForensics.signals)
              ? listingForensics.signals.length
              : 0;
            const remediationPlan = entry.decision.payoutDecision.remediationPlan ?? {};
            const boundary = entry.decision.payoutDecision.machineHumanDecisionBoundary ?? {};
            const autoAppliedActions = new Set(boundary.autoAppliedActions ?? []);
            const humanReviewRequiredActions = new Set(boundary.humanReviewRequiredActions ?? []);
            for (const action of remediationPlan.actions ?? []) {
              const actionType = String(action.actionType ?? "").trim();
              if (!VALID_TRUST_REMEDIATION_ACTION_TYPES.has(actionType)) {
                continue;
              }
              const shouldAutoApply =
                autoAppliedActions.has(actionType) && !humanReviewRequiredActions.has(actionType);
              let targetListingId = null;
              if (shouldAutoApply && actionType === "listing_quarantine") {
                const listing = listListingsBySeller
                  .all({
                    seller_id: entry.transaction.sellerId,
                    moderation_status: "approved",
                    cursor_created_at: null,
                    cursor_id: null,
                    limit: 1
                  })
                  .map(mapListing)[0];
                if (listing) {
                  this.setListingModerationStatus({
                    listingId: listing.id,
                    moderationStatus: "temporarily_hidden",
                    reasonCode: "trust_ops_listing_quarantine",
                    publicReason: "Listing was temporarily quarantined by trust and safety review.",
                    internalNotes: `trust_case:${activeCase.id} action:listing_quarantine`,
                    source: "trust_ops_v10",
                    actorId
                  });
                  targetListingId = listing.id;
                }
              }
              if (shouldAutoApply && actionType === "account_capability_restriction") {
                this.setAccountRiskControls({
                  userId: entry.transaction.sellerId,
                  flagged: true,
                  flagReason: "trust_ops_v10_capability_restriction",
                  verificationRequired: true,
                  actorId,
                  reason: "trust_ops_v10_capability_restriction",
                  notes: `trust_case:${activeCase.id}`
                });
              }
              appendTrustCaseRemediationAction({
                caseId: activeCase.id,
                transactionId: entry.transaction.id,
                actionType,
                confidenceTier: action.confidenceTier ?? "low",
                status: shouldAutoApply ? "applied" : "proposed",
                reasonCode: action.reasonCode ?? entry.decision.reasonCode,
                policyVersionId,
                machineDecision: {
                  fromSweep: true,
                  autoApplied: shouldAutoApply,
                  targetListingId
                },
                humanDecision: shouldAutoApply
                  ? {}
                  : {
                      required: true,
                      boundary: "high_impact_action_requires_operator"
                    },
                createdBy: actorId
              });
              if (shouldAutoApply) {
                summary.v10.remediationApplied += 1;
              } else {
                summary.v10.remediationProposed += 1;
              }
            }
          }
          if (activeCase && policy.v11Enabled === true) {
            const buyerRiskIntelligence = entry.decision.payoutDecision.buyerRiskIntelligence ?? {};
            const disputePreemptionAutomation =
              entry.decision.payoutDecision.disputePreemptionAutomation ?? {};
            const featureAttributions = Array.isArray(buyerRiskIntelligence.featureAttributions)
              ? buyerRiskIntelligence.featureAttributions
              : [];
            const actions = Array.isArray(disputePreemptionAutomation.actions)
              ? disputePreemptionAutomation.actions
              : [];
            appendTrustBuyerRiskSignals({
              caseId: activeCase.id,
              transactionId: entry.transaction.id,
              buyerId: entry.transaction.buyerId,
              featureAttributions,
              policyVersionId,
              createdBy: actorId
            });
            summary.v11.buyerSignalsLogged += featureAttributions.length;
            const boundary = disputePreemptionAutomation.machineHumanDecisionBoundary ?? {};
            const autoAppliedActions = new Set(boundary.autoAppliedActions ?? []);
            const humanReviewRequiredActions = new Set(boundary.humanReviewRequiredActions ?? []);
            for (const action of actions) {
              const actionType = String(action.actionType ?? "").trim();
              if (!VALID_TRUST_PREEMPTION_ACTION_TYPES.has(actionType)) {
                continue;
              }
              const shouldAutoApply =
                autoAppliedActions.has(actionType) && !humanReviewRequiredActions.has(actionType);
              appendTrustDisputePreemptionAction({
                caseId: activeCase.id,
                transactionId: entry.transaction.id,
                actionType,
                confidenceTier: action.confidenceTier ?? "low",
                status: shouldAutoApply ? "applied" : "proposed",
                reasonCode: action.reasonCode ?? entry.decision.reasonCode,
                policyVersionId,
                machineDecision: {
                  fromSweep: true,
                  autoApplied: shouldAutoApply,
                  delayHours: action.delayHours ?? null,
                  windowHours: action.windowHours ?? null
                },
                humanDecision: shouldAutoApply
                  ? {}
                  : {
                      required: true,
                      boundary: "high_impact_action_requires_operator"
                    },
                createdBy: actorId
              });
              if (shouldAutoApply) {
                summary.v11.preemptionActionsApplied += 1;
              } else {
                summary.v11.preemptionActionsProposed += 1;
              }
            }
          }
          recordPayoutRiskAction({
            transactionId: entry.transaction.id,
            caseId: activeCase?.id ?? null,
            sellerId: entry.transaction.sellerId,
            actionType: entry.decision.payoutAction,
            reservePercent: entry.decision.payoutDecision.reservePercent,
            holdHours: entry.decision.payoutDecision.holdHours,
            reviewRequired: entry.decision.payoutDecision.reviewRequired,
            reasonCode: entry.decision.reasonCode,
            source: "policy",
            policyVersionId,
            policySnapshot: policy,
            actorId,
            metadata: {
              combinedRiskScore: entry.decision.payoutDecision.combinedRiskScore,
              integrityScore: entry.decision.payoutDecision.integrityScore,
              identityAssuranceScore:
                entry.decision.payoutDecision.identityAssurance?.blendedScore ?? null,
              gatingAction: entry.decision.payoutDecision.gating?.action ?? "none",
              gatingReasonCodes: entry.decision.payoutDecision.gating?.reasonCodes ?? [],
              preemptiveControls:
                entry.decision.payoutDecision.preemptiveDisputeControls?.controls ?? {},
              buyerRiskIntelligence:
                entry.decision.payoutDecision.buyerRiskIntelligence?.attributionSummary ?? {},
              escrowAnomalyForecast:
                entry.decision.payoutDecision.escrowAnomalyForecast ?? {},
              disputePreemptionAutomation: {
                score:
                  entry.decision.payoutDecision.disputePreemptionAutomation?.score ?? 0,
                actionCount:
                  entry.decision.payoutDecision.disputePreemptionAutomation?.actions?.length ?? 0
              },
              amountCents: entry.transaction.amountCents
            },
            createdAt: timestamp
          });
          if (entry.decision.payoutAction === "reserve") {
            summary.applied.reserves += 1;
          }
          if (entry.decision.payoutAction === "manual_review") {
            summary.applied.manualReviews += 1;
          }
          if (holdApplied) {
            appendTrustOperationsCaseEvent({
              caseId: activeCase.id,
              transactionId: entry.transaction.id,
              eventType: "auto_hold_applied",
              actorId,
              reasonCode: entry.decision.reasonCode,
              details: {
                riskScore: entry.transaction.riskScore,
                severity: entry.decision.severity,
                priorityScore: entry.decision.priorityScore,
                holdExpiresAt: entry.decision.holdExpiresAt ?? null,
                sellerIntegrityScore: entry.integrity.integrityScore,
                payoutDecision: entry.decision.payoutDecision
              }
            });
            const transaction = mapTransaction(getTransactionByIdQuery.get(entry.transaction.id));
            enqueueOutboxRecords({
              transactionId: entry.transaction.id,
              sourceEventId: null,
              occurredAt: nowIso,
              records: [
                {
                  topic: "action_required",
                  recipientUserId: transaction.buyerId,
                  payload: {
                    transactionId: transaction.id,
                    eventType: "trust_ops_hold_applied",
                    reasonCode: entry.decision.reasonCode
                  }
                },
                {
                  topic: "action_required",
                  recipientUserId: transaction.sellerId,
                  payload: {
                    transactionId: transaction.id,
                    eventType: "trust_ops_hold_applied",
                    reasonCode: entry.decision.reasonCode
                  }
                }
              ]
            });
            summary.applied.holds += 1;
          }
          caseChanged = true;
        } else if (applyForTransaction && entry.decision.recommendedAction === "clear") {
          if (entry.transaction.holdStatus === "held") {
            this.setTransactionHold({
              transactionId: entry.transaction.id,
              hold: false,
              reason: "policy_auto_clear:trust_ops",
              notes: "Cleared by trust operations policy sweep",
              actorId,
              requestId,
              correlationId
            });
            holdCleared = true;
          }
          const timestamp = now().toISOString();
          if (activeCase) {
            updateTrustOperationsCase.run({
              id: activeCase.id,
              status: "resolved",
              recommended_action: "none",
              reason_code: entry.decision.reasonCode,
              policy_snapshot_json: JSON.stringify(policy ?? {}),
              triggered_by_signal_id: activeCase.triggeredBySignalId,
              risk_score_at_trigger: activeCase.riskScoreAtTrigger,
              seller_integrity_score_at_trigger: activeCase.sellerIntegrityScoreAtTrigger,
              severity: activeCase.severity,
              priority_score: activeCase.priorityScore,
              sla_due_at: activeCase.slaDueAt,
              assigned_investigator_id: activeCase.assignedInvestigatorId,
              claimed_at: activeCase.claimedAt,
              first_action_at: activeCase.firstActionAt,
              last_action_at: now().toISOString(),
              false_positive_flag:
                entry.decision.reasonCode === "risk_score_recovered" ? 1 : activeCase.falsePositiveFlag ? 1 : 0,
              payout_action: "release",
              payout_decision_json: JSON.stringify(entry.decision.payoutDecision),
              policy_version_id: policyVersionId ?? activeCase.policyVersionId,
              override_expires_at: null,
              hold_expires_at: activeCase.holdExpiresAt,
              resolved_at: timestamp,
              resolved_by: actorId,
              resolution_code: entry.decision.reasonCode,
              updated_at: timestamp
            });
            summary.applied.casesUpdated += 1;
            appendTrustOperationsCaseEvent({
              caseId: activeCase.id,
              transactionId: entry.transaction.id,
              eventType: holdCleared ? "auto_hold_cleared" : "operator_cleared",
              actorId,
              reasonCode: entry.decision.reasonCode,
              details: {
                policy,
                cohort,
                riskScore: entry.transaction.riskScore
              },
              createdAt: timestamp
            });
            activeCase = mapTrustOperationsCase(getTrustOperationsCaseById.get({ id: activeCase.id }));
            caseChanged = true;
            const shouldQueueRecovery = entry.decision.reasonCode === "risk_score_recovered";
            if (shouldQueueRecovery) {
              enqueueTrustRecoveryJob({
                caseId: activeCase.id,
                transactionId: entry.transaction.id,
                reasonCode: "false_positive_release_recovery",
                templateKey: "trust_recovery_release_notice",
                payload: {
                  transactionId: entry.transaction.id,
                  caseId: activeCase.id,
                  reasonCode: entry.decision.reasonCode
                }
              });
            } else {
              updateTrustOperationsCaseV6({
                caseId: activeCase.id,
                networkRiskScoreAtTrigger: activeCase.networkRiskScoreAtTrigger,
                interventionLadderStep: activeCase.interventionLadderStep,
                clusterId: activeCase.clusterId,
                recoveryStatus: "not_applicable"
              });
            }
            recordPayoutRiskAction({
              transactionId: entry.transaction.id,
              caseId: activeCase.id,
              sellerId: entry.transaction.sellerId,
              actionType: "release",
              reasonCode: entry.decision.reasonCode,
              source: "policy",
              policyVersionId: policyVersionId ?? activeCase.policyVersionId,
              policySnapshot: policy,
              actorId,
              metadata: {
                combinedRiskScore: entry.decision.payoutDecision.combinedRiskScore,
                integrityScore: entry.decision.payoutDecision.integrityScore,
                identityAssuranceScore:
                  entry.decision.payoutDecision.identityAssurance?.blendedScore ?? null,
                gatingAction: entry.decision.payoutDecision.gating?.action ?? "none",
                gatingReasonCodes: entry.decision.payoutDecision.gating?.reasonCodes ?? [],
                preemptiveControls:
                  entry.decision.payoutDecision.preemptiveDisputeControls?.controls ?? {},
                amountCents: entry.transaction.amountCents
              },
              createdAt: timestamp
            });
          }
          if (holdCleared) {
            const transaction = mapTransaction(getTransactionByIdQuery.get(entry.transaction.id));
            enqueueOutboxRecords({
              transactionId: entry.transaction.id,
              sourceEventId: null,
              occurredAt: nowIso,
              records: [
                {
                  topic: "dispute_update",
                  recipientUserId: transaction.buyerId,
                  payload: {
                    transactionId: transaction.id,
                    eventType: "trust_ops_hold_cleared",
                    reasonCode: entry.decision.reasonCode
                  }
                },
                {
                  topic: "dispute_update",
                  recipientUserId: transaction.sellerId,
                  payload: {
                    transactionId: transaction.id,
                    eventType: "trust_ops_hold_cleared",
                    reasonCode: entry.decision.reasonCode
                  }
                }
              ]
            });
            summary.applied.clears += 1;
          }
        }

        summary.items.push({
          transactionId: entry.transaction.id,
          riskScore: entry.transaction.riskScore,
          severity: entry.decision.severity,
          priorityScore: entry.decision.priorityScore,
          slaDueAt: entry.decision.slaDueAt,
          cohortMatched: entry.cohortMatched,
          recommendedAction: entry.decision.recommendedAction,
          payoutAction: entry.decision.payoutAction,
          payoutDecision: entry.decision.payoutDecision,
          integrityScore: entry.integrity.integrityScore,
          networkRiskScore: entry.decision.networkRiskScore,
          interventionLadderStep: entry.decision.interventionLadderStep,
          clusterId: entry.decision.clusterId,
          reasonCode: entry.decision.reasonCode,
          caseId: activeCase?.id ?? null,
          caseChanged,
          holdApplied,
          holdCleared,
          experimentApplied: applyForTransaction
        });
      }
      if (apply && policy.v7Enabled === true && Number.isInteger(policyVersionId) && policyVersionId > 0) {
        summary.guardrails = this.evaluateTrustPolicyGuardrails({
          policyVersionId,
          policy,
          actorId
        });
      }
      return summary;
    },

    listTrustOperationsCases({ status, transactionId, limit = 100 } = {}) {
      if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
        throw new StoreError("validation", "limit must be an integer between 1 and 500");
      }
      if (transactionId && typeof transactionId !== "string") {
        throw new StoreError("validation", "transactionId must be a string when provided");
      }
      if (transactionId) {
        return listTrustOperationsCasesByTransaction
          .all({ transaction_id: transactionId, limit })
          .map(mapTrustOperationsCase);
      }
      if (status === undefined || status === null || status === "") {
        return listTrustOperationsCasesAll.all({ limit }).map(mapTrustOperationsCase);
      }
      const normalizedStatus = normalizeTrustOperationsCaseStatus(status);
      return listTrustOperationsCasesByStatus
        .all({ status: normalizedStatus, limit })
        .map(mapTrustOperationsCase);
    },

    createTrustOpsPolicyVersion({
      name,
      policy = {},
      cohort = {},
      activationWindowStartAt = null,
      activationWindowEndAt = null,
      actorId
    }) {
      const normalizedName = String(name ?? "").trim();
      if (!normalizedName) {
        throw new StoreError("validation", "name is required");
      }
      const normalizedActorId = String(actorId ?? "").trim();
      if (!normalizedActorId) {
        throw new StoreError("validation", "actorId is required");
      }
      const createdAt = now().toISOString();
      const insertResult = insertTrustOpsPolicyVersion.run({
        name: normalizedName,
        status: "draft",
        activation_window_start_at: activationWindowStartAt ? toIsoString(activationWindowStartAt) : null,
        activation_window_end_at: activationWindowEndAt ? toIsoString(activationWindowEndAt) : null,
        policy_json: JSON.stringify(policy ?? {}),
        cohort_json: JSON.stringify(cohort ?? {}),
        created_by: normalizedActorId,
        activated_by: null,
        activated_at: null,
        created_at: createdAt,
        updated_at: createdAt
      });
      return mapTrustOpsPolicyVersion(getTrustOpsPolicyVersionById.get({ id: Number(insertResult.lastInsertRowid) }));
    },

    listTrustOpsPolicyVersions({ status, limit = 100 } = {}) {
      if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
        throw new StoreError("validation", "limit must be an integer between 1 and 500");
      }
      if (!status) {
        return listTrustOpsPolicyVersionsAll.all({ limit }).map(mapTrustOpsPolicyVersion);
      }
      return listTrustOpsPolicyVersionsByStatus
        .all({ status: normalizeTrustOpsPolicyStatus(status), limit })
        .map(mapTrustOpsPolicyVersion);
    },

    getTrustOpsPolicyVersion({ id }) {
      if (!Number.isInteger(id) || id <= 0) {
        throw new StoreError("validation", "id must be a positive integer");
      }
      const policy = mapTrustOpsPolicyVersion(getTrustOpsPolicyVersionById.get({ id }));
      if (!policy) {
        throw new StoreError("not_found", "trust operations policy version not found");
      }
      return policy;
    },

    listTrustPolicyGuardrailEvents({ policyVersionId, limit = 100 } = {}) {
      if (!Number.isInteger(policyVersionId) || policyVersionId <= 0) {
        throw new StoreError("validation", "policyVersionId must be a positive integer");
      }
      if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
        throw new StoreError("validation", "limit must be an integer between 1 and 500");
      }
      return listTrustPolicyGuardrailEventsByPolicy
        .all({ policy_version_id: policyVersionId, limit })
        .map(mapTrustPolicyGuardrailEvent);
    },

    activateTrustOpsPolicyVersion({ id, actorId }) {
      const policy = this.getTrustOpsPolicyVersion({ id });
      const timestamp = now().toISOString();
      const normalizedActorId = String(actorId ?? "").trim();
      if (!normalizedActorId) {
        throw new StoreError("validation", "actorId is required");
      }
      retireActiveTrustOpsPolicies.run({ id, updated_at: timestamp });
      updateTrustOpsPolicyVersionStatus.run({
        id,
        status: "active",
        activated_by: normalizedActorId,
        activated_at: timestamp,
        updated_at: timestamp
      });
      return this.getTrustOpsPolicyVersion({ id: policy.id });
    },

    getActiveTrustOpsPolicyVersion() {
      return mapTrustOpsPolicyVersion(getActiveTrustOpsPolicyVersion.get());
    },

    getTrustOperationsCase({ caseId, includeEvents = true, eventLimit = 200 }) {
      if (!Number.isInteger(caseId) || caseId <= 0) {
        throw new StoreError("validation", "caseId must be a positive integer");
      }
      const trustCase = mapTrustOperationsCase(getTrustOperationsCaseById.get({ id: caseId }));
      if (!trustCase) {
        throw new StoreError("not_found", "trust operations case not found");
      }
      const events = includeEvents
        ? listTrustOperationsCaseEventsByCase
            .all({ case_id: caseId, limit: eventLimit })
            .map(mapTrustOperationsCaseEvent)
        : [];
      const notes = listTrustOperationsCaseNotesByCase
        .all({ case_id: caseId, limit: 200 })
        .map(mapTrustOperationsCaseNote);
      const payoutTimeline = listPayoutRiskActionsByCase
        .all({ case_id: caseId, limit: 200 })
        .map(mapPayoutRiskAction);
      const clusterActions = trustCase.clusterId
        ? listTrustClusterActionsByCluster
            .all({ cluster_id: trustCase.clusterId, limit: 200 })
            .map(mapTrustClusterAction)
        : [];
      const recoveryJobs = listTrustRecoveryJobsByCase
        .all({ case_id: caseId, limit: 200 })
        .map(mapTrustRecoveryJob);
      const challenges = listTrustStepUpChallengesByCase
        .all({ case_id: caseId, limit: 200 })
        .map(mapTrustStepUpChallenge);
      const networkLinks = trustCase.clusterId
        ? listTrustNetworkLinksByCluster
            .all({ cluster_id: trustCase.clusterId, limit: 500 })
            .map(mapTrustNetworkLink)
        : [];
      const listingAuthenticitySignals = listTrustListingAuthenticitySignalsByCase
        .all({ case_id: caseId, limit: 500 })
        .map(mapTrustListingAuthenticitySignal);
      const remediationActions = listTrustCaseRemediationActionsByCase
        .all({ case_id: caseId, limit: 500 })
        .map(mapTrustCaseRemediationAction);
      const buyerRiskSignals = listTrustBuyerRiskSignalsByCase
        .all({ case_id: caseId, limit: 500 })
        .map(mapTrustBuyerRiskSignal);
      const disputePreemptionActions = listTrustDisputePreemptionActionsByCase
        .all({ case_id: caseId, limit: 500 })
        .map(mapTrustDisputePreemptionAction);
      return {
        trustCase,
        events,
        notes,
        payoutTimeline,
        clusterActions,
        recoveryJobs,
        challenges,
        networkLinks,
        listingAuthenticitySignals,
        remediationActions,
        buyerRiskSignals,
        disputePreemptionActions
      };
    },

    previewTrustOpsIntervention({ caseId }) {
      const details = this.getTrustOperationsCase({ caseId, includeEvents: false });
      const remediationPlan = details.trustCase.payoutDecision?.remediationPlan ?? { actions: [] };
      const machineHumanDecisionBoundary =
        details.trustCase.payoutDecision?.machineHumanDecisionBoundary ?? {};
      const v11Automation = details.trustCase.payoutDecision?.disputePreemptionAutomation ?? {};
      const preview = {
        caseId: details.trustCase.id,
        transactionId: details.trustCase.transactionId,
        confidenceTier:
          details.trustCase.payoutDecision?.scamRingInterdiction?.confidenceTier ?? "low",
        score: details.trustCase.payoutDecision?.scamRingInterdiction?.score ?? 0,
        actions: remediationPlan.actions ?? [],
        machineHumanDecisionBoundary,
        buyerRiskIntelligence:
          details.trustCase.payoutDecision?.buyerRiskIntelligence ?? {},
        disputePreemptionAutomation: {
          score: v11Automation.score ?? 0,
          actions: v11Automation.actions ?? [],
          machineHumanDecisionBoundary: v11Automation.machineHumanDecisionBoundary ?? {},
          alternativePaths: v11Automation.alternativePaths ?? {}
        },
        alternativeInterventionPaths: v11Automation.alternativePaths ?? {},
        safeToAutoApply: machineHumanDecisionBoundary.humanReviewRequiredActions?.length
          ? false
          : true
      };
      return { preview, trustCase: details.trustCase };
    },

    exportTrustOpsEvidenceBundle({ caseId, actorId }) {
      const details = this.getTrustOperationsCase({ caseId, includeEvents: true });
      const normalizedActorId = String(actorId ?? "").trim();
      if (!normalizedActorId) {
        throw new StoreError("validation", "actorId is required");
      }
      const transaction = mapTransaction(getTransactionByIdQuery.get(details.trustCase.transactionId));
      if (!transaction) {
        throw new StoreError("not_found", "transaction not found");
      }
      const payload = {
        exportVersion:
          Array.isArray(details.buyerRiskSignals) && details.buyerRiskSignals.length > 0 ? "v11" : "v10",
        exportedAt: now().toISOString(),
        exportedBy: normalizedActorId,
        caseId: details.trustCase.id,
        transactionId: details.trustCase.transactionId,
        policyVersionId: details.trustCase.policyVersionId ?? null,
        decisionBoundary:
          details.trustCase.payoutDecision?.machineHumanDecisionBoundary ?? {},
        scamRingInterdiction: details.trustCase.payoutDecision?.scamRingInterdiction ?? {},
        listingAuthenticityForensics:
          details.trustCase.payoutDecision?.listingAuthenticityForensics ?? {},
        remediationPlan: details.trustCase.payoutDecision?.remediationPlan ?? { actions: [] },
        buyerRiskIntelligence: details.trustCase.payoutDecision?.buyerRiskIntelligence ?? {},
        escrowAnomalyForecast: details.trustCase.payoutDecision?.escrowAnomalyForecast ?? {},
        disputePreemptionAutomation:
          details.trustCase.payoutDecision?.disputePreemptionAutomation ?? {},
        network: {
          clusterId: details.trustCase.clusterId,
          linkCount: details.networkLinks.length,
          links: details.networkLinks
        },
        listingAuthenticitySignals: details.listingAuthenticitySignals,
        remediationActions: details.remediationActions,
        buyerRiskSignals: details.buyerRiskSignals,
        disputePreemptionActions: details.disputePreemptionActions,
        timeline: details.events,
        payoutTimeline: details.payoutTimeline,
        transactionSnapshot: transaction
      };
      appendTrustOperationsCaseEvent({
        caseId: details.trustCase.id,
        transactionId: details.trustCase.transactionId,
        eventType: "operator_overridden",
        actorId: normalizedActorId,
        reasonCode: "evidence_bundle_exported",
        details: {
          exportVersion: payload.exportVersion,
          remediationActionCount: details.remediationActions.length,
          signalCount: details.listingAuthenticitySignals.length,
          buyerRiskSignalCount: details.buyerRiskSignals.length,
          preemptionActionCount: details.disputePreemptionActions.length
        }
      });
      return { caseId: details.trustCase.id, payload };
    },

    assignTrustOperationsCase({
      caseId,
      investigatorId,
      actorId,
      reasonCode = "investigator_assignment",
      notes = null
    }) {
      if (!Number.isInteger(caseId) || caseId <= 0) {
        throw new StoreError("validation", "caseId must be a positive integer");
      }
      const normalizedInvestigatorId = String(investigatorId ?? "").trim();
      if (!normalizedInvestigatorId) {
        throw new StoreError("validation", "investigatorId is required");
      }
      const existing = this.getTrustOperationsCase({ caseId, includeEvents: false }).trustCase;
      const timestamp = now().toISOString();
      claimTrustOperationsCase.run({
        id: caseId,
        assigned_investigator_id: normalizedInvestigatorId,
        claimed_at: timestamp,
        first_action_at: existing.firstActionAt ?? timestamp,
        last_action_at: timestamp,
        updated_at: timestamp
      });
      appendTrustOperationsCaseEvent({
        caseId,
        transactionId: existing.transactionId,
        eventType: "operator_overridden",
        actorId,
        reasonCode,
        details: {
          action: "assign",
          investigatorId: normalizedInvestigatorId,
          notes: notes ?? null
        },
        createdAt: timestamp
      });
      return this.getTrustOperationsCase({ caseId, includeEvents: true });
    },

    addTrustOperationsCaseNote({ caseId, note, actorId }) {
      if (!Number.isInteger(caseId) || caseId <= 0) {
        throw new StoreError("validation", "caseId must be a positive integer");
      }
      const normalizedNote = String(note ?? "").trim();
      if (!normalizedNote) {
        throw new StoreError("validation", "note is required");
      }
      const normalizedActorId = String(actorId ?? "").trim();
      if (!normalizedActorId) {
        throw new StoreError("validation", "actorId is required");
      }
      const existing = this.getTrustOperationsCase({ caseId, includeEvents: false }).trustCase;
      const timestamp = now().toISOString();
      insertTrustOperationsCaseNote.run({
        case_id: caseId,
        transaction_id: existing.transactionId,
        note: normalizedNote,
        author_id: normalizedActorId,
        created_at: timestamp
      });
      claimTrustOperationsCase.run({
        id: caseId,
        assigned_investigator_id: existing.assignedInvestigatorId,
        claimed_at: existing.claimedAt,
        first_action_at: existing.firstActionAt ?? timestamp,
        last_action_at: timestamp,
        updated_at: timestamp
      });
      appendTrustOperationsCaseEvent({
        caseId,
        transactionId: existing.transactionId,
        eventType: "operator_overridden",
        actorId: normalizedActorId,
        reasonCode: "internal_note_added",
        details: {
          action: "note",
          note: normalizedNote
        },
        createdAt: timestamp
      });
      return this.getTrustOperationsCase({ caseId, includeEvents: true });
    },

    bulkApplyTrustOperationsCaseDecision({
      caseIds,
      action,
      actorId,
      reasonCode,
      notes = null
    }) {
      if (!Array.isArray(caseIds) || caseIds.length === 0) {
        throw new StoreError("validation", "caseIds must contain at least one case id");
      }
      if (caseIds.length > 100) {
        throw new StoreError("validation", "caseIds cannot exceed 100 items");
      }
      if (!reasonCode || typeof reasonCode !== "string" || !reasonCode.trim()) {
        throw new StoreError("validation", "reasonCode is required");
      }
      const bulkActionId = `bulk_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const results = [];
      for (const caseIdRaw of caseIds) {
        const caseId = Number(caseIdRaw);
        if (!Number.isInteger(caseId) || caseId <= 0) {
          throw new StoreError("validation", "caseIds must be positive integers");
        }
        const result = this.applyTrustOperationsCaseDecision({
          caseId,
          action,
          actorId,
          reasonCode,
          notes
        });
        appendTrustOperationsCaseEvent({
          caseId,
          transactionId: result.trustCase.transactionId,
          eventType: "operator_overridden",
          actorId,
          reasonCode,
          details: {
            action: "bulk_case_action",
            bulkActionId,
            appliedAction: action
          }
        });
        results.push(result);
      }
      return { bulkActionId, total: results.length, cases: results };
    },

    ingestTrustOpsPolicyFeedback({
      transactionId = null,
      caseId = null,
      feedbackType,
      outcome,
      source,
      actorId = null,
      details = {}
    }) {
      const normalizedType = normalizeTrustOpsFeedbackType(feedbackType);
      const normalizedOutcome = String(outcome ?? "").trim();
      if (!normalizedOutcome) {
        throw new StoreError("validation", "outcome is required");
      }
      const normalizedSource = String(source ?? "").trim();
      if (!normalizedSource) {
        throw new StoreError("validation", "source is required");
      }
      const normalizedActorId =
        actorId === null || actorId === undefined ? null : String(actorId).trim() || null;
      const normalizedTransactionId =
        transactionId === null || transactionId === undefined
          ? null
          : String(transactionId).trim() || null;
      const normalizedCaseId =
        caseId === null || caseId === undefined ? null : Number(caseId);
      if (normalizedCaseId !== null && (!Number.isInteger(normalizedCaseId) || normalizedCaseId <= 0)) {
        throw new StoreError("validation", "caseId must be a positive integer when provided");
      }
      const createdAt = now().toISOString();
      const insertResult = insertTrustOpsPolicyFeedback.run({
        transaction_id: normalizedTransactionId,
        case_id: normalizedCaseId,
        feedback_type: normalizedType,
        outcome: normalizedOutcome,
        source: normalizedSource,
        actor_id: normalizedActorId,
        details_json: JSON.stringify(details ?? {}),
        created_at: createdAt
      });
      if (normalizedCaseId !== null && normalizedOutcome.toLowerCase().includes("false_positive")) {
        const existing = this.getTrustOperationsCase({ caseId: normalizedCaseId, includeEvents: false }).trustCase;
        updateTrustOperationsCase.run({
          id: normalizedCaseId,
          status: existing.status,
          recommended_action: existing.recommendedAction,
          reason_code: existing.reasonCode,
          policy_snapshot_json: JSON.stringify(existing.policySnapshot ?? {}),
          triggered_by_signal_id: existing.triggeredBySignalId,
          risk_score_at_trigger: existing.riskScoreAtTrigger,
          seller_integrity_score_at_trigger: existing.sellerIntegrityScoreAtTrigger,
          severity: existing.severity,
          priority_score: existing.priorityScore,
          sla_due_at: existing.slaDueAt,
          assigned_investigator_id: existing.assignedInvestigatorId,
          claimed_at: existing.claimedAt,
          first_action_at: existing.firstActionAt,
          last_action_at: now().toISOString(),
          false_positive_flag: 1,
          payout_action: existing.payoutAction,
          payout_decision_json: JSON.stringify(existing.payoutDecision ?? {}),
          policy_version_id: existing.policyVersionId,
          override_expires_at: existing.overrideExpiresAt,
          hold_expires_at: existing.holdExpiresAt,
          resolved_at: existing.resolvedAt,
          resolved_by: existing.resolvedBy,
          resolution_code: existing.resolutionCode,
          updated_at: now().toISOString()
        });
      }
      const inserted = listTrustOpsPolicyFeedbackByCreated
        .all({ limit: 1 })
        .map(mapTrustOpsPolicyFeedback)
        .find((item) => item.id === Number(insertResult.lastInsertRowid));
      return inserted ?? null;
    },

    listTrustOpsPolicyFeedback({ lookbackHours = 24, limit = 200 } = {}) {
      if (!Number.isInteger(limit) || limit <= 0 || limit > 1000) {
        throw new StoreError("validation", "limit must be an integer between 1 and 1000");
      }
      const parsedLookback = Number(lookbackHours ?? 24);
      if (!Number.isFinite(parsedLookback) || parsedLookback <= 0) {
        throw new StoreError("validation", "lookbackHours must be a positive number");
      }
      const sinceAt = addHours(now().toISOString(), -parsedLookback);
      return listTrustOpsPolicyFeedbackSince
        .all({ since_at: sinceAt, limit })
        .map(mapTrustOpsPolicyFeedback);
    },

    generateTrustOpsPolicyRecommendations({ lookbackHours = 168 } = {}) {
      const feedback = this.listTrustOpsPolicyFeedback({ lookbackHours, limit: 1000 });
      const falsePositiveSignals = feedback.filter((item) =>
        String(item.outcome).toLowerCase().includes("false_positive")
      ).length;
      const chargebackSignals = feedback.filter(
        (item) =>
          item.feedbackType === "chargeback_outcome" &&
          (String(item.outcome).includes("won_by_buyer") || String(item.outcome).includes("chargeback"))
      ).length;
      const activePolicy = this.getActiveTrustOpsPolicyVersion();
      const baseline = activePolicy?.policy ?? {};
      let autoHoldRiskScore = Number(baseline.autoHoldRiskScore ?? 70);
      let clearRiskScore = Number(baseline.clearRiskScore ?? 30);
      if (falsePositiveSignals >= 3) {
        autoHoldRiskScore = Math.min(100, autoHoldRiskScore + 5);
        clearRiskScore = Math.min(autoHoldRiskScore, clearRiskScore + 5);
      }
      if (chargebackSignals >= 3) {
        autoHoldRiskScore = Math.max(1, autoHoldRiskScore - 5);
        clearRiskScore = Math.max(0, Math.min(clearRiskScore, autoHoldRiskScore - 20));
      }
      return {
        lookbackHours,
        signals: {
          falsePositiveSignals,
          chargebackSignals
        },
        baseline,
        recommendation: {
          autoHoldRiskScore,
          clearRiskScore,
          holdDurationHours: Number(baseline.holdDurationHours ?? 24)
        }
      };
    },

    applyTrustOperationsCaseDecision({
      caseId,
      action,
      actorId,
      reasonCode,
      notes = null,
      overrideExpiresInHours = null,
      requestId = null,
      correlationId = null
    }) {
      if (!Number.isInteger(caseId) || caseId <= 0) {
        throw new StoreError("validation", "caseId must be a positive integer");
      }
      const normalizedAction = normalizeTrustOperationsRecommendedAction(action);
      const normalizedActorId = String(actorId ?? "").trim();
      if (!normalizedActorId) {
        throw new StoreError("validation", "actorId is required");
      }
      if (!reasonCode || typeof reasonCode !== "string" || !reasonCode.trim()) {
        throw new StoreError("validation", "reasonCode is required");
      }
      const existing = mapTrustOperationsCase(getTrustOperationsCaseById.get({ id: caseId }));
      if (!existing) {
        throw new StoreError("not_found", "trust operations case not found");
      }
      const transaction = mapTransaction(getTransactionByIdQuery.get(existing.transactionId));
      if (!transaction) {
        throw new StoreError("not_found", "transaction not found");
      }

      let holdApplied = false;
      let holdCleared = false;
      if (normalizedAction === "hold" && transaction.holdStatus !== "held") {
        this.setTransactionHold({
          transactionId: transaction.id,
          hold: true,
          reason: "policy_auto_hold:operator_review",
          notes: notes ?? "approved by operator",
          actorId: normalizedActorId,
          requestId,
          correlationId
        });
        holdApplied = true;
      }
      if (normalizedAction === "clear" && transaction.holdStatus === "held") {
        this.setTransactionHold({
          transactionId: transaction.id,
          hold: false,
          reason: "policy_auto_clear:operator_review",
          notes: notes ?? "cleared by operator",
          actorId: normalizedActorId,
          requestId,
          correlationId
        });
        holdCleared = true;
      }

      const timestamp = now().toISOString();
      const parsedOverrideExpiresInHours =
        overrideExpiresInHours === null || overrideExpiresInHours === undefined
          ? null
          : Number(overrideExpiresInHours);
      if (
        parsedOverrideExpiresInHours !== null &&
        (!Number.isInteger(parsedOverrideExpiresInHours) ||
          parsedOverrideExpiresInHours < 1 ||
          parsedOverrideExpiresInHours > 240)
      ) {
        throw new StoreError("validation", "overrideExpiresInHours must be an integer between 1 and 240");
      }
      const nextStatus =
        normalizedAction === "none" || normalizedAction === "clear" ? "resolved" : "in_review";
      const resolutionCode = nextStatus === "resolved" ? reasonCode.trim() : null;
      const overrideExpiresAt =
        normalizedAction === "hold" && parsedOverrideExpiresInHours !== null
          ? addHours(timestamp, parsedOverrideExpiresInHours)
          : normalizedAction === "clear" || normalizedAction === "none"
            ? null
            : existing.overrideExpiresAt;
      updateTrustOperationsCase.run({
        id: caseId,
        status: nextStatus,
        recommended_action: normalizedAction,
        reason_code: reasonCode.trim(),
        policy_snapshot_json: JSON.stringify(existing.policySnapshot ?? {}),
        triggered_by_signal_id: existing.triggeredBySignalId,
        risk_score_at_trigger: existing.riskScoreAtTrigger,
        seller_integrity_score_at_trigger: existing.sellerIntegrityScoreAtTrigger,
        severity: existing.severity,
        priority_score: existing.priorityScore,
        sla_due_at: existing.slaDueAt,
        assigned_investigator_id: existing.assignedInvestigatorId,
        claimed_at: existing.claimedAt,
        first_action_at: existing.firstActionAt ?? timestamp,
        last_action_at: timestamp,
        false_positive_flag:
          normalizedAction === "clear" || reasonCode.trim() === "false_positive_after_review"
            ? 1
            : existing.falsePositiveFlag
              ? 1
              : 0,
        payout_action:
          normalizedAction === "hold"
            ? "manual_review"
            : normalizedAction === "clear"
              ? "release"
              : "none",
        payout_decision_json: JSON.stringify(existing.payoutDecision ?? {}),
        policy_version_id: existing.policyVersionId,
        override_expires_at: overrideExpiresAt,
        hold_expires_at:
          normalizedAction === "hold" && parsedOverrideExpiresInHours !== null
            ? addHours(timestamp, parsedOverrideExpiresInHours)
            : existing.holdExpiresAt,
        resolved_at: nextStatus === "resolved" ? timestamp : null,
        resolved_by: nextStatus === "resolved" ? normalizedActorId : null,
        resolution_code: resolutionCode,
        updated_at: timestamp
      });
      const nextRecoveryStatus =
        normalizedAction === "clear" || reasonCode.trim() === "false_positive_after_review"
          ? "queued"
          : normalizedAction === "hold"
            ? "not_applicable"
            : existing.recoveryStatus ?? "not_applicable";
      updateTrustOperationsCaseV6({
        caseId,
        networkRiskScoreAtTrigger: existing.networkRiskScoreAtTrigger,
        interventionLadderStep:
          normalizedAction === "hold" ? "manual_review_gate" : existing.interventionLadderStep,
        clusterId: existing.clusterId,
        recoveryStatus: nextRecoveryStatus
      });
      if (nextRecoveryStatus === "queued") {
        enqueueTrustRecoveryJob({
          caseId,
          transactionId: transaction.id,
          reasonCode:
            reasonCode.trim() === "false_positive_after_review"
              ? "false_positive_release_recovery"
              : "operator_clear_recovery",
          templateKey: "trust_recovery_release_notice",
          payload: {
            transactionId: transaction.id,
            caseId,
            reasonCode: reasonCode.trim()
          }
        });
      }
      const remediationUnwind = {
        applied: false,
        rolledBackActionIds: [],
        restoredListingIds: [],
        restoredAccountIds: []
      };
      const preemptionUnwind = {
        applied: false,
        rolledBackActionIds: []
      };
      if (normalizedAction === "clear" || reasonCode.trim() === "false_positive_after_review") {
        const appliedRemediationActions = listAppliedTrustCaseRemediationActionsByCase
          .all({ case_id: caseId, limit: 200 })
          .map(mapTrustCaseRemediationAction);
        for (const remediationAction of appliedRemediationActions) {
          if (remediationAction.actionType === "listing_quarantine") {
            const listingId = remediationAction.machineDecision?.targetListingId ?? null;
            if (listingId) {
              try {
                this.setListingModerationStatus({
                  listingId,
                  moderationStatus: "approved",
                  reasonCode: "trust_ops_remediation_unwind",
                  publicReason: "Listing restored after trust remediation rollback.",
                  internalNotes: `trust_case:${caseId} rollback_of_action:${remediationAction.id}`,
                  source: "trust_ops_v10_unwind",
                  actorId: normalizedActorId
                });
                remediationUnwind.restoredListingIds.push(listingId);
              } catch {
                // Keep rollback audit trail even if target listing state changed independently.
              }
            }
          }
          if (remediationAction.actionType === "account_capability_restriction") {
            try {
              this.setAccountRiskControls({
                userId: transaction.sellerId,
                flagged: false,
                verificationRequired: false,
                actorId: normalizedActorId,
                reason: "trust_ops_remediation_unwind",
                notes: `trust_case:${caseId} rollback_of_action:${remediationAction.id}`
              });
              remediationUnwind.restoredAccountIds.push(transaction.sellerId);
            } catch {
              // Risk controls may already have been changed manually by operators.
            }
          }
          updateTrustCaseRemediationActionStatus.run({
            id: remediationAction.id,
            status: "rolled_back",
            updated_at: timestamp
          });
          remediationUnwind.rolledBackActionIds.push(remediationAction.id);
          appendTrustCaseRemediationAction({
            caseId,
            transactionId: transaction.id,
            actionType: "remediation_unwind",
            confidenceTier: remediationAction.confidenceTier,
            status: "applied",
            reasonCode: "false_positive_remediation_unwind",
            policyVersionId: existing.policyVersionId,
            machineDecision: {
              rollbackOfActionId: remediationAction.id,
              sourceActionType: remediationAction.actionType
            },
            humanDecision: {
              approvedBy: normalizedActorId,
              reasonCode: reasonCode.trim()
            },
            rollbackOfActionId: remediationAction.id,
            createdBy: normalizedActorId
          });
        }
        remediationUnwind.applied = remediationUnwind.rolledBackActionIds.length > 0;
        const appliedPreemptionActions = listAppliedTrustDisputePreemptionActionsByCase
          .all({ case_id: caseId, limit: 200 })
          .map(mapTrustDisputePreemptionAction);
        for (const preemptionAction of appliedPreemptionActions) {
          if (preemptionAction.actionType === "preemption_unwind") {
            continue;
          }
          updateTrustDisputePreemptionActionStatus.run({
            id: preemptionAction.id,
            status: "rolled_back",
            updated_at: timestamp
          });
          preemptionUnwind.rolledBackActionIds.push(preemptionAction.id);
          appendTrustDisputePreemptionAction({
            caseId,
            transactionId: transaction.id,
            actionType: "preemption_unwind",
            confidenceTier: preemptionAction.confidenceTier,
            status: "applied",
            reasonCode: "false_positive_preemption_unwind",
            policyVersionId: existing.policyVersionId,
            machineDecision: {
              rollbackOfActionId: preemptionAction.id,
              sourceActionType: preemptionAction.actionType
            },
            humanDecision: {
              approvedBy: normalizedActorId,
              reasonCode: reasonCode.trim()
            },
            rollbackOfActionId: preemptionAction.id,
            createdBy: normalizedActorId
          });
        }
        preemptionUnwind.applied = preemptionUnwind.rolledBackActionIds.length > 0;
      }

      recordPayoutRiskAction({
        transactionId: transaction.id,
        caseId,
        sellerId: transaction.sellerId,
        actionType:
          normalizedAction === "hold"
            ? "manual_review"
            : normalizedAction === "clear"
              ? "release"
              : "none",
        reasonCode: reasonCode.trim(),
        source: "override",
        policyVersionId: existing.policyVersionId,
        policySnapshot: existing.policySnapshot ?? {},
        actorId: normalizedActorId,
        overrideExpiresAt,
        metadata: {
          action: normalizedAction,
          notes: notes ?? null,
          amountCents: transaction.amountCents,
          remediationUnwind,
          preemptionUnwind
        },
        createdAt: timestamp
      });

      appendTrustOperationsCaseEvent({
        caseId,
        transactionId: transaction.id,
        eventType: normalizedAction === "hold" ? "operator_approved" : normalizedAction === "clear" ? "operator_cleared" : "operator_overridden",
        actorId: normalizedActorId,
        reasonCode: reasonCode.trim(),
        details: {
          action: normalizedAction,
          notes: notes ?? null,
          remediationUnwind,
          preemptionUnwind
        },
        createdAt: timestamp
      });
      if (holdApplied || holdCleared) {
        enqueueOutboxRecords({
          transactionId: transaction.id,
          sourceEventId: null,
          occurredAt: timestamp,
          records: [
            {
              topic: holdApplied ? "action_required" : "dispute_update",
              recipientUserId: transaction.buyerId,
              payload: {
                transactionId: transaction.id,
                eventType: holdApplied ? "trust_ops_hold_applied" : "trust_ops_hold_cleared",
                reasonCode: reasonCode.trim()
              }
            },
            {
              topic: holdApplied ? "action_required" : "dispute_update",
              recipientUserId: transaction.sellerId,
              payload: {
                transactionId: transaction.id,
                eventType: holdApplied ? "trust_ops_hold_applied" : "trust_ops_hold_cleared",
                reasonCode: reasonCode.trim()
              }
            }
          ]
        });
      }

      return this.getTrustOperationsCase({ caseId, includeEvents: true });
    },

    getTrustOperationsStats({ lookbackHours = 24 } = {}) {
      const sinceAt = addHours(now().toISOString(), -Math.max(1, Number(lookbackHours ?? 24)));
      const openCount = Number(countTrustOperationsCasesByStatus.get({ status: "open" })?.count ?? 0);
      const inReviewCount = Number(
        countTrustOperationsCasesByStatus.get({ status: "in_review" })?.count ?? 0
      );
      const resolvedCount = Number(
        countTrustOperationsCasesByStatus.get({ status: "resolved" })?.count ?? 0
      );
      const autoHoldAppliedCount = Number(
        countTrustOperationsCaseEventsByTypeSince.get({
          event_type: "auto_hold_applied",
          since_at: sinceAt
        })?.count ?? 0
      );
      const autoHoldClearedCount = Number(
        countTrustOperationsCaseEventsByTypeSince.get({
          event_type: "auto_hold_cleared",
          since_at: sinceAt
        })?.count ?? 0
      );
      const operatorOverrideCount = Number(
        countTrustOperationsCaseEventsByTypeSince.get({
          event_type: "operator_overridden",
          since_at: sinceAt
        })?.count ?? 0
      );
      const falsePositiveCount = Number(countTrustOpsFalsePositiveCases.get()?.count ?? 0);
      const feedback = listTrustOpsPolicyFeedbackSince
        .all({ since_at: sinceAt, limit: 1000 })
        .map(mapTrustOpsPolicyFeedback);
      const overrideFeedbackCount = feedback.filter(
        (item) => item.feedbackType === "operator_action" && String(item.outcome).startsWith("override")
      ).length;
      const reversalFeedbackCount = feedback.filter(
        (item) =>
          item.feedbackType === "dispute_outcome" &&
          (String(item.outcome).includes("reversed") || String(item.outcome).includes("refund"))
      ).length;
      const openCaseAgingHours = Number(
        avgTrustOpsOpenCaseAgeHours.get({ now_at: now().toISOString() })?.avg_hours ?? 0
      );
      const averageResolutionHours = Number(avgTrustOpsResolutionHours.get()?.avg_hours ?? 0);
      const actionSample = autoHoldAppliedCount + operatorOverrideCount + autoHoldClearedCount;
      const falsePositiveRate = actionSample === 0 ? 0 : falsePositiveCount / actionSample;
      const reversalRate = actionSample === 0 ? 0 : reversalFeedbackCount / actionSample;
      const payoutActions = listPayoutRiskActionsSince
        .all({ since_at: sinceAt, limit: 5000 })
        .map(mapPayoutRiskAction);
      const restrictiveActions = payoutActions.filter((item) =>
        ["hold", "reserve", "manual_review"].includes(item.actionType)
      );
      const releaseActions = payoutActions.filter((item) => item.actionType === "release");
      const overrideActions = payoutActions.filter((item) => item.source === "override");
      const preventedLossEstimateCents = Math.round(
        restrictiveActions.reduce((sum, item) => {
          const amount = Number(item.metadata.amountCents ?? 0);
          const riskScore = Number(item.metadata.combinedRiskScore ?? 0);
          return sum + amount * (Math.max(0, Math.min(100, riskScore)) / 100);
        }, 0)
      );
      const delayHours = [];
      for (const release of releaseActions) {
        const trigger = restrictiveActions.find(
          (item) => item.transactionId === release.transactionId && item.createdAt <= release.createdAt
        );
        if (trigger) {
          const lag = (new Date(release.createdAt).valueOf() - new Date(trigger.createdAt).valueOf()) / 3600000;
          if (Number.isFinite(lag) && lag >= 0) {
            delayHours.push(lag);
          }
        }
      }
      delayHours.sort((a, b) => a - b);
      const percentile = (sorted, p) => {
        if (!sorted.length) {
          return 0;
        }
        const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
        return Number(sorted[index].toFixed(2));
      };
      const falsePositiveReleaseRate =
        restrictiveActions.length === 0 ? 0 : releaseActions.length / restrictiveActions.length;
      const overrideDriftRate =
        payoutActions.length === 0 ? 0 : overrideActions.length / payoutActions.length;
      const actionsWithPreemptiveControls = payoutActions.filter(
        (item) =>
          item.metadata?.preemptiveControls &&
          typeof item.metadata.preemptiveControls === "object"
      );
      const shipmentConfirmationCount = actionsWithPreemptiveControls.filter(
        (item) => item.metadata.preemptiveControls.requireShipmentConfirmation === true
      ).length;
      const payoutRestrictionCount = actionsWithPreemptiveControls.filter(
        (item) => item.metadata.preemptiveControls.restrictPayoutProgression === true
      ).length;
      const escrowDelayValues = actionsWithPreemptiveControls
        .map((item) => Number(item.metadata.preemptiveControls.conditionalEscrowDelayHours ?? 0))
        .filter((value) => Number.isFinite(value) && value > 0);
      const ladderRows = countTrustOpsCasesByLadderStepSince.all({ since_at: sinceAt });
      const ladderCounts = {
        none: 0,
        listing_throttle: 0,
        transaction_cooloff: 0,
        reserve_increase: 0,
        verification_rechallenge: 0,
        manual_review_gate: 0
      };
      for (const row of ladderRows) {
        if (Object.prototype.hasOwnProperty.call(ladderCounts, row.step)) {
          ladderCounts[row.step] = Number(row.count ?? 0);
        }
      }
      const recoveryRows = countTrustOpsRecoveryJobsByStatusSince.all({ since_at: sinceAt });
      const recoveryCounts = { queued: 0, processing: 0, completed: 0, failed: 0 };
      for (const row of recoveryRows) {
        if (Object.prototype.hasOwnProperty.call(recoveryCounts, row.status)) {
          recoveryCounts[row.status] = Number(row.count ?? 0);
        }
      }
      const challengeRows = countTrustStepUpChallengesByStatusSince.all({ since_at: sinceAt });
      const challengeCounts = { pending: 0, passed: 0, failed: 0, expired: 0 };
      for (const row of challengeRows) {
        if (Object.prototype.hasOwnProperty.call(challengeCounts, row.status)) {
          challengeCounts[row.status] = Number(row.count ?? 0);
        }
      }
      const accountRecoveryRows = countAccountRecoveryCasesByStatusSince.all({ since_at: sinceAt });
      const accountRecoveryCounts = { open: 0, resolved: 0, cancelled: 0 };
      for (const row of accountRecoveryRows) {
        if (Object.prototype.hasOwnProperty.call(accountRecoveryCounts, row.status)) {
          accountRecoveryCounts[row.status] = Number(row.count ?? 0);
        }
      }
      const totalRecovery = Object.values(recoveryCounts).reduce((sum, value) => sum + value, 0);
      const totalChallenges = Object.values(challengeCounts).reduce((sum, value) => sum + value, 0);
      const clusterActions = Number(countTrustClusterActionsSince.get({ since_at: sinceAt })?.count ?? 0);
      const remediationRows = listTrustCaseRemediationActionsSince
        .all({ since_at: sinceAt, limit: 5000 })
        .map(mapTrustCaseRemediationAction);
      const listingSignalRows = listTrustListingAuthenticitySignalsSince
        .all({ since_at: sinceAt, limit: 5000 })
        .map(mapTrustListingAuthenticitySignal);
      const buyerRiskSignalRows = listTrustBuyerRiskSignalsSince
        .all({ since_at: sinceAt, limit: 5000 })
        .map(mapTrustBuyerRiskSignal);
      const preemptionRows = listTrustDisputePreemptionActionsSince
        .all({ since_at: sinceAt, limit: 5000 })
        .map(mapTrustDisputePreemptionAction);
      const remediationAppliedRows = remediationRows.filter((item) => item.status === "applied");
      const remediationRolledBackRows = remediationRows.filter((item) => item.status === "rolled_back");
      const unwindRows = remediationRows.filter((item) => item.actionType === "remediation_unwind");
      const preemptionAppliedRows = preemptionRows.filter((item) => item.status === "applied");
      const preemptionRolledBackRows = preemptionRows.filter((item) => item.status === "rolled_back");
      const preemptionUnwindRows = preemptionRows.filter((item) => item.actionType === "preemption_unwind");
      const actionTypeCounts = {
        listing_quarantine: 0,
        offer_throttle: 0,
        account_capability_restriction: 0,
        payout_reserve_escalation: 0
      };
      for (const row of remediationAppliedRows) {
        if (Object.prototype.hasOwnProperty.call(actionTypeCounts, row.actionType)) {
          actionTypeCounts[row.actionType] += 1;
        }
      }
      const avgAuthenticityScore =
        listingSignalRows.length === 0
          ? 0
          : Number(
              (
                listingSignalRows.reduce((sum, item) => sum + Number(item.confidenceScore ?? 0), 0) /
                listingSignalRows.length
              ).toFixed(2)
            );
      const avgBuyerRiskContribution =
        buyerRiskSignalRows.length === 0
          ? 0
          : Number(
              (
                buyerRiskSignalRows.reduce(
                  (sum, item) => sum + Math.max(0, Number(item.contributionScore ?? 0)),
                  0
                ) / buyerRiskSignalRows.length
              ).toFixed(4)
            );
      const preemptionDelayHours = preemptionAppliedRows
        .map((item) => Number(item.machineDecision?.delayHours ?? 0))
        .filter((value) => Number.isFinite(value) && value > 0);
      const falsePositivePreemptionImpactRate =
        preemptionAppliedRows.length === 0
          ? 0
          : Number((preemptionRolledBackRows.length / preemptionAppliedRows.length).toFixed(4));
      const netTrustLossPreventedEstimateCents = Math.round(
        Math.max(0, preemptionAppliedRows.length - preemptionRolledBackRows.length) * 1250
      );
      const appealFeedbackCount = Number(countAppealFeedbackSince.get({ since_at: sinceAt })?.count ?? 0);
      const appealOverturnCount = Number(
        countAppealOverturnFeedbackSince.get({ since_at: sinceAt })?.count ?? 0
      );
      const rollbackRows = countTrustPolicyGuardrailRollbacksByPolicySince.all({ since_at: sinceAt });
      const rollbackFrequencyByPolicyVersion = {};
      for (const row of rollbackRows) {
        if (row.policy_version_id === null || row.policy_version_id === undefined) {
          continue;
        }
        rollbackFrequencyByPolicyVersion[String(Number(row.policy_version_id))] = Number(row.count ?? 0);
      }
      return {
        queue: {
          open: openCount,
          inReview: inReviewCount,
          resolved: resolvedCount
        },
        lookbackHours: Math.max(1, Number(lookbackHours ?? 24)),
        events: {
          autoHoldApplied: autoHoldAppliedCount,
          autoHoldCleared: autoHoldClearedCount,
          operatorOverrides: operatorOverrideCount
        },
        decisionQuality: {
          falsePositiveRate: Number(falsePositiveRate.toFixed(4)),
          falsePositiveCases: falsePositiveCount,
          overrideRate: Number((actionSample === 0 ? 0 : overrideFeedbackCount / actionSample).toFixed(4)),
          reversalRate: Number(reversalRate.toFixed(4)),
          caseAgingHours: Number(openCaseAgingHours.toFixed(2)),
          averageResolutionHours: Number(averageResolutionHours.toFixed(2))
        },
        payoutRiskQuality: {
          falsePositiveReleaseRate: Number(falsePositiveReleaseRate.toFixed(4)),
          preventedLossEstimateCents,
          payoutDelayDistributionHours: {
            count: delayHours.length,
            p50: percentile(delayHours, 0.5),
            p95: percentile(delayHours, 0.95),
            avg:
              delayHours.length === 0
                ? 0
                : Number((delayHours.reduce((sum, value) => sum + value, 0) / delayHours.length).toFixed(2))
          },
          overrideDriftRate: Number(overrideDriftRate.toFixed(4))
        },
        preemptiveDisputeControls: {
          actionCount: actionsWithPreemptiveControls.length,
          shipmentConfirmationRate:
            actionsWithPreemptiveControls.length === 0
              ? 0
              : Number((shipmentConfirmationCount / actionsWithPreemptiveControls.length).toFixed(4)),
          payoutRestrictionRate:
            actionsWithPreemptiveControls.length === 0
              ? 0
              : Number((payoutRestrictionCount / actionsWithPreemptiveControls.length).toFixed(4)),
          averageConditionalEscrowDelayHours:
            escrowDelayValues.length === 0
              ? 0
              : Number(
                  (
                    escrowDelayValues.reduce((sum, value) => sum + value, 0) /
                    escrowDelayValues.length
                  ).toFixed(2)
                )
        },
        interventionEfficacyByLadderStep: ladderCounts,
        clusterRiskQuality: {
          clusterActions,
          precisionProxy:
            clusterActions === 0 ? 0 : Number((1 - Math.min(1, falsePositiveReleaseRate)).toFixed(4)),
          collateralImpactRate:
            totalRecovery === 0
              ? 0
              : Number(((recoveryCounts.completed + recoveryCounts.failed) / Math.max(1, restrictiveActions.length)).toFixed(4))
        },
        interdictionV10: {
          remediationAppliedCount: remediationAppliedRows.length,
          remediationRolledBackCount: remediationRolledBackRows.length,
          unwindActionCount: unwindRows.length,
          rollbackRate:
            remediationAppliedRows.length === 0
              ? 0
              : Number((remediationRolledBackRows.length / remediationAppliedRows.length).toFixed(4)),
          actionTypeCounts,
          listingAuthenticitySignalCount: listingSignalRows.length,
          averageListingAuthenticitySignalScore: avgAuthenticityScore
        },
        buyerRiskV11: {
          buyerRiskSignalCount: buyerRiskSignalRows.length,
          preemptionActionCount: preemptionRows.length,
          preemptionAppliedCount: preemptionAppliedRows.length,
          preemptionRolledBackCount: preemptionRolledBackRows.length,
          preemptionUnwindCount: preemptionUnwindRows.length,
          falsePositiveInterventionImpactRate: falsePositivePreemptionImpactRate,
          averageBuyerRiskContributionScore: avgBuyerRiskContribution,
          averageEscrowCycleLatencyHours:
            preemptionDelayHours.length === 0
              ? 0
              : Number(
                  (
                    preemptionDelayHours.reduce((sum, value) => sum + value, 0) /
                    preemptionDelayHours.length
                  ).toFixed(2)
                ),
          disputeRateReductionProxy:
            preemptionAppliedRows.length === 0
              ? 0
              : Number(
                  (
                    Math.max(
                      0,
                      preemptionAppliedRows.length - preemptionRolledBackRows.length
                    ) / preemptionAppliedRows.length
                  ).toFixed(4)
                ),
          netTrustLossPreventedEstimateCents: netTrustLossPreventedEstimateCents
        },
        recoveryAutomation: {
          queued: recoveryCounts.queued,
          processing: recoveryCounts.processing,
          completed: recoveryCounts.completed,
          failed: recoveryCounts.failed,
          completionRate:
            totalRecovery === 0 ? 0 : Number((recoveryCounts.completed / totalRecovery).toFixed(4))
        },
        identityGating: {
          challengeCounts,
          challengeCompletionRate:
            totalChallenges === 0
              ? 0
              : Number(((challengeCounts.passed + challengeCounts.failed) / totalChallenges).toFixed(4)),
          challengePassRate:
            totalChallenges === 0 ? 0 : Number((challengeCounts.passed / totalChallenges).toFixed(4)),
          compromiseDetectionPrecisionProxy:
            challengeCounts.failed + challengeCounts.expired === 0
              ? 0
              : Number(
                  (
                    (challengeCounts.failed + challengeCounts.expired) /
                    Math.max(1, challengeCounts.failed + challengeCounts.expired + challengeCounts.passed)
                  ).toFixed(4)
                ),
          compromiseDetectionRecallProxy:
            accountRecoveryCounts.open + accountRecoveryCounts.resolved === 0
              ? 0
              : Number(
                  (
                    (challengeCounts.failed + challengeCounts.expired) /
                    Math.max(1, accountRecoveryCounts.open + accountRecoveryCounts.resolved)
                  ).toFixed(4)
                )
        },
        accountRecovery: {
          counts: accountRecoveryCounts,
          turnaroundCompletionRate:
            accountRecoveryCounts.open + accountRecoveryCounts.resolved === 0
              ? 0
              : Number(
                  (
                    accountRecoveryCounts.resolved /
                    Math.max(1, accountRecoveryCounts.open + accountRecoveryCounts.resolved)
                  ).toFixed(4)
                )
        },
        policyGuardrails: {
          appealOverturnRate:
            appealFeedbackCount === 0
              ? 0
              : Number((appealOverturnCount / appealFeedbackCount).toFixed(4)),
          appealFeedbackCount,
          appealOverturnCount,
          rollbackFrequencyByPolicyVersion
        }
      };
    },

    listLaunchControlFlags() {
      return listLaunchControlFlagsAll.all().map(mapLaunchControlFlag);
    },

    getLaunchControlFlag(key) {
      const normalizedKey = normalizeLaunchControlKey(key);
      return mapLaunchControlFlag(getLaunchControlFlagByKey.get({ key: normalizedKey }));
    },

    setLaunchControlFlag({
      key,
      enabled,
      rolloutPercentage,
      allowlistUserIds,
      regionAllowlist,
      environment = null,
      actorId,
      reason = null,
      source = "admin",
      deploymentRunId = null,
      metadata = {},
      requestId = null,
      correlationId = null
    }) {
      const normalizedKey = normalizeLaunchControlKey(key);
      if (enabled !== undefined && typeof enabled !== "boolean") {
        throw new StoreError("validation", "enabled must be a boolean when provided");
      }
      if (!actorId || typeof actorId !== "string" || !actorId.trim()) {
        throw new StoreError("validation", "actorId is required");
      }
      if (!source || typeof source !== "string" || !source.trim()) {
        throw new StoreError("validation", "source is required");
      }

      const previous = mapLaunchControlFlag(getLaunchControlFlagByKey.get({ key: normalizedKey }));
      const nextEnabled = enabled === undefined ? previous?.enabled ?? true : enabled;
      const nextRolloutPercentage =
        rolloutPercentage === undefined || rolloutPercentage === null
          ? previous?.rolloutPercentage ?? 100
          : Number(rolloutPercentage);
      if (
        !Number.isInteger(nextRolloutPercentage) ||
        nextRolloutPercentage < 0 ||
        nextRolloutPercentage > 100
      ) {
        throw new StoreError("validation", "rolloutPercentage must be an integer between 0 and 100");
      }

      const normalizedAllowlist =
        allowlistUserIds === undefined
          ? normalizeAllowlist(previous?.allowlistUserIds)
          : normalizeAllowlist(allowlistUserIds);
      const normalizedRegionAllowlist =
        regionAllowlist === undefined
          ? normalizeAllowlist(previous?.regionAllowlist)
          : normalizeAllowlist(regionAllowlist);
      const timestamp = now().toISOString();
      const run = db.transaction(() => {
        upsertLaunchControlFlag.run({
          key: normalizedKey,
          enabled: nextEnabled ? 1 : 0,
          rollout_percentage: nextRolloutPercentage,
          allowlist_user_ids_json: JSON.stringify(normalizedAllowlist),
          region_allowlist_json: JSON.stringify(normalizedRegionAllowlist),
          environment: environment ? String(environment).trim() : null,
          reason: reason ? String(reason).trim() : null,
          deployment_run_id: deploymentRunId ? String(deploymentRunId).trim() : null,
          metadata_json: JSON.stringify(metadata ?? {}),
          updated_by: actorId.trim(),
          updated_at: timestamp
        });
        insertLaunchControlAuditEvent.run({
          flag_key: normalizedKey,
          previous_enabled: previous ? (previous.enabled ? 1 : 0) : null,
          next_enabled: nextEnabled ? 1 : 0,
          previous_rollout_percentage: previous?.rolloutPercentage ?? null,
          next_rollout_percentage: nextRolloutPercentage,
          previous_allowlist_user_ids_json: previous
            ? JSON.stringify(normalizeAllowlist(previous.allowlistUserIds))
            : null,
          next_allowlist_user_ids_json: JSON.stringify(normalizedAllowlist),
          previous_region_allowlist_json: previous
            ? JSON.stringify(normalizeAllowlist(previous.regionAllowlist))
            : null,
          next_region_allowlist_json: JSON.stringify(normalizedRegionAllowlist),
          actor_id: actorId.trim(),
          reason: reason ? String(reason).trim() : null,
          source: source.trim(),
          deployment_run_id: deploymentRunId ? String(deploymentRunId).trim() : null,
          metadata_json: JSON.stringify(metadata ?? {}),
          correlation_id: correlationId ? String(correlationId).trim() : null,
          request_id: requestId ? String(requestId).trim() : null,
          created_at: timestamp
        });
      });
      run();

      return mapLaunchControlFlag(getLaunchControlFlagByKey.get({ key: normalizedKey }));
    },

    listLaunchControlAuditEvents({ key, limit = 100 } = {}) {
      if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
        throw new StoreError("validation", "limit must be an integer between 1 and 500");
      }
      if (key === undefined || key === null) {
        return listLaunchControlAuditEventsAll.all({ limit }).map(mapLaunchControlAuditEvent);
      }
      const normalizedKey = normalizeLaunchControlKey(key);
      return listLaunchControlAuditEventsByFlag
        .all({ flag_key: normalizedKey, limit })
        .map(mapLaunchControlAuditEvent);
    },

    recordLaunchControlIncident({
      incidentKey = null,
      signalType,
      severity,
      details = {},
      autoRollbackApplied = false,
      requestId = null,
      correlationId = null
    }) {
      if (!signalType || typeof signalType !== "string" || !signalType.trim()) {
        throw new StoreError("validation", "signalType is required");
      }
      const normalizedSeverity = String(severity ?? "medium").trim().toLowerCase();
      if (!VALID_LAUNCH_CONTROL_SEVERITIES.has(normalizedSeverity)) {
        throw new StoreError("validation", "severity must be one of: critical, high, medium, low");
      }
      const timestamp = now().toISOString();
      const result = upsertLaunchControlIncident.run({
        incident_key: incidentKey ? String(incidentKey).trim() : null,
        signal_type: signalType.trim(),
        severity: normalizedSeverity,
        details_json: JSON.stringify(details ?? {}),
        auto_rollback_applied: autoRollbackApplied ? 1 : 0,
        correlation_id: correlationId ? String(correlationId).trim() : null,
        request_id: requestId ? String(requestId).trim() : null,
        created_at: timestamp
      });
      if (incidentKey) {
        return mapLaunchControlIncident(
          getLaunchControlIncidentByIncidentKey.get({ incident_key: String(incidentKey).trim() })
        );
      }
      return mapLaunchControlIncident(
        getLaunchControlIncidentById.get({ id: Number(result.lastInsertRowid) })
      );
    },

    listLaunchControlIncidents({ limit = 100 } = {}) {
      if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
        throw new StoreError("validation", "limit must be an integer between 1 and 500");
      }
      return listLaunchControlIncidents.all({ limit }).map(mapLaunchControlIncident);
    },

    createListing({
      id,
      sellerId,
      title,
      description,
      priceCents,
      category,
      itemCondition,
      localArea,
      photoUrls = [],
      uploadedPhotos = [],
      moderationStatus = "approved",
      moderationReasonCode = null,
      moderationPublicReason = null,
      moderationInternalNotes = null,
      moderationUpdatedBy = null,
      moderationSource = "seller_submission",
      requestId,
      correlationId
    }) {
      if (!id || !sellerId) {
        throw new StoreError("validation", "id and sellerId are required");
      }

      if (!title || !title.trim()) {
        throw new StoreError("validation", "title is required");
      }

      if (!localArea || !localArea.trim()) {
        throw new StoreError("validation", "localArea is required");
      }

      if (!Number.isInteger(priceCents) || priceCents <= 0) {
        throw new StoreError("validation", "priceCents must be a positive integer");
      }
      if (!VALID_LISTING_MODERATION_STATUSES.has(moderationStatus)) {
        throw new StoreError("validation", "invalid moderationStatus");
      }

      const timestamp = now().toISOString();

      const runCreateListing = db.transaction(() => {
        try {
          insertListing.run({
            id,
            seller_id: sellerId,
            title: title.trim(),
            description: description ?? null,
            price_cents: priceCents,
            category: category ? String(category).trim() : null,
            item_condition: itemCondition ? String(itemCondition).trim() : null,
            local_area: localArea.trim(),
            listing_photo_urls_json: JSON.stringify(
              Array.isArray(photoUrls)
                ? photoUrls.map((item) => String(item ?? "").trim()).filter(Boolean)
                : []
            ),
            listing_uploaded_photos_json: JSON.stringify(
              Array.isArray(uploadedPhotos) ? uploadedPhotos : []
            ),
            moderation_status: moderationStatus,
            moderation_reason_code: moderationReasonCode ?? null,
            moderation_public_reason: moderationPublicReason ?? null,
            moderation_internal_notes: moderationInternalNotes ?? null,
            moderation_updated_at: timestamp,
            moderation_updated_by: moderationUpdatedBy ?? sellerId,
            created_at: timestamp,
            updated_at: timestamp
          });
        } catch (error) {
          if (error && typeof error.message === "string" && error.message.includes("UNIQUE")) {
            throw new StoreError("conflict", "listing id already exists");
          }
          throw error;
        }

        appendListingModerationEvent({
          listingId: id,
          fromStatus: null,
          toStatus: moderationStatus,
          reasonCode: moderationReasonCode ?? null,
          publicReason: moderationPublicReason ?? null,
          internalNotes: moderationInternalNotes ?? null,
          source: moderationSource,
          actorId: moderationUpdatedBy ?? sellerId,
          requestId,
          correlationId,
          createdAt: timestamp
        });
      });
      runCreateListing();

      return mapListing(getListingById.get(id));
    },

    updateListing({
      id,
      sellerId,
      title,
      description,
      priceCents,
      category,
      itemCondition,
      localArea,
      photoUrls,
      moderationStatus = "approved",
      moderationReasonCode = null,
      moderationPublicReason = null,
      moderationInternalNotes = null,
      moderationUpdatedBy = null,
      moderationSource = "seller_update",
      requestId,
      correlationId
    }) {
      const existing = getListingById.get(id);
      if (!existing) {
        throw new StoreError("not_found", "listing not found");
      }

      if (existing.seller_id !== sellerId) {
        throw new StoreError("forbidden", "only the listing seller can update this listing");
      }

      if (!title || !title.trim()) {
        throw new StoreError("validation", "title is required");
      }

      if (!localArea || !localArea.trim()) {
        throw new StoreError("validation", "localArea is required");
      }

      if (!Number.isInteger(priceCents) || priceCents <= 0) {
        throw new StoreError("validation", "priceCents must be a positive integer");
      }
      if (!VALID_LISTING_MODERATION_STATUSES.has(moderationStatus)) {
        throw new StoreError("validation", "invalid moderationStatus");
      }

      const timestamp = now().toISOString();
      const normalizedPhotoUrls = Array.isArray(photoUrls)
        ? photoUrls.map((item) => String(item ?? "").trim()).filter(Boolean)
        : parseJsonArrayOrEmpty(existing.listing_photo_urls_json)
            .map((item) => String(item ?? "").trim())
            .filter(Boolean);
      const runUpdateListing = db.transaction(() => {
        const result = updateListingStatement.run({
          id,
          title: title.trim(),
          description: description ?? null,
          price_cents: priceCents,
          category: category ? String(category).trim() : null,
          item_condition: itemCondition ? String(itemCondition).trim() : null,
          local_area: localArea.trim(),
          listing_photo_urls_json: JSON.stringify(normalizedPhotoUrls),
          moderation_status: moderationStatus,
          moderation_reason_code: moderationReasonCode ?? null,
          moderation_public_reason: moderationPublicReason ?? null,
          moderation_internal_notes: moderationInternalNotes ?? null,
          moderation_updated_at: timestamp,
          moderation_updated_by: moderationUpdatedBy ?? sellerId,
          updated_at: timestamp
        });

        if (result.changes !== 1) {
          throw new StoreError("conflict", "failed to update listing");
        }

        appendListingModerationEvent({
          listingId: id,
          fromStatus: existing.moderation_status ?? "approved",
          toStatus: moderationStatus,
          reasonCode: moderationReasonCode ?? null,
          publicReason: moderationPublicReason ?? null,
          internalNotes: moderationInternalNotes ?? null,
          source: moderationSource,
          actorId: moderationUpdatedBy ?? sellerId,
          requestId,
          correlationId,
          createdAt: timestamp
        });
      });
      runUpdateListing();

      return mapListing(getListingById.get(id));
    },

    appendListingUploadedPhoto({ listingId, sellerId, photo }) {
      if (!listingId || typeof listingId !== "string") {
        throw new StoreError("validation", "listingId is required");
      }
      if (!sellerId || typeof sellerId !== "string") {
        throw new StoreError("validation", "sellerId is required");
      }
      if (!photo || typeof photo !== "object") {
        throw new StoreError("validation", "photo is required");
      }
      const existing = getListingById.get(listingId);
      if (!existing) {
        throw new StoreError("not_found", "listing not found");
      }
      if (existing.seller_id !== sellerId) {
        throw new StoreError("forbidden", "only the listing seller can upload listing photos");
      }
      const timestamp = now().toISOString();
      const currentPhotos = parseJsonArrayOrEmpty(existing.listing_uploaded_photos_json)
        .filter((item) => item && typeof item === "object");
      const normalizedPhoto = {
        id: String(photo.id ?? "").trim(),
        originalFileName: String(photo.originalFileName ?? "").trim(),
        mimeType: String(photo.mimeType ?? "").trim(),
        sizeBytes: Number(photo.sizeBytes ?? 0),
        checksumSha256: String(photo.checksumSha256 ?? "").trim(),
        storageKey: String(photo.storageKey ?? "").trim(),
        downloadUrl: String(photo.downloadUrl ?? "").trim(),
        createdAt: photo.createdAt ?? timestamp
      };
      if (
        !normalizedPhoto.id ||
        !normalizedPhoto.originalFileName ||
        !normalizedPhoto.mimeType ||
        !Number.isInteger(normalizedPhoto.sizeBytes) ||
        normalizedPhoto.sizeBytes < 0 ||
        !normalizedPhoto.checksumSha256 ||
        !normalizedPhoto.storageKey ||
        !normalizedPhoto.downloadUrl
      ) {
        throw new StoreError("validation", "uploaded photo metadata is invalid");
      }
      if (currentPhotos.some((item) => String(item.id ?? "") === normalizedPhoto.id)) {
        throw new StoreError("conflict", "listing photo id already exists");
      }
      currentPhotos.push(normalizedPhoto);
      const result = updateListingUploadedPhotosStatement.run({
        id: listingId,
        listing_uploaded_photos_json: JSON.stringify(currentPhotos),
        updated_at: timestamp
      });
      if (result.changes !== 1) {
        throw new StoreError("conflict", "failed to append listing photo");
      }
      return mapListing(getListingById.get(listingId));
    },

    getListingUploadedPhotoStorage({ listingId, photoId }) {
      if (!listingId || typeof listingId !== "string") {
        throw new StoreError("validation", "listingId is required");
      }
      if (!photoId || typeof photoId !== "string") {
        throw new StoreError("validation", "photoId is required");
      }
      const existing = getListingById.get(listingId);
      if (!existing) {
        throw new StoreError("not_found", "listing not found");
      }
      const photos = parseJsonArrayOrEmpty(existing.listing_uploaded_photos_json)
        .filter((item) => item && typeof item === "object");
      const photo = photos.find((item) => String(item.id ?? "") === photoId);
      if (!photo) {
        throw new StoreError("not_found", "listing photo not found");
      }
      const storageKey = String(photo.storageKey ?? "").trim();
      if (!storageKey) {
        throw new StoreError("not_found", "listing photo storage not found");
      }
      return {
        listing: mapListing(existing),
        photo: {
          id: String(photo.id ?? "").trim(),
          originalFileName: String(photo.originalFileName ?? "").trim(),
          mimeType: String(photo.mimeType ?? "").trim(),
          storageKey
        }
      };
    },

    getListingById(id) {
      return mapListing(getListingById.get(id));
    },

    listListings({
      limit = 100,
      sellerId,
      localArea,
      moderationStatus,
      cursorCreatedAt,
      cursorId
    } = {}) {
      if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
        throw new StoreError("validation", "limit must be an integer between 1 and 500");
      }

      if (sellerId !== undefined && sellerId !== null && typeof sellerId !== "string") {
        throw new StoreError("validation", "sellerId must be a string");
      }
      if (localArea !== undefined && localArea !== null && typeof localArea !== "string") {
        throw new StoreError("validation", "localArea must be a string");
      }
      if (
        moderationStatus !== undefined &&
        moderationStatus !== null &&
        !VALID_LISTING_MODERATION_STATUSES.has(moderationStatus)
      ) {
        throw new StoreError("validation", "invalid moderationStatus");
      }
      if ((cursorCreatedAt === undefined) !== (cursorId === undefined)) {
        throw new StoreError("validation", "cursorCreatedAt and cursorId must be provided together");
      }

      const params = {
        limit,
        seller_id: sellerId ? sellerId.trim() : null,
        local_area: localArea ? localArea.trim() : null,
        moderation_status: moderationStatus ?? null,
        cursor_created_at: cursorCreatedAt ? toIsoString(cursorCreatedAt) : null,
        cursor_id: cursorId ?? null
      };

      let rows;
      if (params.seller_id && params.local_area) {
        rows = listListingsBySellerAndArea.all(params);
      } else if (params.seller_id) {
        rows = listListingsBySeller.all(params);
      } else if (params.local_area) {
        rows = listListingsByArea.all(params);
      } else {
        rows = listListingsAll.all(params);
      }

      return rows.map(mapListing);
    },

    evaluateListingPriceBaseline({ sellerId, excludeListingId } = {}) {
      if (!sellerId || typeof sellerId !== "string") {
        throw new StoreError("validation", "sellerId is required");
      }
      const row = excludeListingId
        ? averageListingPriceBySellerExcludingListing.get({
            seller_id: sellerId,
            listing_id: excludeListingId
          })
        : averageListingPriceBySeller.get({ seller_id: sellerId });
      return {
        averagePriceCents:
          row?.average_price_cents === null || row?.average_price_cents === undefined
            ? null
            : Math.round(Number(row.average_price_cents)),
        sampleSize: Number(row?.count ?? 0)
      };
    },

    setListingModerationStatus({
      listingId,
      status,
      reasonCode,
      publicReason,
      internalNotes,
      actorId,
      source = "admin_action",
      requestId,
      correlationId
    }) {
      const existing = getListingById.get(listingId);
      if (!existing) {
        throw new StoreError("not_found", "listing not found");
      }
      if (!VALID_LISTING_MODERATION_STATUSES.has(status)) {
        throw new StoreError("validation", "invalid moderation status");
      }
      if (!actorId || typeof actorId !== "string" || !actorId.trim()) {
        throw new StoreError("validation", "actorId is required");
      }

      const timestamp = now().toISOString();
      const runUpdate = db.transaction(() => {
        const result = updateListingModerationStatement.run({
          id: listingId,
          moderation_status: status,
          moderation_reason_code: reasonCode ?? null,
          moderation_public_reason: publicReason ?? null,
          moderation_internal_notes: internalNotes ?? null,
          moderation_updated_at: timestamp,
          moderation_updated_by: actorId.trim(),
          updated_at: timestamp
        });
        if (result.changes !== 1) {
          throw new StoreError("conflict", "failed to update listing moderation");
        }
        appendListingModerationEvent({
          listingId,
          fromStatus: existing.moderation_status ?? "approved",
          toStatus: status,
          reasonCode: reasonCode ?? null,
          publicReason: publicReason ?? null,
          internalNotes: internalNotes ?? null,
          source,
          actorId: actorId.trim(),
          requestId,
          correlationId,
          createdAt: timestamp
        });
      });
      runUpdate();

      return mapListing(getListingById.get(listingId));
    },

    listListingModerationEvents({ listingId, limit = 100 } = {}) {
      if (!listingId || typeof listingId !== "string") {
        throw new StoreError("validation", "listingId is required");
      }
      if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
        throw new StoreError("validation", "limit must be an integer between 1 and 500");
      }
      return listListingModerationEventsByListing
        .all({ listing_id: listingId, limit })
        .map(mapListingModerationEvent);
    },

    createListingAbuseReport({
      listingId,
      reporterUserId,
      reasonCode,
      details,
      status = "open",
      priorityScore = 1
    }) {
      const listing = getListingById.get(listingId);
      if (!listing) {
        throw new StoreError("not_found", "listing not found");
      }
      if (!reasonCode || typeof reasonCode !== "string" || !reasonCode.trim()) {
        throw new StoreError("validation", "reasonCode is required");
      }
      if (!Number.isInteger(priorityScore) || priorityScore < 1 || priorityScore > 100) {
        throw new StoreError("validation", "priorityScore must be an integer between 1 and 100");
      }
      const normalizedStatus = String(status ?? "open").trim();
      if (!["open", "triaged", "dismissed"].includes(normalizedStatus)) {
        throw new StoreError("validation", "invalid abuse report status");
      }
      if (reporterUserId && !getUserById.get(reporterUserId)) {
        throw new StoreError("not_found", "reporter user not found");
      }

      const timestamp = now().toISOString();
      const result = insertListingAbuseReport.run({
        listing_id: listingId,
        reporter_user_id: reporterUserId ?? null,
        reason_code: reasonCode.trim(),
        details: details ? String(details) : null,
        status: normalizedStatus,
        priority_score: priorityScore,
        created_at: timestamp,
        updated_at: timestamp
      });
      return mapListingAbuseReport(getListingAbuseReportById.get(Number(result.lastInsertRowid)));
    },

    countListingOpenAbuseReports(listingId) {
      const row = countOpenAbuseReportsByListing.get({ listing_id: listingId });
      return Number(row?.count ?? 0);
    },

    listListingAbuseReports({ listingId, status, limit = 100 } = {}) {
      if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
        throw new StoreError("validation", "limit must be an integer between 1 and 500");
      }
      const normalizedStatus =
        status === undefined || status === null ? null : String(status).trim();
      if (normalizedStatus && !["open", "triaged", "dismissed"].includes(normalizedStatus)) {
        throw new StoreError("validation", "invalid abuse report status");
      }
      if (listingId !== undefined && listingId !== null && typeof listingId !== "string") {
        throw new StoreError("validation", "listingId must be a string");
      }
      const rows = listingId
        ? listListingAbuseReportsByListing.all({ listing_id: listingId, limit })
        : listListingAbuseReportsAll.all({ status: normalizedStatus, limit });
      return rows.map(mapListingAbuseReport);
    },

    createAcceptedTransaction({ id, buyerId, sellerId, amountCents, acceptedAt, actorId }) {
      if (!id || !buyerId || !sellerId) {
        throw new StoreError(
          "validation",
          "id, buyerId, and sellerId are required to create a transaction"
        );
      }

      const quote = calculateSettlementAmounts({
        amountCents,
        serviceFeeFixedCents,
        serviceFeeRateBps,
        currency: normalizedSettlementCurrency
      });

      const acceptedAtIso = acceptedAt ? toIsoString(acceptedAt) : now().toISOString();
      const autoReleaseDueAt = addHours(acceptedAtIso, releaseTimeoutHours);
      const timestamp = now().toISOString();

      const runCreateTransaction = db.transaction(() => {
        try {
          insertTransaction.run({
            id,
            buyer_id: buyerId,
            seller_id: sellerId,
            amount_cents: amountCents,
            fee_fixed_cents: serviceFeeFixedCents,
            fee_rate_bps: serviceFeeRateBps,
            service_fee_cents: quote.serviceFeeCents,
            total_buyer_charge_cents: quote.totalBuyerChargeCents,
            seller_net_cents: quote.sellerNetCents,
            currency_code: normalizedSettlementCurrency,
            payment_provider: "local",
            payment_status: "captured",
            provider_payment_intent_id: null,
            provider_charge_id: null,
            payment_reconciliation_json: JSON.stringify({ mode: "legacy" }),
            accepted_at: acceptedAtIso,
            auto_release_due_at: autoReleaseDueAt,
            created_at: timestamp,
            updated_at: timestamp
          });
        } catch (error) {
          if (error && typeof error.message === "string" && error.message.includes("UNIQUE")) {
            throw new StoreError("conflict", "transaction id already exists");
          }
          throw error;
        }

        const sourceEventId = appendTransactionEvent({
          transactionId: id,
          eventType: "payment_captured",
          actorId: actorId ?? sellerId,
          occurredAt: timestamp,
          payload: {
            amountCents,
            serviceFeeCents: quote.serviceFeeCents,
            totalBuyerChargeCents: quote.totalBuyerChargeCents,
            sellerNetCents: quote.sellerNetCents,
            currency: normalizedSettlementCurrency,
            buyerId,
            sellerId
          }
        });
        upsertPaymentOperation.run({
          transaction_id: id,
          operation: "authorize_capture",
          provider: "local",
          idempotency_key: `legacy:${id}:authorize_capture`,
          status: "succeeded",
          external_reference: null,
          error_code: null,
          error_message: null,
          response_json: JSON.stringify({ mode: "legacy" }),
          created_at: timestamp,
          updated_at: timestamp
        });
        enqueueOutboxRecords({
          transactionId: id,
          sourceEventId,
          occurredAt: timestamp,
          records: [
            {
              topic: "payment_received",
              recipientUserId: sellerId,
              payload: {
                transactionId: id,
                amountCents,
                sellerNetCents,
                serviceFeeCents,
                buyerId
              }
            },
            {
              topic: "action_required",
              recipientUserId: buyerId,
              payload: {
                transactionId: id,
                action: "confirm_delivery_when_received"
              }
            }
          ]
        });
      });
      runCreateTransaction();
      refreshUserRiskTierProfile({
        userId: buyerId,
        actorId: actorId ?? buyerId,
        reason: "transaction accepted",
        source: "system"
      });
      refreshUserRiskTierProfile({
        userId: sellerId,
        actorId: actorId ?? sellerId,
        reason: "transaction accepted",
        source: "system"
      });

      return mapTransaction(getTransactionByIdQuery.get(id));
    },

    quoteTransaction({ amountCents }) {
      return calculateSettlementAmounts({
        amountCents,
        serviceFeeFixedCents,
        serviceFeeRateBps,
        currency: normalizedSettlementCurrency
      });
    },

    createAcceptedTransactionWithPayment({
      id,
      buyerId,
      sellerId,
      amountCents,
      acceptedAt,
      actorId,
      paymentResult,
      paymentIdempotencyKey
    }) {
      if (!paymentResult || typeof paymentResult !== "object") {
        throw new StoreError("validation", "paymentResult is required");
      }
      if (!paymentIdempotencyKey || typeof paymentIdempotencyKey !== "string") {
        throw new StoreError("validation", "paymentIdempotencyKey is required");
      }
      if (!paymentResult.provider) {
        throw new StoreError("validation", "paymentResult.provider is required");
      }

      const quote = this.quoteTransaction({ amountCents });
      const acceptedAtIso = acceptedAt ? toIsoString(acceptedAt) : now().toISOString();
      const autoReleaseDueAt = addHours(acceptedAtIso, releaseTimeoutHours);
      const timestamp = now().toISOString();
      const paymentStatus = paymentResult.status === "succeeded" ? "captured" : "captured";
      const reconciliation = JSON.stringify({
        authorizeCapture: {
          provider: paymentResult.provider,
          idempotencyKey: paymentIdempotencyKey,
          paymentIntentId: paymentResult.paymentIntentId ?? null,
          chargeId: paymentResult.chargeId ?? null,
          status: paymentResult.status ?? "captured",
          raw: paymentResult.raw ?? null
        }
      });

      const runCreateTransaction = db.transaction(() => {
        try {
          insertTransaction.run({
            id,
            buyer_id: buyerId,
            seller_id: sellerId,
            amount_cents: amountCents,
            fee_fixed_cents: serviceFeeFixedCents,
            fee_rate_bps: serviceFeeRateBps,
            service_fee_cents: quote.serviceFeeCents,
            total_buyer_charge_cents: quote.totalBuyerChargeCents,
            seller_net_cents: quote.sellerNetCents,
            currency_code: normalizedSettlementCurrency,
            payment_provider: paymentResult.provider,
            payment_status: paymentStatus,
            provider_payment_intent_id: paymentResult.paymentIntentId ?? null,
            provider_charge_id: paymentResult.chargeId ?? null,
            payment_reconciliation_json: reconciliation,
            accepted_at: acceptedAtIso,
            auto_release_due_at: autoReleaseDueAt,
            created_at: timestamp,
            updated_at: timestamp
          });
        } catch (error) {
          if (error && typeof error.message === "string" && error.message.includes("UNIQUE")) {
            throw new StoreError("conflict", "transaction id already exists");
          }
          throw error;
        }

        const sourceEventId = appendTransactionEvent({
          transactionId: id,
          eventType: "payment_captured",
          actorId: actorId ?? sellerId,
          occurredAt: timestamp,
          payload: {
            amountCents,
            serviceFeeCents: quote.serviceFeeCents,
            totalBuyerChargeCents: quote.totalBuyerChargeCents,
            sellerNetCents: quote.sellerNetCents,
            currency: normalizedSettlementCurrency,
            buyerId,
            sellerId,
            paymentProvider: paymentResult.provider,
            providerPaymentIntentId: paymentResult.paymentIntentId ?? null,
            providerChargeId: paymentResult.chargeId ?? null
          }
        });
        upsertPaymentOperation.run({
          transaction_id: id,
          operation: "authorize_capture",
          provider: paymentResult.provider,
          idempotency_key: paymentIdempotencyKey,
          status: "succeeded",
          external_reference: paymentResult.chargeId ?? paymentResult.paymentIntentId ?? null,
          error_code: null,
          error_message: null,
          response_json: JSON.stringify(paymentResult.raw ?? {}),
          created_at: timestamp,
          updated_at: timestamp
        });
        enqueueOutboxRecords({
          transactionId: id,
          sourceEventId,
          occurredAt: timestamp,
          records: [
            {
              topic: "payment_received",
              recipientUserId: sellerId,
              payload: {
                transactionId: id,
                amountCents,
                sellerNetCents: quote.sellerNetCents,
                serviceFeeCents: quote.serviceFeeCents,
                buyerId
              }
            },
            {
              topic: "action_required",
              recipientUserId: buyerId,
              payload: {
                transactionId: id,
                action: "confirm_delivery_when_received"
              }
            }
          ]
        });
      });
      runCreateTransaction();
      refreshUserRiskTierProfile({
        userId: buyerId,
        actorId: actorId ?? buyerId,
        reason: "transaction accepted",
        source: "system"
      });
      refreshUserRiskTierProfile({
        userId: sellerId,
        actorId: actorId ?? sellerId,
        reason: "transaction accepted",
        source: "system"
      });
      return mapTransaction(getTransactionByIdQuery.get(id));
    },

    upsertPaymentOperation({
      transactionId,
      operation,
      provider,
      idempotencyKey,
      status,
      externalReference,
      errorCode,
      errorMessage,
      response,
      createdAt
    }) {
      if (!transactionId || !operation || !provider || !idempotencyKey || !status) {
        throw new StoreError(
          "validation",
          "transactionId, operation, provider, idempotencyKey, and status are required"
        );
      }
      const timestamp = createdAt ? toIsoString(createdAt) : now().toISOString();
      upsertPaymentOperation.run({
        transaction_id: transactionId,
        operation,
        provider,
        idempotency_key: idempotencyKey,
        status,
        external_reference: externalReference ?? null,
        error_code: errorCode ?? null,
        error_message: errorMessage ?? null,
        response_json: JSON.stringify(response ?? {}),
        created_at: timestamp,
        updated_at: timestamp
      });
    },

    ingestProviderWebhookEvent({
      provider,
      eventId,
      eventType,
      transactionId,
      occurredAt,
      payload,
      signatureValid,
      initialStatus = "received",
      processingError = null
    }) {
      if (!provider || !eventId || !eventType) {
        throw new StoreError("validation", "provider, eventId, and eventType are required");
      }
      const normalizedStatus = String(initialStatus);
      if (!VALID_PROVIDER_WEBHOOK_EVENT_STATUSES.has(normalizedStatus)) {
        throw new StoreError("validation", "initialStatus must be received, processed, or failed");
      }
      const timestamp = now().toISOString();
      upsertProviderWebhookEvent.run({
        provider: String(provider).trim(),
        event_id: String(eventId).trim(),
        event_type: String(eventType).trim(),
        transaction_id: transactionId ? String(transactionId).trim() : null,
        occurred_at: occurredAt ? toIsoString(occurredAt) : null,
        status: normalizedStatus,
        signature_valid: signatureValid ? 1 : 0,
        payload_json: JSON.stringify(payload ?? {}),
        processing_error: processingError ?? null,
        first_received_at: timestamp,
        last_received_at: timestamp,
        created_at: timestamp,
        updated_at: timestamp
      });

      return mapProviderWebhookEvent(
        getProviderWebhookEventByProviderAndEventId.get({
          provider: String(provider).trim(),
          event_id: String(eventId).trim()
        })
      );
    },

    listProviderWebhookEvents({ status, provider, limit = 100 } = {}) {
      if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
        throw new StoreError("validation", "limit must be an integer between 1 and 500");
      }
      const normalizedStatus = status === undefined || status === null ? null : String(status).trim();
      if (
        normalizedStatus !== null &&
        !VALID_PROVIDER_WEBHOOK_EVENT_STATUSES.has(normalizedStatus)
      ) {
        throw new StoreError("validation", "status must be received, processed, or failed");
      }

      const normalizedProvider =
        provider === undefined || provider === null ? null : String(provider).trim();

      let rows;
      if (normalizedProvider && normalizedStatus) {
        rows = listProviderWebhookEventsByProviderAndStatus.all({
          provider: normalizedProvider,
          status: normalizedStatus,
          limit
        });
      } else if (normalizedProvider) {
        rows = listProviderWebhookEventsByProvider.all({
          provider: normalizedProvider,
          limit
        });
      } else if (normalizedStatus) {
        rows = listProviderWebhookEventsByStatus.all({
          status: normalizedStatus,
          limit
        });
      } else {
        rows = listProviderWebhookEventsAll.all({ limit });
      }
      return rows.map(mapProviderWebhookEvent);
    },

    requeueProviderWebhookEvent({ id }) {
      if (!Number.isInteger(id) || id <= 0) {
        throw new StoreError("validation", "id must be a positive integer");
      }
      const existing = mapProviderWebhookEvent(getProviderWebhookEventById.get({ id }));
      if (!existing) {
        throw new StoreError("not_found", "provider webhook event not found");
      }
      if (existing.status !== "failed") {
        throw new StoreError("conflict", "only failed webhook events can be reprocessed");
      }
      const timestamp = now().toISOString();
      markProviderWebhookEventReceivedById.run({ id, updated_at: timestamp });
      return mapProviderWebhookEvent(getProviderWebhookEventById.get({ id }));
    },

    processProviderWebhookEvent({ provider, eventId }) {
      if (!provider || !eventId) {
        throw new StoreError("validation", "provider and eventId are required");
      }
      const existingEvent = mapProviderWebhookEvent(
        getProviderWebhookEventByProviderAndEventId.get({
          provider: String(provider).trim(),
          event_id: String(eventId).trim()
        })
      );
      if (!existingEvent) {
        throw new StoreError("not_found", "provider webhook event not found");
      }
      if (!existingEvent.signatureValid) {
        const timestamp = now().toISOString();
        markProviderWebhookEventFailed.run({
          provider: existingEvent.provider,
          event_id: existingEvent.eventId,
          processing_error: "invalid webhook signature",
          updated_at: timestamp
        });
        return {
          event: mapProviderWebhookEvent(
            getProviderWebhookEventByProviderAndEventId.get({
              provider: existingEvent.provider,
              event_id: existingEvent.eventId
            })
          ),
          transaction: null,
          applied: false,
          reason: "invalid_signature"
        };
      }

      if (existingEvent.status === "processed") {
        const existingTransaction = existingEvent.transactionId
          ? mapTransaction(getTransactionByIdQuery.get(existingEvent.transactionId))
          : null;
        return {
          event: existingEvent,
          transaction: existingTransaction,
          applied: false,
          reason: "duplicate_delivery"
        };
      }

      const payload = existingEvent.payload;
      const resolvedTransactionId =
        existingEvent.transactionId ?? resolveTransactionIdFromProviderPayload(payload);
      const transaction = resolvedTransactionId
        ? mapTransaction(getTransactionByIdQuery.get(resolvedTransactionId))
        : null;
      if (!transaction) {
        const timestamp = now().toISOString();
        markProviderWebhookEventFailed.run({
          provider: existingEvent.provider,
          event_id: existingEvent.eventId,
          processing_error: "transaction could not be resolved from webhook payload",
          updated_at: timestamp
        });
        return {
          event: mapProviderWebhookEvent(
            getProviderWebhookEventByProviderAndEventId.get({
              provider: existingEvent.provider,
              event_id: existingEvent.eventId
            })
          ),
          transaction: null,
          applied: false,
          reason: "transaction_not_found"
        };
      }

      const eventPaymentStatus = deriveWebhookPaymentState(existingEvent.eventType);
      const timestamp = now().toISOString();
      const reconciliation = transaction.paymentReconciliation ?? {};
      const lastProcessedEventAt = reconciliation.webhook?.lastEventCreatedAt ?? null;
      const currentEventAt = existingEvent.occurredAt ?? existingEvent.lastReceivedAt;
      const isOutOfOrder =
        lastProcessedEventAt !== null &&
        new Date(lastProcessedEventAt).valueOf() > new Date(currentEventAt).valueOf();

      let updatedTransaction = transaction;
      if (eventPaymentStatus && !isOutOfOrder) {
        const object = payload?.data?.object ?? {};
        const nextReconciliation = {
          ...reconciliation,
          webhook: {
            lastEventId: existingEvent.eventId,
            lastEventType: existingEvent.eventType,
            lastEventCreatedAt: currentEventAt,
            lastEventProcessedAt: timestamp
          }
        };
        updateTransactionPaymentFromWebhook.run({
          id: transaction.id,
          payment_status: eventPaymentStatus,
          provider_payment_intent_id: object.payment_intent ?? object.id ?? null,
          provider_charge_id: object.charge ?? object.id ?? null,
          provider_last_refund_id: object.id?.startsWith?.("re_") ? object.id : null,
          payment_reconciliation_json: JSON.stringify(nextReconciliation),
          updated_at: timestamp
        });
        updatedTransaction = mapTransaction(getTransactionByIdQuery.get(transaction.id));
      }

      markProviderWebhookEventProcessed.run({
        provider: existingEvent.provider,
        event_id: existingEvent.eventId,
        processed_at: timestamp,
        updated_at: timestamp
      });

      return {
        event: mapProviderWebhookEvent(
          getProviderWebhookEventByProviderAndEventId.get({
            provider: existingEvent.provider,
            event_id: existingEvent.eventId
          })
        ),
        transaction: updatedTransaction,
        applied: Boolean(eventPaymentStatus && !isOutOfOrder),
        reason: isOutOfOrder ? "out_of_order_ignored" : eventPaymentStatus ? "applied" : "unsupported_event"
      };
    },

    runPaymentReconciliation({ limit = 100 } = {}) {
      if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
        throw new StoreError("validation", "limit must be an integer between 1 and 500");
      }

      const rows = listTransactionsWithProcessedWebhookEvents.all({ limit });
      const timestamp = now().toISOString();
      const updates = [];
      for (const row of rows) {
        const transaction = mapTransaction(getTransactionByIdQuery.get(row.id));
        if (!transaction) {
          continue;
        }
        const events = listProcessedProviderWebhookEventsForTransaction
          .all({ transaction_id: transaction.id })
          .map(mapProviderWebhookEvent);
        if (events.length === 0) {
          continue;
        }
        const latest = events[0];
        const desiredPaymentStatus = deriveWebhookPaymentState(latest.eventType);
        if (!desiredPaymentStatus) {
          continue;
        }
        if (transaction.paymentStatus === desiredPaymentStatus) {
          continue;
        }

        const payloadObject = latest.payload?.data?.object ?? {};
        const currentReconciliation = transaction.paymentReconciliation ?? {};
        const nextReconciliation = {
          ...currentReconciliation,
          reconciliation: {
            lastRunAt: timestamp,
            correctedByEventId: latest.eventId,
            correctedByEventType: latest.eventType,
            correctedEventCreatedAt: latest.occurredAt ?? latest.lastReceivedAt
          }
        };
        updateTransactionPaymentFromWebhook.run({
          id: transaction.id,
          payment_status: desiredPaymentStatus,
          provider_payment_intent_id:
            payloadObject.payment_intent ?? payloadObject.id ?? transaction.providerPaymentIntentId,
          provider_charge_id: payloadObject.charge ?? payloadObject.id ?? transaction.providerChargeId,
          provider_last_refund_id:
            latest.eventType === "refund.succeeded" || latest.eventType === "charge.refunded"
              ? payloadObject.id ?? transaction.providerLastRefundId
              : transaction.providerLastRefundId,
          payment_reconciliation_json: JSON.stringify(nextReconciliation),
          updated_at: timestamp
        });
        updates.push({
          transactionId: transaction.id,
          previousPaymentStatus: transaction.paymentStatus,
          correctedPaymentStatus: desiredPaymentStatus,
          sourceEventId: latest.eventId,
          sourceEventType: latest.eventType
        });
      }

      return {
        processedTransactionCount: rows.length,
        correctedCount: updates.length,
        corrections: updates,
        ranAt: timestamp
      };
    },

    getTransactionById(id) {
      return mapTransaction(getTransactionByIdQuery.get(id));
    },

    listTransactionRatings({ transactionId }) {
      if (!transactionId || typeof transactionId !== "string") {
        throw new StoreError("validation", "transactionId is required");
      }
      return listTransactionRatingsByTransactionId
        .all({ transaction_id: transactionId })
        .map(mapTransactionRating);
    },

    getUserReputationSummary({ userId, limit = 20 } = {}) {
      if (!userId || typeof userId !== "string") {
        throw new StoreError("validation", "userId is required");
      }
      if (!Number.isInteger(limit) || limit <= 0 || limit > 200) {
        throw new StoreError("validation", "limit must be an integer between 1 and 200");
      }

      const aggregate = getReputationSummaryByUserId.get({ ratee_user_id: userId });
      const recentRatings = listTransactionRatingsByRateeUserId
        .all({ ratee_user_id: userId, limit })
        .map(mapTransactionRating);

      return {
        userId,
        ratingCount: Number(aggregate?.rating_count ?? 0),
        averageScore:
          aggregate?.average_score === null || aggregate?.average_score === undefined
            ? null
            : Number(Number(aggregate.average_score).toFixed(2)),
        minScore:
          aggregate?.min_score === null || aggregate?.min_score === undefined
            ? null
            : Number(aggregate.min_score),
        maxScore:
          aggregate?.max_score === null || aggregate?.max_score === undefined
            ? null
            : Number(aggregate.max_score),
        recentRatings
      };
    },

    submitTransactionRating({ transactionId, raterUserId, score, comment, ratingId }) {
      if (!transactionId || typeof transactionId !== "string") {
        throw new StoreError("validation", "transactionId is required");
      }
      if (!raterUserId || typeof raterUserId !== "string") {
        throw new StoreError("validation", "raterUserId is required");
      }
      if (!Number.isInteger(score) || score < 1 || score > 5) {
        throw new StoreError("validation", "score must be an integer between 1 and 5");
      }
      if (comment !== undefined && comment !== null && typeof comment !== "string") {
        throw new StoreError("validation", "comment must be a string");
      }
      const existing = getTransactionByIdQuery.get(transactionId);
      if (!existing) {
        throw new StoreError("not_found", "transaction not found");
      }
      if (existing.status !== "completed") {
        throw new StoreError("conflict", "ratings can only be submitted after transaction completion");
      }
      if (raterUserId !== existing.buyer_id && raterUserId !== existing.seller_id) {
        throw new StoreError("forbidden", "only transaction participants can submit ratings");
      }

      const rateeUserId = raterUserId === existing.buyer_id ? existing.seller_id : existing.buyer_id;
      const timestamp = now().toISOString();
      try {
        insertTransactionRating.run({
          id: ratingId ?? `${transactionId}-${raterUserId}`,
          transaction_id: transactionId,
          rater_user_id: raterUserId,
          ratee_user_id: rateeUserId,
          score,
          comment: comment?.trim() ? comment.trim() : null,
          created_at: timestamp,
          updated_at: timestamp
        });
      } catch (error) {
        if (error && typeof error.message === "string" && error.message.includes("UNIQUE")) {
          throw new StoreError("conflict", "rating already submitted for this transaction");
        }
        throw error;
      }

      const ratings = listTransactionRatingsByTransactionId
        .all({ transaction_id: transactionId })
        .map(mapTransactionRating);
      const created = ratings.find((entry) => entry.raterUserId === raterUserId);
      return created ?? null;
    },

    refreshTransactionRiskProfile({ transactionId, extraFlags = [] } = {}) {
      if (!transactionId || typeof transactionId !== "string") {
        throw new StoreError("validation", "transactionId is required");
      }
      const timestamp = now().toISOString();
      return refreshTransactionRiskProfile({
        transactionId,
        updatedAt: timestamp,
        extraFlags
      });
    },

    setTransactionHold({
      transactionId,
      hold,
      reason,
      notes,
      actorId,
      requestId,
      correlationId
    }) {
      if (!transactionId || typeof transactionId !== "string") {
        throw new StoreError("validation", "transactionId is required");
      }
      const existing = mapTransaction(getTransactionByIdQuery.get(transactionId));
      if (!existing) {
        throw new StoreError("not_found", "transaction not found");
      }
      if (!actorId || typeof actorId !== "string" || !actorId.trim()) {
        throw new StoreError("validation", "actorId is required");
      }
      if (hold && (!reason || typeof reason !== "string" || !reason.trim())) {
        throw new StoreError("validation", "reason is required when placing a hold");
      }

      const timestamp = now().toISOString();
      const run = db.transaction(() => {
        updateTransactionHoldState.run({
          id: transactionId,
          hold_status: hold ? "held" : "none",
          hold_reason: hold ? reason.trim() : null,
          hold_applied_at: hold ? timestamp : existing.holdAppliedAt,
          hold_released_at: hold ? null : timestamp,
          hold_applied_by: hold ? actorId.trim() : existing.holdAppliedBy,
          hold_released_by: hold ? null : actorId.trim(),
          updated_at: timestamp
        });

        insertRiskOperatorAction.run({
          subject_type: "transaction",
          subject_id: transactionId,
          action_type: hold ? "hold" : "unhold",
          reason: reason ?? null,
          notes: notes ?? null,
          actor_id: actorId.trim(),
          correlation_id: correlationId ?? null,
          request_id: requestId ?? null,
          created_at: timestamp
        });
      });
      run();

      return refreshTransactionRiskProfile({
        transactionId,
        updatedAt: timestamp
      });
    },

    countRecentAcceptedTransactionsByUser({ userId, role, sinceAt }) {
      if (!userId || typeof userId !== "string") {
        throw new StoreError("validation", "userId is required");
      }
      if (role !== "buyer" && role !== "seller") {
        throw new StoreError("validation", "role must be buyer or seller");
      }
      const normalizedSinceAt = toIsoString(sinceAt);
      const row =
        role === "buyer"
          ? countRecentAcceptedTransactionsByBuyer.get({
              user_id: userId,
              since_at: normalizedSinceAt
            })
          : countRecentAcceptedTransactionsBySeller.get({
              user_id: userId,
              since_at: normalizedSinceAt
            });
      return Number(row?.count ?? 0);
    },

    countRecentAcceptedAmountByUser({ userId, role, sinceAt }) {
      if (!userId || typeof userId !== "string") {
        throw new StoreError("validation", "userId is required");
      }
      if (role !== "buyer" && role !== "seller") {
        throw new StoreError("validation", "role must be buyer or seller");
      }
      const normalizedSinceAt = toIsoString(sinceAt);
      const row =
        role === "buyer"
          ? sumRecentAcceptedAmountByBuyer.get({
              user_id: userId,
              since_at: normalizedSinceAt
            })
          : sumRecentAcceptedAmountBySeller.get({
              user_id: userId,
              since_at: normalizedSinceAt
            });
      return Number(row?.total_amount ?? 0);
    },

    recomputeAccountRiskTier({
      userId,
      actorId = null,
      reason = null,
      requestId = null,
      correlationId = null,
      force = false
    }) {
      return refreshUserRiskTierProfile({
        userId,
        actorId,
        reason,
        source: "system",
        requestId,
        correlationId,
        force
      });
    },

    evaluateAndRecordRiskLimitDecision({
      checkpoint,
      transactionId = null,
      userId,
      amountCents,
      dailyVolumeCents,
      maxTransactionCents,
      dailyVolumeCapCents,
      cooldownHours = 0,
      cooldownUntil = null,
      riskTier,
      verificationStatus,
      decision,
      reasonCode = null,
      policySnapshot = {},
      requestId = null,
      correlationId = null
    }) {
      const normalizedCheckpoint = String(checkpoint ?? "").trim();
      if (!["transaction_initiation", "payout_release"].includes(normalizedCheckpoint)) {
        throw new StoreError("validation", "invalid checkpoint");
      }
      const normalizedDecision = String(decision ?? "").trim();
      if (!["allow", "deny"].includes(normalizedDecision)) {
        throw new StoreError("validation", "decision must be allow or deny");
      }
      if (!userId || typeof userId !== "string") {
        throw new StoreError("validation", "userId is required");
      }
      if (!Number.isInteger(amountCents) || amountCents <= 0) {
        throw new StoreError("validation", "amountCents must be a positive integer");
      }
      insertRiskLimitDecision.run({
        checkpoint: normalizedCheckpoint,
        decision: normalizedDecision,
        reason_code: reasonCode ? String(reasonCode).trim() : null,
        transaction_id: transactionId ? String(transactionId).trim() : null,
        user_id: userId,
        amount_cents: amountCents,
        daily_volume_cents: Math.max(0, Number(dailyVolumeCents ?? 0)),
        max_transaction_cents: Math.max(0, Number(maxTransactionCents ?? 0)),
        daily_volume_cap_cents: Math.max(0, Number(dailyVolumeCapCents ?? 0)),
        cooldown_hours: Math.max(0, Number(cooldownHours ?? 0)),
        cooldown_until: cooldownUntil ?? null,
        risk_tier: normalizeRiskTier(riskTier),
        verification_status: normalizeVerificationStatus(verificationStatus),
        policy_snapshot_json: JSON.stringify(policySnapshot ?? {}),
        request_id: requestId ? String(requestId).trim() : null,
        correlation_id: correlationId ? String(correlationId).trim() : null,
        created_at: now().toISOString()
      });
    },

    listRiskLimitDecisions({ userId, checkpoint, limit = 100 } = {}) {
      if (!userId || typeof userId !== "string") {
        throw new StoreError("validation", "userId is required");
      }
      if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
        throw new StoreError("validation", "limit must be an integer between 1 and 500");
      }
      const normalizedCheckpoint =
        checkpoint === undefined || checkpoint === null ? null : String(checkpoint).trim();
      if (
        normalizedCheckpoint !== null &&
        !["transaction_initiation", "payout_release"].includes(normalizedCheckpoint)
      ) {
        throw new StoreError("validation", "invalid checkpoint");
      }
      return listRiskLimitDecisionsByUser
        .all({ user_id: userId, checkpoint: normalizedCheckpoint, limit })
        .map(mapRiskLimitDecision);
    },

    countRecentDisputeOpeningsByActor({ actorId, sinceAt }) {
      if (!actorId || typeof actorId !== "string") {
        throw new StoreError("validation", "actorId is required");
      }
      const normalizedSinceAt = toIsoString(sinceAt);
      const row = countRecentDisputeOpenedByActor.get({
        actor_id: actorId,
        since_at: normalizedSinceAt
      });
      return Number(row?.count ?? 0);
    },

    getTransactionEventHistory({ id }) {
      const existing = getTransactionByIdQuery.get(id);
      if (!existing) {
        throw new StoreError("not_found", "transaction not found");
      }

      return listTransactionEventsByTransactionId.all(id).map(mapTransactionEvent);
    },

    createDisputeEvidence({
      id,
      transactionId,
      uploaderUserId,
      originalFileName,
      mimeType,
      sizeBytes,
      checksumSha256,
      storageKey,
      integrity = {}
    }) {
      if (!id || !transactionId || !uploaderUserId) {
        throw new StoreError("validation", "id, transactionId, and uploaderUserId are required");
      }
      if (!originalFileName || !originalFileName.trim()) {
        throw new StoreError("validation", "originalFileName is required");
      }
      if (!mimeType || !mimeType.trim()) {
        throw new StoreError("validation", "mimeType is required");
      }
      if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
        throw new StoreError("validation", "sizeBytes must be a positive integer");
      }
      if (!checksumSha256 || !checksumSha256.trim()) {
        throw new StoreError("validation", "checksumSha256 is required");
      }
      if (!storageKey || !storageKey.trim()) {
        throw new StoreError("validation", "storageKey is required");
      }

      const transaction = getTransactionByIdQuery.get(transactionId);
      if (!transaction) {
        throw new StoreError("not_found", "transaction not found");
      }
      if (transaction.status !== "disputed") {
        throw new StoreError("conflict", "dispute evidence can only be added to open disputes");
      }

      const timestamp = now().toISOString();

      try {
        insertDisputeEvidence.run({
          id,
          transaction_id: transactionId,
          uploader_user_id: uploaderUserId,
          original_file_name: originalFileName.trim(),
          mime_type: mimeType.trim(),
          size_bytes: sizeBytes,
          checksum_sha256: checksumSha256.trim(),
          storage_key: storageKey.trim(),
          created_at: timestamp
        });
      } catch (error) {
        if (error && typeof error.message === "string" && error.message.includes("UNIQUE")) {
          throw new StoreError("conflict", "evidence id or storage key already exists");
        }
        throw error;
      }

      const metadataConsistencyScore = Math.max(
        0,
        Math.min(100, Number(integrity.metadataConsistencyScore ?? 100))
      );
      const duplicateWithinTransaction = integrity.duplicateWithinTransaction === true;
      const replaySeenGlobally = integrity.replaySeenGlobally === true;
      const anomalyScore = Math.max(0, Math.min(100, Number(integrity.anomalyScore ?? 0)));
      const integrityFlags = integrity.integrityFlags ?? [];
      upsertDisputeEvidenceIntegrity.run({
        evidence_id: id,
        transaction_id: transactionId,
        metadata_consistency_score: metadataConsistencyScore,
        duplicate_within_transaction: duplicateWithinTransaction ? 1 : 0,
        replay_seen_globally: replaySeenGlobally ? 1 : 0,
        anomaly_score: anomalyScore,
        integrity_flags_json: JSON.stringify(integrityFlags),
        created_at: timestamp,
        updated_at: timestamp
      });

      const evidence = mapDisputeEvidence(getDisputeEvidenceById.get(id));
      return {
        ...evidence,
        integrity: mapDisputeEvidenceIntegrity(
          getDisputeEvidenceIntegrityByEvidenceId.get({ evidence_id: evidence.id })
        )
      };
    },

    countDisputeEvidenceByChecksum({ transactionId, checksumSha256, global = false }) {
      const normalizedChecksum = String(checksumSha256 ?? "").trim();
      if (!normalizedChecksum) {
        throw new StoreError("validation", "checksumSha256 is required");
      }
      if (global) {
        return Number(
          countDisputeEvidenceByChecksum.get({
            checksum_sha256: normalizedChecksum
          })?.count ?? 0
        );
      }
      const normalizedTransactionId = String(transactionId ?? "").trim();
      if (!normalizedTransactionId) {
        throw new StoreError("validation", "transactionId is required when global is false");
      }
      return Number(
        countDisputeEvidenceByTransactionChecksum.get({
          transaction_id: normalizedTransactionId,
          checksum_sha256: normalizedChecksum
        })?.count ?? 0
      );
    },

    listDisputeEvidence({ transactionId }) {
      const transaction = getTransactionByIdQuery.get(transactionId);
      if (!transaction) {
        throw new StoreError("not_found", "transaction not found");
      }

      return listDisputeEvidenceByTransactionId.all(transactionId).map((row) => {
        const evidence = mapDisputeEvidence(row);
        return {
          ...evidence,
          integrity: mapDisputeEvidenceIntegrity(
            getDisputeEvidenceIntegrityByEvidenceId.get({ evidence_id: evidence.id })
          )
        };
      });
    },

    getDisputeEvidenceById({ transactionId, evidenceId }) {
      const transaction = getTransactionByIdQuery.get(transactionId);
      if (!transaction) {
        throw new StoreError("not_found", "transaction not found");
      }

      const evidence = mapDisputeEvidence(getDisputeEvidenceById.get(evidenceId));
      if (!evidence || evidence.transactionId !== transactionId) {
        throw new StoreError("not_found", "dispute evidence not found");
      }
      return {
        ...evidence,
        integrity: mapDisputeEvidenceIntegrity(
          getDisputeEvidenceIntegrityByEvidenceId.get({ evidence_id: evidence.id })
        )
      };
    },

    recordFulfillmentProof({
      id,
      transactionId,
      submittedBy,
      proofType,
      artifactChecksumSha256 = null,
      metadata = {},
      recordedAt = null
    }) {
      const normalizedTransactionId = String(transactionId ?? "").trim();
      if (!normalizedTransactionId) {
        throw new StoreError("validation", "transactionId is required");
      }
      const normalizedSubmittedBy = String(submittedBy ?? "").trim();
      if (!normalizedSubmittedBy) {
        throw new StoreError("validation", "submittedBy is required");
      }
      const normalizedProofType = String(proofType ?? "").trim();
      if (!normalizedProofType) {
        throw new StoreError("validation", "proofType is required");
      }
      const transaction = mapTransaction(getTransactionByIdQuery.get(normalizedTransactionId));
      if (!transaction) {
        throw new StoreError("not_found", "transaction not found");
      }
      const checksum = artifactChecksumSha256 ? String(artifactChecksumSha256).trim() : null;
      const transactionDuplicate =
        checksum === null
          ? 0
          : Number(
              countFulfillmentProofByTransactionChecksum.get({
                transaction_id: normalizedTransactionId,
                artifact_checksum_sha256: checksum
              })?.count ?? 0
            );
      const globalReplay =
        checksum === null
          ? 0
          : Number(
              countFulfillmentProofByChecksum.get({
                artifact_checksum_sha256: checksum
              })?.count ?? 0
            );
      const replayDetected = transactionDuplicate > 0 || globalReplay > 0;
      const anomalyScore = Math.max(0, Math.min(100, replayDetected ? 80 : 15));
      const integrityScore = Math.max(0, Math.min(100, replayDetected ? 20 : 90));
      const proofId = String(id ?? "").trim();
      if (!proofId) {
        throw new StoreError("validation", "id is required");
      }
      const timestamp = now().toISOString();
      insertFulfillmentProof.run({
        id: proofId,
        transaction_id: normalizedTransactionId,
        submitted_by: normalizedSubmittedBy,
        proof_type: normalizedProofType,
        artifact_checksum_sha256: checksum,
        metadata_json: JSON.stringify(metadata ?? {}),
        recorded_at: recordedAt ? toIsoString(recordedAt) : null,
        integrity_score: integrityScore,
        anomaly_score: anomalyScore,
        replay_detected: replayDetected ? 1 : 0,
        created_at: timestamp
      });
      const row = listFulfillmentProofsByTransaction
        .all({ transaction_id: normalizedTransactionId, limit: 1 })
        .map(mapFulfillmentProof)[0];
      return row;
    },

    listFulfillmentProofs({ transactionId, limit = 50 }) {
      const normalizedTransactionId = String(transactionId ?? "").trim();
      if (!normalizedTransactionId) {
        throw new StoreError("validation", "transactionId is required");
      }
      if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
        throw new StoreError("validation", "limit must be an integer between 1 and 500");
      }
      return listFulfillmentProofsByTransaction
        .all({ transaction_id: normalizedTransactionId, limit })
        .map(mapFulfillmentProof);
    },

    listAdminDisputeQueue({ filter = "open", sortBy = "updatedAt", sortOrder = "desc", nowAt }) {
      const normalizedFilter = String(filter);
      const normalizedSortBy = String(sortBy);
      const normalizedSortOrder = String(sortOrder).toLowerCase() === "asc" ? "asc" : "desc";
      const validFilters = new Set(["open", "needs_evidence", "awaiting_decision", "resolved"]);
      const validSortBy = new Set([
        "updatedAt",
        "disputeOpenedAt",
        "disputeResolvedAt",
        "autoReleaseDueAt",
        "disputeAgeHours",
        "autoReleaseOverdueHours",
        "evidenceCount"
      ]);

      if (!validFilters.has(normalizedFilter)) {
        throw new StoreError(
          "validation",
          "filter must be one of: open, needs_evidence, awaiting_decision, resolved"
        );
      }
      if (!validSortBy.has(normalizedSortBy)) {
        throw new StoreError(
          "validation",
          "sortBy must be one of: updatedAt, disputeOpenedAt, disputeResolvedAt, autoReleaseDueAt, disputeAgeHours, autoReleaseOverdueHours, evidenceCount"
        );
      }

      const nowMs = nowAt ? new Date(toIsoString(nowAt)).valueOf() : now().valueOf();
      const rows = listDisputeQueueRows.all();

      const items = rows
        .map((row) => {
          const transaction = mapTransaction(row);
          const disputeOpenedMs = transaction.disputeOpenedAt
            ? new Date(transaction.disputeOpenedAt).valueOf()
            : null;
          const disputeResolvedMs = transaction.disputeResolvedAt
            ? new Date(transaction.disputeResolvedAt).valueOf()
            : null;
          const autoReleaseDueMs = transaction.autoReleaseDueAt
            ? new Date(transaction.autoReleaseDueAt).valueOf()
            : null;
          const disputeEndMs = disputeResolvedMs ?? nowMs;
          const disputeAgeHours =
            disputeOpenedMs === null ? null : Number(((disputeEndMs - disputeOpenedMs) / 3600000).toFixed(2));
          const autoReleaseOverdueHours =
            autoReleaseDueMs === null ? null : Number((Math.max(0, nowMs - autoReleaseDueMs) / 3600000).toFixed(2));
          const autoReleaseRemainingHours =
            autoReleaseDueMs === null ? null : Number((Math.max(0, autoReleaseDueMs - nowMs) / 3600000).toFixed(2));

          return {
            transaction,
            evidenceCount: Number(row.evidence_count ?? 0),
            latestEvidenceAt: row.latest_evidence_at ?? null,
            disputeAgeHours,
            autoReleaseOverdueHours,
            autoReleaseRemainingHours
          };
        })
        .filter((item) => {
          if (normalizedFilter === "open") {
            return item.transaction.status === "disputed";
          }
          if (normalizedFilter === "needs_evidence") {
            return item.transaction.status === "disputed" && item.evidenceCount === 0;
          }
          if (normalizedFilter === "awaiting_decision") {
            return item.transaction.status === "disputed" && item.evidenceCount > 0;
          }
          return item.transaction.disputeResolvedAt !== null;
        });

      const getSortValue = (item) => {
        if (normalizedSortBy === "evidenceCount") {
          return item.evidenceCount;
        }
        if (normalizedSortBy === "disputeAgeHours") {
          return item.disputeAgeHours ?? -1;
        }
        if (normalizedSortBy === "autoReleaseOverdueHours") {
          return item.autoReleaseOverdueHours ?? -1;
        }
        if (normalizedSortBy === "updatedAt") {
          return item.transaction.updatedAt ? new Date(item.transaction.updatedAt).valueOf() : 0;
        }
        if (normalizedSortBy === "disputeOpenedAt") {
          return item.transaction.disputeOpenedAt
            ? new Date(item.transaction.disputeOpenedAt).valueOf()
            : 0;
        }
        if (normalizedSortBy === "disputeResolvedAt") {
          return item.transaction.disputeResolvedAt
            ? new Date(item.transaction.disputeResolvedAt).valueOf()
            : 0;
        }
        if (normalizedSortBy === "autoReleaseDueAt") {
          return item.transaction.autoReleaseDueAt
            ? new Date(item.transaction.autoReleaseDueAt).valueOf()
            : 0;
        }
        return 0;
      };

      items.sort((left, right) => {
        const leftValue = getSortValue(left);
        const rightValue = getSortValue(right);
        if (leftValue === rightValue) {
          return left.transaction.id.localeCompare(right.transaction.id);
        }
        return normalizedSortOrder === "asc" ? leftValue - rightValue : rightValue - leftValue;
      });

      return items;
    },

    listPendingNotifications({ transactionId }) {
      return listPendingOutboxRecords.all({ transaction_id: transactionId }).map(mapOutboxRecord);
    },

    processNotificationOutbox({ nowAt, limit = 100, maxProcessingMs = 250 } = {}) {
      if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
        throw new StoreError("validation", "limit must be an integer between 1 and 500");
      }
      if (!Number.isInteger(maxProcessingMs) || maxProcessingMs <= 0 || maxProcessingMs > 60000) {
        throw new StoreError("validation", "maxProcessingMs must be an integer between 1 and 60000");
      }

      const timestamp = nowAt ? toIsoString(nowAt) : now().toISOString();
      const rows = listDispatchableOutboxRecords.all({ now_at: timestamp, limit });
      let sentCount = 0;
      let failedCount = 0;
      let deliveredNotificationCount = 0;
      const startMs = Date.now();
      let timeBudgetReached = false;

      const processSingleRecord = db.transaction((row) => {
        const markResult = markOutboxRecordProcessing.run({
          id: row.id,
          processing_started_at: timestamp,
          last_attempt_at: timestamp,
          updated_at: timestamp
        });

        if (markResult.changes !== 1) {
          return { skipped: true };
        }

        const processingRecord = mapOutboxRecord(getOutboxRecordById.get(row.id));
        try {
          dispatchNotification({ outboxRecord: processingRecord });

          if (processingRecord.recipientUserId) {
            const insertResult = insertUserNotification.run({
              recipient_user_id: processingRecord.recipientUserId,
              transaction_id: processingRecord.transactionId,
              source_event_id: processingRecord.sourceEventId,
              source_outbox_id: processingRecord.id,
              topic: processingRecord.topic,
              payload_json: JSON.stringify(processingRecord.payload ?? {}),
              created_at: timestamp,
              updated_at: timestamp
            });

            if (insertResult.changes === 1) {
              deliveredNotificationCount += 1;
            }
          }

          markOutboxRecordSent.run({
            id: row.id,
            sent_at: timestamp,
            processed_at: timestamp,
            updated_at: timestamp
          });
          sentCount += 1;
          return { skipped: false };
        } catch (error) {
          const normalized = error instanceof Error ? error.message : "notification dispatch failed";
          const attemptCount = Number(processingRecord.attemptCount ?? 1);
          const retryDelayMinutes = Math.min(60, Math.max(1, 2 ** (attemptCount - 1)));
          const nextRetryAt = addMinutes(timestamp, retryDelayMinutes);
          markOutboxRecordFailed.run({
            id: row.id,
            failed_at: timestamp,
            processed_at: timestamp,
            next_retry_at: nextRetryAt,
            failure_reason: normalized,
            updated_at: timestamp
          });
          failedCount += 1;
          return { skipped: false };
        }
      });

      for (const row of rows) {
        if (Date.now() - startMs >= maxProcessingMs) {
          timeBudgetReached = true;
          break;
        }
        processSingleRecord(row);
      }

      return {
        processedCount: sentCount + failedCount,
        sentCount,
        failedCount,
        deliveredNotificationCount,
        remainingPendingCount: Number(countPendingOrFailedOutboxRecords.get().count),
        timeBudgetReached,
        ranAt: timestamp
      };
    },

    getNotificationOutboxStats() {
      return {
        pendingOrFailed: Number(countPendingOrFailedOutboxRecords.get().count),
        processing: Number(countOutboxRecordsByStatus.get({ status: "processing" }).count),
        sent: Number(countOutboxRecordsByStatus.get({ status: "sent" }).count),
        failed: Number(countOutboxRecordsByStatus.get({ status: "failed" }).count)
      };
    },

    listUserNotifications({ recipientUserId, limit = 100 }) {
      if (!recipientUserId) {
        throw new StoreError("validation", "recipientUserId is required");
      }
      if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
        throw new StoreError("validation", "limit must be an integer between 1 and 500");
      }
      return listNotificationsByUserId
        .all({ recipient_user_id: recipientUserId, limit })
        .map(mapUserNotification);
    },

    markNotificationAsRead({ id, recipientUserId }) {
      const existing = getNotificationById.get({ id });
      if (!existing) {
        throw new StoreError("not_found", "notification not found");
      }
      if (existing.recipient_user_id !== recipientUserId) {
        throw new StoreError("forbidden", "notification does not belong to authenticated user");
      }

      const timestamp = now().toISOString();
      const result = markNotificationRead.run({
        id,
        recipient_user_id: recipientUserId,
        read_at: timestamp,
        updated_at: timestamp
      });

      if (result.changes !== 1) {
        throw new StoreError("conflict", "failed to mark notification as read");
      }
      return mapUserNotification(getNotificationById.get({ id }));
    },

    markNotificationAsAcknowledged({ id, recipientUserId }) {
      const existing = getNotificationById.get({ id });
      if (!existing) {
        throw new StoreError("not_found", "notification not found");
      }
      if (existing.recipient_user_id !== recipientUserId) {
        throw new StoreError("forbidden", "notification does not belong to authenticated user");
      }

      const timestamp = now().toISOString();
      const result = markNotificationAcknowledged.run({
        id,
        recipient_user_id: recipientUserId,
        read_at: timestamp,
        acknowledged_at: timestamp,
        updated_at: timestamp
      });

      if (result.changes !== 1) {
        throw new StoreError("conflict", "failed to acknowledge notification");
      }
      return mapUserNotification(getNotificationById.get({ id }));
    },

    confirmDelivery({ id, buyerId }) {
      const existing = getTransactionByIdQuery.get(id);
      if (!existing) {
        throw new StoreError("not_found", "transaction not found");
      }

      if (!buyerId || buyerId !== existing.buyer_id) {
        throw new StoreError("forbidden", "buyerId must match transaction buyer");
      }

      if (existing.payout_released_at) {
        throw new StoreError("conflict", "payout already released for transaction");
      }

      if (existing.buyer_confirmed_at) {
        throw new StoreError("conflict", "buyer has already confirmed this transaction");
      }

      if (existing.status !== "accepted") {
        throw new StoreError(
          "conflict",
          `transaction cannot be confirmed from status '${existing.status}'`
        );
      }
      if (existing.hold_status === "held") {
        throw new StoreError("conflict", "transaction progression is currently held");
      }

      if (existing.dispute_opened_at && !existing.dispute_resolved_at) {
        throw new StoreError("conflict", "transaction has an open dispute");
      }

      const timestamp = now().toISOString();
      const runConfirmDelivery = db.transaction(() => {
        const result = markConfirmed.run({
          id,
          buyer_confirmed_at: timestamp,
          payout_released_at: timestamp,
          updated_at: timestamp
        });

        if (result.changes !== 1) {
          throw new StoreError("conflict", "transaction confirmation preconditions failed");
        }

        const sourceEventId = appendTransactionEvent({
          transactionId: id,
          eventType: "buyer_confirmed",
          actorId: buyerId,
          occurredAt: timestamp,
          payload: {}
        });
        appendTransactionEvent({
          transactionId: id,
          eventType: "settlement_completed",
          actorId: buyerId,
          occurredAt: timestamp,
          payload: { reason: "buyer_confirmation" }
        });
        enqueueOutboxRecords({
          transactionId: id,
          sourceEventId,
          occurredAt: timestamp,
          records: [
            {
              topic: "dispute_update",
              recipientUserId: existing.seller_id,
              payload: {
                transactionId: id,
                eventType: "settlement_completed",
                reason: "buyer_confirmation"
              }
            }
          ]
        });
      });
      runConfirmDelivery();

      return mapTransaction(getTransactionByIdQuery.get(id));
    },

    acknowledgeCompletionBySeller({ id, sellerId }) {
      const existing = getTransactionByIdQuery.get(id);
      if (!existing) {
        throw new StoreError("not_found", "transaction not found");
      }
      if (!sellerId || sellerId !== existing.seller_id) {
        throw new StoreError("forbidden", "sellerId must match transaction seller");
      }
      if (existing.status !== "completed") {
        throw new StoreError("conflict", "seller acknowledgment requires a completed transaction");
      }
      if (existing.seller_completion_acknowledged_at) {
        throw new StoreError("conflict", "seller has already acknowledged completion");
      }

      const timestamp = now().toISOString();
      const result = markSellerCompletionAcknowledged.run({
        id,
        seller_completion_acknowledged_at: timestamp,
        updated_at: timestamp
      });
      if (result.changes !== 1) {
        throw new StoreError("conflict", "failed to acknowledge completion");
      }
      return mapTransaction(getTransactionByIdQuery.get(id));
    },

    openDispute({ id, actorId }) {
      const existing = getTransactionByIdQuery.get(id);
      if (!existing) {
        throw new StoreError("not_found", "transaction not found");
      }

      if (!actorId || (actorId !== existing.buyer_id && actorId !== existing.seller_id)) {
        throw new StoreError("forbidden", "only transaction participants can open a dispute");
      }

      if (existing.payout_released_at) {
        throw new StoreError("conflict", "cannot dispute a settled transaction");
      }

      if (existing.status === "disputed" && !existing.dispute_resolved_at) {
        return mapTransaction(existing);
      }

      if (existing.status !== "accepted") {
        throw new StoreError("conflict", `cannot dispute status '${existing.status}'`);
      }
      if (existing.hold_status === "held") {
        throw new StoreError("conflict", "transaction progression is currently held");
      }

      const timestamp = now().toISOString();
      const runOpenDispute = db.transaction(() => {
        const result = openDisputeStatement.run({
          id,
          dispute_opened_at: timestamp,
          updated_at: timestamp
        });

        if (result.changes !== 1) {
          throw new StoreError("conflict", "failed to open dispute");
        }

        const sourceEventId = appendTransactionEvent({
          transactionId: id,
          eventType: "dispute_opened",
          actorId,
          occurredAt: timestamp,
          payload: {}
        });
        const recipientUserId = actorId === existing.buyer_id ? existing.seller_id : existing.buyer_id;
        enqueueOutboxRecords({
          transactionId: id,
          sourceEventId,
          occurredAt: timestamp,
          records: [
            {
              topic: "action_required",
              recipientUserId: null,
              payload: {
                transactionId: id,
                action: "review_dispute"
              }
            },
            {
              topic: "dispute_update",
              recipientUserId,
              payload: {
                transactionId: id,
                eventType: "dispute_opened"
              }
            }
          ]
        });
      });
      runOpenDispute();

      return mapTransaction(getTransactionByIdQuery.get(id));
    },

    resolveDispute({ id }) {
      const existing = getTransactionByIdQuery.get(id);
      if (!existing) {
        throw new StoreError("not_found", "transaction not found");
      }

      if (existing.status !== "disputed") {
        throw new StoreError("conflict", "transaction does not have an open dispute");
      }
      if (existing.hold_status === "held") {
        throw new StoreError("conflict", "transaction progression is currently held");
      }

      const timestamp = now().toISOString();
      const runResolveDispute = db.transaction(() => {
        const result = resolveDisputeStatement.run({
          id,
          dispute_resolved_at: timestamp,
          updated_at: timestamp
        });

        if (result.changes !== 1) {
          throw new StoreError("conflict", "failed to resolve dispute");
        }

        const sourceEventId = appendTransactionEvent({
          transactionId: id,
          eventType: "dispute_resolved",
          actorId: "admin",
          occurredAt: timestamp,
          payload: {}
        });
        enqueueOutboxRecords({
          transactionId: id,
          sourceEventId,
          occurredAt: timestamp,
          records: [
            {
              topic: "dispute_update",
              recipientUserId: existing.buyer_id,
              payload: {
                transactionId: id,
                eventType: "dispute_resolved"
              }
            },
            {
              topic: "dispute_update",
              recipientUserId: existing.seller_id,
              payload: {
                transactionId: id,
                eventType: "dispute_resolved"
              }
            }
          ]
        });
      });
      runResolveDispute();

      return mapTransaction(getTransactionByIdQuery.get(id));
    },

    adjudicateDispute({
      id,
      decision,
      decidedBy,
      reasonCode = "operator_decision",
      notes,
      paymentRefundResult,
      refundIdempotencyKey
    }) {
      const existing = getTransactionByIdQuery.get(id);
      if (!existing) {
        throw new StoreError("not_found", "transaction not found");
      }

      if (!VALID_ADJUDICATION_DECISIONS.has(decision)) {
        throw new StoreError(
          "validation",
          "decision must be one of: release_to_seller, refund_to_buyer, cancel_transaction"
        );
      }

      if (!decidedBy || typeof decidedBy !== "string" || !decidedBy.trim()) {
        throw new StoreError("validation", "decidedBy is required");
      }
      const normalizedReasonCode = String(reasonCode ?? "").trim() || "operator_decision";

      if (existing.adjudication_decision) {
        throw new StoreError("conflict", "dispute already adjudicated");
      }

      if (existing.status !== "disputed") {
        throw new StoreError("conflict", "transaction does not have an open dispute");
      }
      if (existing.hold_status === "held") {
        throw new StoreError("conflict", "transaction progression is currently held");
      }

      if (existing.payout_released_at) {
        throw new StoreError("conflict", "cannot adjudicate a settled transaction");
      }

      const timestamp = now().toISOString();
      const updateParams = {
        id,
        dispute_resolved_at: timestamp,
        adjudication_decided_at: timestamp,
        adjudication_decided_by: decidedBy.trim(),
        adjudication_notes: notes ?? null,
        payout_released_at: timestamp,
        refund_issued_at: timestamp,
        cancelled_at: timestamp,
        provider_last_refund_id: paymentRefundResult?.refundId ?? null,
        payment_reconciliation_json:
          paymentRefundResult && refundIdempotencyKey
            ? JSON.stringify({
                refund: {
                  provider: paymentRefundResult.provider,
                  idempotencyKey: refundIdempotencyKey,
                  refundId: paymentRefundResult.refundId ?? null,
                  status: paymentRefundResult.status ?? null,
                  raw: paymentRefundResult.raw ?? null
                }
              })
            : null,
        updated_at: timestamp
      };

      const runAdjudicateDispute = db.transaction(() => {
        let result;
        if (decision === "release_to_seller") {
          result = adjudicateToReleaseSellerStatement.run(updateParams);
        } else if (decision === "refund_to_buyer") {
          result = adjudicateToRefundBuyerStatement.run(updateParams);
        } else {
          result = adjudicateToCancelTransactionStatement.run(updateParams);
        }

        if (result.changes !== 1) {
          throw new StoreError("conflict", "failed to adjudicate dispute");
        }

        if (paymentRefundResult && refundIdempotencyKey) {
          upsertPaymentOperation.run({
            transaction_id: id,
            operation: "refund",
            provider: paymentRefundResult.provider,
            idempotency_key: refundIdempotencyKey,
            status: "succeeded",
            external_reference: paymentRefundResult.refundId ?? null,
            error_code: null,
            error_message: null,
            response_json: JSON.stringify(paymentRefundResult.raw ?? {}),
            created_at: timestamp,
            updated_at: timestamp
          });
        }

        const sourceEventId = appendTransactionEvent({
          transactionId: id,
          eventType: "dispute_adjudicated",
          actorId: decidedBy.trim(),
          occurredAt: timestamp,
          payload: {
            decision,
            reasonCode: normalizedReasonCode,
            notes: notes ?? null
          }
        });

        let settlementEventType = "settlement_completed";
        if (decision === "refund_to_buyer") {
          settlementEventType = "settlement_refunded";
        } else if (decision === "cancel_transaction") {
          settlementEventType = "settlement_cancelled";
        }
        appendTransactionEvent({
          transactionId: id,
          eventType: settlementEventType,
          actorId: decidedBy.trim(),
          occurredAt: timestamp,
          payload: { decision, reasonCode: normalizedReasonCode }
        });

        enqueueOutboxRecords({
          transactionId: id,
          sourceEventId,
          occurredAt: timestamp,
          records: [
            {
              topic: "dispute_update",
              recipientUserId: existing.buyer_id,
              payload: {
                transactionId: id,
                eventType: "dispute_adjudicated",
                decision,
                reasonCode: normalizedReasonCode,
                decisionTransparency: {
                  policyReasonCategory: normalizedReasonCode,
                  nextActions:
                    decision === "release_to_seller"
                      ? ["monitor_delivery_completion", "open_appeal_if_new_evidence"]
                      : decision === "refund_to_buyer"
                        ? ["confirm_refund_receipt", "open_appeal_if_needed"]
                        : ["coordinate_item_return", "open_appeal_if_needed"],
                  appealWindow: {
                    eligible: true,
                    closesAt: addHours(timestamp, 72)
                  }
                }
              }
            },
            {
              topic: "dispute_update",
              recipientUserId: existing.seller_id,
              payload: {
                transactionId: id,
                eventType: "dispute_adjudicated",
                decision,
                reasonCode: normalizedReasonCode,
                decisionTransparency: {
                  policyReasonCategory: normalizedReasonCode,
                  nextActions:
                    decision === "release_to_seller"
                      ? ["prepare_item_handover_record", "respond_to_appeal_if_opened"]
                      : decision === "refund_to_buyer"
                        ? ["confirm_return_status", "respond_to_appeal_if_opened"]
                        : ["close_transaction_followups", "respond_to_appeal_if_opened"],
                  appealWindow: {
                    eligible: true,
                    closesAt: addHours(timestamp, 72)
                  }
                }
              }
            }
          ]
        });
      });
      runAdjudicateDispute();

      return mapTransaction(getTransactionByIdQuery.get(id));
    },

    runAutoRelease({ nowAt } = {}) {
      const cutoff = nowAt ? toIsoString(nowAt) : now().toISOString();
      const result = runAutoReleaseTransaction(cutoff);
      return {
        releasedCount: result.releasedIds.length,
        releasedTransactionIds: result.releasedIds,
        delayedCount: result.delayedIds.length,
        delayedTransactionIds: result.delayedIds,
        manualReviewCount: result.manualReviewIds.length,
        manualReviewTransactionIds: result.manualReviewIds,
        ranAt: cutoff
      };
    }
  };
}
