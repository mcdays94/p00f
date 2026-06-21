<p align="center">
  <img src="docs/hero.gif" width="100%" alt="Animated p00f banner. The wordmark p00f with a coral dot sits over a faint drifting field of monospace glyphs on a dark dotted grid, with the subtitle zero-knowledge ephemeral clipboard. The wordmark ascii-scrambles into the terminal command dollar-sign poof, a coral ascii smoke ring sweeps outward across the whole banner (the poof), and the wordmark then reassembles out of the scramble noise before the loop repeats." />
</p>

<h1 align="center">p00f</h1>

<p align="center"><strong>A zero-knowledge, ephemeral clipboard for humans and agents.</strong><br/>
Encrypt something in your browser, your terminal, or your agent. Get a short-lived link. Hand it off. It disappears.</p>

<p align="center">
  <a href="https://p00f.me"><img alt="live at p00f.me" src="https://img.shields.io/badge/live-p00f.me-FF6363?style=flat-square" /></a>
  <a href="https://www.npmjs.com/package/@p00f/core"><img alt="@p00f/core on npm" src="https://img.shields.io/npm/v/@p00f/core?style=flat-square&color=FF6363&label=%40p00f%2Fcore" /></a>
  <a href="LICENSE"><img alt="MIT licensed" src="https://img.shields.io/badge/license-MIT-FF6363?style=flat-square" /></a>
  <img alt="built on Cloudflare Workers" src="https://img.shields.io/badge/built%20on-Cloudflare%20Workers-FF6363?style=flat-square" />
</p>

---

p00f holds your secret for as long as it takes to hand it over, and not a second longer. Content is encrypted on the device that creates it; the key lives in the URL fragment and never reaches the server; and every poof burns on a timer or after a fixed number of reveals. The infrastructure only ever sees ciphertext.

- **Zero-knowledge.** Encryption happens caller-side with Web Crypto. The decryption key sits in the link's `#fragment`, which browsers never send over the network. p00f cannot read your content even if it wanted to.
- **Ephemeral.** Every poof has a TTL and a reveal budget. When either runs out, it burns. Permanence is not an option by design.
- **Built for humans and agents alike.** The same poof is created and revealed from the web app, the `poof` CLI, or a local MCP server, over one shared zero-knowledge core.

## The point: hand secrets to agents without leaking them

Pasting an API key, token, or password straight into an agent chat is a bad habit. That text tends to get logged, retained in history, synced to a provider, and sometimes used for training. p00f is the basic, boring fix:

```sh
# you, in your terminal: poof the secret, get a link
$ printf '%s' "$OPENAI_API_KEY" | poof --ttl 1h --reads 1
https://p00f.me/c/q8Zr2nF1#3sP_Kb...redacted...key-in-the-fragment

# hand that link to your agent. it reveals the secret exactly once, then it burns.
```

The agent reveals it through its own `poof` MCP server or CLI, so decryption happens on the agent's side. The hosted API only ever relays ciphertext. Because a default poof needs no human captcha to reveal (see [ADR-0015](docs/adr/0015-optional-reveal-turnstile.md)), a headless agent can open it; for a sensitive secret the creator can require a PIN, cap it to a single reveal, or flip on a human captcha that keeps it browser-only.

> A poof is not a vault. It is a courier that forgets. If a recipient (human or agent) is allowed to see the plaintext, assume they can copy it. p00f controls how long and how often it is revealable, not what happens after. The trust model is spelled out honestly in [`SECURITY.md`](SECURITY.md).

## How it works

A poof link looks like `https://p00f.me/c/<id>#<key>`. The `<id>` addresses the ciphertext on the server; the `<key>` after the `#` is the secret half, and it never leaves the client.

```mermaid
sequenceDiagram
    autonumber
    participant C as Creator
    participant S as p00f server
    participant R as Recipient
    Note over C: browser, CLI, or agent
    C->>C: generate a random key, encrypt content locally
    C->>S: upload ciphertext only
    S->>S: store in a per-clip Durable Object (TTL alarm + atomic reveal budget)
    S-->>C: clip id
    C->>C: build link p00f.me/c/{id}#{key}
    Note over C,R: the #{key} fragment never touches the server
    C->>R: hand over the link
    R->>S: fetch ciphertext for {id}
    S->>S: spend one reveal; burn when the budget hits zero
    S-->>R: ciphertext
    R->>R: decrypt locally with the key from the #fragment
```

The recipient sees the plaintext. The infrastructure never does. Here is the same split, by what each side ever holds:

```text
   YOUR DEVICE / YOUR AGENT                      p00f SERVERS (Worker + DO)
   what stays here, always                       what they hold, only ever
   .......................                       ..........................
   - the plaintext content                       - ciphertext (an opaque blob)
   - the decryption key                          - a random 128-bit clip id
   - the exact size and filename                 - a coarse size bucket
   - the kind (text/code/image/file/secret/url)  - reveals remaining
   - the URL #fragment (it carries the key)      - a TTL to run the burn

        the key lives in the link's #fragment and is never sent to the
        server, so p00f physically cannot decrypt what it stores.
```

