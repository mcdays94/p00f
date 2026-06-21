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
// renders text via textContent (never HTML), code via the inlined highlighter
// (token text still goes through textContent, so injection payloads stay
// inert), or an image via a blob URL.

import { LANGS } from "./highlight";

// 'unsafe-inline' is for this document's own bootstrap only, which is safe
// because the sandbox holds no key and cannot reach the parent. frame-ancestors
// 'self' limits who may embed it to the same-origin app.
export const SANDBOX_CSP =
  "default-src 'none'; img-src blob: data:; media-src blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'self'";

// Serialize the grammars as a JS object literal. JSON.stringify is valid JS,
// and we escape '<' to its \u003c form so a grammar pattern that contains '<'
// (the HTML rules do) cannot terminate the inline <script> block.
const LANGS_LITERAL = JSON.stringify(LANGS).replace(/</g, "\\u003c");

export const SANDBOX_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
html,body{margin:0}
body{font:14px/1.5 ui-monospace,Menlo,Consolas,monospace;color:#ededed;background:#1b1b1e}
#r{padding:14px;white-space:pre-wrap;word-break:break-word}
img,video{max-width:100%;height:auto;display:block;border-radius:8px}
audio{width:100%;display:block}
pre.code{margin:0;padding:0;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;color:#ededed;background:transparent;border:0}
pre.code .t-c{color:#8a8a92;font-style:italic}
pre.code .t-s{color:#3ad29f}
pre.code .t-n{color:#ff9d6b}
pre.code .t-k{color:#ff6363}
pre.code .t-i{color:#ededed}
pre.code .t-p{color:#8a8a92}
pre.code .t-o{color:#c94f4f}
</style>
</head>
<body>
<div id="r"></div>
<script>
(function () {
  var LANGS = ${LANGS_LITERAL};
  // Tokenize the source against a language. Token text is a raw slice of the
  // input. Nothing is HTML-escaped here; the render step uses textContent on
  // every span and text node, so a payload like \\u003cscript\\u003e stays
  // inert visible text.
  function tokenize(src, lang) {
    var def = LANGS[lang];
    if (!def) return src ? [["", src]] : [];
    var compiled = [];
    for (var k = 0; k < def.rules.length; k++) {
      compiled.push([new RegExp(def.rules[k][0], "ym"), def.rules[k][1]]);
    }
    var tokens = [];
    var i = 0;
    var n = src.length;
    while (i < n) {
      var matched = false;
      for (var r = 0; r < compiled.length; r++) {
        var re = compiled[r][0];
        re.lastIndex = i;
        var m = re.exec(src);
        if (m && m.index === i && m[0].length > 0) {
          tokens.push([compiled[r][1], m[0]]);
          i = re.lastIndex;
          matched = true;
          break;
        }
      }
      if (!matched) {
        tokens.push(["", src.charAt(i)]);
        i++;
      }
    }
    var merged = [];
    for (var j = 0; j < tokens.length; j++) {
      var last = merged.length ? merged[merged.length - 1] : null;
      if (last && last[0] === tokens[j][0]) last[1] += tokens[j][1];
      else merged.push([tokens[j][0], tokens[j][1]]);
    }
    return merged;
  }
  // Score each grammar and pick the best, with a floor of 1 to beat "plain".
  function detectLanguage(src) {
    if (!src) return "plain";
    var best = "plain";
    var bestScore = 0;
    var names = Object.keys(LANGS);
    for (var i = 0; i < names.length; i++) {
      var re = new RegExp(LANGS[names[i]].score, "gm");
      var m = src.match(re);
      var s = m ? m.length : 0;
      if (s > bestScore) {
        bestScore = s;
        best = names[i];
      }
    }
    return bestScore >= 1 ? best : "plain";
  }
  // Render a code Clip. Build a <pre> programmatically; every token's text is
  // written via textContent (or document.createTextNode), so a code payload
  // that contains raw markup is shown as text, never executed.
  function renderCode(root, src) {
    var lang = detectLanguage(src);
    var toks = tokenize(src, lang);
    var pre = document.createElement("pre");
    pre.className = "code";
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (t[0]) {
        var span = document.createElement("span");
        span.className = "t-" + t[0];
        span.textContent = t[1];
        pre.appendChild(span);
      } else {
        pre.appendChild(document.createTextNode(t[1]));
      }
    }
    root.appendChild(pre);
  }
  var r = document.getElementById("r");
  // Post the rendered content height to the parent so the reveal iframe can
  // size itself to its content (#15). The message carries only a number; no
  // origin info, no key (the sandbox never had the key), and the opaque-origin
  // guarantee is unchanged.
  function postSize() {
    parent.postMessage({ type: "poof-size", height: document.documentElement.scrollHeight }, "*");
  }
  addEventListener("message", function (e) {
    var m = e.data;
    if (!m || m.type !== "poof-render") return;
    if (m.mode === "text") {
      r.textContent = m.text;
      postSize();
    } else if (m.mode === "code") {
      renderCode(r, m.text);
      postSize();
    } else if (m.mode === "image") {
      var u = URL.createObjectURL(new Blob([m.bytes], { type: m.mime || "application/octet-stream" }));
      var i = new Image();
      // Measure AFTER the image decodes so scrollHeight reflects its rendered
      // size. An onerror still posts a size so the box never stays stuck at
      // the wire min-height.
      i.onload = postSize;
      i.onerror = postSize;
      i.src = u;
      r.appendChild(i);
    } else if (m.mode === "video" || m.mode === "audio") {
      // Play media inline via a blob URL (CSP allows media-src blob:). The
      // sandbox is opaque-origin and never holds the key, so even a malicious
      // media payload cannot reach the parent's fragment. Controls let the
      // viewer play/scrub; size is posted once metadata (dimensions) is known.
      var mu = URL.createObjectURL(new Blob([m.bytes], { type: m.mime || "application/octet-stream" }));
      var el = document.createElement(m.mode);
      el.controls = true;
      el.preload = "metadata";
      if (m.mode === "video") el.setAttribute("playsinline", "");
      el.onloadedmetadata = postSize;
      el.onerror = postSize;
      el.src = mu;
      r.appendChild(el);
    }
  });
  parent.postMessage("poof-sandbox-ready", "*");
})();
</script>
</body>
</html>`;
