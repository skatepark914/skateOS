// ============================================================
// square-import — direct Square API pull → skateOS DB
//
// Pulls Catalog (items + images + categories), Customers, and
// recent Orders from Square via their REST API + upserts into
// skateOS tables. Richer than CSV import because:
//   - Photos: Square's catalog includes image URLs (CSV doesn't)
//   - Variations: full SKU/price tree
//   - Categories: imported as proper categories rows
//
// Auth: SQUARE_ACCESS_TOKEN must be set as a Supabase secret.
//       Doug generates this from Square Dashboard → Apps →
//       Access tokens (sandbox key for testing OR production key).
//
// Endpoints used:
//   GET  /v2/catalog/list?types=CATEGORY  → categories
//   GET  /v2/catalog/list?types=ITEM      → products
//   GET  /v2/catalog/list?types=IMAGE     → image URLs (joined to items)
//   POST /v2/customers/search             → customers (paginated)
//
// Request shape: { action: 'preview' | 'commit', what: 'all' | 'products' | 'customers' | 'orders' }
// Response: { ok: true, summary: {...counts...}, details: {...} } on success
// ============================================================

const SQUARE_BASE = "https://connect.squareup.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

async function squareGet(path: string, token: string) {
  const r = await fetch(SQUARE_BASE + path, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Square-Version": "2024-12-18",
      "Content-Type": "application/json",
    },
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Square GET ${path} failed ${r.status}: ${txt.slice(0, 200)}`);
  }
  return r.json();
}

async function squarePost(path: string, body: unknown, token: string) {
  const r = await fetch(SQUARE_BASE + path, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Square-Version": "2024-12-18",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Square POST ${path} failed ${r.status}: ${txt.slice(0, 200)}`);
  }
  return r.json();
}

// Fetch the full /v2/catalog/list paginating via cursor
async function fetchAllCatalog(types: string, token: string) {
  const all: any[] = [];
  let cursor: string | undefined;
  let safety = 0;
  do {
    safety++;
    if (safety > 50) break;
    const qs = new URLSearchParams({ types });
    if (cursor) qs.set("cursor", cursor);
    const r = await squareGet(`/v2/catalog/list?${qs.toString()}`, token);
    if (Array.isArray(r.objects)) all.push(...r.objects);
    cursor = r.cursor;
  } while (cursor);
  return all;
}

