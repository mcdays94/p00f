// @ts-nocheck
// poof MCP server (POOF-17, ADR-0010). Local stdio server over @p00f/core: the
// agent's own process holds the Fragment Key and decrypts locally, so the hosted
// API only ever sees ciphertext. A remote MCP facade could only relay ciphertext.
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { poofCreate, poofRead, poofInfo, poofBurn } from "./tools";
import { ttlToMs, readsToBudget } from "../cli/args";

const BASE = process.env.POOF_BASE || process.env.P00F_BASE || "https://poof.localhost";
const http = (u, init) => fetch(u, init);

function text(obj) {
  return { content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj) }] };
}

const server = new McpServer({ name: "poof", version: "0.1.0" });

server.registerTool(
  "poof_create",
  {
    title: "Create a Poof clip",
    description:
      "Encrypt content client-side and return a one-time, expiring Link to hand to a human or another agent. The server only ever sees ciphertext.",
    inputSchema: {
      content: z.string(),
      kind: z.string().optional(),
      ttl: z.string().optional(),
      reads: z.string().optional(),
      pin: z.string().optional(),
    },
  },
  async (a) => {
    const c = await poofCreate(http, BASE, {
      content: a.content,
      kind: a.kind,
      ttlMs: ttlToMs(a.ttl),
      reads: readsToBudget(a.reads),
      pin: a.pin,
    });
    return text({ link: c.link, ownerToken: c.ownerToken, note: "share the Link; keep ownerToken to burn early" });
  },
);

server.registerTool(
  "poof_read",
  {
    title: "Read a Poof clip",
    description:
      "Fetch and decrypt a Poof Link, consuming one reveal. Decryption happens here (caller side); the server never sees the key. A secret-kind clip requires confirm=true.",
    inputSchema: { link: z.string(), pin: z.string().optional(), confirm: z.boolean().optional() },
  },
  async (a) => text(await poofRead(http, a.link, { pin: a.pin, confirm: a.confirm })),
);

server.registerTool(
  "poof_info",
  {
    title: "Inspect a Poof clip (non-consuming)",
    description: "Return kind, reveals remaining, and pin requirement without spending a reveal.",
    inputSchema: { link: z.string() },
  },
  async (a) => text(await poofInfo(http, a.link)),
);

server.registerTool(
  "poof_burn",
  {
    title: "Burn a Poof clip",
    description: "Destroy a clip immediately using its owner token.",
    inputSchema: { link: z.string(), ownerToken: z.string() },
  },
  async (a) => text(await poofBurn(http, a.link, a.ownerToken)),
);

await server.connect(new StdioServerTransport());
