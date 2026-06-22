# @p00f/cli

The command-line interface and local MCP server for
[p00f](https://github.com/mcdays94/p00f), a zero-knowledge, ephemeral clipboard.
Share a file, some text, or piped stdin and get back a short-lived link; whoever
opens the link can decrypt it, and the link self-destructs after it expires or
its reveals run out.

This package ships two binaries:

- **`poof`** the terminal client (create, get, info, burn).
- **`poof-mcp`** a local stdio MCP server exposing the same operations to agents.

## Trust model

All encryption and decryption happen here, on your machine, over
[`@p00f/core`](https://www.npmjs.com/package/@p00f/core). The key lives only in
the link's fragment (after `#`) and is never sent to the server. The hosted
service holds ciphertext and cannot read your content or recover a lost link.

## Install

Global install puts both `poof` and `poof-mcp` on your PATH:

```sh
npm install -g @p00f/cli
```

Or run one-off without installing (a multi-binary package needs `-p` plus the
command you want):

```sh
npx -p @p00f/cli poof ./secret.txt
```

By default the CLI talks to the hosted app at `https://p00f.me`. Point it at a
different deployment (for example a local dev server) with `POOF_BASE`:

```sh
export POOF_BASE=https://poof.localhost
```

## Use

```sh
# Create from a file, from stdin, or with an inline string.
poof ./report.pdf
echo "hello agents" | poof
poof ./photo.png --ttl 1h --reads 3

# stdout is the link only, so it composes:
LINK=$(poof ./report.pdf)

# Read it back (consumes one reveal); --out saves binary content.
poof get "$LINK"
poof get "$LINK" --out ./report.pdf

# Inspect without spending a reveal.
poof info "$LINK"

# Burn early with the owner token printed at create time (to stderr).
poof burn "$LINK" --token <ownerToken>
```

Flags: `--ttl <5m|1h|2d>`, `--reads <n|unlimited>`, `--pin <value>`,
`--kind <text|code|image|file|secret|url>`, `--require-turnstile`,
`--no-countdown`, `--json`, `--out <file>`.

A poof created with `--require-turnstile` needs a human captcha to reveal, so it
can only be opened in a browser, not from the CLI or an agent.

## MCP server

`poof-mcp` is a local stdio MCP server with four tools: `poof_create`,
`poof_read`, `poof_info`, `poof_burn`. Decryption happens inside the server
process (your machine), so the hosted service still only ever sees ciphertext.

Point an MCP client at it:

```json
{
  "mcpServers": {
    "poof": {
      "command": "npx",
      "args": ["-y", "-p", "@p00f/cli", "poof-mcp"],
      "env": { "POOF_BASE": "https://p00f.me" }
    }
  }
}
```

## License

MIT
