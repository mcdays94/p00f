# 0003 - Content model: kinds, unified input, two-blob payload

**Status:** accepted

Poof supports four Clip kinds (text, code, image, file), all entered through a single paste/drop target that infers the kind client-side. To give recipients informed consent before a budget-consuming Reveal, each Clip is stored as two independently encrypted blobs: a small metadata blob and the content blob.

## Decisions

- **Kinds:** text, code, image, file. Determined client-side at create time; the server never sees the kind.
- **Input:** one unified paste/drop target, no mode picker. Pasted text that parses as a language is treated as code (auto-detected, manual override available). A pasted or dragged image becomes an image Clip; any other dragged file becomes a file Clip.
- **Render on Reveal** (all client-side, after decryption): code = syntax highlighting + raw copy; image = inline preview + copy-to-clipboard + download; file = name/size + download; text = rendered + copy.
- **Two-blob payload:**
  - **Metadata blob** (encrypted): kind, filename, byte size, language/mime. Fetched on page load and decrypted client-side with the Fragment Key. Fetching it does NOT consume reveal budget.
  - **Content blob** (encrypted): the actual bytes. Released only on the explicit Reveal action, which consumes one unit of reveal budget.

## Consequences

- The recipient sees an honest pre-reveal card (kind, filename, size, reveals remaining) without the server ever learning the content type and without spending a reveal.
- Link unfurlers cannot populate the card: no Fragment Key and no JS execution, so the metadata stays opaque to them. Auto-fetching the metadata blob on load is therefore safe (non-consuming and undecryptable by bots).
- Residual leak: ciphertext length approximates content size, consistent with the size shown to the recipient. Optional padding to size buckets can be added later.
- This refines the "content type stored inside the encrypted payload" note in ADR-0001: the type now lives in a dedicated encrypted metadata blob. The zero-knowledge guarantee is unchanged.
