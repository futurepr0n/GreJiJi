import crypto from "node:crypto";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toPercent(value) {
  return Number((value * 100).toFixed(2));
}

function stableSerialize(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
}

function hashSha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function calculateCriticality(amountCents) {
  if (amountCents >= 100000) {
    return "high";
  }
  if (amountCents >= 25000) {
    return "medium";
  }
  return "low";
}

function calculateConfidenceBand(sampleSize, hasSellerArea) {
  if (sampleSize >= 8 && hasSellerArea) {
    return "high";
  }
  if (sampleSize >= 3) {
    return "medium";
  }
  return "low";
}

function normalizeGraphStats(graphStats) {
  const entityTypeCounts = graphStats?.entityTypeCounts ?? {};
  return {
    linkedTransactionCount: Number(graphStats?.linkedTransactionCount ?? 0),
    sharedEntityCount: Number(graphStats?.sharedEntityCount ?? 0),
    linkedDisputedCount: Number(graphStats?.linkedDisputedCount ?? 0),
    sharedUsers: Number(entityTypeCounts.user ?? 0),
    sharedListings: Number(entityTypeCounts.listing ?? 0),
    sharedDevices: Number(entityTypeCounts.device ?? 0),
    sharedPaymentFingerprints: Number(entityTypeCounts.payment_fingerprint ?? 0),
    sharedDisputeEntities: Number(entityTypeCounts.dispute_entity ?? 0)
  };
}

function resolveThresholdModel(feedbackCalibration) {
  const defaultModel = {
    medium: 35,
    high: 70,
    adjustment: 0,
    calibrationSampleSize: 0,
    safeguard: "minimum_sample_not_met",
    observedAdverseRate: 0,
    targetAdverseRate: 22
  };

  if (!feedbackCalibration || typeof feedbackCalibration !== "object") {
    return defaultModel;
  }

  const medium = Number(feedbackCalibration.mediumThreshold ?? defaultModel.medium);
  const high = Number(feedbackCalibration.highThreshold ?? defaultModel.high);

  return {
    medium: clamp(Math.round(medium), 20, 55),
    high: clamp(Math.round(high), 55, 85),
    adjustment: clamp(Number(feedbackCalibration.adjustment ?? 0), -8, 8),
    calibrationSampleSize: Number(feedbackCalibration.sampleSize ?? 0),
    safeguard: String(feedbackCalibration.safeguard ?? "bounded_adjustment"),
    observedAdverseRate: Number(feedbackCalibration.observedAdverseRate ?? 0),
    targetAdverseRate: Number(feedbackCalibration.targetAdverseRate ?? 22)
  };
}

function buildIdentityFrictionPlan({
  riskBand,
  criticality,
  amountCents,
  thresholdModel,
  evaluatedAt
}) {
  const policyVersion = "identity-friction-v14-2026-04";
  const requirements = [];
  const decisionTrace = [];

  if (riskBand === "medium" || riskBand === "high") {
    requirements.push("email_otp", "phone_otp");
    decisionTrace.push({
      step: "risk_band_gate",
      matched: true,
      reason: "medium_or_high_risk_requires_step_up"
    });
  } else {
    decisionTrace.push({
      step: "risk_band_gate",
      matched: false,
      reason: "low_risk_keeps_baseline_identity_flow"
    });
  }

  if (riskBand === "high" || criticality === "high") {
    requirements.push("government_id", "selfie_liveness");
    decisionTrace.push({
      step: "criticality_gate",
      matched: true,
      reason: "high_value_or_high_risk_requires_strong_identity_proof"
    });
  } else if (criticality === "medium" && riskBand !== "low") {
    requirements.push("government_id");
    decisionTrace.push({
      step: "criticality_gate",
      matched: true,
      reason: "medium_criticality_requires_document_check_when_risk_elevated"
    });
  } else {
    decisionTrace.push({
      step: "criticality_gate",
      matched: false,
      reason: "criticality_does_not_require_extra_document_checks"
    });
  }

  if (amountCents >= 150000 || riskBand === "high") {
    requirements.push("payment_instrument_challenge");
    decisionTrace.push({
      step: "transaction_value_gate",
      matched: true,
      reason: "high_value_or_high_risk_requires_payment_proof"
    });
  } else {
    decisionTrace.push({
      step: "transaction_value_gate",
      matched: false,
      reason: "payment_challenge_not_required"
    });
  }

  const dedupedRequirements = [...new Set(requirements)];
  const escalationLevel =
    dedupedRequirements.length >= 5
      ? "maximum"
      : dedupedRequirements.length >= 3
        ? "enhanced"
        : dedupedRequirements.length >= 1
          ? "standard"
          : "baseline";

  return {
    policyVersion,
    escalationLevel,
    requirements: dedupedRequirements,
    decisionTrace,
    userExperienceConstraints: {
      maxInteractiveChecks: riskBand === "high" ? 5 : 3,
      requiresGracefulFallback: true,
      allowManualReviewSubstitution: true,
      policySafe: true
    },
    policyInputs: {
      riskBand,
      criticality,
      amountCents,
      mediumThreshold: thresholdModel.medium,
      highThreshold: thresholdModel.high
    },
    auditedAt: evaluatedAt
  };
}

function buildPostIncidentVerification({ riskBand, incidentStats, thresholdModel }) {
  const sellerSettledCount = Number(incidentStats?.sellerSettledCount ?? 0);
  const sellerAdverseCount = Number(incidentStats?.sellerAdverseCount ?? 0);
  const sellerDisputedCount = Number(incidentStats?.sellerDisputedCount ?? 0);
  const areaSettledCount = Number(incidentStats?.areaSettledCount ?? 0);
  const areaAdverseCount = Number(incidentStats?.areaAdverseCount ?? 0);

  const sellerAdverseRate = sellerSettledCount > 0 ? sellerAdverseCount / sellerSettledCount : 0;
  const areaAdverseRate = areaSettledCount > 0 ? areaAdverseCount / areaSettledCount : 0;

  const expectedAdverseRateByBand = {
    low: 12,
    medium: 24,
    high: 38
  };

  const expectedAdverseRate = expectedAdverseRateByBand[riskBand] ?? 20;
  const observedAdverseRate =
    sellerSettledCount >= 4 ? toPercent(sellerAdverseRate) : thresholdModel.observedAdverseRate;
  const driftFromExpected = Number((observedAdverseRate - expectedAdverseRate).toFixed(2));
  const regressionDetected = sellerSettledCount >= 8 && driftFromExpected > 8;

  let controlStatus = "insufficient_data";
  if (sellerSettledCount >= 4) {
    controlStatus = regressionDetected ? "degraded" : "stable";
  }

  const alerts = [];
  if (regressionDetected) {
    alerts.push("policy_regression_detected");
  }
  if (sellerSettledCount >= 4 && toPercent(sellerAdverseRate) >= expectedAdverseRate + 5) {
    alerts.push("seller_control_outcome_drift");
  }
  if (areaSettledCount >= 4 && toPercent(areaAdverseRate) >= expectedAdverseRate + 8) {
    alerts.push("local_area_adverse_spike");
  }
  if (sellerDisputedCount >= 3) {
    alerts.push("repeat_dispute_pattern_detected");
  }

  return {
    controlStatus,
    regressionDetected,
    driftFromExpected,
    expectedAdverseRate,
    observedAdverseRate,
    sellerOutcomeWindow: {
      settledCount: sellerSettledCount,
      adverseCount: sellerAdverseCount,
      disputedCount: sellerDisputedCount,
      adverseRate: toPercent(sellerAdverseRate)
    },
    areaOutcomeWindow: {
      settledCount: areaSettledCount,
      adverseCount: areaAdverseCount,
      adverseRate: toPercent(areaAdverseRate)
    },
    alerts,
    verificationMode: "post_incident_outcome_guardrail"
  };
}

