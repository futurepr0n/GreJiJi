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
        <h1>Marketplace operations console</h1>
        <p class="lede">
          Run buyer/seller lifecycle checks and admin moderation, dispute, and risk interventions against the live API.
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
            <div id="listing-reputation" class="subtle-box">Seller reputation will appear after listing selection.</div>
          </div>
        </div>

        <form id="seller-listing-form" class="card role-seller" hidden>
          <h3>Seller: create listing</h3>
          <label>Listing ID <input name="listingId" placeholder="optional-listing-id" /></label>
          <label>Title <input required name="title" /></label>
          <label>Description <textarea name="description" rows="3"></textarea></label>
          <label>Price (cents) <input required name="priceCents" type="number" min="1" step="1" /></label>
          <label>Local area <input required name="localArea" /></label>
          <label>Photo URLs (one per line) <textarea name="photoUrls" rows="3" placeholder="https://example.com/photo-1.jpg"></textarea></label>
          <button type="submit">Create listing</button>
        </form>

        <form id="listing-photo-upload-form" class="card role-seller" hidden>
          <h3>Seller: upload listing photo</h3>
          <label>Listing ID <input required name="listingId" placeholder="listing-id" /></label>
          <label>Photo ID <input name="photoId" placeholder="optional-photo-id" /></label>
          <label>File <input required name="file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" /></label>
          <button type="submit">Upload photo</button>
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
            <div id="transaction-trust" class="subtle-box">Transaction trust state appears after loading ratings.</div>
          </div>
        </div>

        <div class="grid two">
          <div class="card">
            <h3>Participant actions</h3>
            <div class="button-row role-buyer" hidden>
              <button type="button" id="confirm-delivery">Buyer confirm delivery</button>
              <button type="button" id="open-dispute">Open dispute</button>
              <button type="button" class="ghost" id="open-dispute-shortcut-buyer">Dispute shortcut</button>
            </div>
            <div class="button-row role-seller" hidden>
              <button type="button" id="seller-open-dispute">Seller open dispute</button>
              <button type="button" id="acknowledge-completion">Seller acknowledge completion</button>
              <button type="button" class="ghost" id="open-dispute-shortcut-seller">Dispute shortcut</button>
            </div>
            <p class="status" id="closure-status-line"></p>

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
              <label>Reason code <input name="reasonCode" placeholder="delivery_verified" /></label>
              <label>Notes <textarea name="notes" rows="3"></textarea></label>
              <button type="submit">Adjudicate dispute</button>
            </form>
          </div>
        </div>

        <div class="grid two">
          <form id="rating-form" class="card role-buyer role-seller" hidden>
            <h3>Submit rating</h3>
            <p class="status" id="rating-status-line"></p>
            <label>Score
              <select name="score" required>
                <option value="5">5</option>
                <option value="4">4</option>
                <option value="3">3</option>
                <option value="2">2</option>
                <option value="1">1</option>
              </select>
            </label>
            <label>Comment <textarea name="comment" rows="3" placeholder="Optional feedback"></textarea></label>
            <button type="submit">Submit rating</button>
          </form>
          <div class="card">
            <h3>Rating status</h3>
            <div id="rating-state">Load a transaction and ratings to see pending/submitted state.</div>
            <button type="button" class="ghost" id="load-ratings">Load ratings</button>
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

      <section class="panel role-admin" id="admin-moderation-panel" hidden>
        <h2>Admin Listing Moderation</h2>
        <div class="actions">
          <label>Status
            <select id="admin-moderation-status">
              <option value="pending_review">pending_review</option>
              <option value="temporarily_hidden">temporarily_hidden</option>
              <option value="rejected">rejected</option>
              <option value="approved">approved</option>
            </select>
          </label>
          <button type="button" id="load-admin-moderation">Load queue</button>
        </div>
        <div class="grid two">
          <div class="card">
            <h3>Queue entries</h3>
            <ul id="admin-moderation-list" class="list"></ul>
          </div>
          <div class="card">
            <h3>Selected listing detail</h3>
            <div id="admin-moderation-detail">Select a queue entry to load detail.</div>
            <form id="admin-moderation-action-form" class="stack">
              <label>Action
                <select name="action" required>
                  <option value="approve">approve</option>
                  <option value="reject">reject</option>
                  <option value="hide">hide</option>
                  <option value="unhide">unhide</option>
                </select>
              </label>
              <label>Reason code <input name="reasonCode" placeholder="manual_review" /></label>
              <label>Public reason <input name="publicReason" placeholder="Optional public-facing reason" /></label>
              <label>Operator notes <textarea name="notes" rows="3" placeholder="Required for irreversible decisions"></textarea></label>
              <button type="submit">Apply moderation action</button>
            </form>
            <p class="status" id="admin-moderation-status-line"></p>
          </div>
        </div>
      </section>

      <section class="panel role-admin" id="admin-risk-panel" hidden>
        <h2>Admin Risk Interventions</h2>
        <div class="grid two">
          <form id="admin-risk-transaction-form" class="card">
            <h3>Transaction risk detail</h3>
            <label>Transaction ID <input required name="transactionId" /></label>
            <button type="submit">Load risk detail</button>
            <div id="admin-risk-transaction-detail">Load a transaction to view risk profile and action history.</div>
          </form>
          <form id="admin-risk-action-form" class="card">
            <h3>Transaction intervention</h3>
            <label>Action
              <select name="action" required>
                <option value="hold">hold</option>
                <option value="unhold">unhold</option>
              </select>
            </label>
            <label>Reason <input required name="reason" placeholder="manual review reason" /></label>
            <label>Notes <textarea name="notes" rows="3" placeholder="Operator context for audit trail"></textarea></label>
            <button type="submit">Apply intervention</button>
            <p class="status" id="admin-risk-status-line"></p>
          </form>
        </div>
        <div class="grid two">
          <form id="admin-risk-account-form" class="card">
            <h3>Account risk + verification</h3>
            <label>User ID <input required name="userId" /></label>
            <button type="submit">Load account risk detail</button>
            <div id="admin-risk-account-detail">Load an account to review tier, verification state, and recent limit decisions.</div>
          </form>
          <form id="admin-risk-account-action-form" class="card">
            <h3>Account controls</h3>
            <label>Action
              <select name="action" required>
                <option value="approve-verification">approve-verification</option>
                <option value="reject-verification">reject-verification</option>
                <option value="override-tier">override-tier</option>
                <option value="clear-tier-override">clear-tier-override</option>
              </select>
            </label>
            <label>Tier (override only)
              <select name="tier">
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </label>
            <label>Reason <input required name="reason" placeholder="operator reason" /></label>
            <label>Notes <textarea name="notes" rows="3" placeholder="optional operator notes"></textarea></label>
            <button type="submit">Apply account control</button>
            <p class="status" id="admin-risk-account-status-line"></p>
          </form>
        </div>
      </section>

      <section class="panel role-admin" id="admin-launch-control-panel" hidden>
        <h2>Launch Control</h2>
        <div class="actions">
          <button type="button" id="load-launch-control-flags">Load flags</button>
          <button type="button" id="load-launch-control-audit">Load audit</button>
          <button type="button" id="load-launch-control-incidents">Load incidents</button>
        </div>
        <div class="grid two">
          <div class="card">
            <h3>Flags</h3>
            <ul id="launch-control-flag-list" class="list"></ul>
          </div>
          <form id="launch-control-flag-form" class="card stack">
            <h3>Flag update</h3>
            <label>Flag key
              <select name="key" required>
                <option value="transaction_initiation">transaction_initiation</option>
                <option value="payout_release">payout_release</option>
                <option value="dispute_auto_transitions">dispute_auto_transitions</option>
                <option value="moderation_auto_actions">moderation_auto_actions</option>
              </select>
            </label>
            <label>Enabled
              <select name="enabled" required>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            </label>
            <label>Rollout % <input name="rolloutPercentage" type="number" min="0" max="100" value="100" /></label>
            <label>Allowlist users (comma-separated) <input name="allowlistUserIds" placeholder="user-a,user-b" /></label>
            <label>Region allowlist (comma-separated) <input name="regionAllowlist" placeholder="CA-ON,US-NY" /></label>
            <label>Reason <input name="reason" required placeholder="why this change is needed" /></label>
            <label>Deployment run id <input name="deploymentRunId" placeholder="optional deployment run id" /></label>
            <button type="submit">Apply launch flag update</button>
            <p class="status" id="launch-control-status-line"></p>
          </form>
        </div>
        <div class="grid two">
          <div class="card">
            <h3>Audit events</h3>
            <pre id="launch-control-audit-log" class="log"></pre>
          </div>
          <div class="card">
            <h3>Incidents</h3>
            <pre id="launch-control-incident-log" class="log"></pre>
            <form id="launch-control-rollback-form" class="stack">
              <label>Incident key <input name="incidentKey" placeholder="optional stable incident key" /></label>
              <label>Reason <input name="reason" placeholder="optional operator context" /></label>
              <label>Force rollback
                <select name="force">
                  <option value="false">false</option>
                  <option value="true">true</option>
                </select>
              </label>
              <button type="submit">Run auto-rollback hook</button>
            </form>
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
