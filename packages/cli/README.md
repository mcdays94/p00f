# @p00f/cli

The command-line interface for [p00f](https://github.com/mcdays94/p00f), a
zero-knowledge, ephemeral clipboard. Share a file, some text, or piped stdin and
get back a short-lived link; whoever opens the link can decrypt it, and the link
self-destructs after it expires or its reveals run out.

## Trust model

All encryption and decryption happen here, on your machine, over
[`@p00f/core`](https://www.npmjs.com/package/@p00f/core). The key lives only in
the link's fragment (after `#`) and is never sent to the server. The hosted
service holds ciphertext and cannot read your content or recover a lost link.

## Use it

Run it one-off, with no install:

```sh
npx @p00f/cli ./secret.txt
```

Or install globally to get the `poof` command on your PATH:

```sh
npm install -g @p00f/cli
poof ./secret.txt
```

By default the CLI talks to the hosted app at `https://p00f.me`. Point it at a
different deployment (for example a local dev server) with `POOF_BASE`:

```sh
export POOF_BASE=https://poof.localhost
```

## Commands

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
can only be opened in a browser, not from the CLI.

## License

MIT
