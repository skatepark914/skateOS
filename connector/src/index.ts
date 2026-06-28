import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";

interface Env {
  SKATE_MCP: DurableObjectNamespace;
  SUPABASE_PAT: string;
  SUPABASE_REF: string;
  CONNECTOR_SECRET: string;
}

// Run a read-only SQL query against the cloud Supabase via the Management API.
async function sql(env: Env, query: string): Promise<any[]> {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${env.SUPABASE_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.SUPABASE_PAT}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    }
  );
  const txt = await r.text();
  if (!r.ok) throw new Error(`db ${r.status}: ${txt.slice(0, 300)}`);
  return JSON.parse(txt);
}

const esc = (s: string) => s.replace(/'/g, "''");
const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Math.floor(Number(n) || lo)));
const money = (n: any) =>
  "$" +
  Number(n || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export class SkateMCP extends McpAgent<Env, {}, {}> {
  server = new McpServer({ name: "skateOS", version: "1.0.0" });

  async init() {
    const env = this.env;

    this.server.registerTool(
      "park_stats",
      {
        description:
          "Get 2nd Nature Park totals: number of customers, lifetime sales count & revenue, and today's sales count & revenue.",
        inputSchema: {},
      },
      async () => {
        const rows = await sql(
          env,
          `select
            (select count(*) from customers) customers,
            (select count(*) from sales where status='completed') sales,
            (select coalesce(sum(total),0) from sales where status='completed') revenue,
            (select count(*) from sales where status='completed' and (created_at at time zone 'America/New_York')::date = (now() at time zone 'America/New_York')::date) sales_today,
            (select coalesce(sum(total),0) from sales where status='completed' and (created_at at time zone 'America/New_York')::date = (now() at time zone 'America/New_York')::date) revenue_today`
        );
        const r = rows[0] || {};
        return {
          content: [
            {
              type: "text",
              text: `2nd Nature Park\n• Customers: ${r.customers}\n• Lifetime sales: ${r.sales} (${money(r.revenue)})\n• Today: ${r.sales_today} sales, ${money(r.revenue_today)}`,
            },
          ],
        };
      }
    );

    this.server.registerTool(
      "top_products",
      {
        description:
          "List the top-selling products by revenue over the last N days.",
        inputSchema: {
          days: z.number().default(30).describe("look-back window in days"),
          limit: z.number().default(10).describe("how many products to return"),
        },
      },
      async ({ days, limit }) => {
        const d = clamp(days ?? 30, 1, 365);
        const l = clamp(limit ?? 10, 1, 25);
        const rows = await sql(
          env,
          `select coalesce(p.name,'(unknown)') name, sum(si.quantity) units, sum(si.total) revenue
           from sale_items si
           join sales s on s.id = si.sale_id
           left join products p on p.id = si.product_id
           where s.status='completed' and s.created_at > now() - interval '${d} days'
           group by 1 order by revenue desc limit ${l}`
        );
        const body =
          rows
            .map(
              (x: any, i: number) =>
                `${i + 1}. ${x.name} — ${money(x.revenue)} (${x.units} units)`
            )
            .join("\n") || "No sales in that window.";
        return {
          content: [{ type: "text", text: `Top products · last ${d} days\n${body}` }],
        };
      }
    );

    this.server.registerTool(
      "find_customer",
      {
        description:
          "Search customers by name, email, or phone. Returns up to 10 matches with visits and lifetime spend.",
        inputSchema: { query: z.string().describe("name, email, or phone") },
      },
      async ({ query }) => {
        const q = esc((query || "").trim());
        if (!q)
          return {
            content: [
              { type: "text", text: "Provide a name, email, or phone to search." },
            ],
          };
        const rows = await sql(
          env,
          `select name, email, phone, total_visits, total_spent, loyalty_points
           from customers
           where name ilike '%${q}%' or email ilike '%${q}%' or phone ilike '%${q}%'
           order by total_spent desc nulls last limit 10`
        );
        const body =
          rows
            .map(
              (c: any) =>
                `• ${c.name || "(no name)"} — ${c.email || "no email"} · ${c.phone || "no phone"} · ${c.total_visits || 0} visits · ${money(c.total_spent)} · ${c.loyalty_points || 0} pts`
            )
            .join("\n") || `No customers match "${query}".`;
        return { content: [{ type: "text", text: body }] };
      }
    );

    this.server.registerTool(
      "sales_summary",
      {
        description: "Total sales count and revenue over the last N days (default 7).",
        inputSchema: { days: z.number().default(7).describe("look-back window in days") },
      },
      async ({ days }) => {
        const d = clamp(days ?? 7, 1, 365);
        const rows = await sql(
          env,
          `select count(*) sales, coalesce(sum(total),0) revenue
           from sales where status='completed' and created_at > now() - interval '${d} days'`
        );
        const r = rows[0] || {};
        return {
          content: [
            {
              type: "text",
              text: `Last ${d} days: ${r.sales} sales, ${money(r.revenue)}`,
            },
          ],
        };
      }
    );
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const base = `/sk/${env.CONNECTOR_SECRET}/mcp`;
    if (url.pathname === base || url.pathname.startsWith(base + "/")) {
      return SkateMCP.serve(base, { binding: "SKATE_MCP" }).fetch(request, env, ctx);
    }
    if (url.pathname === "/") return new Response("skateOS connector OK", { status: 200 });
    return new Response("not found", { status: 404 });
  },
};
