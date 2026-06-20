# p00f

Temporary memory for humans and agents. Encrypt something in your browser, your
terminal, or your agent; get a short-lived link; hand it off; it disappears.

p00f is a zero-knowledge, ephemeral clipboard and agent-handoff tool built on
Cloudflare Workers and Durable Objects. The server only ever holds ciphertext.

- **Zero-knowledge.** Content is encrypted caller-side. The decryption key lives
  in the URL fragment and never reaches the server.
- **Ephemeral.** Every clip has a TTL and a reveal budget, and burns when either
  runs out. Permanence is not an option by design.
- **Human and agent parity.** The same clip is created and read from the web app,
  the `poof` CLI, or a local MCP server, over one shared core.

See `CONTEXT.md` for the vocabulary and `docs/adr/` for the decisions behind the
design. The trust model is spelled out honestly in `SECURITY.md`.

## How it works (the 20-second version)

1. The caller generates a random key, encrypts the content locally, and uploads
   only the ciphertext.
2. The server stores the ciphertext in a per-clip Durable Object with a TTL alarm
   and an atomic reveal-budget counter.
3. The caller builds a Link as `https://p00f.<tld>/c/<id>#<key>`. The `#<key>` part
   is never sent to the server.
4. The recipient opens the Link; their client fetches the ciphertext and decrypts
   it locally. A reveal is spent; when the budget hits zero, the clip burns.

The receiving human or agent sees the plaintext. The infrastructure never does.

## Quickstart

### Web

```sh
npm install
npm run dev   # builds the client and starts wrangler dev
```

Open the local URL, paste or drop content, and share the Link.

### CLI

```sh
npm install
npm run build:cli
# point it at your instance (local dev shown here)
export POOF_BASE=http://localhost:8787

# create from a file or stdin; stdout is the Link, nothing else
./bin/poof.mjs secrets.env
cat debug.log | ./bin/poof.mjs --ttl 1h --reads 3

# read, inspect (non-consuming), and burn early
./bin/poof.mjs get   https://p00f.example/c/ID#KEY
./bin/poof.mjs info  https://p00f.example/c/ID#KEY
./bin/poof.mjs burn  https://p00f.example/c/ID#KEY --token OWNER_TOKEN
```

stdout is the Link only, so `LINK=$(./bin/poof.mjs report.md)` composes cleanly.
The owner token (needed to burn early) is printed to stderr, or use `--json`.

### MCP (agents)

```sh
npm run build:mcp
```

Then register the local server with your agent. For example:

```jsonc
{
  "mcpServers": {
    "poof": {
      "command": "node",
      "args": ["/absolute/path/to/bin/poof-mcp.mjs"],
      "env": { "POOF_BASE": "https://p00f.example" }
    }
  }
}
```

Tools: `poof_create`, `poof_read`, `poof_info` (non-consuming), `poof_burn`.
Decryption happens in the local server, so the hosted API only ever sees
ciphertext. A `secret`-kind clip requires `confirm: true` before it is revealed
into the model context. A remote MCP facade could only ever relay ciphertext;
functional read requires the caller-side server (see ADR-0010).

## Develop

```sh
npm test            # vitest under @cloudflare/vitest-pool-workers
npm run dev         # local wrangler dev
```

The shared zero-knowledge engine is `src/shared/` (`crypto.ts`, `link.ts`,
`protocol.ts`, `core.ts`). The web app, CLI (`src/cli/`), and MCP server
(`src/mcp/`) are thin shells over it. The Worker and Durable Object live in
`src/worker/`.

## Self-host (Cloudflare free plan)

p00f runs on free-plan primitives. A deployer needs to:

1. Create the R2 bucket: `CLOUDFLARE_ACCOUNT_ID=<id> wrangler r2 bucket create poof-content`.
2. Set a real Turnstile secret: `wrangler secret put TURNSTILE_SECRET` (the
   committed value is Cloudflare's public test key, safe for local dev only).
3. Keep the `CREATE_LIMIT` rate-limit binding in `wrangler.jsonc` (the machine-path
   abuse floor).
4. Deploy with `wrangler deploy` (do this only when you intend to publish).

## Status

Local-first. No public deployment yet. Contributions are welcome under the MIT
License (`LICENSE`).