function buildFraudRingDisruption({
  graph,
  ringStats,
  participantDisputeRate,
  riskBand,
  evaluatedAt
}) {
  const hopDistribution = ringStats?.hopDistribution ?? {};
  const hop1 = Number(hopDistribution.hop1 ?? 0);
  const hop2 = Number(hopDistribution.hop2 ?? 0);
  const hop3 = Number(hopDistribution.hop3 ?? 0);
  const linkedTransactionCount = Number(ringStats?.linkedTransactionCount ?? 0);
  const disputedLinkedCount = Number(ringStats?.linkedDisputedCount ?? 0);
  const uniqueBuyers = Number(ringStats?.uniqueBuyers ?? 0);
  const uniqueSellers = Number(ringStats?.uniqueSellers ?? 0);
  const sharedDevices = Number(ringStats?.sharedDevices ?? 0);
  const sharedPaymentFingerprints = Number(ringStats?.sharedPaymentFingerprints ?? 0);
  const disputedRate = linkedTransactionCount > 0 ? disputedLinkedCount / linkedTransactionCount : 0;

  const multiHopIntensity = clamp((hop2 * 1.2 + hop3 * 1.5) / 6, 0, 1);
  const counterpartyDensity = clamp((uniqueBuyers + uniqueSellers) / 10, 0, 1);
  const instrumentReuse = clamp((sharedDevices + sharedPaymentFingerprints) / 6, 0, 1);
  const adverseLinkDensity = clamp(disputedRate, 0, 1);

  const disruptionScore = Math.round(
    clamp(
      multiHopIntensity * 32 +
        counterpartyDensity * 18 +
        instrumentReuse * 24 +
        adverseLinkDensity * 18 +
        participantDisputeRate * 100 * 0.08,
      0,
      100
    )
  );

  let disruptionBand = "low";
  if (disruptionScore >= 70) {
    disruptionBand = "high";
  } else if (disruptionScore >= 40) {
    disruptionBand = "medium";
  }

  const shouldDisrupt = disruptionBand !== "low" || riskBand === "high";
  const recommendedActions = [];
  if (shouldDisrupt) {
    recommendedActions.push("ring_entity_quarantine");
  }
  if (disruptionBand === "high") {
    recommendedActions.push("counterparty_velocity_freeze", "manual_investigator_escalation");
  } else if (disruptionBand === "medium") {
    recommendedActions.push("enhanced_monitoring");
  }

  return {
    version: "fraud-ring-disruption-v15-2026-04",
    disruptionScore,
    disruptionBand,
    ringMetrics: {
      linkedTransactionCount,
      linkedDisputedCount: disputedLinkedCount,
      uniqueBuyers,
      uniqueSellers,
      sharedDevices,
      sharedPaymentFingerprints,
      hopDistribution: {
        hop1,
        hop2,
        hop3
      }
    },
    recommendedActions,
    shouldDisrupt,
    investigatorArtifacts: {
      graphSnapshotRef: ringStats?.graphSnapshotRef ?? null,
      actorClusterSummary: {
        buyerCount: uniqueBuyers,
        sellerCount: uniqueSellers,
        instrumentReuseScore: Number((instrumentReuse * 100).toFixed(2))
      },
      triggeredAt: evaluatedAt
    }
  };
}

function buildEscrowAdversarialSimulation({
  riskBand,
  criticality,
  amountCents,
  probabilities,
  fraudRingDisruption
}) {
  const stressScore = Number(probabilities?.escrowStressScore ?? 0);
  const deliveryFailureProbability = clamp(
    Number(probabilities?.deliveryFailureProbability ?? 0),
    0,
    1
  );
  const disputeEscalationProbability = clamp(
    Number(probabilities?.disputeEscalationProbability ?? 0),
    0,
    1
  );
  const paymentAnomalyProbability = clamp(
    Number(probabilities?.paymentAnomalyProbability ?? 0),
    0,
    1
  );
  const ringPressure = clamp(Number(fraudRingDisruption?.disruptionScore ?? 0) / 100, 0, 1);

  const scenarios = [
    {
      key: "delivery_diversion",
      likelihood: clamp(
        deliveryFailureProbability * 0.65 + disputeEscalationProbability * 0.2 + ringPressure * 0.15,
        0,
        1
      ),
      impact: clamp((amountCents / 150000) * 0.6 + ringPressure * 0.4, 0, 1)
    },
    {
      key: "chargeback_reversal",
      likelihood: clamp(
        paymentAnomalyProbability * 0.7 + disputeEscalationProbability * 0.2 + ringPressure * 0.1,
        0,
        1
      ),
      impact: clamp((amountCents / 180000) * 0.55 + ringPressure * 0.45, 0, 1)
    },
    {
      key: "coordinated_dispute_flood",
      likelihood: clamp(disputeEscalationProbability * 0.6 + ringPressure * 0.4, 0, 1),
      impact: clamp((stressScore / 100) * 0.55 + ringPressure * 0.45, 0, 1)
    }
  ];

  const scenarioOutcomes = scenarios.map((scenario) => {
    const severityScore = Math.round(clamp(scenario.likelihood * 45 + scenario.impact * 55, 0, 100));
    return {
      scenario: scenario.key,
      likelihood: toPercent(scenario.likelihood),
      impact: toPercent(scenario.impact),
      severityScore,
      recommendedGuardrails:
        severityScore >= 75
          ? ["manual_release_gate", "proof_of_delivery_required"]
          : severityScore >= 45
            ? ["asynchronous_release_review"]
            : ["baseline_escrow_monitoring"]
    };
  });

  const maxSeverity = scenarioOutcomes.reduce((max, item) => Math.max(max, item.severityScore), 0);
  const recommendedGuardrails = [...new Set(scenarioOutcomes.flatMap((item) => item.recommendedGuardrails))];
  if (riskBand === "high" || criticality === "high") {
    recommendedGuardrails.push("high_risk_disbursement_delay");
  }

  return {
    version: "escrow-adversarial-sim-v15-2026-04",
    simulationMode: "coordinated_attack_scenarios",
    maxSeverity,
    scenarioOutcomes,
    recommendedGuardrails: [...new Set(recommendedGuardrails)],
    simulationInputs: {
      riskBand,
      criticality,
      amountCents,
      stressScore,
      fraudRingDisruptionScore: Number(fraudRingDisruption?.disruptionScore ?? 0)
    }
  };
}

