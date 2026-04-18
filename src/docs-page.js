export function renderDocsPage() {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>GreJiJi API Docs</title>
    <style>
      :root {
        --bg: #f4efe7;
        --panel: rgba(255, 252, 247, 0.92);
        --panel-strong: #fffaf2;
        --text: #1f2933;
        --muted: #52606d;
        --accent: #8f3b1b;
        --accent-soft: #f7d7c8;
        --border: rgba(143, 59, 27, 0.18);
        --shadow: 0 20px 60px rgba(73, 38, 18, 0.12);
        --code: #fff4e8;
      }

      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Georgia", "Times New Roman", serif;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(195, 122, 74, 0.16), transparent 32%),
          radial-gradient(circle at top right, rgba(73, 127, 106, 0.12), transparent 28%),
          linear-gradient(180deg, #f8f1e7 0%, var(--bg) 100%);
      }

      a { color: var(--accent); }
      code, pre { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; }

      .shell {
        max-width: 1120px;
        margin: 0 auto;
        padding: 24px;
      }

      header[role="banner"] {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 28px;
        box-shadow: var(--shadow);
        padding: 32px;
        overflow: hidden;
        position: relative;
      }

      header[role="banner"]::after {
        content: "";
        position: absolute;
        inset: auto -40px -60px auto;
        width: 220px;
        height: 220px;
        background: radial-gradient(circle, rgba(143, 59, 27, 0.18), transparent 65%);
      }

      .eyebrow {
        color: var(--accent);
        font-size: 0.85rem;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        margin: 0 0 12px;
      }

      h1, h2, h3 {
        line-height: 1.1;
        margin: 0 0 12px;
      }

      h1 { font-size: clamp(2.4rem, 5vw, 4.4rem); max-width: 10ch; }
      h2 { font-size: clamp(1.6rem, 2vw, 2.2rem); margin-top: 0; }
      h3 { font-size: 1.1rem; }

      p, li { font-size: 1rem; line-height: 1.7; }
      .lede { max-width: 62ch; color: var(--muted); }

      .grid {
        display: grid;
        grid-template-columns: minmax(0, 280px) minmax(0, 1fr);
        gap: 24px;
        margin-top: 24px;
      }

      nav[aria-label="Table of contents"] {
        align-self: start;
        position: sticky;
        top: 20px;
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 24px;
        padding: 20px;
        box-shadow: var(--shadow);
      }

      nav ol {
        padding-left: 18px;
        margin: 12px 0 0;
      }

      main[role="main"] {
        display: grid;
        gap: 20px;
      }

      section {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 24px;
        padding: 24px;
        box-shadow: var(--shadow);
      }

      .card-row {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
      }

      .metric {
        background: var(--panel-strong);
        border: 1px solid var(--border);
        border-radius: 18px;
        padding: 16px;
      }

      .metric strong {
        display: block;
        font-size: 1.3rem;
        margin-bottom: 6px;
      }

      .callout {
        border-left: 5px solid var(--accent);
        background: var(--accent-soft);
        border-radius: 16px;
        padding: 16px 18px;
        margin: 18px 0;
      }

      pre {
        background: var(--code);
        overflow-x: auto;
        padding: 16px;
        border-radius: 16px;
        border: 1px solid rgba(82, 96, 109, 0.15);
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th, td {
        text-align: left;
        padding: 12px;
        border-bottom: 1px solid rgba(82, 96, 109, 0.15);
        vertical-align: top;
      }

      details {
        border: 1px solid var(--border);
        border-radius: 16px;
        padding: 14px 16px;
        background: var(--panel-strong);
      }

      details + details { margin-top: 12px; }
      summary { cursor: pointer; font-weight: 700; }

      @media (max-width: 860px) {
        .shell { padding: 16px; }
        .grid { grid-template-columns: 1fr; }
        nav[aria-label="Table of contents"] { position: static; }
        header[role="banner"], section { padding: 20px; border-radius: 22px; }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <header role="banner">
        <p class="eyebrow">GreJiJi Documentation</p>
        <h1>Marketplace trust flows, documented in-app.</h1>
        <p class="lede">
          This service documents its own auth, listing, escrow, dispute, settlement, and audit behavior.
          Use this page as the live companion to the repo docs.
        </p>
          <div class="card-row" aria-label="Service summary">
          <div class="metric">
            <strong>Node 18+</strong>
            <span>Runtime target</span>
          </div>
          <div class="metric">
            <strong>SQLite</strong>
            <span>Primary persistence layer</span>
          </div>
          <div class="metric">
            <strong>Bearer auth</strong>
            <span>Signed HMAC tokens</span>
          </div>
          <div class="metric">
            <strong>Trust ops v17</strong>
            <span>Incident bundles, integrity proofs, operator handoff</span>
          </div>
        </div>
      </header>

      <div class="grid">
        <nav aria-label="Table of contents">
          <h2>Contents</h2>
          <ol>
            <li><a href="#overview">Overview</a></li>
            <li><a href="#auth">Auth and roles</a></li>
            <li><a href="#demo">Demo mode</a></li>
            <li><a href="#routes">Route map</a></li>
            <li><a href="#workflow">Settlement workflow</a></li>
            <li><a href="#trust">Trust operations v17</a></li>
            <li><a href="#audit">Audit trail and notifications</a></li>
            <li><a href="#operations">Operations</a></li>
          </ol>
        </nav>

        <main role="main">
          <section id="overview" aria-labelledby="overview-title">
            <h2 id="overview-title">Overview</h2>
            <p>
              GreJiJi is an API-first backend for local marketplace transactions where the platform controls settlement timing,
              dispute handling, and a durable audit trail.
            </p>
            <div class="callout" role="note" aria-label="Documentation note">
              The repo also includes Markdown docs in <code>docs/api-reference.md</code> and <code>docs/operations.md</code>.
            </div>
            <div class="callout" role="note" aria-label="Trust contract note">
              The current mainline build treats legacy <code>trust-ops-v17</code> runtime surfaces as superseded. Release-gate evidence for the shipped contract: <code>npm run test:unit</code> 3/3, <code>npm run test:integration</code> 26/26, and <code>npm run test:e2e</code> 23/23.
            </div>
            <table>
              <thead>
                <tr>
                  <th>Concern</th>
                  <th>Current implementation</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Health</td>
                  <td><code>GET /health</code></td>
                </tr>
                <tr>
                  <td>Listings</td>
                  <td><code>GET /listings</code>, <code>POST /listings</code>, <code>PATCH /listings/:listingId</code></td>
                </tr>
                <tr>
                  <td>Transactions</td>
                  <td><code>GET /transactions</code>, <code>POST /transactions</code>, <code>GET /transactions/:id</code>, <code>GET /transactions/:id/events</code></td>
                </tr>
                <tr>
                  <td>Disputes</td>
                  <td><code>POST /transactions/:id/disputes</code>, <code>/resolve</code>, <code>/adjudicate</code></td>
                </tr>
                <tr>
                  <td>Notifications</td>
                  <td><code>POST /jobs/notification-dispatch</code>, <code>GET /notifications</code>, <code>POST /notifications/:id/read</code>, <code>POST /notifications/:id/acknowledge</code></td>
                </tr>
              </tbody>
            </table>
          </section>

          <section id="auth" aria-labelledby="auth-title">
            <h2 id="auth-title">Auth and roles</h2>
            <p>Protected routes require <code>Authorization: Bearer &lt;token&gt;</code>.</p>
            <ul>
              <li><code>buyer</code>: can create buyer-bound transactions and confirm delivery.</li>
              <li><code>seller</code>: can create and update only their own listings and seller-bound transactions.</li>
              <li><code>admin</code>: can resolve disputes, adjudicate disputes, and run auto-release jobs.</li>
            </ul>
            <pre><code>{
  "email": "buyer@example.com",
  "password": "buyer-password",
  "role": "buyer"
}</code></pre>
          </section>

          <section id="demo" aria-labelledby="demo-title">
            <h2 id="demo-title">Demo mode</h2>
            <p>
              The web console auth flow uses a modal opened from the header action, plus one-click demo account buttons
              that prefill login credentials for seller, buyer, and admin walkthroughs.
            </p>
            <details open>
              <summary>Seed behavior</summary>
              <ul>
                <li><code>DEMO_SEED_ENABLED</code> defaults to <code>true</code> unless <code>NODE_ENV=test</code>.</li>
                <li>Seed bootstrap runs only when <code>DATABASE_PATH</code> resolves to <code>./data/grejiji.sqlite</code>.</li>
                <li>Seeding is idempotent for users/history; existing <code>demo-listing-*</code> rows are refreshed to the current catalog on restart.</li>
                <li>Catalog includes 10 retro game listings with two validated image URLs each (box art + gameplay).</li>
              </ul>
            </details>
            <details>
              <summary>Seeded credentials</summary>
              <ul>
                <li><code>demo-admin@grejiji.demo</code></li>
                <li><code>demo-buyer@grejiji.demo</code></li>
                <li><code>demo-seller-01@grejiji.demo</code> (plus seller 02 through 10)</li>
                <li>Password: <code>DemoMarket123!</code> (override with <code>DEMO_SEED_PASSWORD</code>)</li>
              </ul>
            </details>
            <pre><code>rm -f ./data/grejiji.sqlite
DEMO_SEED_ENABLED=true npm start
# open /app and click a Demo Access button
</code></pre>
            <div class="callout" role="note" aria-label="Demo mode note">
              Demo buttons prefill and open the auth modal; submit the login form to complete authentication.
            </div>
          </section>

          <section id="routes" aria-labelledby="routes-title">
            <h2 id="routes-title">Route map</h2>
            <details open>
              <summary>Listings</summary>
              <p><code>GET /listings</code> is public. Listing creation and updates are seller-only and validate <code>title</code>, <code>localArea</code>, and a positive integer <code>priceCents</code>. Listings support external <code>photoUrls</code> plus uploaded seller images via <code>POST /listings/:listingId/photos</code>.</p>
              <p>In <code>GET /app</code>, listing browse rows render the first available listing photo as a thumbnail, and listing detail renders a combined inline gallery from both external links and uploaded photo assets.</p>
              <p>Photo uploads use JSON with <code>fileName</code>, <code>mimeType</code>, and base64 <code>contentBase64</code>. Allowed MIME types are <code>image/jpeg</code>, <code>image/png</code>, <code>image/webp</code>, and <code>image/gif</code>; max size is controlled by <code>LISTING_PHOTO_MAX_BYTES</code>.</p>
              <p>Uploaded photo bytes are publicly readable only when the listing is approved. Sellers and admins can still fetch uploaded files for non-approved listings.</p>
            </details>
            <details>
              <summary>Transactions</summary>
              <p><code>POST /transactions</code> creates an accepted transaction, computes <code>autoReleaseDueAt</code>, appends <code>payment_captured</code>, queues notification outbox rows, and persists a current <code>trustAssessment</code>.</p>
            </details>
            <details>
              <summary>Disputes and settlement</summary>
              <p>Participants can open disputes. Admins can resolve back to <code>accepted</code> or adjudicate to seller release, buyer refund, or cancellation.</p>
            </details>
            <details>
              <summary>Trust assessments</summary>
              <p><code>GET /transactions/:id/trust</code> returns the latest assessment and intervention history. <code>POST /transactions/:id/trust/evaluate</code> is admin-only and appends a fresh trust evaluation snapshot, while <code>POST /admin/trust-operations/cases/:caseId/evidence-bundle/export</code> emits the current v17 handoff bundle.</p>
            </details>
            <details>
              <summary>Notification dispatch and inbox</summary>
              <p><code>POST /jobs/notification-dispatch</code> processes outbox rows with retry metadata, while users consume inbox entries through <code>GET /notifications</code> and mark items as read or acknowledged.</p>
            </details>
          </section>

          <section id="workflow" aria-labelledby="workflow-title">
            <h2 id="workflow-title">Settlement workflow</h2>
            <ol>
              <li>Register buyer, seller, or admin via <code>POST /auth/register</code>.</li>
              <li>Seller publishes a listing.</li>
              <li>An authenticated buyer or seller creates the transaction.</li>
              <li>Buyer confirms delivery or the admin runs auto-release after the deadline.</li>
              <li>If a dispute opens first, settlement pauses until admin resolution or adjudication.</li>
            </ol>
            <div class="callout" role="note" aria-label="Auto-release rule">
              Auto-release does not settle transactions with an unresolved dispute.
            </div>
          </section>

          <section id="trust" aria-labelledby="trust-title">
            <h2 id="trust-title">Trust operations v17</h2>
            <p>
              The current trust engine persists operator review state plus a v17 evidence-bundle export surface for
              deterministic incident handoff, checkpoint-level verification, and downstream audit retention.
            </p>
            <details open>
              <summary>Assessment bundle</summary>
              <p><code>contextBundles.assessment</code> packages collusion links, listing-authenticity signals, buyer-risk signals, and policy simulation outcomes into the operator's read-first checkpoint.</p>
            </details>
            <details>
              <summary>Intervention bundle</summary>
              <p><code>contextBundles.intervention</code> captures rationale, machine/human decision boundaries, remediation actions, and dispute-preemption actions so reviewers can reconstruct why a case moved into containment.</p>
            </details>
            <details>
              <summary>Dispute bundle and integrity verification</summary>
              <p><code>contextBundles.dispute</code> includes escrow attestation checkpoints, dispute evidence, fulfillment proofs, and risk checkpoint decisions. Operators can require artifacts, assert known hashes, and validate the response through <code>integrityMetadata.bundleHashSha256</code>, <code>artifactHashes</code>, and <code>checkpointLinkage</code>.</p>
            </details>
            <div class="callout" role="note" aria-label="Trust route note">
              Deep-dive routes: <code>GET /transactions/:id/trust</code> returns the latest assessment history, and <code>POST /admin/trust-operations/cases/:caseId/evidence-bundle/export</code> produces the current v17 review bundle.
            </div>
            <div class="callout" role="note" aria-label="Trust deprecation note">
              Investigator and automation workflows should target the current mainline trust-operations APIs. Legacy <code>trust-ops-v17</code> runtime surfaces are superseded and intentionally absent from this build.
            </div>
          </section>

          <section id="audit" aria-labelledby="audit-title">
            <h2 id="audit-title">Audit trail and notifications</h2>
            <p>Lifecycle changes append immutable rows to <code>transaction_events</code> and enqueue <code>notification_outbox</code> records in the same logical transaction.</p>
            <ul>
              <li>Event types include <code>payment_captured</code>, <code>dispute_opened</code>, <code>dispute_adjudicated</code>, and settlement outcomes.</li>
              <li>Outbox topics include <code>payment_received</code>, <code>action_required</code>, and <code>dispute_update</code>.</li>
              <li>Dispatcher retries are tracked with <code>attempt_count</code>, <code>last_attempt_at</code>, and <code>next_retry_at</code>.</li>
              <li>Delivered user-facing inbox rows are stored in <code>user_notifications</code>.</li>
              <li>Event history is exposed at <code>GET /transactions/:id/events</code>.</li>
            </ul>
          </section>

          <section id="operations" aria-labelledby="operations-title">
            <h2 id="operations-title">Operations</h2>
            <p>Run the service locally with <code>npm start</code> and verify behavior with <code>npm test</code>.</p>
            <p>For Jenkins-based Docker delivery, provision or refresh the pipeline job with <code>npm run jenkins:provision</code> after setting Jenkins API credentials and repository settings.</p>
            <p>Jenkins provisioning defaults to a root-level <code>GreJiJi</code> job when <code>JENKINS_FOLDER</code> is unset. Legacy <code>GreJiJi/deploy</code> setups remain supported by setting <code>JENKINS_FOLDER=GreJiJi</code> and <code>JENKINS_JOB=deploy</code>.</p>
            <div class="callout" role="note" aria-label="Operations note">
              For incident handoff, treat a <code>409</code> evidence-bundle export response as an integrity failure. Resolve missing artifacts or hash drift before distributing the bundle downstream.
            </div>
            <pre><code>curl -sS -X POST http://localhost:3000/jobs/notification-dispatch \
  -H "Authorization: Bearer &lt;admin-token&gt;" \
  -H "Content-Type: application/json" \
  -d '{"limit":100}'
JENKINS_BASE_URL="https://ci.example.com" \
JENKINS_USER="ci-user" \
JENKINS_TOKEN="&lt;api-token&gt;" \
JENKINS_REPO_URL="https://github.com/futurepr0n/GreJiJi" \
npm run jenkins:provision
JENKINS_FOLDER="GreJiJi" JENKINS_JOB="deploy" npm run jenkins:provision
curl -sS http://localhost:3000/transactions/&lt;transaction-id&gt;/trust \
  -H "Authorization: Bearer &lt;participant-or-admin-token&gt;"
curl -sS -X POST http://localhost:3000/admin/trust-operations/cases/&lt;case-id&gt;/evidence-bundle/export \
  -H "Authorization: Bearer &lt;admin-token&gt;" \
  -H "Content-Type: application/json" \
  -d '{"requireDisputeArtifacts":true}'
sqlite3 ./data/grejiji.sqlite "SELECT id, transaction_id, topic, status, attempt_count, next_retry_at FROM notification_outbox ORDER BY id;"
sqlite3 ./data/grejiji.sqlite "SELECT transaction_id, orchestration_version, json_extract(policy_canary_governance_json, '$.rolloutDecision') FROM trust_assessments ORDER BY updated_at DESC;"
sqlite3 ./data/grejiji.sqlite "SELECT id, recipient_user_id, topic, status, read_at, acknowledged_at FROM user_notifications ORDER BY id;"</code></pre>
          </section>
        </main>
      </div>
    </div>
  </body>
</html>`;
}
