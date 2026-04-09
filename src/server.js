import http from "node:http";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const nodeEnv = process.env.NODE_ENV ?? "development";

function requestHandler(req, res) {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "grejiji-api", env: nodeEnv }));
    return;
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: "GreJiJi API baseline is running" }));
}

export function createServer() {
  return http.createServer(requestHandler);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createServer();

  server.listen(port, host, () => {
    // Keep startup log concise for local developer usage.
    console.log(`grejiji-api listening on http://${host}:${port}`);
  });
}