function buildTrustPolicyRollback({
  thresholdModel,
  postIncidentVerification,
  escrowAdversarialSimulation,
  fraudRingDisruption,
  evaluatedAt
}) {
  const driftFromExpected = Number(postIncidentVerification?.driftFromExpected ?? 0);
  const regressionDetected = Boolean(postIncidentVerification?.regressionDetected);
  const maxSimulationSeverity = Number(escrowAdversarialSimulation?.maxSeverity ?? 0);
  const ringDisruptionScore = Number(fraudRingDisruption?.disruptionScore ?? 0);

  const rollbackPressure = Math.round(
    clamp(
      driftFromExpected * 2.2 +
        (regressionDetected ? 20 : 0) +
        maxSimulationSeverity * 0.32 +
        ringDisruptionScore * 0.24,
      0,
      100
    )
  );

  const rollbackTriggered = rollbackPressure >= 72 || (regressionDetected && maxSimulationSeverity >= 70);
  const rollbackMode = rollbackTriggered ? "autonomous_guarded_rollback" : "monitoring_only";
  const policyDelta = rollbackTriggered
    ? {
        mediumThresholdDelta: -3,
        highThresholdDelta: -4
      }
    : {
        mediumThresholdDelta: 0,
        highThresholdDelta: 0
      };

  const effectiveThresholds = {
    medium: clamp(
      Number(thresholdModel?.medium ?? 35) + policyDelta.mediumThresholdDelta,
      20,
      55
    ),
    high: clamp(
      Number(thresholdModel?.high ?? 70) + policyDelta.highThresholdDelta,
      55,
      85
    )
  };
  effectiveThresholds.high = Math.max(effectiveThresholds.high, effectiveThresholds.medium + 15);

  return {
    version: "trust-policy-rollback-v15-2026-04",
    rollbackTriggered,
    rollbackMode,
    rollbackPressure,
    rollbackReasonCodes: [
      ...(regressionDetected ? ["post_incident_regression"] : []),
      ...(maxSimulationSeverity >= 70 ? ["high_severity_adversarial_simulation"] : []),
      ...(ringDisruptionScore >= 65 ? ["ring_disruption_pressure"] : [])
    ],
    policyDelta,
    thresholdsBeforeRollback: {
      medium: Number(thresholdModel?.medium ?? 35),
      high: Number(thresholdModel?.high ?? 70)
    },
    effectiveThresholds,
    rollbackArtifacts: {
      initiatedAt: evaluatedAt,
      simulationMaxSeverity: maxSimulationSeverity,
      disruptionScore: ringDisruptionScore,
      observedAdverseRate: Number(postIncidentVerification?.observedAdverseRate ?? 0)
    }
  };
}

function buildAccountTakeoverContainment({
  graph,
  ringStats,
  participantDisputeRate,
  probabilities,
  riskBand,
  evaluatedAt,
  evidenceProvenance
}) {
  const sharedDevicePressure = clamp(Number(graph.sharedDevices ?? 0) / 3, 0, 1);
  const sharedPaymentPressure = clamp(
    Number(graph.sharedPaymentFingerprints ?? 0) / 4,
    0,
    1
  );
  const multiHopPressure = clamp(
    (Number(ringStats?.hopDistribution?.hop2 ?? 0) +
      Number(ringStats?.hopDistribution?.hop3 ?? 0) * 1.4) /
      6,
    0,
    1
  );
  const takeoverTransitionPressure = clamp(
    Number(probabilities?.paymentAnomalyProbability ?? 0) * 0.48 +
      Number(probabilities?.deliveryFailureProbability ?? 0) * 0.24 +
      participantDisputeRate * 0.28,
    0,
    1
  );

  const correlationScore = Math.round(
    clamp(
      sharedDevicePressure * 28 +
        sharedPaymentPressure * 30 +
        multiHopPressure * 25 +
        takeoverTransitionPressure * 17,
      0,
      100
    )
  );

  let containmentBand = "low";
  if (correlationScore >= 74 || riskBand === "high") {
    containmentBand = "high";
  } else if (correlationScore >= 42 || riskBand === "medium") {
    containmentBand = "medium";
  }

  const recommendedActions = ["session_risk_annotation"];
  if (containmentBand !== "low") {
    recommendedActions.push("step_up_credential_reset", "device_trust_decay");
  }
  if (containmentBand === "high") {
    recommendedActions.push("linked_account_freeze", "payment_instrument_rebind_hold");
  } else if (containmentBand === "medium") {
    recommendedActions.push("counterparty_velocity_throttle");
  }

  return {
    version: "account-takeover-containment-v16-2026-04",
    correlationScore,
    containmentBand,
    containmentMode:
      containmentBand === "high"
        ? "graduated_lockdown"
        : containmentBand === "medium"
          ? "guarded_containment"
          : "monitor_only",
    recommendedActions: [...new Set(recommendedActions)],
    investigatorEvidenceTrail: {
      snapshotRef: evidenceProvenance?.snapshotId ?? null,
      linkedEntitySignals: {
        sharedDevices: Number(graph.sharedDevices ?? 0),
        sharedPaymentFingerprints: Number(graph.sharedPaymentFingerprints ?? 0),
        hop2Links: Number(ringStats?.hopDistribution?.hop2 ?? 0),
        hop3Links: Number(ringStats?.hopDistribution?.hop3 ?? 0)
      },
      suspiciousTransitionSignals: {
        deliveryFailureProbability: toPercent(
          Number(probabilities?.deliveryFailureProbability ?? 0)
        ),
        paymentAnomalyProbability: toPercent(
          Number(probabilities?.paymentAnomalyProbability ?? 0)
        ),
        participantDisputeRate: toPercent(participantDisputeRate)
      },
      generatedAt: evaluatedAt
    }
  };
}

