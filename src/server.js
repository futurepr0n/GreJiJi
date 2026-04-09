import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { StoreError, createTransactionStore } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultDatabasePath = path.join(__dirname, "..", "data", "grejiji.sqlite");
const migrationsDirectory = path.join(__dirname, "..", "migrations");

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const nodeEnv = process.env.NODE_ENV ?? "development";

function parseReleaseTimeoutHours(value) {
  const parsed = Number(value ?? 72);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("RELEASE_TIMEOUT_HOURS must be a positive number");
  }
  return parsed;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
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

export function createServer({ databasePath, releaseTimeoutHours } = {}) {
  const store = createTransactionStore({
    databasePath: databasePath ?? process.env.DATABASE_PATH ?? defaultDatabasePath,
    migrationsDirectory,
    releaseTimeoutHours: releaseTimeoutHours ?? parseReleaseTimeoutHours(process.env.RELEASE_TIMEOUT_HOURS)
  });

  const requestHandler = async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { status: "ok", service: "grejiji-api", env: nodeEnv });
        return;
      }

      if (req.method === "POST" && url.pathname === "/transactions") {
        const body = await readRequestBody(req);
        const transaction = store.createAcceptedTransaction({
          id: body.transactionId ?? crypto.randomUUID(),
          buyerId: body.buyerId,
          sellerId: body.sellerId,
          amountCents: body.amountCents,
          acceptedAt: body.acceptedAt
        });
        sendJson(res, 201, { transaction });
        return;
      }

      if (req.method === "GET") {
        const params = getPathParams(url.pathname, /^\/transactions\/([^/]+)$/);
        if (params) {
          const [transactionId] = params;
          const transaction = store.getTransactionById(transactionId);
          if (!transaction) {
            sendJson(res, 404, { error: "transaction not found" });
            return;
          }
          sendJson(res, 200, { transaction });
          return;
        }
      }

      if (req.method === "POST") {
        const confirmParams = getPathParams(
          url.pathname,
          /^\/transactions\/([^/]+)\/confirm-delivery$/
        );

        if (confirmParams) {
          const [transactionId] = confirmParams;
          const body = await readRequestBody(req);
          const transaction = store.confirmDelivery({ id: transactionId, buyerId: body.buyerId });
          sendJson(res, 200, { transaction });
          return;
        }

        const disputeParams = getPathParams(url.pathname, /^\/transactions\/([^/]+)\/disputes$/);
        if (disputeParams) {
          const [transactionId] = disputeParams;
          const transaction = store.openDispute({ id: transactionId });
          sendJson(res, 200, { transaction });
          return;
        }

        const resolveParams = getPathParams(
          url.pathname,
          /^\/transactions\/([^/]+)\/disputes\/resolve$/
        );
        if (resolveParams) {
          const [transactionId] = resolveParams;
          const transaction = store.resolveDispute({ id: transactionId });
          sendJson(res, 200, { transaction });
          return;
        }

        if (url.pathname === "/jobs/auto-release") {
          const body = await readRequestBody(req);
          const result = store.runAutoRelease({ nowAt: body.nowAt });
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