Revealed content renders inside a sandboxed, opaque-origin iframe, so a hostile payload in a poof cannot reach back out and steal the key from the page ([ADR-0012](docs/adr/0012-hostile-rendering-key-isolation.md)).

## Three ways in

All three are thin shells over the same `@p00f/core` engine, so a poof made in one is revealable in another.

### Web

Open [p00f.me](https://p00f.me) (or your own instance). Paste text or code, drop a file, or paste an image; choose how long it lives and how many reveals it gets; share the link. A lone URL can be shared as a masked link, and text/code, images, video, and audio render inline on reveal.

### CLI

```sh
npm install
npm run build:cli
export POOF_BASE=https://p00f.me        # or your own instance / local dev

# create from a file or stdin. stdout is the link, and only the link.
poof secrets.env
cat debug.log | poof --ttl 1h --reads 3

# reveal, inspect without spending a reveal, and burn early
poof get  https://p00f.me/c/ID#KEY
poof info https://p00f.me/c/ID#KEY      # non-consuming
poof burn https://p00f.me/c/ID#KEY --token OWNER_TOKEN
```

Because stdout is the link only, `LINK=$(poof report.md)` composes cleanly in scripts. The owner token needed to burn early goes to stderr, or use `--json`. Flags include `--ttl`, `--reads`, `--pin`, `--require-turnstile`, `--no-countdown`, and `--out FILE`.

### MCP (agents)

```sh
npm run build:mcp
```

Register the local server with your agent:

```jsonc
{
  "mcpServers": {
    "poof": {
      "command": "node",
      "args": ["/absolute/path/to/bin/poof-mcp.mjs"],
      "env": { "POOF_BASE": "https://p00f.me" }
    }
  }
}
```

Tools: `poof_create`, `poof_read`, `poof_info` (non-consuming), `poof_burn`. Decryption happens in the local server, so the hosted API only ever sees ciphertext. A `secret`-kind poof requires `confirm: true` before it is revealed into the model context. A remote MCP facade could only ever relay ciphertext; a functional read needs the caller-side server (see [ADR-0010](docs/adr/0010-agent-machine-integration.md)).

## What a creator controls

- **Burns after** a TTL: 5 minutes, 1 hour, 1 day, or 7 days.
- **Or after** N reveals: 1, 3, 10, or unlimited (within the TTL). The counter is atomic in the Durable Object, so concurrent reveals cannot overspend it.
- **PIN** (4 to 128 characters), folded into the key derivation. A wrong-PIN lockout lives in the Durable Object.
- **Reveal captcha** (optional, default off): require a human to pass a Turnstile challenge before revealing. This is what keeps a poof browser-only; leave it off for agent-revealable poofs.
- **Countdown**: the reveal page shows a live fuse and best-effort auto-clears when the deadline passes. This is honest UX, not confidentiality (an already-revealed poof may have been copied).
- **Content cap**: up to 25 MiB per poof.

## What p00f does and does not promise

**Does:** keep plaintext and keys off p00f's servers; enforce a TTL and a reveal budget; lock out PIN guessing per poof; isolate revealed content from the page that holds the key.

**Does not:** stop a recipient who is allowed to see a secret from copying, screenshotting, or re-sharing it; guarantee deletion on a device that already revealed and cached it; act as long-term storage or a password manager. p00f is a courier that forgets, and it is honest about the rest in [`SECURITY.md`](SECURITY.md).

## Self-host (Cloudflare free plan)

p00f runs on free-plan primitives (Workers, a SQLite Durable Object, R2, a rate-limit binding, Turnstile). A deployer needs to:

1. Create the R2 bucket: `CLOUDFLARE_ACCOUNT_ID=<id> wrangler r2 bucket create poof-content`.
2. Set a real Turnstile secret: `wrangler secret put TURNSTILE_SECRET` (the committed value is Cloudflare's public test key, safe for local dev only).
3. Keep the `CREATE_LIMIT` rate-limit binding in `wrangler.jsonc` (the machine-path abuse floor).
4. Deploy with `wrangler deploy`.

## Develop

```sh
npm install
npm run dev          # builds the client and starts wrangler dev
npm test             # vitest under @cloudflare/vitest-pool-workers
```

The shared zero-knowledge engine is `src/shared/` (`crypto.ts`, `link.ts`, `protocol.ts`, `core.ts`). The web app (`src/client/`), CLI (`src/cli/`), and MCP server (`src/mcp/`) are thin shells over it. The Worker and Durable Object live in `src/worker/`. See [`CONTEXT.md`](CONTEXT.md) for the vocabulary and [`docs/adr/`](docs/adr/) for the decisions behind the design. The hero banner above is generated from [`docs/hero/banner.html`](docs/hero/banner.html).

## Status

Alpha, and live at [p00f.me](https://p00f.me). The zero-knowledge engine is published as [`@p00f/core`](https://www.npmjs.com/package/@p00f/core). Issues and contributions are welcome under the [MIT License](LICENSE).