function buildSettlementRiskStressControls({
  riskBand,
  criticality,
  amountCents,
  probabilities,
  incidentStats,
  fraudRingDisruption
}) {
  const ringPressure = clamp(Number(fraudRingDisruption?.disruptionScore ?? 0) / 100, 0, 1);
  const delayedDeliveryLikelihood = clamp(
    Number(probabilities?.deliveryFailureProbability ?? 0) * 0.72 + ringPressure * 0.28,
    0,
    1
  );
  const reversalWaveLikelihood = clamp(
    Number(probabilities?.paymentAnomalyProbability ?? 0) * 0.68 + ringPressure * 0.32,
    0,
    1
  );
  const disputeBurstLikelihood = clamp(
    Number(probabilities?.disputeEscalationProbability ?? 0) * 0.62 + ringPressure * 0.38,
    0,
    1
  );

  const amountWeight = clamp(amountCents / 160000, 0, 1);
  const scenarios = [
    {
      scenario: "delayed_delivery",
      likelihood: delayedDeliveryLikelihood,
      impact: clamp(amountWeight * 0.58 + ringPressure * 0.42, 0, 1)
    },
    {
      scenario: "reversal_wave",
      likelihood: reversalWaveLikelihood,
      impact: clamp(amountWeight * 0.52 + ringPressure * 0.48, 0, 1)
    },
    {
      scenario: "coordinated_dispute_burst",
      likelihood: disputeBurstLikelihood,
      impact: clamp(
        Number(incidentStats?.sellerDisputedCount ?? 0) / 8 * 0.4 + ringPressure * 0.6,
        0,
        1
      )
    }
  ].map((scenario) => {
    const severityScore = Math.round(
      clamp(scenario.likelihood * 46 + scenario.impact * 54, 0, 100)
    );
    const confidenceBand =
      severityScore >= 75 ? "high" : severityScore >= 45 ? "medium" : "low";
    return {
      scenario: scenario.scenario,
      likelihood: toPercent(scenario.likelihood),
      impact: toPercent(scenario.impact),
      severityScore,
      confidenceBand
    };
  });

  const maxScenarioSeverity = scenarios.reduce((max, item) => Math.max(max, item.severityScore), 0);
  const averageConfidenceScore =
    scenarios.reduce(
      (sum, item) =>
        sum + (item.confidenceBand === "high" ? 1 : item.confidenceBand === "medium" ? 0.66 : 0.34),
      0
    ) / scenarios.length;
  const simulationConfidenceBand =
    averageConfidenceScore >= 0.78 ? "high" : averageConfidenceScore >= 0.55 ? "medium" : "low";

  const recommendedControls = ["escrow_cohort_monitoring"];
  if (maxScenarioSeverity >= 45 || riskBand !== "low") {
    recommendedControls.push("graduated_settlement_delay", "dispute_burst_rate_limiter");
  }
  if (maxScenarioSeverity >= 72 || criticality === "high") {
    recommendedControls.push("manual_release_confirmation", "reversal_buffer_reserve");
  }

  return {
    version: "settlement-risk-stress-controls-v16-2026-04",
    simulationMode: "delayed_delivery_reversal_dispute_burst",
    stressScenarios: scenarios,
    maxScenarioSeverity,
    simulationConfidenceBand,
    projectedLossBps: Math.round(
      clamp(
        maxScenarioSeverity * 0.72 +
          Number(probabilities?.escrowStressScore ?? 0) * 0.2 +
          ringPressure * 100 * 0.08,
        0,
        100
      )
    ),
    recommendedControls: [...new Set(recommendedControls)],
    recommendationRationale: {
      riskBand,
      criticality,
      ringPressure: toPercent(ringPressure)
    }
  };
}

function buildPolicyCanaryGovernance({
  riskBand,
  thresholdModel,
  trustPolicyRollback,
  accountTakeoverContainment,
  settlementRiskStressControls,
  postIncidentVerification,
  evaluatedAt
}) {
  const degradationPressure = Math.round(
    clamp(
      Number(trustPolicyRollback?.rollbackPressure ?? 0) * 0.52 +
        Number(accountTakeoverContainment?.correlationScore ?? 0) * 0.24 +
        Number(settlementRiskStressControls?.maxScenarioSeverity ?? 0) * 0.24,
      0,
      100
    )
  );
  const autoReverted =
    Boolean(trustPolicyRollback?.rollbackTriggered) ||
    degradationPressure >= 76 ||
    Boolean(postIncidentVerification?.regressionDetected);
  const rolloutDecision = autoReverted
    ? "revert"
    : degradationPressure <= 38 && riskBand === "low"
      ? "promote"
      : "hold";

  const guardrailActions = [];
  if (rolloutDecision === "promote") {
    guardrailActions.push("canary_promote");
  } else if (rolloutDecision === "revert") {
    guardrailActions.push("canary_revert", "incident_review_required");
  } else {
    guardrailActions.push("canary_hold", "extended_observation");
  }

  return {
    version: "policy-canary-governance-v16-2026-04",
    rolloutDecision,
    autoReverted,
    degradationPressure,
    monitoredSignals: {
      rollbackPressure: Number(trustPolicyRollback?.rollbackPressure ?? 0),
      takeoverCorrelationScore: Number(accountTakeoverContainment?.correlationScore ?? 0),
      settlementStressSeverity: Number(settlementRiskStressControls?.maxScenarioSeverity ?? 0),
      postIncidentRegressionDetected: Boolean(postIncidentVerification?.regressionDetected)
    },
    rollbackThresholds: {
      caution: 52,
      rollback: 76
    },
    cohortPlan: {
      stage0Percent: 5,
      stage1Percent: 20,
      stage2Percent: rolloutDecision === "promote" ? 100 : 40
    },
    effectiveThresholds: {
      medium: Number(thresholdModel?.medium ?? 35),
      high: Number(thresholdModel?.high ?? 70)
    },
    guardrailActions,
    artifacts: {
      rollbackRunbookRef: "runbook:trust-policy-canary-v16",
      generatedAt: evaluatedAt
    }
  };
}

