const state = {
  token: null,
  user: null,
  listings: [],
  selectedListing: null,
  selectedListingReputation: null,
  currentTransaction: null,
  currentTrust: null,
  currentEvents: [],
  currentEvidence: [],
  selectedModerationListingId: null,
  selectedRiskTransactionId: null,
  selectedRiskAccountId: null,
  launchControlFlags: []
};

function qs(selector) {
  const node = document.querySelector(selector);
  if (!node) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return node;
}

function log(message, kind = "info") {
  const logNode = qs("#activity-log");
  const prefix = kind === "error" ? "[error]" : "[info]";
  const line = `${new Date().toISOString()} ${prefix} ${message}`;
  logNode.textContent = `${line}\n${logNode.textContent}`.trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setPanelStatus(selector, message = "", kind = "info") {
  const node = qs(selector);
  node.textContent = message;
  node.classList.remove("error");
  if (kind === "error") {
    node.classList.add("error");
  }
}

async function apiRequest(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (state.token) {
    headers.authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error ?? `request failed (${response.status})`);
  }

  return payload;
}

function toUsdLike(cents, currency) {
  if (typeof cents !== "number") {
    return "-";
  }

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(cents / 100);
}

function centsToDollarsInput(cents) {
  if (!Number.isInteger(cents) || cents <= 0) {
    return "";
  }
  return (cents / 100).toFixed(2);
}

function dollarsInputToCents(rawValue, fieldName) {
  const normalized = String(rawValue ?? "").trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`${fieldName} must be a dollar amount with up to 2 decimals`);
  }
  const dollars = Number(normalized);
  if (!Number.isFinite(dollars) || dollars <= 0) {
    throw new Error(`${fieldName} must be greater than 0`);
  }
  return Math.round(dollars * 100);
}

function fmtDate(value) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return String(value);
  }
  return parsed.toLocaleString();
}

async function fileToBase64(file) {
  const bytes = await file.arrayBuffer();
  let binary = "";
  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte);
  }
  return window.btoa(binary);
}

function ensureTransactionLoaded() {
  if (!state.currentTransaction?.id) {
    throw new Error("load a transaction first");
  }
  return state.currentTransaction.id;
}

function renderRoleUI() {
  const role = state.user?.role;
  for (const node of document.querySelectorAll(".role-buyer, .role-seller, .role-admin")) {
    const classes = node.className;
    const matchRole = role && classes.includes(`role-${role}`);
    node.hidden = !matchRole;
  }

  qs("#transaction-panel").hidden = !role;
  qs("#notifications-panel").hidden = !role;
  qs("#admin-disputes-panel").hidden = role !== "admin";
  qs("#admin-moderation-panel").hidden = role !== "admin";
  qs("#admin-risk-panel").hidden = role !== "admin";
  qs("#admin-launch-control-panel").hidden = role !== "admin";

  const authStatus = qs("#auth-status");
  const openAuthButton = qs("#open-auth-modal");
  const logoutButton = qs("#logout-button");
  authStatus.textContent = role ? `Signed in as ${state.user.email} (${role})` : "Signed out";
  openAuthButton.textContent = role ? "Switch account" : "Sign in / Register";
  logoutButton.hidden = !role;
}

function renderListingDetail() {
  const detailNode = qs("#listing-detail");
  const listing = state.selectedListing;
  if (!listing) {
    detailNode.textContent = "Select a listing to view details.";
    return;
  }

  const linkedPhotos = Array.isArray(listing.photoUrls) ? listing.photoUrls : [];
  const uploadedPhotos = Array.isArray(listing.uploadedPhotos) ? listing.uploadedPhotos : [];
  const linkedPhotoHtml =
    linkedPhotos.length === 0
      ? "<li>None</li>"
      : linkedPhotos
          .map(
            (url) =>
              `<li><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a></li>`
          )
          .join("");
  const uploadedPhotoHtml =
    uploadedPhotos.length === 0
      ? "<li>None</li>"
      : uploadedPhotos
          .map(
            (photo) =>
              `<li><a href="${escapeHtml(photo.downloadUrl)}" target="_blank" rel="noreferrer">${escapeHtml(photo.originalFileName)}</a> (${escapeHtml(photo.mimeType)})</li>`
          )
          .join("");

  detailNode.innerHTML = `
    <p><strong>${escapeHtml(listing.title)}</strong> <span class="inline-badge">${escapeHtml(listing.localArea)}</span></p>
    <p>${escapeHtml(listing.description || "No description")}</p>
    <p>Seller: <code>${escapeHtml(listing.sellerId)}</code></p>
    <p>Price: <strong>${toUsdLike(listing.priceCents, "USD")}</strong></p>
    <p>Photo links:</p>
    <ul>${linkedPhotoHtml}</ul>
    <p>Uploaded photos:</p>
    <ul>${uploadedPhotoHtml}</ul>
    <p>Updated: ${escapeHtml(fmtDate(listing.updatedAt))}</p>
  `;

  const purchaseForm = qs("#purchase-form");
  purchaseForm.sellerId.value = listing.sellerId;
  purchaseForm.amountDollars.value = centsToDollarsInput(listing.priceCents);
}

function renderListingReputation() {
  const node = qs("#listing-reputation");
  const reputation = state.selectedListingReputation;
  if (!state.selectedListing?.sellerId) {
    node.textContent = "Seller reputation will appear after listing selection.";
    return;
  }
  if (!reputation) {
    node.textContent = "Seller reputation is loading or unavailable.";
    return;
  }
  const avgLabel =
    reputation.averageScore === null ? "No ratings yet" : `${reputation.averageScore.toFixed(2)} / 5`;
  node.innerHTML = `
    <p><strong>Seller reputation</strong> for <code>${escapeHtml(reputation.userId)}</code></p>
    <p>Average: <strong>${escapeHtml(avgLabel)}</strong></p>
    <p>Ratings: ${escapeHtml(reputation.ratingCount)}</p>
  `;
}

