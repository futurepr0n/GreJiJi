import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { StoreError, createTransactionStore } from "./db.js";
import { renderDocsPage } from "./docs-page.js";
import { renderWebAppPage } from "./web/app-page.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultDatabasePath = path.join(__dirname, "..", "data", "grejiji.sqlite");
const defaultEvidenceStoragePath = path.join(__dirname, "..", "data", "dispute-evidence");
const migrationsDirectory = path.join(__dirname, "..", "migrations");
const webClientFilePath = path.join(__dirname, "web", "client.js");
const webStylesFilePath = path.join(__dirname, "web", "styles.css");

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const nodeEnv = process.env.NODE_ENV ?? "development";
const authTokenSecret = process.env.AUTH_TOKEN_SECRET ?? "local-dev-secret-change-me";
const tokenTtlSeconds = Number(process.env.AUTH_TOKEN_TTL_SECONDS ?? 60 * 60 * 12);
const evidenceMaxBytes = Number(process.env.EVIDENCE_MAX_BYTES ?? 5 * 1024 * 1024);

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

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", (chunk) => {
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
        reject(new Error("Request body must be valid JSON"));
      }
    });

    req.on("error", reject);
  });
}

function mapStoreErrorToStatusCode(error) {
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

  return user;
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

export function createServer({
  databasePath,
  releaseTimeoutHours,
  dispatchNotification,
  serviceFeeFixedCents,
  serviceFeePercent,
  settlementCurrency,
  evidenceStoragePath
} = {}) {
  const resolvedEvidenceStoragePath =
    evidenceStoragePath ?? process.env.EVIDENCE_STORAGE_PATH ?? defaultEvidenceStoragePath;
  const resolvedEvidenceMaxBytes = parseEvidenceMaxBytes(evidenceMaxBytes);
  const store = createTransactionStore({
    databasePath: databasePath ?? process.env.DATABASE_PATH ?? defaultDatabasePath,
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

  const requestHandler = async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { status: "ok", service: "grejiji-api", env: nodeEnv });
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

      if (req.method === "POST" && url.pathname === "/auth/register") {
        const body = await readRequestBody(req);
        if (!body.email || !body.password || !body.role) {
          throw new StoreError("validation", "email, password, and role are required");
        }

        if (typeof body.password !== "string" || body.password.length < 8) {
          throw new StoreError("validation", "password must be at least 8 characters");
        }

        const salt = crypto.randomBytes(16).toString("hex");
        const user = store.createUser({
          id: body.userId ?? crypto.randomUUID(),
          email: body.email,
          role: body.role,
          passwordHash: hashPassword(body.password, salt),
          passwordSalt: salt
        });

        const auth = buildAuthResponse(user);
        sendJson(res, 201, { user, ...auth });
        return;
      }

      if (req.method === "POST" && url.pathname === "/auth/login") {
        const body = await readRequestBody(req);
        if (!body.email || !body.password) {
          throw new StoreError("validation", "email and password are required");
        }

        const authRecord = store.getUserAuthByEmail(body.email);
        if (!authRecord) {
          throw new StoreError("forbidden", "invalid email or password");
        }

        const candidateHash = hashPassword(body.password, authRecord.passwordSalt);
        if (!timingSafeEqualHex(candidateHash, authRecord.passwordHash)) {
          throw new StoreError("forbidden", "invalid email or password");
        }

        const user = store.recordUserLogin(authRecord.user.id);
        const auth = buildAuthResponse(user);
        sendJson(res, 200, { user, ...auth });
        return;
      }

      if (req.method === "GET" && url.pathname === "/listings") {
        sendJson(res, 200, { listings: store.listListings() });
        return;
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
        requireRole(currentUser, "seller");

        const body = await readRequestBody(req);
        const listing = store.createListing({
          id: body.listingId ?? crypto.randomUUID(),
          sellerId: currentUser.id,
          title: body.title,
          description: body.description,
          priceCents: body.priceCents,
          localArea: body.localArea
        });

        sendJson(res, 201, { listing });
        return;
      }

      if (req.method === "PATCH") {
        const listingParams = getPathParams(url.pathname, /^\/listings\/([^/]+)$/);
        if (listingParams) {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "seller");

          const [listingId] = listingParams;
          const body = await readRequestBody(req);
          const listing = store.updateListing({
            id: listingId,
            sellerId: currentUser.id,
            title: body.title,
            description: body.description,
            priceCents: body.priceCents,
            localArea: body.localArea
          });

          sendJson(res, 200, { listing });
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
        const body = await readRequestBody(req);

        if (currentUser.role === "buyer") {
          body.buyerId = currentUser.id;
        }

        if (currentUser.role === "seller") {
          body.sellerId = currentUser.id;
        }

        const transaction = store.createAcceptedTransaction({
          id: body.transactionId ?? crypto.randomUUID(),
          buyerId: body.buyerId,
          sellerId: body.sellerId,
          amountCents: body.amountCents,
          acceptedAt: body.acceptedAt,
          actorId: currentUser.id
        });
        sendJson(res, 201, { transaction });
        return;
      }

      if (req.method === "GET") {
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
          const transaction = store.getTransactionById(transactionId);
          if (!transaction) {
            sendJson(res, 404, { error: "transaction not found" });
            return;
          }

          const events = store.getTransactionEventHistory({ id: transactionId });
          const evidence = store.listDisputeEvidence({ transactionId });
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

        const params = getPathParams(url.pathname, /^\/transactions\/([^/]+)$/);
        if (params) {
          const currentUser = requireAuth(req, store);
          const [transactionId] = params;
          const transaction = store.getTransactionById(transactionId);
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
        const evidenceUploadParams = getPathParams(
          url.pathname,
          /^\/transactions\/([^/]+)\/disputes\/evidence$/
        );
        if (evidenceUploadParams) {
          const currentUser = requireAuth(req, store);
          const [transactionId] = evidenceUploadParams;
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

          const body = await readRequestBody(req);
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

          const evidenceId = body.evidenceId ?? crypto.randomUUID();
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
              storageKey
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
          const [transactionId] = confirmParams;
          const transaction = store.confirmDelivery({ id: transactionId, buyerId: currentUser.id });
          sendJson(res, 200, { transaction });
          return;
        }

        const disputeParams = getPathParams(url.pathname, /^\/transactions\/([^/]+)\/disputes$/);
        if (disputeParams) {
          const currentUser = requireAuth(req, store);
          const [transactionId] = disputeParams;
          const transaction = store.openDispute({ id: transactionId, actorId: currentUser.id });
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
          const [transactionId] = resolveParams;
          const transaction = store.resolveDispute({ id: transactionId });
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
          const [transactionId] = adjudicateParams;
          const body = await readRequestBody(req);
          const transaction = store.adjudicateDispute({
            id: transactionId,
            decision: body.decision,
            decidedBy: body.decidedBy ?? currentUser.id,
            notes: body.notes
          });
          sendJson(res, 200, { transaction });
          return;
        }

        if (url.pathname === "/jobs/auto-release") {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const body = await readRequestBody(req);
          const result = store.runAutoRelease({ nowAt: body.nowAt });
          sendJson(res, 200, result);
          return;
        }

        if (url.pathname === "/jobs/notification-dispatch") {
          const currentUser = requireAuth(req, store);
          requireRole(currentUser, "admin");
          const body = await readRequestBody(req);
          const result = store.processNotificationOutbox({
            nowAt: body.nowAt,
            limit: body.limit
          });
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
