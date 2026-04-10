const state = {
  token: null,
  user: null,
  listings: [],
  selectedListing: null,
  currentTransaction: null,
  currentEvents: [],
  currentEvidence: []
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

  const authStatus = qs("#auth-status");
  authStatus.textContent = role
    ? `Signed in as ${state.user.email} (${role})`
    : "Sign in to unlock role-aware controls.";
}

function renderListingDetail() {
  const detailNode = qs("#listing-detail");
  const listing = state.selectedListing;
  if (!listing) {
    detailNode.textContent = "Select a listing to view details.";
    return;
  }

  detailNode.innerHTML = `
    <p><strong>${listing.title}</strong> <span class="inline-badge">${listing.localArea}</span></p>
    <p>${listing.description || "No description"}</p>
    <p>Seller: <code>${listing.sellerId}</code></p>
    <p>Price: <strong>${toUsdLike(listing.priceCents, "USD")}</strong> (${listing.priceCents} cents)</p>
    <p>Updated: ${fmtDate(listing.updatedAt)}</p>
  `;

  const purchaseForm = qs("#purchase-form");
  purchaseForm.sellerId.value = listing.sellerId;
  purchaseForm.amountCents.value = String(listing.priceCents);
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
      renderListingDetail();
      log(`selected listing ${listing.id}`);
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
    <p><strong>ID:</strong> <code>${tx.id}</code></p>
    <p><strong>Status:</strong> <span class="inline-badge">${tx.status}</span></p>
    <p><strong>Buyer:</strong> <code>${tx.buyerId}</code></p>
    <p><strong>Seller:</strong> <code>${tx.sellerId}</code></p>
    <p><strong>Item price:</strong> ${toUsdLike(tx.itemPrice, tx.currency)}</p>
    <p><strong>Service fee:</strong> ${toUsdLike(tx.serviceFee, tx.currency)}</p>
    <p><strong>Total buyer charge:</strong> ${toUsdLike(tx.totalBuyerCharge, tx.currency)}</p>
    <p><strong>Seller net:</strong> ${toUsdLike(tx.sellerNet, tx.currency)}</p>
    <p><strong>Settlement outcome:</strong> ${tx.settlementOutcome || "pending"}</p>
    <p><strong>Updated at:</strong> ${fmtDate(tx.updatedAt)}</p>
  `;

  qs("#fetch-transaction-form").transactionId.value = tx.id;
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
    item.innerHTML = `<span><strong>${event.eventType}</strong> at ${fmtDate(event.occurredAt)}</span><code>${event.actorId || "system"}</code>`;
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
        const payload = await apiRequest(
          "GET",
          `/admin/disputes/${encodeURIComponent(entry.transaction.id)}`
        );
        const detail = payload.dispute;
        qs("#admin-dispute-detail").innerHTML = `
          <p><strong>Transaction:</strong> <code>${detail.transaction.id}</code></p>
          <p><strong>Status:</strong> ${detail.transaction.status}</p>
          <p><strong>Evidence:</strong> ${detail.evidence.length}</p>
          <p><strong>Adjudication actions:</strong> ${detail.adjudicationActions.length}</p>
          <p><strong>Latest updated:</strong> ${fmtDate(detail.transaction.updatedAt)}</p>
        `;
        state.currentTransaction = detail.transaction;
        state.currentEvents = detail.events;
        state.currentEvidence = detail.evidence;
        renderTransactionSummary();
        renderEvents();
        renderEvidence();
      } catch (error) {
        log(error.message, "error");
      }
    });

    item.append(summary, button);
    listNode.appendChild(item);
  }
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
  log(`loaded ${payload.listings.length} listings`);
}

async function fetchTransaction(transactionId) {
  const payload = await apiRequest("GET", `/transactions/${encodeURIComponent(transactionId)}`);
  state.currentTransaction = payload.transaction;
  renderTransactionSummary();
  log(`loaded transaction ${payload.transaction.id}`);
}

async function fetchEvents() {
  const transactionId = ensureTransactionLoaded();
  const payload = await apiRequest(
    "GET",
    `/transactions/${encodeURIComponent(transactionId)}/events`
  );
  state.currentEvents = payload.events;
  renderEvents();
  log(`loaded ${payload.events.length} events`);
}

async function fetchEvidence() {
  const transactionId = ensureTransactionLoaded();
  const payload = await apiRequest(
    "GET",
    `/transactions/${encodeURIComponent(transactionId)}/disputes/evidence`
  );
  state.currentEvidence = payload.evidence;
  renderEvidence();
  log(`loaded ${payload.evidence.length} evidence records`);
}

async function loadNotifications() {
  const payload = await apiRequest("GET", "/notifications");
  renderNotifications(payload.notifications);
  log(`loaded ${payload.notifications.length} notifications`);
}

async function fileToBase64(file) {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
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
    state.currentEvents = [];
    state.currentEvidence = [];
    renderRoleUI();
    renderTransactionSummary();
    renderEvents();
    renderEvidence();
    log("logged out");
  });

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
      const payload = await apiRequest("POST", "/listings", {
        listingId: form.listingId.value || undefined,
        title: form.title.value,
        description: form.description.value,
        priceCents: Number(form.priceCents.value),
        localArea: form.localArea.value
      });
      log(`created listing ${payload.listing.id}`);
      form.reset();
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
        amountCents: Number(form.amountCents.value)
      });
      state.currentTransaction = payload.transaction;
      renderTransactionSummary();
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
      const payload = await apiRequest(
        "POST",
        `/transactions/${encodeURIComponent(transactionId)}/confirm-delivery`,
        {}
      );
      state.currentTransaction = payload.transaction;
      renderTransactionSummary();
      log("confirmed delivery");
    } catch (error) {
      log(error.message, "error");
    }
  });

  async function openDisputeAction() {
    const transactionId = ensureTransactionLoaded();
    const payload = await apiRequest(
      "POST",
      `/transactions/${encodeURIComponent(transactionId)}/disputes`,
      {}
    );
    state.currentTransaction = payload.transaction;
    renderTransactionSummary();
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
      const payload = await apiRequest(
        "POST",
        `/transactions/${encodeURIComponent(transactionId)}/disputes/resolve`,
        {}
      );
      state.currentTransaction = payload.transaction;
      renderTransactionSummary();
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
      const payload = await apiRequest(
        "POST",
        `/transactions/${encodeURIComponent(transactionId)}/disputes/adjudicate`,
        {
          decision: form.decision.value,
          notes: form.notes.value || undefined
        }
      );
      state.currentTransaction = payload.transaction;
      renderTransactionSummary();
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

  qs("#load-notifications").addEventListener("click", async () => {
    try {
      await loadNotifications();
    } catch (error) {
      log(error.message, "error");
    }
  });
}

async function init() {
  renderRoleUI();
  renderListings();
  renderListingDetail();
  renderTransactionSummary();
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