function renderListings() {
  const listNode = qs("#listings-list");
  listNode.innerHTML = "";

  if (state.listings.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "No listings found.";
    listNode.appendChild(empty);
    return;
  }

  for (const listing of state.listings) {
    const item = document.createElement("li");
    const text = document.createElement("span");
    text.textContent = `${listing.title} - ${toUsdLike(listing.priceCents, "USD")}`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Select";
    button.addEventListener("click", () => {
      state.selectedListing = listing;
      state.selectedListingReputation = null;
      if (state.user?.role === "seller" && state.user.id === listing.sellerId) {
        const uploadForm = qs("#listing-photo-upload-form");
        uploadForm.listingId.value = listing.id;
      }
      renderListingDetail();
      renderListingReputation();
      log(`selected listing ${listing.id}`);
      void loadListingReputation(listing.sellerId).catch((error) => {
        log(error.message, "error");
      });
    });
    item.append(text, button);
    listNode.appendChild(item);
  }
}

function renderTransactionSummary() {
  const summaryNode = qs("#transaction-summary");
  const tx = state.currentTransaction;
  if (!tx) {
    summaryNode.textContent = "Load a transaction to inspect lifecycle state.";
    return;
  }

  summaryNode.innerHTML = `
    <p><strong>ID:</strong> <code>${escapeHtml(tx.id)}</code></p>
    <p><strong>Status:</strong> <span class="inline-badge">${escapeHtml(tx.status)}</span></p>
    <p><strong>Buyer:</strong> <code>${escapeHtml(tx.buyerId)}</code></p>
    <p><strong>Seller:</strong> <code>${escapeHtml(tx.sellerId)}</code></p>
    <p><strong>Item price:</strong> ${toUsdLike(tx.itemPrice, tx.currency)}</p>
    <p><strong>Service fee:</strong> ${toUsdLike(tx.serviceFee, tx.currency)}</p>
    <p><strong>Total buyer charge:</strong> ${toUsdLike(tx.totalBuyerCharge, tx.currency)}</p>
    <p><strong>Seller net:</strong> ${toUsdLike(tx.sellerNet, tx.currency)}</p>
    <p><strong>Settlement outcome:</strong> ${escapeHtml(tx.settlementOutcome || "pending")}</p>
    <p><strong>Seller completion acknowledgment:</strong> ${escapeHtml(fmtDate(tx.sellerCompletionAcknowledgedAt) || "-")}</p>
    <p><strong>Hold status:</strong> ${escapeHtml(tx.holdStatus || "none")}</p>
    <p><strong>Updated at:</strong> ${escapeHtml(fmtDate(tx.updatedAt))}</p>
  `;

  qs("#fetch-transaction-form").transactionId.value = tx.id;
}

function renderTransactionTrust() {
  const node = qs("#transaction-trust");
  const tx = state.currentTransaction;
  const trust = state.currentTrust;
  if (!tx) {
    node.textContent = "Transaction trust state appears after loading ratings.";
    return;
  }
  if (!trust) {
    node.textContent = "Load ratings to inspect trust state.";
    return;
  }

  const pendingLabel = trust.pendingBy.length === 0 ? "none" : trust.pendingBy.join(", ");
  const buyerAvg =
    trust.reputation?.buyer?.averageScore === null || trust.reputation?.buyer?.averageScore === undefined
      ? "No ratings"
      : `${Number(trust.reputation.buyer.averageScore).toFixed(2)} / 5`;
  const sellerAvg =
    trust.reputation?.seller?.averageScore === null || trust.reputation?.seller?.averageScore === undefined
      ? "No ratings"
      : `${Number(trust.reputation.seller.averageScore).toFixed(2)} / 5`;
  node.innerHTML = `
    <p><strong>Ratings state:</strong> <span class="inline-badge">${escapeHtml(trust.ratingsState)}</span></p>
    <p><strong>Pending by:</strong> ${escapeHtml(pendingLabel)}</p>
    <p><strong>Buyer reputation:</strong> ${escapeHtml(buyerAvg)} (${escapeHtml(trust.reputation?.buyer?.ratingCount ?? 0)} ratings)</p>
    <p><strong>Seller reputation:</strong> ${escapeHtml(sellerAvg)} (${escapeHtml(trust.reputation?.seller?.ratingCount ?? 0)} ratings)</p>
  `;
}

function renderRatingState() {
  const node = qs("#rating-state");
  const tx = state.currentTransaction;
  const trust = state.currentTrust;
  if (!tx) {
    node.textContent = "Load a transaction and ratings to see pending/submitted state.";
    return;
  }
  if (!trust) {
    node.textContent = "Ratings not loaded yet.";
    return;
  }
  const myRole = state.user?.id === tx.buyerId ? "buyer" : state.user?.id === tx.sellerId ? "seller" : "other";
  const alreadySubmitted =
    myRole === "buyer"
      ? Boolean(trust.byRater?.buyer)
      : myRole === "seller"
        ? Boolean(trust.byRater?.seller)
        : false;
  node.innerHTML = `
    <p><strong>Your role:</strong> ${escapeHtml(myRole)}</p>
    <p><strong>Your rating status:</strong> ${escapeHtml(alreadySubmitted ? "submitted" : "pending")}</p>
    <p><strong>Transaction rating status:</strong> ${escapeHtml(trust.ratingsState)}</p>
  `;
}

function renderEvents() {
  const listNode = qs("#events-list");
  listNode.innerHTML = "";

  if (state.currentEvents.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No events loaded.";
    listNode.appendChild(item);
    return;
  }

  for (const event of state.currentEvents) {
    const item = document.createElement("li");
    item.innerHTML = `<span><strong>${escapeHtml(event.eventType)}</strong> at ${escapeHtml(fmtDate(event.occurredAt))}</span><code>${escapeHtml(event.actorId || "system")}</code>`;
    listNode.appendChild(item);
  }
}

function renderEvidence() {
  const listNode = qs("#evidence-list");
  listNode.innerHTML = "";

  if (state.currentEvidence.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No evidence loaded.";
    listNode.appendChild(item);
    return;
  }

  for (const evidence of state.currentEvidence) {
    const item = document.createElement("li");
    const text = document.createElement("span");
    text.textContent = `${evidence.originalFileName} (${evidence.sizeBytes} bytes)`;
    const download = document.createElement("button");
    download.type = "button";
    download.textContent = "Download";
    download.addEventListener("click", async () => {
      try {
        if (!state.token) {
          throw new Error("authentication token is required for evidence download");
        }
        const response = await fetch(
          `/transactions/${encodeURIComponent(evidence.transactionId)}/disputes/evidence/${encodeURIComponent(evidence.id)}/download`,
          {
            method: "GET",
            headers: {
              authorization: `Bearer ${state.token}`
            }
          }
        );
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error ?? `download failed (${response.status})`);
        }
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = evidence.originalFileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(objectUrl);
        log(`downloaded evidence ${evidence.id}`);
      } catch (error) {
        log(error.message, "error");
      }
    });

    const wrap = document.createElement("span");
    wrap.style.display = "flex";
    wrap.style.gap = "10px";
    wrap.append(text, download);

    item.appendChild(wrap);
    listNode.appendChild(item);
  }
}

