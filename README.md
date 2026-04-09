# GreJiJi

Initial executable backend baseline for the GreJiJi marketplace project.

## Requirements

- Node.js 18+

## Environment variables

- `PORT` (optional): HTTP port to listen on. Default `3000`.
- `HOST` (optional): bind host. Default `0.0.0.0`.
- `NODE_ENV` (optional): runtime environment label returned by `/health`. Default `development`.

## Run locally

```bash
npm start
```

Server endpoints:

- `GET /` -> baseline JSON response
- `GET /health` -> health payload

## Run tests

```bash
npm test
```

The smoke test starts the server on an ephemeral local port and verifies `/health`.
