// Sandbox-side syntax highlighter for revealed code Clips (POOF-11 / ADR-0012).
//
// Two non-negotiable design rules:
//   1. Tokenization is data-only. Each rule produces a [type, text] pair where
//      `text` is a raw, unescaped slice of the source. The sandbox renders
//      each token by setting `textContent` on a <span> (never innerHTML), so a
//      payload like `<script>alert(1)</script>` inside a code Clip becomes
//      visible text, never live markup.
//   2. The data lives here and is shared with the inlined sandbox script via
//      JSON serialization (see sandbox-doc.ts), so the algorithm and the
//      grammars stay in lockstep across the unit tests and the served doc.
//
// Curated languages cover the common cases (js/ts, json, html/xml, css,
// python, bash, go, rust, sql, yaml, markdown). Auto-detection inside the
// sandbox uses a per-language score regex; unknown content falls back to
// plain (no highlighting, just `textContent`).

export type Rule = [pattern: string, type: string];

export interface LangSpec {
  // Ordered tokenization rules. Each pattern is anchored (sticky 'y' flag at
  // tokenize time) and matched in order; the first that consumes >0 chars at
  // the current position wins.
  rules: Rule[];
  // Regex source used by detectLanguage. Match count is the language's score;
  // the highest-scoring language wins, with a minimum of 1 to beat "plain".
  score: string;
}

// Reusable string-literal patterns. Single backslashes in these strings become
// regex escape sequences after `new RegExp(...)`.
const STR_DQ = String.raw`"(?:\\.|[^"\\\n])*"`;
const STR_SQ = String.raw`'(?:\\.|[^'\\\n])*'`;
const STR_BQ = "`(?:\\\\.|\\$\\{[^}]*\\}|[^`\\\\])*`";

const KW_JS = [
  "const", "let", "var", "function", "return", "if", "else", "for", "while", "do",
  "switch", "case", "default", "break", "continue", "new", "delete", "typeof",
  "instanceof", "class", "extends", "super", "this", "null", "undefined", "true",
  "false", "async", "await", "import", "export", "from", "as", "of", "in", "try",
  "catch", "finally", "throw", "yield", "static", "interface", "type", "enum",
  "public", "private", "protected", "readonly", "void", "never", "any", "unknown",
  "declare", "abstract", "implements", "namespace", "module",
].join("|");

const KW_PY = [
  "def", "class", "return", "if", "elif", "else", "for", "while", "break",
  "continue", "pass", "import", "from", "as", "in", "is", "not", "and", "or",
  "with", "yield", "try", "except", "finally", "raise", "lambda", "global",
  "nonlocal", "True", "False", "None", "async", "await", "self",
].join("|");

const KW_GO = [
  "func", "package", "import", "var", "const", "type", "struct", "interface",
  "return", "if", "else", "for", "range", "switch", "case", "default", "break",
  "continue", "go", "defer", "chan", "map", "select", "fallthrough", "true",
  "false", "nil",
].join("|");

const KW_RS = [
  "fn", "let", "mut", "const", "static", "pub", "use", "mod", "crate", "self",
  "Self", "super", "return", "if", "else", "for", "while", "loop", "match",
  "in", "break", "continue", "struct", "enum", "impl", "trait", "where", "type",
  "as", "move", "ref", "true", "false", "unsafe", "async", "await", "dyn", "box",
].join("|");

const KW_SQL_UPPER = [
  "SELECT", "FROM", "WHERE", "INSERT", "INTO", "VALUES", "UPDATE", "SET",
  "DELETE", "CREATE", "TABLE", "INDEX", "VIEW", "DROP", "ALTER", "ADD", "JOIN",
  "INNER", "LEFT", "RIGHT", "OUTER", "ON", "GROUP", "BY", "ORDER", "HAVING",
  "LIMIT", "OFFSET", "UNION", "ALL", "DISTINCT", "AS", "AND", "OR", "NOT",
  "NULL", "IS", "IN", "LIKE", "BETWEEN", "EXISTS", "CASE", "WHEN", "THEN",
  "ELSE", "END", "PRIMARY", "KEY", "FOREIGN", "REFERENCES", "DEFAULT",
  "CONSTRAINT", "UNIQUE", "WITH",
];
// SQL keywords come in upper or lower case in the wild; alternate both.
const KW_SQL = [
  ...KW_SQL_UPPER,
  ...KW_SQL_UPPER.map((w) => w.toLowerCase()),
].join("|");

const KW_SH = [
  "if", "then", "elif", "else", "fi", "for", "in", "do", "done", "while",
  "until", "case", "esac", "function", "return", "break", "continue", "exit",
  "local", "export", "echo", "read", "set", "unset", "source", "alias", "trap",
  "shift", "test",
].join("|");