async function loadDisputeDetail(transactionId) {
  const payload = await apiRequest("GET", `/admin/disputes/${encodeURIComponent(transactionId)}`);
  const detail = payload.dispute;
  const buyerEvidence = detail.evidenceComparison?.buyerEvidence ?? [];
  const sellerEvidence = detail.evidenceComparison?.sellerEvidence ?? [];
  const arbitrationTimeline = Array.isArray(detail.arbitrationTimeline) ? detail.arbitrationTimeline : [];
  const timelineMarkup = arbitrationTimeline
    .slice(0, 8)
    .map(
      (entry) =>
        `<li><code>${escapeHtml(entry.actionType || "-")}</code> · ${escapeHtml(entry.reasonCode || "n/a")} · ${escapeHtml(fmtDate(entry.createdAt))}</li>`
    )
    .join("");
  qs("#admin-dispute-detail").innerHTML = `
    <p><strong>Transaction:</strong> <code>${escapeHtml(detail.transaction.id)}</code></p>
    <p><strong>Status:</strong> ${escapeHtml(detail.transaction.status)}</p>
    <p><strong>Evidence:</strong> ${escapeHtml(detail.evidence.length)}</p>
    <p><strong>Buyer evidence:</strong> ${escapeHtml(buyerEvidence.length)}</p>
    <p><strong>Seller evidence:</strong> ${escapeHtml(sellerEvidence.length)}</p>
    <p><strong>Risk signals:</strong> ${escapeHtml(detail.riskSignals.length)}</p>
    <p><strong>Latest updated:</strong> ${escapeHtml(fmtDate(detail.transaction.updatedAt))}</p>
    <details>
      <summary>Arbitration timeline (${escapeHtml(arbitrationTimeline.length)})</summary>
      <ul class="stack-list">${timelineMarkup || "<li>No arbitration events.</li>"}</ul>
    </details>
  `;
  state.currentTransaction = detail.transaction;
  state.currentTrust = null;
  state.currentEvents = detail.events;
  state.currentEvidence = detail.evidence;
  renderTransactionSummary();
  renderTransactionTrust();
  renderRatingState();
  renderEvents();
  renderEvidence();
}

function renderAdminQueue(disputes) {
  const listNode = qs("#admin-dispute-list");
  listNode.innerHTML = "";

  if (disputes.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No disputes in this queue.";
    listNode.appendChild(item);
    return;
  }

  for (const entry of disputes) {
    const item = document.createElement("li");
    const summary = document.createElement("span");
    summary.textContent = `${entry.transaction.id} | evidence: ${entry.evidenceCount} | updated: ${fmtDate(entry.transaction.updatedAt)}`;

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Open";
    button.addEventListener("click", async () => {
      try {
        await loadDisputeDetail(entry.transaction.id);
        log(`loaded dispute detail ${entry.transaction.id}`);
      } catch (error) {
        log(error.message, "error");
      }
    });

    item.append(summary, button);
    listNode.appendChild(item);
  }
}

async function loadModerationDetail(listingId) {
  const payload = await apiRequest("GET", `/admin/listings/${encodeURIComponent(listingId)}/moderation`);
  state.selectedModerationListingId = payload.listing.id;
  const eventsMarkup = payload.events
    .map(
      (event) =>
        `<li><strong>${escapeHtml(event.toStatus)}</strong> from ${escapeHtml(event.fromStatus || "-" )} at ${escapeHtml(fmtDate(event.createdAt))} <code>${escapeHtml(event.actorId || "system")}</code></li>`
    )
    .join("");
  const reportsMarkup = payload.abuseReports
    .slice(0, 8)
    .map(
      (report) =>
        `<li>${escapeHtml(report.reasonCode)} by <code>${escapeHtml(report.reporterUserId)}</code> at ${escapeHtml(fmtDate(report.createdAt))}</li>`
    )
    .join("");

  qs("#admin-moderation-detail").innerHTML = `
    <p><strong>Listing:</strong> <code>${escapeHtml(payload.listing.id)}</code></p>
    <p><strong>Status:</strong> <span class="inline-badge">${escapeHtml(payload.listing.moderationStatus)}</span></p>
    <p><strong>Reason code:</strong> ${escapeHtml(payload.listing.moderationReasonCode || "-")}</p>
    <p><strong>Open abuse reports:</strong> ${escapeHtml(payload.abuseReports.filter((report) => report.status === "open").length)}</p>
    <details>
      <summary>Moderation timeline (${escapeHtml(payload.events.length)})</summary>
      <ul class="stack-list">${eventsMarkup || "<li>No timeline events.</li>"}</ul>
    </details>
    <details>
      <summary>Latest abuse reports (${escapeHtml(payload.abuseReports.length)})</summary>
      <ul class="stack-list">${reportsMarkup || "<li>No abuse reports.</li>"}</ul>
    </details>
  `;
}

function renderModerationQueue(queue) {
  const listNode = qs("#admin-moderation-list");
  listNode.innerHTML = "";

  if (queue.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No listings in this moderation queue.";
    listNode.appendChild(item);
    return;
  }

  for (const listing of queue) {
    const item = document.createElement("li");
    const summary = document.createElement("span");
    summary.textContent = `${listing.id} | ${listing.moderationStatus} | abuse reports: ${listing.openAbuseReports}`;

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Open";
    button.addEventListener("click", async () => {
      try {
        await loadModerationDetail(listing.id);
        setPanelStatus("#admin-moderation-status-line", `Loaded listing ${listing.id}`);
      } catch (error) {
        setPanelStatus("#admin-moderation-status-line", error.message, "error");
        log(error.message, "error");
      }
    });

    item.append(summary, button);
    listNode.appendChild(item);
  }
}

