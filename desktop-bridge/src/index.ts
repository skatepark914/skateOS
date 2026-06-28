import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";

// Desktop bridge — "Local Query" MCP connector.
// Read path (MCP tools) is served to Claude on ANY device. Write path (/ingest) is
// fed by a Mac-side sync script. Data lives in this Worker's own D1 (DESK_DB).

interface Env {
  DESK_MCP: DurableObjectNamespace;
  DESK_DB: D1Database;
  CONNECTOR_SECRET: string; // path secret for the MCP read endpoint
  INGEST_SECRET: string; // path secret the Mac sync script uses to write
}

async function ensureSchema(db: D1Database) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS messages (
        ext_id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        sender TEXT,
        chat   TEXT,
        body   TEXT,
        ts     INTEGER NOT NULL
      )`
    )
    .run();
  await db
    .prepare(`CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(ts)`)
    .run();
}

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Math.floor(Number(n) || lo)));
const fmtTs = (ts: number) => new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 16);

export class DeskMCP extends McpAgent<Env, {}, {}> {
  server = new McpServer({ name: "Desktop Search", version: "1.0.0" });

  async init() {
    const db = this.env.DESK_DB;

    this.server.registerTool(
      "search_messages",
      {
        description:
          "Full-text-ish search across synced desktop message logs (iMessage, etc.). Matches the query against message body, sender, and chat name. Returns most recent matches first.",
        inputSchema: {
          query: z.string().describe("words to search for"),
          source: z
            .string()
            .optional()
            .describe("optional source filter, e.g. 'imessage'"),
          limit: z.number().default(20).describe("max results (1-50)"),
        },
      },
      async ({ query, source, limit }) => {
        await ensureSchema(db);
        const q = (query || "").trim();
        if (!q) return text("Provide search words.");
        const l = clamp(limit ?? 20, 1, 50);
        const like = `%${q}%`;
        const where = source
          ? `(body LIKE ?1 OR sender LIKE ?1 OR chat LIKE ?1) AND source = ?2`
          : `(body LIKE ?1 OR sender LIKE ?1 OR chat LIKE ?1)`;
        const stmt = db
          .prepare(
            `SELECT source, sender, chat, body, ts FROM messages WHERE ${where} ORDER BY ts DESC LIMIT ${l}`
          );
        const bound = source ? stmt.bind(like, source) : stmt.bind(like);
        const { results } = await bound.all<any>();
        const body =
          (results || [])
            .map(
              (m) =>
                `[${fmtTs(m.ts)}] (${m.source}) ${m.sender || "?"}${m.chat ? " · " + m.chat : ""}: ${String(m.body || "").slice(0, 280)}`
            )
            .join("\n") || `No messages match "${q}".`;
        return text(body);
      }
    );

    this.server.registerTool(
      "recent_messages",
      {
        description:
          "Most recent synced desktop messages, newest first. Optionally filter by source (e.g. 'imessage').",
        inputSchema: {
          source: z.string().optional().describe("optional source filter"),
          limit: z.number().default(20).describe("max results (1-50)"),
        },
      },
      async ({ source, limit }) => {
        await ensureSchema(db);
        const l = clamp(limit ?? 20, 1, 50);
        const stmt = source
          ? db
              .prepare(
                `SELECT source, sender, chat, body, ts FROM messages WHERE source = ?1 ORDER BY ts DESC LIMIT ${l}`
              )
              .bind(source)
          : db.prepare(
              `SELECT source, sender, chat, body, ts FROM messages ORDER BY ts DESC LIMIT ${l}`
            );
        const { results } = await stmt.all<any>();
        const body =
          (results || [])
            .map(
              (m) =>
                `[${fmtTs(m.ts)}] (${m.source}) ${m.sender || "?"}${m.chat ? " · " + m.chat : ""}: ${String(m.body || "").slice(0, 280)}`
            )
            .join("\n") || "No messages synced yet.";
        return text(body);
      }
    );

    this.server.registerTool(
      "desktop_status",
      {
        description:
          "Sync health: how many messages are stored, per source, and how fresh the latest one is. Use to check whether the Mac sync has run recently.",
        inputSchema: {},
      },
      async () => {
        await ensureSchema(db);
        const { results } = await db
          .prepare(
            `SELECT source, COUNT(*) n, MAX(ts) latest FROM messages GROUP BY source ORDER BY n DESC`
          )
          .all<any>();
        if (!results || !results.length)
          return text("No messages synced yet. Run the Mac sync script (sync-imessage.py).");
        const body = results
          .map((r) => `• ${r.source}: ${r.n} messages · latest ${fmtTs(r.latest)} UTC`)
          .join("\n");
        return text(`Desktop sync status\n${body}`);
      }
    );
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    // Write path: Mac sync script POSTs message batches here.
    const ingestPath = `/ingest/${env.INGEST_SECRET}`;
    if (url.pathname === ingestPath && request.method === "POST") {
      await ensureSchema(env.DESK_DB);
      let payload: any;
      try {
        payload = await request.json();
      } catch {
        return new Response("bad json", { status: 400 });
      }
      const msgs: any[] = Array.isArray(payload?.messages) ? payload.messages : [];
      if (!msgs.length) return Response.json({ ok: true, inserted: 0 });
      const stmt = env.DESK_DB.prepare(
        `INSERT OR REPLACE INTO messages (ext_id, source, sender, chat, body, ts)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
      );
      const batch = msgs
        .filter((m) => m && m.ext_id && m.ts)
        .map((m) =>
          stmt.bind(
            String(m.ext_id),
            String(m.source || "imessage"),
            m.sender ? String(m.sender) : null,
            m.chat ? String(m.chat) : null,
            m.body ? String(m.body) : null,
            Math.floor(Number(m.ts))
          )
        );
      if (batch.length) await env.DESK_DB.batch(batch);
      return Response.json({ ok: true, inserted: batch.length });
    }

    // Read path: the MCP connector Claude (any device) talks to.
    const base = `/desk/${env.CONNECTOR_SECRET}/mcp`;
    if (url.pathname === base || url.pathname.startsWith(base + "/")) {
      return DeskMCP.serve(base, { binding: "DESK_MCP" }).fetch(request, env, ctx);
    }

    if (url.pathname === "/") return new Response("desktop bridge OK", { status: 200 });
    return new Response("not found", { status: 404 });
  },
};