export const LANGS: Record<string, LangSpec> = {
  js: {
    rules: [
      [String.raw`\/\/[^\n]*`, "c"],
      [String.raw`\/\*[\s\S]*?\*\/`, "c"],
      [STR_BQ, "s"],
      [STR_DQ, "s"],
      [STR_SQ, "s"],
      [String.raw`\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b`, "n"],
      [String.raw`\b(?:${KW_JS})\b`, "k"],
      [String.raw`[A-Za-z_$][\w$]*`, "i"],
      [String.raw`\s+`, ""],
      [String.raw`[+\-*\/=<>!&|^~?:.;,(){}\[\]]`, "p"],
    ],
    score: String.raw`\b(?:const|let|function|var|await|async)\b|=>|\bconsole\.|;\s*$`,
  },
  json: {
    rules: [
      [STR_DQ, "s"],
      [String.raw`\b(?:true|false|null)\b`, "k"],
      [String.raw`-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?`, "n"],
      [String.raw`\s+`, ""],
      [String.raw`[{}\[\]:,]`, "p"],
    ],
    score: String.raw`^\s*[{\[]|"\w+"\s*:\s*(?:"|true|false|null|-?\d|\[|\{)`,
  },
  html: {
    rules: [
      [String.raw`<!--[\s\S]*?-->`, "c"],
      [String.raw`<!?\/?[a-zA-Z][\w-]*`, "k"],
      [STR_DQ, "s"],
      [STR_SQ, "s"],
      [String.raw`[a-zA-Z_-]+(?==)`, "i"],
      [String.raw`\s+`, ""],
      [String.raw`[<>\/=]`, "p"],
    ],
    score: String.raw`<\/?[a-zA-Z][\w-]*(?:\s|>|\/>)|<!doctype\s`,
  },
  css: {
    rules: [
      [String.raw`\/\*[\s\S]*?\*\/`, "c"],
      [STR_DQ, "s"],
      [STR_SQ, "s"],
      [String.raw`#[\da-fA-F]{3,8}\b`, "n"],
      [String.raw`\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?\b`, "n"],
      [String.raw`@[A-Za-z-]+`, "k"],
      [String.raw`--[\w-]+`, "k"],
      [String.raw`[.#:][A-Za-z_-][\w-]*`, "k"],
      [String.raw`[A-Za-z-]+(?=\s*:)`, "i"],
      [String.raw`\s+`, ""],
      [String.raw`[{}();,:]`, "p"],
    ],
    score: String.raw`\{[^{}]*\b[a-z-]+\s*:\s*[^;{}]+;|@(?:media|import|keyframes|font-face|supports)\b`,
  },
  python: {
    rules: [
      [String.raw`#[^\n]*`, "c"],
      [String.raw`"""[\s\S]*?"""`, "s"],
      [String.raw`'''[\s\S]*?'''`, "s"],
      [STR_DQ, "s"],
      [STR_SQ, "s"],
      [String.raw`\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b`, "n"],
      [String.raw`\b(?:${KW_PY})\b`, "k"],
      [String.raw`@[A-Za-z_]\w*`, "k"],
      [String.raw`[A-Za-z_]\w*`, "i"],
      [String.raw`\s+`, ""],
      [String.raw`[+\-*\/=<>!&|^~?:.;,(){}\[\]]`, "p"],
    ],
    score: String.raw`\bdef\s+\w+\s*\(|^\s*import\s+\w|^\s*from\s+\w+\s+import|\bself\b|^\s*@\w`,
  },
  bash: {
    rules: [
      [String.raw`#[^\n]*`, "c"],
      [STR_DQ, "s"],
      [STR_SQ, "s"],
      [String.raw`\$\{[^}]+\}|\$[A-Za-z_]\w*|\$\d+|\$\?|\$\$`, "i"],
      [String.raw`\b(?:${KW_SH})\b`, "k"],
      [String.raw`-{1,2}[A-Za-z][\w-]*`, "n"],
      [String.raw`[A-Za-z_][\w]*`, ""],
      [String.raw`\s+`, ""],
      [String.raw`[|&;<>(){}\[\]]`, "p"],
    ],
    score: String.raw`^#!\s*\/|\$\{?[A-Za-z_]|^\s*(?:if|for|while|function)\s|\b(?:echo|export|local)\s`,
  },
  go: {
    rules: [
      [String.raw`\/\/[^\n]*`, "c"],
      [String.raw`\/\*[\s\S]*?\*\/`, "c"],
      [STR_BQ, "s"],
      [STR_DQ, "s"],
      [String.raw`'(?:\\.|[^'\\])'`, "s"],
      [String.raw`\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b`, "n"],
      [String.raw`\b(?:${KW_GO})\b`, "k"],
      [String.raw`[A-Za-z_]\w*`, "i"],
      [String.raw`\s+`, ""],
      [String.raw`[+\-*\/=<>!&|^~?:.;,(){}\[\]]`, "p"],
    ],
    score: String.raw`\bfunc\s+(?:\(\w+\s+\*?\w+\)\s+)?\w+\s*\(|\bpackage\s+\w+|:=|\bimport\s*\(`,
  },
  rust: {
    rules: [
      [String.raw`\/\/[^\n]*`, "c"],
      [String.raw`\/\*[\s\S]*?\*\/`, "c"],
      [String.raw`r#?"(?:[^"]|"(?!#))*"#?`, "s"],
      [STR_DQ, "s"],
      [String.raw`'(?:\\.|[^'\\])'`, "s"],
      [String.raw`\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?:u8|u16|u32|u64|usize|i8|i16|i32|i64|isize|f32|f64)?\b`, "n"],
      [String.raw`\b(?:${KW_RS})\b`, "k"],
      [String.raw`[A-Za-z_]\w*!?`, "i"],
      [String.raw`\s+`, ""],
      [String.raw`[+\-*\/=<>!&|^~?:.;,(){}\[\]]`, "p"],
    ],
    score: String.raw`\bfn\s+\w+\s*[<(]|\blet\s+(?:mut\s+)?\w+|\bimpl\s+|::\w+|\bpub\s+(?:fn|struct|enum|mod)|\bprintln!|\bvec!`,
  },
  sql: {
    rules: [
      [String.raw`--[^\n]*`, "c"],
      [String.raw`\/\*[\s\S]*?\*\/`, "c"],
      [STR_SQ, "s"],
      [STR_DQ, "s"],
      [String.raw`\b\d+(?:\.\d+)?\b`, "n"],
      [String.raw`\b(?:${KW_SQL})\b`, "k"],
      [String.raw`[A-Za-z_]\w*`, "i"],
      [String.raw`\s+`, ""],
      [String.raw`[+\-*\/=<>!&|^~?:.;,(){}\[\]]`, "p"],
    ],
    score: String.raw`\b(?:SELECT|select)\b[\s\S]{0,200}?\b(?:FROM|from)\b|\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b|\bDELETE\s+FROM\b|\bCREATE\s+TABLE\b|\bJOIN\s+\w`,
  },
  yaml: {
    rules: [
      [String.raw`#[^\n]*`, "c"],
      [STR_DQ, "s"],
      [STR_SQ, "s"],
      [String.raw`\b(?:true|false|null|yes|no|on|off)\b`, "k"],
      [String.raw`\b\d+(?:\.\d+)?\b`, "n"],
      [String.raw`---|\.\.\.`, "p"],
      [String.raw`[A-Za-z_][\w-]*(?=\s*:)`, "i"],
      [String.raw`\s+`, ""],
      [String.raw`[:,\[\]{}|>&*-]`, "p"],
    ],
    score: String.raw`^---\s*$|^[A-Za-z_][\w-]*\s*:\s|^\s+[A-Za-z_][\w-]*\s*:\s|^\s*-\s+\w`,
  },
  markdown: {
    rules: [
      [String.raw`\`\`\`[\s\S]*?\`\`\``, "s"],
      [String.raw`\`[^\`\n]+\``, "s"],
      [String.raw`^#{1,6}\s[^\n]*`, "k"],
      [String.raw`\*\*[^*\n]+\*\*|__[^_\n]+__`, "k"],
      [String.raw`\*[^*\n]+\*|_[^_\n]+_`, "i"],
      [String.raw`\[[^\]]+\]\([^)]+\)`, "n"],
      [String.raw`^\s*[-*+]\s`, "p"],
      [String.raw`^\s*>\s`, "c"],
      [String.raw`\s+`, ""],
      [String.raw`[^\s]+`, ""],
    ],
    score: String.raw`^#{1,6}\s|^\s*[-*+]\s+\w|\*\*[^*]+\*\*|^\s*>\s|\`\`\``,
  },
};