async function loadTransactionRiskDetail(transactionId) {
  const payload = await apiRequest("GET", `/admin/transactions/${encodeURIComponent(transactionId)}/risk`);
  state.selectedRiskTransactionId = payload.transaction.id;
  state.currentTransaction = payload.transaction;
  state.currentTrust = null;
  renderTransactionSummary();
  renderTransactionTrust();
  renderRatingState();

  const signals = payload.signals
    .slice(0, 10)
    .map(
      (signal) =>
        `<li>${escapeHtml(signal.signalType)} (${escapeHtml(signal.severity)}) at ${escapeHtml(fmtDate(signal.createdAt))}</li>`
    )
    .join("");
  const actions = payload.actions
    .slice(0, 10)
    .map(
      (action) =>
        `<li>${escapeHtml(action.actionType)} by <code>${escapeHtml(action.actorId || "system")}</code> at ${escapeHtml(fmtDate(action.createdAt))}</li>`
    )
    .join("");

  qs("#admin-risk-transaction-detail").innerHTML = `
    <p><strong>Transaction:</strong> <code>${escapeHtml(payload.transaction.id)}</code></p>
    <p><strong>Status:</strong> ${escapeHtml(payload.transaction.status)}</p>
    <p><strong>Risk score:</strong> ${escapeHtml(payload.transaction.riskScore)}</p>
    <p><strong>Risk level:</strong> ${escapeHtml(payload.transaction.riskLevel)}</p>
    <p><strong>Hold status:</strong> ${escapeHtml(payload.transaction.holdStatus || "none")}</p>
    <details>
      <summary>Risk signals (${escapeHtml(payload.signals.length)})</summary>
      <ul class="stack-list">${signals || "<li>No risk signals.</li>"}</ul>
    </details>
    <details>
      <summary>Operator actions (${escapeHtml(payload.actions.length)})</summary>
      <ul class="stack-list">${actions || "<li>No risk operator actions.</li>"}</ul>
    </details>
  `;
}

async function loadAccountRiskDetail(userId) {
  const payload = await apiRequest("GET", `/admin/accounts/${encodeURIComponent(userId)}/risk`);
  const verificationPayload = await apiRequest(
    "GET",
    `/admin/accounts/${encodeURIComponent(userId)}/verification`
  );
  const decisionsPayload = await apiRequest(
    "GET",
    `/admin/accounts/${encodeURIComponent(userId)}/risk/limits?limit=20`
  );
  state.selectedRiskAccountId = payload.account.id;
  const recentLimitDecisions = (decisionsPayload.decisions ?? []).slice(0, 8)
    .map(
      (entry) =>
        `<li>${escapeHtml(entry.checkpoint)} | ${escapeHtml(entry.decision)} (${escapeHtml(entry.reasonCode || "none")}) at ${escapeHtml(fmtDate(entry.createdAt))}</li>`
    )
    .join("");
  const tierEvents = (payload.tierEvents ?? []).slice(0, 8)
    .map(
      (entry) =>
        `<li>${escapeHtml(entry.previousTier || "-")} -> ${escapeHtml(entry.nextTier)} (${escapeHtml(entry.source)}) at ${escapeHtml(fmtDate(entry.createdAt))}</li>`
    )
    .join("");
  const verificationEvents = (verificationPayload.events ?? []).slice(0, 8)
    .map(
      (entry) =>
        `<li>${escapeHtml(entry.fromStatus || "-")} -> ${escapeHtml(entry.toStatus)} by <code>${escapeHtml(entry.actorId)}</code> at ${escapeHtml(fmtDate(entry.createdAt))}</li>`
    )
    .join("");
  qs("#admin-risk-account-detail").innerHTML = `
    <p><strong>Account:</strong> <code>${escapeHtml(payload.account.id)}</code></p>
    <p><strong>Risk tier:</strong> ${escapeHtml(payload.account.riskTier)} (${escapeHtml(payload.account.riskTierSource)})</p>
    <p><strong>Verification:</strong> ${escapeHtml(payload.account.verificationStatus)}</p>
    <details>
      <summary>Risk tier events (${escapeHtml((payload.tierEvents ?? []).length)})</summary>
      <ul class="stack-list">${tierEvents || "<li>No risk-tier events.</li>"}</ul>
    </details>
    <details>
      <summary>Verification events (${escapeHtml((verificationPayload.events ?? []).length)})</summary>
      <ul class="stack-list">${verificationEvents || "<li>No verification events.</li>"}</ul>
    </details>
    <details>
      <summary>Recent limit decisions (${escapeHtml((decisionsPayload.decisions ?? []).length)})</summary>
      <ul class="stack-list">${recentLimitDecisions || "<li>No limit decisions.</li>"}</ul>
    </details>
  `;
}

function renderLaunchControlFlags(flags) {
  const listNode = qs("#launch-control-flag-list");
  listNode.innerHTML = "";
  if (!Array.isArray(flags) || flags.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No launch-control flags found.";
    listNode.appendChild(item);
    return;
  }
  for (const flag of flags) {
    const item = document.createElement("li");
    item.innerHTML = `
      <span><code>${escapeHtml(flag.key)}</code> | enabled: <strong>${escapeHtml(flag.enabled)}</strong> | rollout: ${escapeHtml(flag.rolloutPercentage)}%</span>
      <code>${escapeHtml(flag.updatedAt || "-")}</code>
    `;
    listNode.appendChild(item);
  }
}

async function loadLaunchControlFlags() {
  const payload = await apiRequest("GET", "/admin/launch-control/flags");
  state.launchControlFlags = payload.flags || [];
  renderLaunchControlFlags(state.launchControlFlags);
  log(`loaded ${state.launchControlFlags.length} launch-control flag(s)`);
}

async function loadLaunchControlAudit() {
  const payload = await apiRequest("GET", "/admin/launch-control/audit?limit=50");
  qs("#launch-control-audit-log").textContent = JSON.stringify(payload.events ?? [], null, 2);
  log(`loaded ${(payload.events ?? []).length} launch-control audit event(s)`);
}

async function loadLaunchControlIncidents() {
  const payload = await apiRequest("GET", "/admin/launch-control/incidents?limit=50");
  qs("#launch-control-incident-log").textContent = JSON.stringify(payload.incidents ?? [], null, 2);
  log(`loaded ${(payload.incidents ?? []).length} launch-control incident(s)`);
}