// Brand canonicalization — Square has no clean brand field; it lives in the
// item name (e.g. "8.25in DGK Haters Deck"). Collapse to one label per brand.
const BRAND_PHRASES: [string, string][] = [
  ['toy machine','Toy Machine'], ['powell peralta','Powell Peralta'], ['anti hero','Anti Hero'],
  ['santa cruz','Santa Cruz'], ['alien workshop','Alien Workshop'], ['triple 8','Triple 8'],
  ['triple eight','Triple 8'], ['mini logo','Mini Logo'], ['nike sb','Nike SB'],
  ['new balance','New Balance'], ['fucking awesome','Fucking Awesome'], ['sci-fi fantasy','Sci-Fi Fantasy'],
  ['5 boro','5Boro'], ['2nd nature','2nd Nature'], ['thank you','Thank You'], ['sour','Sour'],
  ['thumbs','Thumbs'], ['heroin','Heroin'], ['foundation','Foundation'], ['creature','Creature'],
];
const BRAND_CANON: Record<string, string> = {
  spitfire:'Spitfire', toy:'Toy Machine', powell:'Powell Peralta', bones:'Bones', dgk:'DGK',
  triple:'Triple 8', girl:'Girl', anti:'Anti Hero', antihero:'Anti Hero', thunder:'Thunder',
  primitive:'Primitive', primitives:'Primitive', chocolate:'Chocolate', real:'Real', quasi:'Quasi',
  gx1000:'GX1000', '5boro':'5Boro', '5ball':'5Ball', mob:'Mob', snack:'Snack', snacks:'Snack',
  slappy:'Slappy', baker:'Baker', santa:'Santa Cruz', etnies:'Etnies', emerica:'Emerica',
  venture:'Venture', mtn:'MTN', dais:'Dais', jessup:'Jessup', creature:'Creature', bronson:'Bronson',
  zero:'Zero', es:'éS', krooked:'Krooked', grizzly:'Grizzly', bullet:'Bullet', deathwish:'Deathwish',
  pig:'Pig', krux:'Krux', jacuzzi:'Jacuzzi', birdhouse:'Birdhouse', alien:'Alien Workshop',
  independent:'Independent', indy:'Independent', ricta:'Ricta', lakai:'Lakai', vans:'Vans',
  adidas:'Adidas', nike:'Nike SB', enjoi:'Enjoi', magenta:'Magenta', theories:'Theories',
  cannibal:'Cannibal', opera:'Opera', polar:'Polar', thrasher:'Thrasher', welcome:'Welcome',
  hockey:'Hockey', frog:'Frog', habitat:'Habitat', element:'Element', flip:'Flip', almost:'Almost',
  globe:'Globe', deluxe:'Deluxe',
};
// KNOWN-brands only: returns null (no junk first-word guess) when unrecognized.
function canonBrandFromName(name: string): string | null {
  const low = (name || '').toLowerCase();
  for (const [pat, label] of BRAND_PHRASES) { if (low.indexOf(pat) >= 0) return label; }
  const n = (name || '').replace(/^(?:\d{1,2}(?:\.\d{1,3})?\s*(?:in\b|")|\d{2,3}\s*mm)\s*/i, '').trim();
  const f = (n.split(/\s+/)[0] || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return BRAND_CANON[f] || null;
}
// Deck width — prefer Square's variation name (where width usually lives),
// fall back to the item name. Returns "8.25" style or null.
function parseDeckSize(name: string, variationName?: string): string | null {
  const hay = (variationName || '') + ' ' + (name || '');
  const m = hay.match(/(\d{1,2}(?:\.\d{1,3})?)\s*(?:in\b|")/i);
  if (!m) return null;
  const w = parseFloat(m[1]);
  if (isNaN(w) || w < 6.5 || w > 11) return null;
  return String(w);
}
// Square Inventory counts → { catalogObjectId: quantity } across the given locations.
async function fetchInventory(variationIds: string[], locationIds: string[], token: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (let i = 0; i < variationIds.length; i += 400) {
    const ids = variationIds.slice(i, i + 400);
    let cursor: string | undefined;
    let safety = 0;
    do {
      safety++; if (safety > 50) break;
      const reqBody: any = { catalog_object_ids: ids, location_ids: locationIds, states: ["IN_STOCK"] };
      if (cursor) reqBody.cursor = cursor;
      const r = await squarePost("/v2/inventory/counts/batch-retrieve", reqBody, token);
      (r.counts || []).forEach((c: any) => {
        if (c.catalog_object_id) out[c.catalog_object_id] = (out[c.catalog_object_id] || 0) + (parseFloat(c.quantity || "0") || 0);
      });
      cursor = r.cursor;
    } while (cursor);
  }
  return out;
}

async function fetchAllCustomers(token: string) {
  const all: any[] = [];
  let cursor: string | undefined;
  let safety = 0;
  do {
    safety++;
    if (safety > 100) break;
    const body: any = { limit: 100 };
    if (cursor) body.cursor = cursor;
    const r = await squarePost(`/v2/customers/search`, body, token);
    if (Array.isArray(r.customers)) all.push(...r.customers);
    cursor = r.cursor;
  } while (cursor);
  return all;
}

function admin() {
  // Lazy import only inside Deno.serve so the function can boot even
  // when SUPABASE_URL is malformed for one call
  return null as any;
}

// Square Locations — needed for Orders search
async function fetchLocations(token: string): Promise<string[]> {
  const r = await squareGet("/v2/locations", token);
  return (r.locations || []).map((l: any) => l.id).filter(Boolean);
}

// Square Orders — paginated by cursor, scoped by location + date window
async function fetchOrders(
  token: string,
  locationIds: string[],
  startAt: string,
  endAt: string,
  startCursor?: string,
  maxPages = 8,
): Promise<{ orders: any[]; cursor?: string }> {
  const all: any[] = [];
  let cursor = startCursor;
  let pages = 0;
  do {
    pages++;
    if (pages > maxPages) break;
    const body: any = {
      location_ids: locationIds,
      query: {
        filter: {
          date_time_filter: { closed_at: { start_at: startAt, end_at: endAt } },
          // Required by Square when sort_field=CLOSED_AT: must filter to closed states
          state_filter: { states: ["COMPLETED"] },
        },
        sort: { sort_field: "CLOSED_AT", sort_order: "ASC" },
      },
      limit: 500,
    };
    if (cursor) body.cursor = cursor;
    const r = await squarePost("/v2/orders/search", body, token);
    if (Array.isArray(r.orders)) all.push(...r.orders);
    cursor = r.cursor;
    if (!cursor) break;
  } while (cursor);
  return { orders: all, cursor };
}

// Square tender type → skateOS payment method label
function tenderToPaymentMethod(tenderType: string | undefined): string {
  switch ((tenderType || "").toUpperCase()) {
    case "CARD":          return "Credit Card";
    case "CASH":          return "Cash";
    case "SQUARE_GIFT_CARD": return "Gift Card";
    case "THIRD_PARTY_CARD": return "Credit Card";
    case "OTHER":         return "Other";
    case "NO_SALE":       return "Other";
    default:              return "Other";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "POST only" }, 405);

  const sqToken = Deno.env.get("SQUARE_ACCESS_TOKEN");
  if (!sqToken) {
    return jsonResponse({
      ok: false,
      error: "SQUARE_ACCESS_TOKEN not set. Generate one at Square Dashboard → Settings → Account & Settings → Apps → Developer Apps → My Application → Access Token, then: supabase secrets set SQUARE_ACCESS_TOKEN=EAAA... --project-ref zecurmlenxyxanqucrga",
    }, 500);
  }

  let body: any;
  try { body = await req.json(); }
  catch { body = {}; }
  const action: "preview" | "commit" = body?.action === "commit" ? "commit" : "preview";
  const what: string = body?.what || "all";

  // Discounts sync — Square's DISCOUNT catalog → our promo_codes table.
  // Doug's cashiers use codes like "CLASSFREE" — pull them from Square so
  // the POS Apply button just works.
  if (what === "discounts") {
    const { createClient: cc } = await import("https://esm.sh/@supabase/supabase-js@2");
    const sbd = cc(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    let cursor: string | undefined = undefined;
    const rows: any[] = [];
    while (true) {
      const qs = new URLSearchParams({ types: "DISCOUNT" });
      if (cursor) qs.set("cursor", cursor);
      const r = await squareGet(`/v2/catalog/list?${qs.toString()}`, sqToken);
      for (const o of (r.objects || [])) {
        const d = o.discount_data || {};
        // Parse code from end of name — Square owners typically write
        // "Get N% off — CODENAME" so the code is after the em-dash.
        const rawName = String(d.name || "").trim();
        const m = rawName.match(/[—–-]\s*([A-Z0-9_]{3,30})\s*$/);
        const code = (m ? m[1] : rawName.split(/\s+/).pop() || "").toUpperCase();
        if (!code || code.length > 30 || !/^[A-Z0-9_]+$/.test(code)) continue;
        const pct = d.percentage ? parseFloat(d.percentage) : 0;
        const fixed = (d.amount_money?.amount || 0) / 100;
        const kind = pct > 0 ? "percent" : "fixed";
        const value = pct > 0 ? pct : fixed;
        if (!value || value <= 0) continue;
        rows.push({
          square_discount_id: o.id,
          code,
          kind,
          value,
          active: true,
          description: rawName,
        });
      }
      cursor = r.cursor;
      if (!cursor) break;
    }
    if (rows.length === 0) return jsonResponse({ ok: true, summary: { fetched: 0 } });
    // Dedupe within batch by code — Square may have several discounts that
    // resolve to the same code name (versioned promos). Keep the last seen.
    const byCode = new Map<string, any>();
    for (const r of rows) byCode.set(r.code, r);
    const dedupedRows = Array.from(byCode.values());
    // ON CONFLICT (code) — that's the table's full unique key. The partial
    // index on square_discount_id can't be matched without a WHERE clause
    // (Postgres limitation, same as the loyalty trigger we just fixed).
    const { data, error } = await sbd
      .from("promo_codes")
      .upsert(dedupedRows, { onConflict: "code", ignoreDuplicates: false })
      .select("id");
    if (error) return jsonResponse({ ok: false, error: error.message, attempted: dedupedRows.length, sample: dedupedRows.slice(0, 3) });
    return jsonResponse({ ok: true, summary: { fetched: rows.length, deduped: dedupedRows.length, upserted: (data || []).length } });
  }

  // Audit mode — enumerate every Square catalog type so we can verify
  // parity coverage without committing anything. Returns just the
  // first-page count + "more?" flag per type. Runs in 5-10 seconds.
  if (what === "audit") {
    const types = ["ITEM","ITEM_VARIATION","MODIFIER","MODIFIER_LIST","CATEGORY","DISCOUNT","TAX","IMAGE","PRICING_RULE","PRODUCT_SET","SUBSCRIPTION_PLAN","ITEM_OPTION"];
    const result: Record<string, { first_page: number; has_more: boolean; samples?: any[] }> = {};
    for (const t of types) {
      try {
        const qs = new URLSearchParams({ types: t });
        const r = await squareGet(`/v2/catalog/list?${qs.toString()}`, sqToken);
        const objs = r.objects || [];
        result[t] = {
          first_page: objs.length,
          has_more: !!r.cursor,
          samples: objs.slice(0, 2).map((o: any) => ({
            id: o.id,
            name: o.item_data?.name || o.category_data?.name || o.discount_data?.name || o.tax_data?.name || o.modifier_data?.name || o.modifier_list_data?.name || o.item_variation_data?.name || "(no name)",
          })),
        };
      } catch (e) {
        result[t] = { first_page: -1, has_more: false, samples: [String(e).slice(0, 100) as any] };
      }
    }
    return jsonResponse({ ok: true, audit: result });
  }

  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const summary: any = { action };
  const details: any = {};

  try {
    // ── Catalog: categories + items + images ────────────────────
    if (what === "all" || what === "products") {
      // Pull categories first
      const cats = await fetchAllCatalog("CATEGORY", sqToken);
      summary.square_categories = cats.length;

      // Build a {square_id → name} map for categories
      const catNameById: Record<string, string> = {};
      cats.forEach((c: any) => {
        const nm = c?.category_data?.name;
        if (c.id && nm) catNameById[c.id] = nm;
      });

      // Pull images
      const images = await fetchAllCatalog("IMAGE", sqToken);
      summary.square_images = images.length;
      const imageUrlById: Record<string, string> = {};
      images.forEach((im: any) => {
        const url = im?.image_data?.url;
        if (im.id && url) imageUrlById[im.id] = url;
      });

      // Pull items
      const items = await fetchAllCatalog("ITEM", sqToken);
      summary.square_items = items.length;

      // Flatten items into one row per variation
      const products: any[] = [];
      items.forEach((it: any) => {
        const d = it?.item_data;
        if (!d) return;
        const itemImageId = (d.image_ids && d.image_ids[0]) || null;
        const itemImageUrl = itemImageId ? imageUrlById[itemImageId] : null;
        const itemCatIds: string[] = d.categories ? d.categories.map((c: any) => c.id) : (d.category_id ? [d.category_id] : []);
        const catName = itemCatIds.length ? catNameById[itemCatIds[0]] : null;
        const variations = d.variations || [];
        if (!variations.length) {
          // Item without variations — treat the item itself as one product
          products.push({
            name: d.name || "(unnamed)",
            description: d.description || null,
            sku: null,
            price: 0,
            category_name: catName,
            image_url: itemImageUrl,
            square_item_id: it.id,
            square_variation_id: null,
            brand: canonBrandFromName(d.name || ""),
            size: parseDeckSize(d.name || ""),
          });
          return;
        }
        variations.forEach((v: any) => {
          const vd = v?.item_variation_data;
          if (!vd) return;
          const priceCents = vd?.price_money?.amount;
          const price = typeof priceCents === "number" ? priceCents / 100 : 0;
          const vImgId = (vd.image_ids && vd.image_ids[0]) || itemImageId;
          const vImgUrl = vImgId ? imageUrlById[vImgId] : null;
          const varName = vd.name && vd.name !== "Regular" ? `${d.name} — ${vd.name}` : d.name;
          products.push({
            name: varName || "(unnamed)",
            description: d.description || null,
            sku: vd.sku || null,
            price,
            category_name: catName,
            image_url: vImgUrl || itemImageUrl,
            square_item_id: it.id,
            square_variation_id: v.id,
            brand: canonBrandFromName(varName || d.name || ""),
            size: parseDeckSize(d.name || "", vd.name),
          });
        });
      });
      summary.skateos_products_built = products.length;
      details.products_sample = products.slice(0, 5);

      if (action === "commit") {
        // Determine resume offset — supports chunked imports
        const offset: number = typeof body?.offset === "number" ? body.offset : 0;
        const chunkSize: number = typeof body?.chunk === "number" ? body.chunk : 300;
        const slice = products.slice(offset, offset + chunkSize);

        // 1. Upsert categories first (only on first call when offset=0)
        const catIdByName: Record<string, string> = {};
        if (offset === 0) {
          const uniqueCatNames = Array.from(new Set(products.map(p => p.category_name).filter(Boolean) as string[]));
          // Pull all existing first to map case-insensitive
          const { data: existingCats } = await sb.from("categories").select("id,name");
          const existingByLc: Record<string, string> = {};
          (existingCats || []).forEach((c: any) => { if (c.name) existingByLc[String(c.name).toLowerCase()] = c.id; });
          const toCreate = uniqueCatNames.filter(n => !existingByLc[n.toLowerCase()]).map(name => ({ name }));
          if (toCreate.length > 0) {
            const { data: ins } = await sb.from("categories").insert(toCreate).select("id,name");
            (ins || []).forEach((c: any) => { if (c.name) existingByLc[String(c.name).toLowerCase()] = c.id; });
          }
          uniqueCatNames.forEach(n => { if (existingByLc[n.toLowerCase()]) catIdByName[n] = existingByLc[n.toLowerCase()]; });
          summary.categories_upserted = Object.keys(catIdByName).length;
        } else {
          // For resume calls, rebuild the cat map from existing rows
          const { data: existingCats } = await sb.from("categories").select("id,name");
          (existingCats || []).forEach((c: any) => { if (c.name) catIdByName[String(c.name)] = c.id; });
        }

        // 2. Pull live Square inventory for this slice's variations → real stock.
        const sliceVarIds = slice.map(p => p.square_variation_id || p.square_item_id).filter(Boolean) as string[];
        let qtyById: Record<string, number> = {};
        try {
          const locs = await fetchLocations(sqToken);
          if (locs.length && sliceVarIds.length) qtyById = await fetchInventory(sliceVarIds, locs, sqToken);
        } catch (invErr) {
          summary.inventory_error = String(invErr).slice(0, 200);
        }

        // 3. Map sku → owning catalog id so we can null SKUs that would collide
        //    with a *different* product on upsert (avoids sku-unique violations).
        const skuOwner: Record<string, string> = {};
        const { data: existingProds } = await sb.from("products").select("sku,square_catalog_id");
        (existingProds || []).forEach((p: any) => {
          if (p.sku && p.square_catalog_id) skuOwner[String(p.sku).toLowerCase()] = String(p.square_catalog_id);
        });

        // 4. Build upsert rows. Conflict target = square_catalog_id (unique, mig 086):
        //    existing items get price/stock/name/size/brand UPDATED; new ones INSERTED.
        const rows: any[] = [];
        for (const p of slice) {
          const sqId = p.square_variation_id || p.square_item_id;
          if (!sqId) continue;
          let sku = p.sku;
          const owner = sku ? skuOwner[String(sku).toLowerCase()] : undefined;
          if (sku && owner && owner !== sqId) sku = null; // belongs to a different product
          rows.push({
            name: p.name,
            description: p.description,
            sku,
            price: p.price,
            image_url: p.image_url,
            category_id: p.category_name ? catIdByName[p.category_name] : null,
            brand: p.brand || null,
            size: p.size || null,
            quantity: qtyById[sqId] != null ? qtyById[sqId] : 0,
            status: "active",
            square_catalog_id: sqId,
          });
        }

        let okCount = 0, failCount = 0;
        for (let i = 0; i < rows.length; i += 50) {
          const batch = rows.slice(i, i + 50);
          const { data, error } = await sb.from("products")
            .upsert(batch, { onConflict: "square_catalog_id" })
            .select("id");
          if (error) {
            for (const r of batch) {
              const { error: e2 } = await sb.from("products").upsert(r, { onConflict: "square_catalog_id" });
              if (e2) failCount++; else okCount++;
            }
          } else {
            okCount += (data || []).length;
          }
        }
        summary.products_upserted = okCount;
        summary.products_failed = failCount;
        summary.inventory_counts_found = Object.keys(qtyById).length;
        summary.processed_offset = offset;
        summary.processed_count = slice.length;
        summary.total_products = products.length;
        summary.has_more = (offset + slice.length) < products.length;
        if (summary.has_more) summary.next_offset = offset + slice.length;
      }
    }

    // ── Customers ───────────────────────────────────────────────
    if (what === "all" || what === "customers") {
      const customers = await fetchAllCustomers(sqToken);
      summary.square_customers = customers.length;
      details.customers_sample = customers.slice(0, 5).map((c: any) => ({
        name: [c.given_name, c.family_name].filter(Boolean).join(" "),
        email: c.email_address,
        phone: c.phone_number,
      }));

      if (action === "commit") {
        // Process ALL customers in one call — re-fetching from Square on every
        // chunked call triggers Square's RATE_LIMIT (100+ paginated calls each).
        // Single-pass + batch inserts keeps us under the 150s function timeout.

        // Pre-pull existing emails, phone-digits, and square_customer_ids for batch dedup
        const existingEmails = new Set<string>();
        const existingPhoneDigits = new Set<string>();
        const existingSqIds = new Set<string>();
        const { data: existingCusts } = await sb.from("customers").select("email,phone,square_customer_id");
        (existingCusts || []).forEach((c: any) => {
          if (c.email) existingEmails.add(String(c.email).toLowerCase());
          if (c.phone) {
            const d = String(c.phone).replace(/\D/g, "");
            if (d.length >= 10) existingPhoneDigits.add(d.slice(-10));
          }
          if (c.square_customer_id) existingSqIds.add(String(c.square_customer_id));
        });

        const rowsToInsert: any[] = [];
        let skipCount = 0;
        const seenEmails = new Set<string>();
        const seenPhones = new Set<string>();
        for (const c of customers) {
          if (c.id && existingSqIds.has(c.id)) { skipCount++; continue; }
          // customers.name is a GENERATED ALWAYS column. Write first_name + last_name
          // and let Postgres compute name. When neither is present, drop the
          // company/nickname/email fallback into first_name so name isn't blank.
          let first: string | null = (c.given_name || "").trim() || null;
          let last:  string | null = (c.family_name || "").trim() || null;
          if (!first && !last) {
            first = (c.company_name || c.nickname || c.email_address || "(unnamed)").toString().trim();
          }
          const email = c.email_address || null;
          const phone = c.phone_number || null;
          const emailLc = email ? String(email).toLowerCase() : null;
          const phoneDigits = phone ? String(phone).replace(/\D/g, "") : "";
          const phoneTen = phoneDigits.length >= 10 ? phoneDigits.slice(-10) : "";
          if (emailLc && (existingEmails.has(emailLc) || seenEmails.has(emailLc))) { skipCount++; continue; }
          if (phoneTen && (existingPhoneDigits.has(phoneTen) || seenPhones.has(phoneTen))) { skipCount++; continue; }
          if (emailLc) seenEmails.add(emailLc);
          if (phoneTen) seenPhones.add(phoneTen);
          const addr = c.address || {};
          rowsToInsert.push({
            first_name: first,
            last_name: last,
            email,
            phone,
            address: addr.address_line_1 || null,
            city: addr.locality || null,
            state: addr.administrative_district_level_1 || null,
            zip: addr.postal_code || null,
            notes: c.note || null,
            dob: c.birthday || null,
            square_customer_id: c.id || null,
          });
        }
        // UPSERT on square_customer_id (unique partial index). Without this,
        // re-running the import duplicates every Square customer. Edited
        // rows in Square (new phone / email) get the update via onConflict.
        let okCount = 0, failCount = 0;
        for (let i = 0; i < rowsToInsert.length; i += 100) {
          const batch = rowsToInsert.slice(i, i + 100);
          const { data, error } = await sb
            .from("customers")
            .upsert(batch, { onConflict: "square_customer_id", ignoreDuplicates: false })
            .select("id");
          if (error) {
            // Fall back to one-by-one to isolate failures
            for (const r of batch) {
              const { error: e2 } = await sb
                .from("customers")
                .upsert(r, { onConflict: "square_customer_id", ignoreDuplicates: false });
              if (e2) failCount++;
              else okCount++;
            }
          } else {
            okCount += (data || []).length;
          }
        }
        summary.customers_inserted = okCount;
        summary.customers_skipped_dupes = skipCount;
        summary.customers_failed = failCount;
        summary.total_customers = customers.length;
      }
    }

    // ── Orders → sales + sale_items ─────────────────────────────
    // Date window: body.since (ISO date) — defaults to 12 months back
    // Resumable: body.cursor honored, returns next_cursor if more
    if (what === "all" || what === "orders") {
      const sinceIso = body?.since
        ? new Date(body.since).toISOString()
        : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
      const untilIso = body?.until
        ? new Date(body.until).toISOString()
        : new Date().toISOString();
      const startCursor: string | undefined = body?.cursor || undefined;

      // Get locations once
      const locationIds = await fetchLocations(sqToken);
      if (locationIds.length === 0) {
        return jsonResponse({ ok: false, error: "Square account has no locations — cannot pull orders" }, 500);
      }

      // Pull orders this call — capped at 30 pages × 500 = 15k orders
      // so we stay under the 150s timeout. Re-call with returned cursor to continue.
      const { orders, cursor: nextCursor } = await fetchOrders(
        sqToken,
        locationIds,
        sinceIso,
        untilIso,
        startCursor,
        action === "preview" ? 1 : 30,
      );

      summary.orders_window = { since: sinceIso, until: untilIso };
      summary.locations = locationIds.length;
      summary.orders_fetched = orders.length;
      if (nextCursor) summary.next_cursor = nextCursor;
      details.orders_sample = orders.slice(0, 3).map((o: any) => ({
        id: o.id,
        state: o.state,
        closed_at: o.closed_at,
        total: ((o.total_money?.amount || 0) / 100).toFixed(2),
        line_count: (o.line_items || []).length,
        tender: (o.tenders || [])[0]?.type,
      }));

      if (action === "commit" && orders.length > 0) {
        // Pre-fetch existing square_order_ids so we skip dupes server-side
        // (the UNIQUE INDEX from mig 075 catches them too, but pre-filtering
        // saves Insert round-trips on re-runs)
        const orderIds = orders.map((o: any) => o.id).filter(Boolean);
        const existingSquareIds = new Set<string>();
        for (let i = 0; i < orderIds.length; i += 200) {
          const batch = orderIds.slice(i, i + 200);
          const { data } = await sb
            .from("sales")
            .select("square_order_id")
            .in("square_order_id", batch);
          (data || []).forEach((r: any) => existingSquareIds.add(r.square_order_id));
        }

        // Build a square_customer_id → skateOS customer_id (+ name) map
        const sqCustIds = Array.from(new Set(orders.map((o: any) => o.customer_id).filter(Boolean)));
        const custByIdMap = new Map<string, { id: string; name: string }>();
        for (let i = 0; i < sqCustIds.length; i += 200) {
          const batch = sqCustIds.slice(i, i + 200);
          const { data } = await sb
            .from("customers")
            .select("id,name,square_customer_id")
            .in("square_customer_id", batch);
          (data || []).forEach((c: any) => {
            if (c.square_customer_id) custByIdMap.set(c.square_customer_id, { id: c.id, name: c.name });
          });
        }

        // Build a square_catalog_id → product map for line-item linkage
        // (we look up by the catalog_object_id Square embeds on each line)
        const sqCatalogIds: string[] = [];
        orders.forEach((o: any) => (o.line_items || []).forEach((li: any) => {
          if (li.catalog_object_id) sqCatalogIds.push(li.catalog_object_id);
        }));
        const prodByCatalogId = new Map<string, { id: string; name: string }>();
        const uniqCatalogIds = Array.from(new Set(sqCatalogIds));
        for (let i = 0; i < uniqCatalogIds.length; i += 200) {
          const batch = uniqCatalogIds.slice(i, i + 200);
          const { data } = await sb
            .from("products")
            .select("id,name,square_catalog_id")
            .in("square_catalog_id", batch);
          (data || []).forEach((p: any) => {
            if (p.square_catalog_id) prodByCatalogId.set(p.square_catalog_id, { id: p.id, name: p.name });
          });
        }

        let salesInserted = 0;
        let salesSkipped = 0;
        let salesFailed = 0;
        let itemsInserted = 0;
        let itemsFailed = 0;

        // Insert each order as a sale + its line items
        // One sale at a time (need the returned sale_id for child line items).
        // Wrap in try so one bad order doesn't kill the batch.
        for (const o of orders) {
          if (!o.id) { salesSkipped++; continue; }
          if (existingSquareIds.has(o.id)) { salesSkipped++; continue; }

          // Only import COMPLETED orders; CANCELED + OPEN aren't real revenue
          if (o.state !== "COMPLETED") { salesSkipped++; continue; }

          const cents = (m: any) => (m && typeof m.amount === "number") ? (m.amount / 100) : 0;
          const tender = (o.tenders || [])[0];
          const cust = o.customer_id ? custByIdMap.get(o.customer_id) : undefined;

          const saleRow: any = {
            square_order_id: o.id,
            // 'SQ-' prefix + last 10 chars distinguishes Square-imported receipts
            // from skateOS-native ones and gives 36^10 collision space (vs ~17M
            // last-6 collisions seen in real data).
            receipt_number: "SQ-" + o.id.slice(-10).toUpperCase(),
            customer_id: cust?.id || null,
            customer_name: cust?.name || (tender?.note || "Walk-in"),
            subtotal: cents(o.net_amounts?.total_money) - cents(o.net_amounts?.tax_money) + cents(o.net_amounts?.discount_money),
            tax: cents(o.net_amounts?.tax_money),
            discount: cents(o.net_amounts?.discount_money),
            tip: cents(o.net_amounts?.tip_money),
            total: cents(o.total_money),
            payment_method: tenderToPaymentMethod(tender?.type),
            payment_provider: "square",
            payment_id: tender?.id || null,
            status: "completed",
            created_at: o.closed_at || o.created_at,
            notes: "[Imported from Square]",
          };

          let saleId: string | undefined;
          try {
            const { data, error } = await sb.from("sales").insert(saleRow).select("id").single();
            if (error) {
              if (String(error.message || "").includes("duplicate")) salesSkipped++;
              else {
                salesFailed++;
                // Surface the first 5 distinct error messages so we can
                // diagnose what's failing without needing a separate logger.
                (summary.sales_error_samples ||= []);
                if ((summary.sales_error_samples as any[]).length < 5) {
                  (summary.sales_error_samples as any[]).push({
                    order: o.id.slice(-10),
                    error: String(error.message || error).slice(0, 200),
                    code: (error as any).code,
                    detail: (error as any).details,
                    row_keys: Object.entries(saleRow).filter(([_,v]) => v != null).map(([k])=>k),
                  });
                }
              }
              continue;
            }
            saleId = data.id;
            salesInserted++;
          } catch (e) {
            salesFailed++;
            continue;
          }

          // Line items
          const lineRows: any[] = [];
          for (const li of (o.line_items || [])) {
            if (!li) continue;
            const prod = li.catalog_object_id ? prodByCatalogId.get(li.catalog_object_id) : undefined;
            const qty = parseFloat(li.quantity || "1") || 1;
            const lineTotalCents = cents(li.total_money) || (cents(li.base_price_money) * qty);
            lineRows.push({
              sale_id: saleId,
              product_id: prod?.id || null,
              product_name: li.name || prod?.name || "(item)",
              quantity: qty,
              unit_price: cents(li.base_price_money),
              total: lineTotalCents,
              square_line_uid: li.uid || null,
            });
          }
          if (lineRows.length > 0) {
            const { error: liErr } = await sb.from("sale_items").insert(lineRows);
            if (liErr) itemsFailed += lineRows.length;
            else itemsInserted += lineRows.length;
          }
        }

        summary.sales_inserted = salesInserted;
        summary.sales_skipped = salesSkipped;
        summary.sales_failed = salesFailed;
        summary.line_items_inserted = itemsInserted;
        summary.line_items_failed = itemsFailed;
        summary.has_more = !!nextCursor;

        // Stamp import state so the UI can resume from cursor
        await sb.from("square_import_state").upsert({
          kind: "orders",
          cursor: nextCursor || null,
          last_run_at: new Date().toISOString(),
          rows_seen: orders.length,
          rows_inserted: salesInserted,
          rows_skipped: salesSkipped,
          errors: salesFailed,
          status: nextCursor ? "running" : "done",
          notes: `window ${sinceIso}..${untilIso} · ${salesInserted}↑ ${salesSkipped}↷ ${salesFailed}✗`,
        }, { onConflict: "kind" });
      }
    }

    return jsonResponse({ ok: true, summary, details });
  } catch (e) {
    return jsonResponse({ ok: false, error: (e as Error).message }, 500);
  }
});
