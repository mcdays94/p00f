# p00f-core

The zero-knowledge engine behind [p00f](https://github.com/mcdays94/p00f): one
small module that encrypts and decrypts entirely caller-side, builds and parses
share Links, and talks to the p00f API as a ciphertext-only client. It is Web
Crypto only, so the same code runs in browsers, Node 20+, and Cloudflare Workers
(workerd). The web app and the CLI are thin shells over it.

## Trust model

The Fragment Key lives only in the URL fragment (after `#`) and is never sent to
the server. The server holds ciphertext and cannot read content or recover a
lost link. Whoever holds the link can decrypt it.

## Install

```sh
npm install p00f-core
```

## Use

```ts
import { create, read, info, burn } from "p00f-core";

const base = "https://p00f.example"; // a p00f deployment
const te = new TextEncoder();

// Create a clip. The returned Link carries the key in its fragment.
const { link, ownerToken } = await create(fetch, base, {
  content: te.encode("hello agents"),
  meta: { kind: "text", mime: "text/plain", size: 12 },
  ttlMs: 5 * 60_000,
  revealBudget: 1,
});

// Non-consuming: decrypt only the metadata.
const meta = await info(fetch, link);

// Consuming: reveal and decrypt the content.
const result = await read(fetch, link);
if (result.ok) new TextDecoder().decode(result.content);

// Owner-gated early burn (the owner token never travels in the Link).
await burn(fetch, link, ownerToken);
```

Lower-level building blocks are also exported: `generateMasterKey`,
`generateClipId`, `encryptBlob`, `decryptBlob`, `buildLink`, `parseLink`, and the
ciphertext-only protocol client (`createClip`, `getMeta`, `revealClip`,
`deleteClip`). Every network function takes an injected `fetch`, so the key
never reaches anything that talks to the server.

## License

MIT