function renderNotifications(notifications) {
  const listNode = qs("#notifications-list");
  listNode.innerHTML = "";

  if (notifications.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No notifications.";
    listNode.appendChild(item);
    return;
  }

  for (const notification of notifications) {
    const item = document.createElement("li");
    const text = document.createElement("span");
    text.textContent = `${notification.topic} | ${notification.status} | txn ${notification.transactionId}`;

    const actions = document.createElement("span");
    actions.style.display = "flex";
    actions.style.gap = "8px";

    const readButton = document.createElement("button");
    readButton.type = "button";
    readButton.textContent = "Read";
    readButton.addEventListener("click", async () => {
      try {
        await apiRequest("POST", `/notifications/${notification.id}/read`, {});
        log(`marked notification ${notification.id} as read`);
        await loadNotifications();
      } catch (error) {
        log(error.message, "error");
      }
    });

    const ackButton = document.createElement("button");
    ackButton.type = "button";
    ackButton.textContent = "Acknowledge";
    ackButton.addEventListener("click", async () => {
      try {
        await apiRequest("POST", `/notifications/${notification.id}/acknowledge`, {});
        log(`acknowledged notification ${notification.id}`);
        await loadNotifications();
      } catch (error) {
        log(error.message, "error");
      }
    });

    actions.append(readButton, ackButton);
    item.append(text, actions);
    listNode.appendChild(item);
  }
}

async function refreshListings() {
  const payload = await apiRequest("GET", "/listings");
  state.listings = payload.listings;
  renderListings();
  renderListingDetail();
  renderListingReputation();
  log(`loaded ${payload.listings.length} listings`);
}

async function loadListingReputation(sellerId) {
  const payload = await apiRequest("GET", `/users/${encodeURIComponent(sellerId)}/reputation`);
  state.selectedListingReputation = payload.reputation;
  renderListingReputation();
}

async function fetchTransaction(transactionId) {
  const payload = await apiRequest("GET", `/transactions/${encodeURIComponent(transactionId)}`);
  state.currentTransaction = payload.transaction;
  renderTransactionSummary();
  state.currentTrust = null;
  renderTransactionTrust();
  renderRatingState();
  try {
    await fetchTrust();
  } catch {
    // Keep transaction view usable even if trust payload is temporarily unavailable.
  }
  log(`loaded transaction ${payload.transaction.id}`);
}

async function fetchTrust() {
  const transactionId = ensureTransactionLoaded();
  const payload = await apiRequest("GET", `/transactions/${encodeURIComponent(transactionId)}/ratings`);
  state.currentTrust = payload.trust;
  renderTransactionTrust();
  renderRatingState();
  log(`loaded ${payload.trust.ratings.length} rating(s) for ${transactionId}`);
}

async function fetchEvents() {
  const transactionId = ensureTransactionLoaded();
  const payload = await apiRequest("GET", `/transactions/${encodeURIComponent(transactionId)}/events`);
  state.currentEvents = payload.events;
  renderEvents();
  log(`loaded ${payload.events.length} events`);
}

async function fetchEvidence() {
  const transactionId = ensureTransactionLoaded();
  const payload = await apiRequest("GET", `/transactions/${encodeURIComponent(transactionId)}/disputes/evidence`);
  state.currentEvidence = payload.evidence;
  renderEvidence();
  log(`loaded ${payload.evidence.length} evidence records`);
}

async function loadNotifications() {
  const payload = await apiRequest("GET", "/notifications");
  renderNotifications(payload.notifications);
  log(`loaded ${payload.notifications.length} notifications`);
}