// Tokenize `src` against the language `lang`. Always returns a list whose
// concatenated `text` round-trips to `src`. Unknown languages collapse to a
// single plain token. The "y" (sticky) and "m" (multiline) flags are needed
// for anchored, line-aware matching at each cursor position.
export function tokenize(src: string, lang: string): Array<[string, string]> {
  const def = LANGS[lang];
  if (!def) return src ? [["", src]] : [];
  const compiled: Array<[RegExp, string]> = def.rules.map((r) => [new RegExp(r[0], "ym"), r[1]]);
  const tokens: Array<[string, string]> = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    let matched = false;
    for (const [re, type] of compiled) {
      re.lastIndex = i;
      const m = re.exec(src);
      if (m && m.index === i && m[0].length > 0) {
        tokens.push([type, m[0]]);
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
  // Merge adjacent same-type tokens to keep the rendered DOM small.
  const merged: Array<[string, string]> = [];
  for (const t of tokens) {
    const last = merged.length > 0 ? merged[merged.length - 1] : undefined;
    if (last && last[0] === t[0]) last[1] += t[1];
    else merged.push([t[0], t[1]]);
  }
  return merged;
}

// Auto-detect the language for `src`. Each grammar's `score` regex is scanned
// in "gm" mode; the language with the most matches wins, with a floor of 1.
// Below the floor we return "plain" and the sandbox renders the source via
// textContent only.
export function detectLanguage(src: string): string {
  if (!src) return "plain";
  let best = "plain";
  let bestScore = 0;
  for (const name of Object.keys(LANGS)) {
    const re = new RegExp(LANGS[name].score, "gm");
    const m = src.match(re);
    const s = m ? m.length : 0;
    if (s > bestScore) {
      bestScore = s;
      best = name;
    }
  }
  return bestScore >= 1 ? best : "plain";
}
