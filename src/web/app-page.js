export function renderWebAppPage() {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>GreJiJi Marketplace Console</title>
    <link rel="stylesheet" href="/app/styles.css" />
  </head>
  <body>
    <div class="bg-orb bg-orb-a" aria-hidden="true"></div>
    <div class="bg-orb bg-orb-b" aria-hidden="true"></div>
    <main class="shell">
      <header class="hero">
        <p class="eyebrow">GreJiJi Web</p>
        <h1>Buyer and seller lifecycle cockpit</h1>
        <p class="lede">
          Run account auth, listing, purchase, disputes, adjudication, and settlement checks against the live API.
        </p>
      </header>

      <section class="panel" id="auth-panel">
        <h2>Authentication</h2>
        <p class="status" id="auth-status">Sign in to unlock role-aware controls.</p>

        <div class="grid two">
          <form id="register-form" class="card">
            <h3>Create account</h3>
            <label>User ID <input name="userId" placeholder="optional-user-id" /></label>
            <label>Email <input required name="email" type="email" /></label>
            <label>Password <input required name="password" type="password" minlength="8" /></label>
            <label>Role
              <select name="role" required>
                <option value="buyer">buyer</option>
                <option value="seller">seller</option>
                <option value="admin">admin</option>
              </select>
            </label>
            <button type="submit">Register</button>
          </form>

          <form id="login-form" class="card">
            <h3>Sign in</h3>
            <label>Email <input required name="email" type="email" /></label>
            <label>Password <input required name="password" type="password" /></label>
            <button type="submit">Login</button>
            <button type="button" class="ghost" id="logout-button">Logout</button>
          </form>
        </div>
      </section>

      <section class="panel" id="listings-panel">
        <h2>Listings Marketplace</h2>
        <div class="actions">
          <button type="button" id="refresh-listings">Refresh listings</button>
        </div>
        <div class="grid two">
          <div class="card">
            <h3>Available listings</h3>
            <ul id="listings-list" class="list"></ul>
          </div>
          <div class="card" id="listing-detail-card">
            <h3>Listing detail</h3>
            <div id="listing-detail">Select a listing to view details.</div>
          </div>
        </div>

        <form id="seller-listing-form" class="card role-seller" hidden>
          <h3>Seller: create listing</h3>
          <label>Listing ID <input name="listingId" placeholder="optional-listing-id" /></label>
          <label>Title <input required name="title" /></label>
          <label>Description <textarea name="description" rows="3"></textarea></label>
          <label>Price (cents) <input required name="priceCents" type="number" min="1" step="1" /></label>
          <label>Local area <input required name="localArea" /></label>
          <button type="submit">Create listing</button>
        </form>
      </section>

      <section class="panel role-buyer role-seller role-admin" id="transaction-panel" hidden>
        <h2>Transaction Workspace</h2>
        <div class="grid three">
          <form id="purchase-form" class="card role-buyer" hidden>
            <h3>Buyer: purchase selected listing</h3>
            <label>Transaction ID <input name="transactionId" placeholder="optional-transaction-id" /></label>
            <label>Seller ID <input name="sellerId" required /></label>
            <label>Amount cents <input name="amountCents" required type="number" min="1" step="1" /></label>
            <button type="submit">Create transaction</button>
          </form>

          <form id="fetch-transaction-form" class="card">
            <h3>Load transaction</h3>
            <label>Transaction ID <input name="transactionId" required /></label>
            <button type="submit">Fetch transaction</button>
            <button type="button" class="ghost" id="fetch-events">Fetch event history</button>
          </form>

          <div class="card">
            <h3>Transaction summary</h3>
            <div id="transaction-summary">Load a transaction to inspect lifecycle state.</div>
          </div>
        </div>

        <div class="grid two">
          <div class="card">
            <h3>Participant actions</h3>
            <div class="button-row role-buyer" hidden>
              <button type="button" id="confirm-delivery">Buyer confirm delivery</button>
              <button type="button" id="open-dispute">Open dispute</button>
            </div>
            <div class="button-row role-seller" hidden>
              <button type="button" id="seller-open-dispute">Seller open dispute</button>
            </div>

            <form id="evidence-form" class="stack">
              <h4>Upload dispute evidence</h4>
              <label>Evidence ID <input name="evidenceId" placeholder="optional-evidence-id" /></label>
              <label>File <input required name="file" type="file" /></label>
              <button type="submit">Upload evidence</button>
            </form>
            <button type="button" class="ghost" id="fetch-evidence">List evidence</button>
          </div>

          <div class="card role-admin" hidden>
            <h3>Admin adjudication</h3>
            <button type="button" id="resolve-dispute">Resolve dispute</button>
            <form id="adjudication-form" class="stack">
              <label>Decision
                <select name="decision" required>
                  <option value="release_to_seller">release_to_seller</option>
                  <option value="refund_to_buyer">refund_to_buyer</option>
                  <option value="cancel_transaction">cancel_transaction</option>
                </select>
              </label>
              <label>Notes <textarea name="notes" rows="3"></textarea></label>
              <button type="submit">Adjudicate dispute</button>
            </form>
          </div>
        </div>

        <div class="grid two">
          <div class="card">
            <h3>Event timeline</h3>
            <ul id="events-list" class="list"></ul>
          </div>
          <div class="card">
            <h3>Evidence list</h3>
            <ul id="evidence-list" class="list"></ul>
          </div>
        </div>
      </section>

      <section class="panel role-admin" id="admin-disputes-panel" hidden>
        <h2>Admin Dispute Queue</h2>
        <div class="actions">
          <label>Filter
            <select id="admin-filter">
              <option value="open">open</option>
              <option value="needs_evidence">needs_evidence</option>
              <option value="awaiting_decision">awaiting_decision</option>
              <option value="resolved">resolved</option>
            </select>
          </label>
          <button type="button" id="load-admin-disputes">Load queue</button>
        </div>
        <div class="grid two">
          <div class="card">
            <h3>Queue entries</h3>
            <ul id="admin-dispute-list" class="list"></ul>
          </div>
          <div class="card">
            <h3>Selected dispute detail</h3>
            <div id="admin-dispute-detail">Select a queue entry to load detail.</div>
          </div>
        </div>
      </section>

      <section class="panel role-buyer role-seller role-admin" id="notifications-panel" hidden>
        <h2>Notification Inbox</h2>
        <div class="actions">
          <button type="button" id="load-notifications">Load notifications</button>
        </div>
        <ul id="notifications-list" class="list"></ul>
      </section>

      <section class="panel">
        <h2>Activity log</h2>
        <pre id="activity-log" class="log" aria-live="polite"></pre>
      </section>
    </main>

    <script type="module" src="/app/client.js"></script>
  </body>
</html>`;
}