function bindEvents() {
  qs("#register-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;

    try {
      const payload = await apiRequest("POST", "/auth/register", {
        userId: form.userId.value || undefined,
        email: form.email.value,
        password: form.password.value,
        role: form.role.value
      });
      state.token = payload.token;
      state.user = payload.user;
      renderRoleUI();
      qs("#auth-modal").close();
      log(`registered and signed in as ${payload.user.role}`);
      await refreshListings();
    } catch (error) {
      log(error.message, "error");
    }
  });

  qs("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;

    try {
      const payload = await apiRequest("POST", "/auth/login", {
        email: form.email.value,
        password: form.password.value
      });
      state.token = payload.token;
      state.user = payload.user;
      renderRoleUI();
      qs("#auth-modal").close();
      log(`logged in as ${payload.user.role}`);
      await refreshListings();
    } catch (error) {
      log(error.message, "error");
    }
  });

  qs("#logout-button").addEventListener("click", () => {
    state.token = null;
    state.user = null;
    state.currentTransaction = null;
    state.currentTrust = null;
    state.currentEvents = [];
    state.currentEvidence = [];
    state.selectedListingReputation = null;
    state.selectedModerationListingId = null;
    state.selectedRiskTransactionId = null;
    renderRoleUI();
    renderTransactionSummary();
    renderTransactionTrust();
    renderRatingState();
    renderListingReputation();
    renderEvents();
    renderEvidence();
    setPanelStatus("#admin-moderation-status-line");
    setPanelStatus("#admin-risk-status-line");
    setPanelStatus("#launch-control-status-line");
    setPanelStatus("#rating-status-line");
    setPanelStatus("#closure-status-line");
    log("logged out");
  });

  qs("#open-auth-modal").addEventListener("click", () => {
    qs("#auth-modal").showModal();
  });

  qs("#close-auth-modal").addEventListener("click", () => {
    qs("#auth-modal").close();
  });

  qs("#auth-modal").addEventListener("click", (event) => {
    const dialog = qs("#auth-modal");
    if (event.target === dialog) {
      dialog.close();
    }
  });

  for (const button of document.querySelectorAll(".demo-login")) {
    button.addEventListener("click", () => {
      const email = button.getAttribute("data-email") ?? "";
      const password = button.getAttribute("data-password") ?? "";
      const loginForm = qs("#login-form");
      loginForm.email.value = email;
      loginForm.password.value = password;
      qs("#auth-modal").showModal();
      loginForm.email.focus();
    });
  }

  qs("#refresh-listings").addEventListener("click", async () => {
    try {
      await refreshListings();
    } catch (error) {
      log(error.message, "error");
    }
  });

  qs("#seller-listing-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;

    try {
      const photoUrls = String(form.photoUrls.value ?? "")
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean);
      const payload = await apiRequest("POST", "/listings", {
        listingId: form.listingId.value || undefined,
        title: form.title.value,
        description: form.description.value,
        priceCents: dollarsInputToCents(form.priceDollars.value, "price"),
        localArea: form.localArea.value,
        photoUrls
      });
      log(`created listing ${payload.listing.id}`);
      form.reset();
      await refreshListings();
    } catch (error) {
      log(error.message, "error");
    }
  });

  qs("#listing-photo-upload-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const listingId = form.listingId.value.trim();
    const file = form.file.files?.[0];
    if (!file) {
      log("select a file to upload", "error");
      return;
    }
    try {
      const payload = await apiRequest(
        "POST",
        `/listings/${encodeURIComponent(listingId)}/photos`,
        {
          photoId: form.photoId.value || undefined,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          contentBase64: await fileToBase64(file)
        }
      );
      log(`uploaded listing photo ${payload.photo?.id ?? "unknown"}`);
      form.photoId.value = "";
      form.file.value = "";
      await refreshListings();
    } catch (error) {
      log(error.message, "error");
    }
  });

  qs("#purchase-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;

    try {
      const payload = await apiRequest("POST", "/transactions", {
        transactionId: form.transactionId.value || undefined,
        sellerId: form.sellerId.value,
        amountCents: dollarsInputToCents(form.amountDollars.value, "offer amount")
      });
      state.currentTransaction = payload.transaction;
      state.currentTrust = null;
      renderTransactionSummary();
      renderTransactionTrust();
      renderRatingState();
      log(`created transaction ${payload.transaction.id}`);
    } catch (error) {
      log(error.message, "error");
    }
  });

  qs("#fetch-transaction-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const transactionId = event.currentTarget.transactionId.value;

    try {
      await fetchTransaction(transactionId);
    } catch (error) {
      log(error.message, "error");
    }
  });

  qs("#fetch-events").addEventListener("click", async () => {
    try {
      await fetchEvents();
    } catch (error) {
      log(error.message, "error");
    }
  });

  qs("#fetch-evidence").addEventListener("click", async () => {
    try {
      await fetchEvidence();
    } catch (error) {
      log(error.message, "error");
    }
  });

  qs("#confirm-delivery").addEventListener("click", async () => {
    try {
      const transactionId = ensureTransactionLoaded();
      const confirmed = window.confirm(
        `Confirm delivery for ${transactionId}? This releases settlement and cannot be undone without a dispute workflow.`
      );
      if (!confirmed) {
        return;
      }
      const payload = await apiRequest(
        "POST",
        `/transactions/${encodeURIComponent(transactionId)}/confirm-delivery`,
        {}
      );
      state.currentTransaction = payload.transaction;
      state.currentTrust = null;
      renderTransactionSummary();
      renderTransactionTrust();
      renderRatingState();
      setPanelStatus("#closure-status-line", "Buyer completion confirmation submitted.");
      log("confirmed delivery");
    } catch (error) {
      setPanelStatus("#closure-status-line", error.message, "error");
      log(error.message, "error");
    }
  });

  async function openDisputeAction() {
    const transactionId = ensureTransactionLoaded();
    const confirmed = window.confirm(
      `Open dispute for ${transactionId}? This will divert closure and require admin adjudication.`
    );
    if (!confirmed) {
      return;
    }
    const payload = await apiRequest("POST", `/transactions/${encodeURIComponent(transactionId)}/disputes`, {});
    state.currentTransaction = payload.transaction;
    state.currentTrust = null;
    renderTransactionSummary();
    renderTransactionTrust();
    renderRatingState();
    setPanelStatus("#closure-status-line", "Dispute opened. Closure is now blocked pending resolution.");
    log("opened dispute");
  }

  qs("#open-dispute").addEventListener("click", async () => {
    try {
      await openDisputeAction();
    } catch (error) {
      log(error.message, "error");
    }
  });

  qs("#seller-open-dispute").addEventListener("click", async () => {
    try {
      await openDisputeAction();
    } catch (error) {
      log(error.message, "error");
    }
  });

  qs("#open-dispute-shortcut-buyer").addEventListener("click", async () => {
    try {
      await openDisputeAction();
    } catch (error) {
      log(error.message, "error");
    }
  });

  qs("#open-dispute-shortcut-seller").addEventListener("click", async () => {
    try {
      await openDisputeAction();
    } catch (error) {
      log(error.message, "error");
    }
  });

  qs("#acknowledge-completion").addEventListener("click", async () => {
    try {
      const transactionId = ensureTransactionLoaded();
      const confirmed = window.confirm(
        `Acknowledge completion for ${transactionId} as seller? This audit marker is irreversible.`
      );
      if (!confirmed) {
        return;
      }
      const payload = await apiRequest(
        "POST",
        `/transactions/${encodeURIComponent(transactionId)}/acknowledge-completion`,
        {}
      );
      state.currentTransaction = payload.transaction;
      renderTransactionSummary();
      setPanelStatus("#closure-status-line", "Seller completion acknowledgment recorded.");
      log("seller acknowledged completion");
    } catch (error) {
      setPanelStatus("#closure-status-line", error.message, "error");
      log(error.message, "error");
    }
  });

  qs("#evidence-form").addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      const transactionId = ensureTransactionLoaded();
      const form = event.currentTarget;
      const file = form.file.files?.[0];
      if (!file) {
        throw new Error("select a file for evidence upload");
      }
      const contentBase64 = await fileToBase64(file);
      await apiRequest(
        "POST",
        `/transactions/${encodeURIComponent(transactionId)}/disputes/evidence`,
        {
          evidenceId: form.evidenceId.value || undefined,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          contentBase64
        }
      );
      log(`uploaded evidence for ${transactionId}`);
      await fetchEvidence();
      form.reset();
    } catch (error) {
      log(error.message, "error");
    }
  });

  qs("#resolve-dispute").addEventListener("click", async () => {
    try {
      const transactionId = ensureTransactionLoaded();
      const confirmed = window.confirm(
        `Resolve dispute for ${transactionId} and return transaction to accepted state?`
      );
      if (!confirmed) {
        return;
      }
      const payload = await apiRequest(
        "POST",
        `/transactions/${encodeURIComponent(transactionId)}/disputes/resolve`,
        {}
      );
      state.currentTransaction = payload.transaction;
      state.currentTrust = null;
      renderTransactionSummary();
      renderTransactionTrust();
      renderRatingState();
      log("resolved dispute");
    } catch (error) {
      log(error.message, "error");
    }
  });

  qs("#adjudication-form").addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      const transactionId = ensureTransactionLoaded();
      const form = event.currentTarget;
      const confirmed = window.confirm(
        `Apply adjudication decision \"${form.decision.value}\" for ${transactionId}? This action is recorded in audit history.`
      );
      if (!confirmed) {
        return;
      }
      const payload = await apiRequest(
        "POST",
        `/transactions/${encodeURIComponent(transactionId)}/disputes/adjudicate`,
        {
          decision: form.decision.value,
          reasonCode: form.reasonCode.value || undefined,
          notes: form.notes.value || undefined
        }
      );
      state.currentTransaction = payload.transaction;
      state.currentTrust = null;
      renderTransactionSummary();
      renderTransactionTrust();
      renderRatingState();
      if (payload.decisionTransparency) {
        log(
          `decision transparency: ${payload.decisionTransparency.policyReasonCategory} | appeal closes ${payload.decisionTransparency.appealWindow?.closesAt}`
        );
      }
      log(`adjudicated dispute with ${form.decision.value}`);
      form.reset();
    } catch (error) {
      log(error.message, "error");
    }
  });

  qs("#load-admin-disputes").addEventListener("click", async () => {
    try {
      const filter = qs("#admin-filter").value;
      const payload = await apiRequest(
        "GET",
        `/admin/disputes?filter=${encodeURIComponent(filter)}&sortBy=updatedAt&sortOrder=desc`
      );
      renderAdminQueue(payload.disputes);
      log(`loaded ${payload.disputes.length} admin disputes (${filter})`);
    } catch (error) {
      log(error.message, "error");
    }
  });

  qs("#load-admin-moderation").addEventListener("click", async () => {
    try {
      const status = qs("#admin-moderation-status").value;
      const payload = await apiRequest(
        "GET",
        `/admin/listings/moderation?status=${encodeURIComponent(status)}&limit=100`
      );
      renderModerationQueue(payload.queue);
      setPanelStatus("#admin-moderation-status-line", `Loaded ${payload.queue.length} queue item(s).`);
      log(`loaded ${payload.queue.length} moderation listings (${status})`);
    } catch (error) {
      setPanelStatus("#admin-moderation-status-line", error.message, "error");
      log(error.message, "error");
    }
  });

  qs("#admin-moderation-action-form").addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      if (!state.selectedModerationListingId) {
        throw new Error("load a listing moderation detail first");
      }

      const form = event.currentTarget;
      const action = form.action.value;
      const warning =
        action === "reject"
          ? "Reject listing and remove it from public feed?"
          : action === "hide"
            ? "Hide listing from public feed immediately?"
            : `Apply moderation action \"${action}\"?`;
      if (!window.confirm(warning)) {
        return;
      }

      const previousDetail = qs("#admin-moderation-detail").innerHTML;
      qs("#admin-moderation-detail").innerHTML = `${previousDetail}<p class=\"status\">Applying ${escapeHtml(action)}...</p>`;
      setPanelStatus("#admin-moderation-status-line", `Applying ${action} action...`);

      await apiRequest(
        "POST",
        `/admin/listings/${encodeURIComponent(state.selectedModerationListingId)}/moderation/${encodeURIComponent(action)}`,
        {
          reasonCode: form.reasonCode.value || undefined,
          publicReason: form.publicReason.value || undefined,
          notes: form.notes.value || undefined
        }
      );

      await loadModerationDetail(state.selectedModerationListingId);
      const status = qs("#admin-moderation-status").value;
      const refreshedQueue = await apiRequest(
        "GET",
        `/admin/listings/moderation?status=${encodeURIComponent(status)}&limit=100`
      );
      renderModerationQueue(refreshedQueue.queue);
      setPanelStatus("#admin-moderation-status-line", `Applied ${action} to ${state.selectedModerationListingId}.`);
      log(`admin moderation action ${action} on ${state.selectedModerationListingId}`);
    } catch (error) {
      setPanelStatus("#admin-moderation-status-line", error.message, "error");
      log(error.message, "error");
    }
  });

  qs("#admin-risk-transaction-form").addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      const transactionId = event.currentTarget.transactionId.value;
      await loadTransactionRiskDetail(transactionId);
      setPanelStatus("#admin-risk-status-line", `Loaded risk detail for ${transactionId}.`);
      log(`loaded risk detail ${transactionId}`);
    } catch (error) {
      setPanelStatus("#admin-risk-status-line", error.message, "error");
      log(error.message, "error");
    }
  });

  qs("#admin-risk-action-form").addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      if (!state.selectedRiskTransactionId) {
        throw new Error("load a transaction risk detail first");
      }

      const form = event.currentTarget;
      const action = form.action.value;
      const reason = form.reason.value.trim();
      if (!reason) {
        throw new Error("reason is required for risk interventions");
      }
      const confirmed = window.confirm(
        `${action === "hold" ? "Place hold" : "Release hold"} on ${state.selectedRiskTransactionId}?`
      );
      if (!confirmed) {
        return;
      }

      setPanelStatus("#admin-risk-status-line", `Applying ${action} intervention...`);
      const endpoint =
        action === "hold"
          ? `/admin/transactions/${encodeURIComponent(state.selectedRiskTransactionId)}/risk/hold`
          : `/admin/transactions/${encodeURIComponent(state.selectedRiskTransactionId)}/risk/unhold`;

      const payload = await apiRequest("POST", endpoint, {
        reason,
        notes: form.notes.value || undefined
      });

      state.currentTransaction = payload.transaction;
      renderTransactionSummary();
      state.currentTrust = null;
      renderTransactionTrust();
      renderRatingState();
      await loadTransactionRiskDetail(state.selectedRiskTransactionId);
      setPanelStatus("#admin-risk-status-line", `Applied ${action} on ${state.selectedRiskTransactionId}.`);
      log(`admin risk action ${action} on ${state.selectedRiskTransactionId}`);
      form.notes.value = "";
    } catch (error) {
      setPanelStatus("#admin-risk-status-line", error.message, "error");
      log(error.message, "error");
    }
  });

  qs("#admin-risk-account-form").addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      const userId = event.currentTarget.userId.value;
      await loadAccountRiskDetail(userId);
      setPanelStatus("#admin-risk-account-status-line", `Loaded account risk detail for ${userId}.`);
      log(`loaded account risk detail ${userId}`);
    } catch (error) {
      setPanelStatus("#admin-risk-account-status-line", error.message, "error");
      log(error.message, "error");
    }
  });

  qs("#admin-risk-account-action-form").addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      if (!state.selectedRiskAccountId) {
        throw new Error("load an account risk detail first");
      }

      const form = event.currentTarget;
      const action = form.action.value;
      const reason = form.reason.value.trim();
      if (!reason) {
        throw new Error("reason is required");
      }
      setPanelStatus("#admin-risk-account-status-line", `Applying ${action} on ${state.selectedRiskAccountId}...`);

      let endpoint = "";
      let payload = {
        reason,
        notes: form.notes.value || undefined
      };
      if (action === "approve-verification") {
        endpoint = `/admin/accounts/${encodeURIComponent(state.selectedRiskAccountId)}/verification/approve`;
      } else if (action === "reject-verification") {
        endpoint = `/admin/accounts/${encodeURIComponent(state.selectedRiskAccountId)}/verification/reject`;
      } else if (action === "override-tier") {
        endpoint = `/admin/accounts/${encodeURIComponent(state.selectedRiskAccountId)}/risk/override-tier`;
        payload = {
          ...payload,
          tier: form.tier.value
        };
      } else if (action === "clear-tier-override") {
        endpoint = `/admin/accounts/${encodeURIComponent(state.selectedRiskAccountId)}/risk/clear-tier-override`;
      } else {
        throw new Error(`unsupported action: ${action}`);
      }

      await apiRequest("POST", endpoint, payload);
      await loadAccountRiskDetail(state.selectedRiskAccountId);
      setPanelStatus(
        "#admin-risk-account-status-line",
        `Applied ${action} on ${state.selectedRiskAccountId}.`
      );
      log(`admin account risk action ${action} on ${state.selectedRiskAccountId}`);
      form.notes.value = "";
    } catch (error) {
      setPanelStatus("#admin-risk-account-status-line", error.message, "error");
      log(error.message, "error");
    }
  });

  qs("#load-launch-control-flags").addEventListener("click", async () => {
    try {
      await loadLaunchControlFlags();
      setPanelStatus("#launch-control-status-line", "Loaded launch-control flags.");
    } catch (error) {
      setPanelStatus("#launch-control-status-line", error.message, "error");
      log(error.message, "error");
    }
  });

  qs("#load-launch-control-audit").addEventListener("click", async () => {
    try {
      await loadLaunchControlAudit();
      setPanelStatus("#launch-control-status-line", "Loaded launch-control audit events.");
    } catch (error) {
      setPanelStatus("#launch-control-status-line", error.message, "error");
      log(error.message, "error");
    }
  });

  qs("#load-launch-control-incidents").addEventListener("click", async () => {
    try {
      await loadLaunchControlIncidents();
      setPanelStatus("#launch-control-status-line", "Loaded launch-control incidents.");
    } catch (error) {
      setPanelStatus("#launch-control-status-line", error.message, "error");
      log(error.message, "error");
    }
  });

  qs("#launch-control-flag-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const form = event.currentTarget;
      const key = form.key.value;
      const rolloutPercentageRaw = String(form.rolloutPercentage.value || "").trim();
      const allowlistUserIds = String(form.allowlistUserIds.value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const regionAllowlist = String(form.regionAllowlist.value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      await apiRequest("POST", `/admin/launch-control/flags/${encodeURIComponent(key)}`, {
        enabled: form.enabled.value === "true",
        rolloutPercentage: rolloutPercentageRaw === "" ? undefined : Number(rolloutPercentageRaw),
        allowlistUserIds,
        regionAllowlist,
        reason: form.reason.value,
        deploymentRunId: form.deploymentRunId.value || undefined
      });
      await loadLaunchControlFlags();
      await loadLaunchControlAudit();
      setPanelStatus("#launch-control-status-line", `Updated ${key}.`);
      log(`updated launch-control flag ${key}`);
    } catch (error) {
      setPanelStatus("#launch-control-status-line", error.message, "error");
      log(error.message, "error");
    }
  });

  qs("#launch-control-rollback-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const form = event.currentTarget;
      const payload = await apiRequest("POST", "/jobs/launch-control/auto-rollback", {
        incidentKey: form.incidentKey.value || undefined,
        reason: form.reason.value || undefined,
        force: form.force.value === "true"
      });
      await loadLaunchControlFlags();
      await loadLaunchControlAudit();
      await loadLaunchControlIncidents();
      setPanelStatus(
        "#launch-control-status-line",
        payload.triggered
          ? `Auto rollback triggered (${(payload.breachReasons || []).join(", ")}).`
          : "No rollback triggered."
      );
      log(
        payload.triggered
          ? `launch-control auto rollback triggered: ${(payload.breachReasons || []).join(", ")}`
          : "launch-control auto rollback completed without trigger"
      );
    } catch (error) {
      setPanelStatus("#launch-control-status-line", error.message, "error");
      log(error.message, "error");
    }
  });

  qs("#load-notifications").addEventListener("click", async () => {
    try {
      await loadNotifications();
    } catch (error) {
      log(error.message, "error");
    }
  });

  qs("#load-ratings").addEventListener("click", async () => {
    try {
      await fetchTrust();
      setPanelStatus("#rating-status-line", "Ratings loaded.");
    } catch (error) {
      setPanelStatus("#rating-status-line", error.message, "error");
      log(error.message, "error");
    }
  });

  qs("#rating-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const transactionId = ensureTransactionLoaded();
      const form = event.currentTarget;
      const payload = await apiRequest(
        "POST",
        `/transactions/${encodeURIComponent(transactionId)}/ratings`,
        {
          score: Number(form.score.value),
          comment: form.comment.value || undefined
        }
      );
      state.currentTrust = payload.trust;
      renderTransactionTrust();
      renderRatingState();
      setPanelStatus("#rating-status-line", "Rating submitted.");
      form.comment.value = "";
      log(`submitted rating for ${transactionId}`);
    } catch (error) {
      setPanelStatus("#rating-status-line", error.message, "error");
      log(error.message, "error");
    }
  });
}

async function init() {
  renderRoleUI();
  renderListings();
  renderListingDetail();
  renderListingReputation();
  renderTransactionSummary();
  renderTransactionTrust();
  renderRatingState();
  renderEvents();
  renderEvidence();
  bindEvents();

  try {
    await refreshListings();
  } catch (error) {
    log(error.message, "error");
  }
}

void init();