function buildCrossMarketCollusionInterdiction({
  graph,
  ringStats,
  sellerArea,
  areaStats,
  participantDisputeRate,
  riskBand,
  evaluatedAt
}) {
  const sharedListings = Number(graph.sharedListings ?? 0);
  const sharedDevices = Number(graph.sharedDevices ?? 0);
  const sharedPaymentFingerprints = Number(graph.sharedPaymentFingerprints ?? 0);
  const linkedTransactionCount = Number(ringStats?.linkedTransactionCount ?? 0);
  const uniqueBuyers = Number(ringStats?.uniqueBuyers ?? 0);
  const uniqueSellers = Number(ringStats?.uniqueSellers ?? 0);
  const hop2 = Number(ringStats?.hopDistribution?.hop2 ?? 0);
  const hop3 = Number(ringStats?.hopDistribution?.hop3 ?? 0);
  const areaTransactionCount = Number(areaStats?.transactionCount ?? 0);
  const areaDisputedCount = Number(areaStats?.disputedCount ?? 0);
  const areaDisputeDensity = areaTransactionCount > 0 ? areaDisputedCount / areaTransactionCount : 0;

  const listingSpreadScore = clamp((sharedListings + uniqueSellers) / 8, 0, 1);
  const geographyDispersionScore = clamp(
    (sellerArea ? 0.12 : 0.28) + linkedTransactionCount / 14 + hop3 * 0.08 + (1 - Math.min(1, areaDisputeDensity)),
    0,
    1
  );
  const instrumentReuseScore = clamp((sharedDevices + sharedPaymentFingerprints) / 7, 0, 1);
  const coordinationScore = clamp((hop2 * 0.45 + hop3 * 0.8 + uniqueBuyers * 0.2) / 6, 0, 1);

  const collusionRiskScore = Math.round(
    clamp(
      listingSpreadScore * 24 +
        geographyDispersionScore * 23 +
        instrumentReuseScore * 31 +
        coordinationScore * 14 +
        participantDisputeRate * 100 * 0.08,
      0,
      100
    )
  );

  let interdictionBand = "low";
  if (collusionRiskScore >= 74 || (riskBand === "high" && collusionRiskScore >= 62)) {
    interdictionBand = "high";
  } else if (collusionRiskScore >= 42 || (riskBand === "medium" && collusionRiskScore >= 34)) {
    interdictionBand = "medium";
  }

  const falsePositiveContainment = {
    challengerReviewRequired: interdictionBand !== "low",
    maxAutomatedSuppressionMinutes: interdictionBand === "high" ? 45 : interdictionBand === "medium" ? 20 : 0,
    allowCounterpartyRecoveryPath: true,
    escalationWhenConflictingSignals: true
  };

  const graduatedInterventions = [];
  if (interdictionBand === "medium" || interdictionBand === "high") {
    graduatedInterventions.push("cross_market_velocity_throttle", "ring_counterparty_limit");
  }
  if (interdictionBand === "high") {
    graduatedInterventions.push(
      "listing_cluster_interdiction_hold",
      "payment_device_quarantine",
      "manual_collusion_review"
    );
  }

  return {
    version: "cross-market-collusion-interdiction-v17-2026-04",
    collusionRiskScore,
    interdictionBand,
    shouldInterdict: interdictionBand !== "low",
    graduatedInterventions,
    reviewerRationale: {
      listingSpreadScore: toPercent(listingSpreadScore),
      geographyDispersionScore: toPercent(geographyDispersionScore),
      instrumentReuseScore: toPercent(instrumentReuseScore),
      coordinationScore: toPercent(coordinationScore),
      participantDisputeRate: toPercent(participantDisputeRate)
    },
    crossMarketSignals: {
      localArea: sellerArea ?? null,
      linkedTransactionCount,
      sharedListings,
      uniqueBuyers,
      uniqueSellers,
      sharedDevices,
      sharedPaymentFingerprints,
      hopDistribution: {
        hop2,
        hop3
      }
    },
    falsePositiveContainment,
    generatedAt: evaluatedAt
  };
}

function buildEscrowIntegrityAttestations({
  transaction,
  evidenceProvenance,
  postIncidentVerification,
  trustPolicyRollback,
  crossMarketCollusionInterdiction,
  evaluatedAt
}) {
  const seed = {
    transactionId: transaction.id,
    amountCents: Number(transaction.amountCents ?? 0),
    snapshotRef: evidenceProvenance?.snapshotId ?? null,
    rollbackTriggered: Boolean(trustPolicyRollback?.rollbackTriggered),
    collusionBand: crossMarketCollusionInterdiction?.interdictionBand ?? "low",
    postIncidentStatus: postIncidentVerification?.controlStatus ?? "unknown",
    generatedAt: evaluatedAt
  };
  const attestationRoot = hashSha256Hex(stableSerialize(seed));

  const checkpoints = [
    {
      checkpoint: "authorization_capture",
      status: "verified",
      details: {
        actor: "escrow_orchestrator",
        requirement: "authorized_funds_locked"
      }
    },
    {
      checkpoint: "hold_transition",
      status:
        crossMarketCollusionInterdiction?.interdictionBand === "high" ? "guarded_review" : "verified",
      details: {
        holdReason:
          crossMarketCollusionInterdiction?.interdictionBand === "high"
            ? "collusion_interdiction_hold"
            : "baseline_hold_window",
        rollbackMode: trustPolicyRollback?.rollbackMode ?? "monitoring_only"
      }
    },
    {
      checkpoint: "dispute_triggered_hold",
      status:
        postIncidentVerification?.controlStatus === "degraded" ? "guarded_review" : "verified",
      details: {
        incidentControlStatus: postIncidentVerification?.controlStatus ?? "stable",
        incidentRegressionDetected: Boolean(postIncidentVerification?.regressionDetected)
      }
    },
    {
      checkpoint: "release_or_refund",
      status:
        Boolean(trustPolicyRollback?.rollbackTriggered) ||
        crossMarketCollusionInterdiction?.interdictionBand === "high"
          ? "guarded_review"
          : "verified",
      details: {
        settlementMode:
          Boolean(trustPolicyRollback?.rollbackTriggered) ? "rollback_constrained" : "normal",
        requiresManualReleaseGate:
          Boolean(trustPolicyRollback?.rollbackTriggered) ||
          crossMarketCollusionInterdiction?.interdictionBand === "high"
      }
    }
  ];

  let previousHash = attestationRoot;
  const tamperEvidentChain = checkpoints.map((checkpoint, index) => {
    const priorHash = previousHash;
    const payload = {
      ...checkpoint,
      transactionId: transaction.id,
      index: index + 1,
      evaluatedAt
    };
    const payloadHash = hashSha256Hex(stableSerialize(payload));
    const chainHash = hashSha256Hex(`${priorHash}:${payloadHash}`);
    previousHash = chainHash;

    return {
      checkpoint: checkpoint.checkpoint,
      status: checkpoint.status,
      details: checkpoint.details,
      artifactId: `attest-${transaction.id}-${index + 1}-${chainHash.slice(0, 10)}`,
      payloadHash,
      previousHash: priorHash,
      chainHash
    };
  });

  const checkpointStatuses = new Set(tamperEvidentChain.map((item) => item.status));
  const attestationStatus = checkpointStatuses.has("guarded_review") ? "guarded" : "verified";

  return {
    version: "escrow-integrity-attestations-v17-2026-04",
    attestationStatus,
    attestationRoot,
    finalChainHash: previousHash,
    tamperEvidentChain,
    integrityChecks: {
      checkpointCount: tamperEvidentChain.length,
      chainContinuity: true,
      rootBoundToProvenance: Boolean(evidenceProvenance?.snapshotHash),
      snapshotHash: evidenceProvenance?.snapshotHash ?? null
    },
    generatedAt: evaluatedAt
  };
}

