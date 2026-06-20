// The opaque-origin sandbox document (ADR-0012). Served by the worker at
// /sandbox.html with SANDBOX_CSP as a response header, so it is a real
// same-origin document (a real URL does not inherit the parent's strict CSP,
// unlike a blob/srcdoc/data frame) and is not subject to the assets layer's
// .html redirect or SPA fallback.
//
// The web app loads it into an iframe with sandbox="allow-scripts" and no
// allow-same-origin, giving it a unique opaque origin: even if a payload ran
// inside, it could not read the parent's location.hash (the Fragment Key),
// cookies, or storage. It receives only decrypted bytes by postMessage and
// renders text via textContent (never HTML) or an image via a blob URL.

// 'unsafe-inline' is for this document's own bootstrap only, which is safe
// because the sandbox holds no key and cannot reach the parent. frame-ancestors
// 'self' limits who may embed it to the same-origin app.
export const SANDBOX_CSP =
  "default-src 'none'; img-src blob: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'self'";

export const SANDBOX_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>html,body{margin:0}body{font:14px/1.5 ui-monospace,Menlo,Consolas,monospace;color:#ededed;background:#1b1b1e}#r{padding:14px;white-space:pre-wrap;word-break:break-word}img{max-width:100%;height:auto;display:block;border-radius:8px}</style>
</head>
<body>
<div id="r"></div>
<script>
(function () {
  var r = document.getElementById("r");
  addEventListener("message", function (e) {
    var m = e.data;
    if (!m || m.type !== "poof-render") return;
    if (m.mode === "text") {
      r.textContent = m.text;
    } else if (m.mode === "image") {
      var u = URL.createObjectURL(new Blob([m.bytes], { type: m.mime || "application/octet-stream" }));
      var i = new Image();
      i.src = u;
      r.appendChild(i);
    }
  });
  parent.postMessage("poof-sandbox-ready", "*");
})();
</script>
</body>
</html>`;