function buildPolicyBlastRadiusSimulation({
  riskBand,
  postIncidentVerification,
  settlementRiskStressControls,
  trustPolicyRollback,
  crossMarketCollusionInterdiction,
  evaluatedAt
}) {
  const trustImpactScore = Math.round(
    clamp(
      Number(postIncidentVerification?.driftFromExpected ?? 0) * 2.4 +
        Number(crossMarketCollusionInterdiction?.collusionRiskScore ?? 0) * 0.42 +
        Number(trustPolicyRollback?.rollbackPressure ?? 0) * 0.24,
      0,
      100
    )
  );
  const settlementImpactScore = Math.round(
    clamp(
      Number(settlementRiskStressControls?.maxScenarioSeverity ?? 0) * 0.63 +
        Number(crossMarketCollusionInterdiction?.collusionRiskScore ?? 0) * 0.27 +
        (Boolean(trustPolicyRollback?.rollbackTriggered) ? 10 : 0),
      0,
      100
    )
  );
  const operationalImpactScore = Math.round(
    clamp(
      Number(crossMarketCollusionInterdiction?.collusionRiskScore ?? 0) * 0.4 +
        Number(trustPolicyRollback?.rollbackPressure ?? 0) * 0.35 +
        Number(settlementRiskStressControls?.maxScenarioSeverity ?? 0) * 0.25,
      0,
      100
    )
  );
  const overallImpactScore = Math.round(
    (trustImpactScore * 0.4 + settlementImpactScore * 0.35 + operationalImpactScore * 0.25)
  );

  const simulatedChangeSet = {
    candidatePolicy: "trust-ops-v17-high-risk-change",
    riskBand,
    rollbackTriggered: Boolean(trustPolicyRollback?.rollbackTriggered),
    collusionInterdictionBand: crossMarketCollusionInterdiction?.interdictionBand ?? "low"
  };

  let gateDecision = "pass";
  if (
    overallImpactScore >= 74 ||
    Boolean(trustPolicyRollback?.rollbackTriggered) ||
    crossMarketCollusionInterdiction?.interdictionBand === "high"
  ) {
    gateDecision = "block";
  } else if (overallImpactScore >= 46 || riskBand !== "low") {
    gateDecision = "review";
  }

  const automatedGuardrails = [];
  if (gateDecision !== "pass") {
    automatedGuardrails.push("prelaunch_operator_signoff", "canary_scope_cap_10_percent");
  }
  if (gateDecision === "block") {
    automatedGuardrails.push("rollback_lock", "blast_radius_reduction_plan_required");
  } else if (gateDecision === "review") {
    automatedGuardrails.push("extended_shadow_evaluation");
  }

  return {
    version: "policy-blast-radius-simulation-v17-2026-04",
    simulatedChangeSet,
    impactBreakdown: {
      trustImpactScore,
      settlementImpactScore,
      operationalImpactScore,
      overallImpactScore
    },
    gateDecision,
    automatedGuardrails,
    simulationArtifacts: {
      generatedAt: evaluatedAt,
      scenarioCount: 3,
      runbookRef: "runbook:policy-blast-radius-v17"
    }
  };
}

function buildExplainability({
  geospatialScore,
  escrowStressScore,
  graphScore,
  participantDisputeRate,
  graph,
  confidenceBand,
  reasonCodes
}) {
  const weighted = [
    {
      key: "account_behavior_path",
      contribution: geospatialScore * 0.35,
      rationale: "participant and geospatial dispute behavior"
    },
    {
      key: "transaction_failure_path",
      contribution: escrowStressScore * 0.3,
      rationale: "delivery/dispute/payment stress model"
    },
    {
      key: "abuse_graph_path",
      contribution: graphScore * 0.25,
      rationale: "cross-transaction linkage strength"
    },
    {
      key: "participant_history_path",
      contribution: participantDisputeRate * 100 * 0.1,
      rationale: "historical participant dispute ratio"
    }
  ];

  const totalWeighted = weighted.reduce((sum, item) => sum + item.contribution, 0) || 1;
  const sortedPaths = [...weighted]
    .sort((left, right) => right.contribution - left.contribution)
    .map((item) => ({
      path: item.key,
      contributionScore: Number(item.contribution.toFixed(2)),
      contributionPercent: Number(((item.contribution / totalWeighted) * 100).toFixed(2)),
      rationale: item.rationale
    }));

  const confidenceDecomposition = {
    dataCoverage: clamp((graph.linkedTransactionCount + graph.sharedEntityCount) / 14, 0, 1),
    linkageCoverage: clamp(
      (graph.sharedDevices + graph.sharedPaymentFingerprints + graph.sharedDisputeEntities) / 8,
      0,
      1
    ),
    operatorReadiness:
      confidenceBand === "high" ? 0.9 : confidenceBand === "medium" ? 0.68 : 0.45,
    confidenceBand
  };

  return {
    topRiskPaths: sortedPaths.slice(0, 3),
    confidenceDecomposition,
    reviewerRationale: reasonCodes.slice(0, 5)
  };
}

export function evaluateTrustOperationsV17({
  transaction,
  sellerArea,
  areaStats,
  participantStats,
  graphStats,
  ringStats,
  feedbackCalibration,
  evidenceProvenance,
  incidentStats,
  evaluatedAt
}) {
  const sellerAreaKnown = typeof sellerArea === "string" && sellerArea.trim().length > 0;
  const areaTransactionCount = Number(areaStats.transactionCount ?? 0);
  const areaDisputedCount = Number(areaStats.disputedCount ?? 0);
  const participantTransactionCount = Number(participantStats.transactionCount ?? 0);
  const participantDisputedCount = Number(participantStats.disputedCount ?? 0);
  const participantDisputeRate =
    participantTransactionCount > 0 ? participantDisputedCount / participantTransactionCount : 0;
  const areaDisputeDensity = areaTransactionCount > 0 ? areaDisputedCount / areaTransactionCount : 0;
  const amountWeight = clamp(transaction.amountCents / 150000, 0, 1);

  const geospatialScore = Math.round(
    clamp(
      (sellerAreaKnown ? 15 : 0) +
        areaDisputeDensity * 55 +
        Math.min(20, areaTransactionCount * 2) +
        participantDisputeRate * 20,
      0,
      100
    )
  );

  const deliveryFailureProbability = clamp(
    0.06 + geospatialScore / 220 + participantDisputeRate * 0.28 + amountWeight * 0.08,
    0,
    1
  );
  const disputeEscalationProbability = clamp(
    0.05 + geospatialScore / 200 + participantDisputeRate * 0.35 + amountWeight * 0.06,
    0,
    1
  );
  const paymentAnomalyProbability = clamp(
    0.04 + geospatialScore / 260 + participantDisputeRate * 0.2 + amountWeight * 0.22,
    0,
    1
  );

  const escrowStressScore = Math.round(
    clamp(
      deliveryFailureProbability * 38 +
        disputeEscalationProbability * 37 +
        paymentAnomalyProbability * 25,
      0,
      100
    )
  );

  const graph = normalizeGraphStats(graphStats);
  const graphDisputeRate =
    graph.linkedTransactionCount > 0 ? graph.linkedDisputedCount / graph.linkedTransactionCount : 0;
  const graphEntityIntensity = clamp(graph.sharedEntityCount / 10, 0, 1);
  const graphScore = Math.round(
    clamp(
      graphDisputeRate * 55 +
        graphEntityIntensity * 25 +
        clamp(graph.sharedPaymentFingerprints / 3, 0, 1) * 12 +
        clamp(graph.sharedDevices / 2, 0, 1) * 8,
      0,
      100
    )
  );

  const thresholdModel = resolveThresholdModel(feedbackCalibration);

  const riskScore = Math.round(
    clamp(
      geospatialScore * 0.35 +
        escrowStressScore * 0.3 +
        graphScore * 0.25 +
        participantDisputeRate * 100 * 0.1,
      0,
      100
    )
  );

  const highThreshold = Math.max(thresholdModel.high, thresholdModel.medium + 15);

  let riskBand = "low";
  if (riskScore >= highThreshold) {
    riskBand = "high";
  } else if (riskScore >= thresholdModel.medium) {
    riskBand = "medium";
  }

  const criticality = calculateCriticality(transaction.amountCents);
  const confidenceBand = calculateConfidenceBand(
    areaTransactionCount + participantTransactionCount + graph.linkedTransactionCount,
    sellerAreaKnown
  );

  const reasonCodes = [];
  if (sellerAreaKnown && areaTransactionCount >= 3 && areaDisputeDensity >= 0.3) {
    reasonCodes.push("geo_cluster_dispute_density_high");
  }
  if (participantTransactionCount >= 3 && participantDisputeRate >= 0.25) {
    reasonCodes.push("participant_dispute_rate_elevated");
  }
  if (graph.linkedTransactionCount >= 2 && graphDisputeRate >= 0.35) {
    reasonCodes.push("abuse_graph_neighbor_dispute_density_high");
  }
  if (graph.sharedPaymentFingerprints > 0) {
    reasonCodes.push("abuse_graph_payment_fingerprint_link");
  }
  if (graph.sharedDevices > 0) {
    reasonCodes.push("abuse_graph_device_cluster_link");
  }
  if (deliveryFailureProbability >= 0.4) {
    reasonCodes.push("escrow_stress_delivery_risk");
  }
  if (disputeEscalationProbability >= 0.42) {
    reasonCodes.push("escrow_stress_dispute_risk");
  }
  if (paymentAnomalyProbability >= 0.4) {
    reasonCodes.push("escrow_stress_payment_anomaly_risk");
  }

  const identityFriction = buildIdentityFrictionPlan({
    riskBand,
    criticality,
    amountCents: transaction.amountCents,
    thresholdModel: {
      medium: thresholdModel.medium,
      high: highThreshold
    },
    evaluatedAt
  });

  const postIncidentVerification = buildPostIncidentVerification({
    riskBand,
    incidentStats,
    thresholdModel
  });
  const fraudRingDisruption = buildFraudRingDisruption({
    graph,
    ringStats,
    participantDisputeRate,
    riskBand,
    evaluatedAt
  });
  const escrowAdversarialSimulation = buildEscrowAdversarialSimulation({
    riskBand,
    criticality,
    amountCents: transaction.amountCents,
    probabilities: {
      deliveryFailureProbability,
      disputeEscalationProbability,
      paymentAnomalyProbability,
      escrowStressScore
    },
    fraudRingDisruption
  });
  const trustPolicyRollback = buildTrustPolicyRollback({
    thresholdModel: {
      medium: thresholdModel.medium,
      high: highThreshold
    },
    postIncidentVerification,
    escrowAdversarialSimulation,
    fraudRingDisruption,
    evaluatedAt
  });
  const accountTakeoverContainment = buildAccountTakeoverContainment({
    graph,
    ringStats,
    participantDisputeRate,
    probabilities: {
      deliveryFailureProbability,
      disputeEscalationProbability,
      paymentAnomalyProbability
    },
    riskBand,
    evaluatedAt,
    evidenceProvenance
  });
  const settlementRiskStressControls = buildSettlementRiskStressControls({
    riskBand,
    criticality,
    amountCents: transaction.amountCents,
    probabilities: {
      deliveryFailureProbability,
      disputeEscalationProbability,
      paymentAnomalyProbability,
      escrowStressScore
    },
    incidentStats,
    fraudRingDisruption
  });
  const policyCanaryGovernance = buildPolicyCanaryGovernance({
    riskBand,
    thresholdModel: {
      medium: thresholdModel.medium,
      high: highThreshold
    },
    trustPolicyRollback,
    accountTakeoverContainment,
    settlementRiskStressControls,
    postIncidentVerification,
    evaluatedAt
  });
  const crossMarketCollusionInterdiction = buildCrossMarketCollusionInterdiction({
    graph,
    ringStats,
    sellerArea,
    areaStats: {
      transactionCount: areaTransactionCount,
      disputedCount: areaDisputedCount
    },
    participantDisputeRate,
    riskBand,
    evaluatedAt
  });
  const escrowIntegrityAttestations = buildEscrowIntegrityAttestations({
    transaction,
    evidenceProvenance,
    postIncidentVerification,
    trustPolicyRollback,
    crossMarketCollusionInterdiction,
    evaluatedAt
  });
  const policyBlastRadiusSimulation = buildPolicyBlastRadiusSimulation({
    riskBand,
    postIncidentVerification,
    settlementRiskStressControls,
    trustPolicyRollback,
    crossMarketCollusionInterdiction,
    evaluatedAt
  });

  if (postIncidentVerification.regressionDetected) {
    reasonCodes.push("post_incident_control_regression_detected");
  }
  if (fraudRingDisruption.shouldDisrupt) {
    reasonCodes.push("multi_hop_ring_disruption_recommended");
  }
  if (trustPolicyRollback.rollbackTriggered) {
    reasonCodes.push("autonomous_trust_policy_rollback_triggered");
  }
  if (accountTakeoverContainment.containmentBand !== "low") {
    reasonCodes.push("networked_account_takeover_containment_triggered");
  }
  if (settlementRiskStressControls.maxScenarioSeverity >= 45) {
    reasonCodes.push("settlement_risk_stress_control_recommended");
  }
  if (policyCanaryGovernance.rolloutDecision === "revert") {
    reasonCodes.push("autonomous_policy_canary_reverted");
  }
  if (crossMarketCollusionInterdiction.shouldInterdict) {
    reasonCodes.push("cross_market_collusion_interdiction_recommended");
  }
  if (policyBlastRadiusSimulation.gateDecision === "block") {
    reasonCodes.push("policy_blast_radius_gate_blocked");
  } else if (policyBlastRadiusSimulation.gateDecision === "review") {
    reasonCodes.push("policy_blast_radius_gate_review");
  }
  if (escrowIntegrityAttestations.attestationStatus !== "verified") {
    reasonCodes.push("escrow_integrity_attestation_guarded");
  }
  if (reasonCodes.length === 0) {
    reasonCodes.push("baseline_risk_within_policy");
  }

  let controls = [];
  if (riskBand === "high") {
    controls = ["step_up_verification", "temporary_hold", "manual_review"];
  } else if (riskBand === "medium") {
    controls = criticality === "high" ? ["step_up_verification", "manual_review"] : ["step_up_verification"];
  } else if (criticality === "high") {
    controls = ["step_up_verification"];
  }

  const frictionControls = identityFriction.requirements.map(
    (requirement) => `identity_friction:${requirement}`
  );

  const intervention = {
    action:
      controls.length === 0 && frictionControls.length === 0
        ? "allow"
        : controls.includes("manual_review") ||
            postIncidentVerification.regressionDetected ||
            trustPolicyRollback.rollbackTriggered
          ? "review"
          : "guarded_allow",
    recommendedControls: [
      ...new Set([
        ...controls,
        ...frictionControls,
        ...fraudRingDisruption.recommendedActions,
        ...escrowAdversarialSimulation.recommendedGuardrails.filter(
          (guardrail) => guardrail !== "baseline_escrow_monitoring"
        ),
        ...accountTakeoverContainment.recommendedActions,
        ...settlementRiskStressControls.recommendedControls.filter(
          (guardrail) => guardrail !== "escrow_cohort_monitoring"
        ),
        ...crossMarketCollusionInterdiction.graduatedInterventions,
        ...policyBlastRadiusSimulation.automatedGuardrails,
        ...policyCanaryGovernance.guardrailActions,
        ...(escrowIntegrityAttestations.attestationStatus === "guarded"
          ? ["escrow_integrity_manual_confirmation"]
          : []),
        ...(trustPolicyRollback.rollbackTriggered ? ["autonomous_policy_rollback"] : [])
      ])
    ],
    policySafe: true,
    confidenceBand,
    provenanceRef: evidenceProvenance?.snapshotId ?? null,
    thresholdModel: {
      medium: thresholdModel.medium,
      high: highThreshold,
      adjustment: thresholdModel.adjustment
    },
    identityFrictionTrace: identityFriction.decisionTrace,
    incidentVerificationStatus: postIncidentVerification.controlStatus,
    rollbackMode: trustPolicyRollback.rollbackMode,
    containmentMode: accountTakeoverContainment.containmentMode,
    canaryDecision: policyCanaryGovernance.rolloutDecision
  };

  const explainability = buildExplainability({
    geospatialScore,
    escrowStressScore,
    graphScore,
    participantDisputeRate,
    graph,
    confidenceBand,
    reasonCodes
  });

  const evidenceSummary = {
    localArea: sellerAreaKnown ? sellerArea : null,
    areaTransactionCount,
    areaDisputedCount,
    areaDisputeDensity: toPercent(areaDisputeDensity),
    participantTransactionCount,
    participantDisputedCount,
    participantDisputeRate: toPercent(participantDisputeRate),
    graphNeighborTransactionCount: graph.linkedTransactionCount,
    graphLinkedDisputedCount: graph.linkedDisputedCount,
    graphDisputeRate: toPercent(graphDisputeRate),
    escrowStress: {
      deliveryFailureProbability: toPercent(deliveryFailureProbability),
      disputeEscalationProbability: toPercent(disputeEscalationProbability),
      paymentAnomalyProbability: toPercent(paymentAnomalyProbability)
    },
    postIncidentVerificationSummary: {
      controlStatus: postIncidentVerification.controlStatus,
      regressionDetected: postIncidentVerification.regressionDetected,
      driftFromExpected: postIncidentVerification.driftFromExpected
    },
    fraudRingDisruptionSummary: {
      disruptionScore: fraudRingDisruption.disruptionScore,
      disruptionBand: fraudRingDisruption.disruptionBand,
      linkedTransactionCount: fraudRingDisruption.ringMetrics.linkedTransactionCount
    },
    rollbackSummary: {
      rollbackTriggered: trustPolicyRollback.rollbackTriggered,
      rollbackPressure: trustPolicyRollback.rollbackPressure
    },
    accountTakeoverContainmentSummary: {
      containmentBand: accountTakeoverContainment.containmentBand,
      correlationScore: accountTakeoverContainment.correlationScore
    },
    settlementRiskStressSummary: {
      maxScenarioSeverity: settlementRiskStressControls.maxScenarioSeverity,
      simulationConfidenceBand: settlementRiskStressControls.simulationConfidenceBand
    },
    policyCanarySummary: {
      rolloutDecision: policyCanaryGovernance.rolloutDecision,
      autoReverted: policyCanaryGovernance.autoReverted
    },
    collusionInterdictionSummary: {
      interdictionBand: crossMarketCollusionInterdiction.interdictionBand,
      collusionRiskScore: crossMarketCollusionInterdiction.collusionRiskScore
    },
    escrowIntegrityAttestationSummary: {
      attestationStatus: escrowIntegrityAttestations.attestationStatus,
      finalChainHash: escrowIntegrityAttestations.finalChainHash
    },
    policyBlastRadiusSummary: {
      gateDecision: policyBlastRadiusSimulation.gateDecision,
      overallImpactScore: policyBlastRadiusSimulation.impactBreakdown.overallImpactScore
    },
    evaluatedAt,
    provenanceRef: evidenceProvenance?.snapshotId ?? null
  };

  return {
    riskScore,
    riskBand,
    criticality,
    confidenceBand,
    geospatialSignals: {
      localArea: sellerAreaKnown ? sellerArea : null,
      areaTransactionCount,
      areaDisputedCount,
      areaDisputeDensity: toPercent(areaDisputeDensity),
      geospatialScore
    },
    graphSignals: {
      linkedTransactionCount: graph.linkedTransactionCount,
      sharedEntityCount: graph.sharedEntityCount,
      linkedDisputedCount: graph.linkedDisputedCount,
      graphDisputeRate: toPercent(graphDisputeRate),
      entityTypeCounts: {
        user: graph.sharedUsers,
        listing: graph.sharedListings,
        device: graph.sharedDevices,
        paymentFingerprint: graph.sharedPaymentFingerprints,
        disputeEntity: graph.sharedDisputeEntities
      },
      graphScore
    },
    escrowStress: {
      deliveryFailureProbability: toPercent(deliveryFailureProbability),
      disputeEscalationProbability: toPercent(disputeEscalationProbability),
      paymentAnomalyProbability: toPercent(paymentAnomalyProbability),
      stressScore: escrowStressScore
    },
    evidenceProvenance: evidenceProvenance ?? {
      snapshotId: null,
      snapshotHash: null,
      lineage: []
    },
    outcomeFeedback: {
      thresholdModel: {
        medium: thresholdModel.medium,
        high: highThreshold,
        adjustment: thresholdModel.adjustment
      },
      calibrationSampleSize: thresholdModel.calibrationSampleSize,
      safeguard: thresholdModel.safeguard,
      observedAdverseRate: thresholdModel.observedAdverseRate,
      targetAdverseRate: thresholdModel.targetAdverseRate
    },
    explainability,
    identityFriction,
    postIncidentVerification,
    fraudRingDisruption,
    escrowAdversarialSimulation,
    trustPolicyRollback,
    accountTakeoverContainment,
    settlementRiskStressControls,
    crossMarketCollusionInterdiction,
    escrowIntegrityAttestations,
    policyBlastRadiusSimulation,
    policyCanaryGovernance,
    intervention,
    reasonCodes,
    evidenceSummary
  };
}

export function evaluateTrustOperationsV14(input) {
  return evaluateTrustOperationsV17(input);
}

export function evaluateTrustOperationsV13(input) {
  return evaluateTrustOperationsV17(input);
}

export function evaluateTrustOperationsV12(input) {
  return evaluateTrustOperationsV17(input);
}

export function evaluateTrustOperationsV15(input) {
  return evaluateTrustOperationsV17(input);
}

export function evaluateTrustOperationsV16(input) {
  return evaluateTrustOperationsV17(input);
}
