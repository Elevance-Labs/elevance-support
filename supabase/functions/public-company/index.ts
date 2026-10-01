// The read-only, sign-in-free list of one company's tickets, addressed by the
// same `company` parameter an embed link carries: /tickets?company=wupi.
//
// A company code is short and guessable, and there is no secret in the URL — so,
// exactly as with `public-issue`, anyone who knows or guesses a code can read
// this view of that company's tickets. See "Company pages" in README.md.
//
// That puts all the weight on the allow-list below. It is deliberately NOT the
// same list as `public-issue`: this page carries the ticket's product, area,
// current status and who asked, and leaves out comments. Assignees, severity,
// priority, type, labels, internal notes, the requester's email, the status
// timeline and SLA never leave the database. Nor does a ticket closed more than
// CLOSED_VISIBLE_DAYS ago: that is filtered here, not in the browser.
//
// Runs with the service_role key so the browser never needs read access to
// `issues` — see the note at the top of public-issue/index.ts.
//
// Deploy with:  supabase functions deploy public-company
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  // supabase-js attaches `apikey` and `x-client-info` to every invoke() alongside
  // `authorization`. Any header not named here fails the browser's preflight.
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

// Long enough to read the page and open every attachment on it.
const SIGNED_URL_TTL_SECONDS = 60 * 60;

// The page is a list, not an export. Newest first, so what is cut is the oldest.
const MAX_TICKETS = 500;

// A closed ticket stays on the page this long, then drops off: the page is for
// what is being worked on and what was just finished, not an archive. Sent with
// the response so the page can say so without keeping its own copy of the number.
const CLOSED_VISIBLE_DAYS = 14;

// Ids travel in the query string of an `in` filter; keep each request short.
const CHUNK = 100;

const chunks = <T>(items: T[]) =>
  Array.from({ length: Math.ceil(items.length / CHUNK) }, (_, i) =>
    items.slice(i * CHUNK, (i + 1) * CHUNK));

const FIELDS =
  "id, number, title, description, product, area, status, company, " +
  "requester_name, source, source_url, submitted_date, projects!inner(name, key)";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let company: unknown;
  try {
    ({ company } = await req.json());
  } catch {
    return json({ error: "Malformed request" }, 400);
  }
  const value = typeof company === "string" ? company.trim() : "";
  if (!value || value.length > 120) return json({ error: "Missing company" }, 400);

  // Code first — that is what links carry — then the name, ignoring case, the
  // same order findCompany() in src/lib/companies.js resolves in. The value only
  // ever reaches the database as a bound filter value; the wildcards are escaped
  // so a name lookup of "%" cannot match the first company on the list.
  let { data: hit } = await admin
    .from("companies").select("name, code").eq("code", value.toLowerCase()).maybeSingle();
  if (!hit) {
    ({ data: hit } = await admin
      .from("companies").select("name, code")
      .ilike("name", value.replace(/[\\%_]/g, "\\$&"))
      .limit(1).maybeSingle());
  }
  // Only companies on the list have a page: free text on an old ticket is not
  // an address.
  if (!hit) return json({ error: "not_found" }, 404);

  // A ticket belongs to the company by its code. Tickets logged before the list
  // existed carry only the name, so those are matched on it — and only when they
  // have no code, so a name can never pull in another company's tickets.
  //
  // `closed_at` is set by trigger on entering a closed status and cleared on
  // reopening, so "null or recent" is exactly "open, or closed lately". The
  // filter is built from a timestamp computed here — nothing the caller sent.
  const cutoff = new Date(Date.now() - CLOSED_VISIBLE_DAYS * 86_400_000).toISOString();
  const visible = `closed_at.is.null,closed_at.gte.${cutoff}`;
  const [byCode, byName, { data: statuses }] = await Promise.all([
    admin.from("issues").select(FIELDS)
      .eq("company_code", hit.code).or(visible)
      .order("submitted_date", { ascending: false }).limit(MAX_TICKETS),
    admin.from("issues").select(FIELDS)
      .is("company_code", null).eq("company", hit.name).or(visible)
      .order("submitted_date", { ascending: false }).limit(MAX_TICKETS),
    admin.from("list_items").select("name, status_type")
      .eq("list_type", "status").order("sort_order"),
  ]);
  if (byCode.error || byName.error) return json({ error: "Could not load tickets" }, 500);

  // deno-lint-ignore no-explicit-any
  const all = [...(byCode.data ?? []), ...(byName.data ?? [])] as any[];
  all.sort((a, b) => String(b.submitted_date).localeCompare(String(a.submitted_date)));
  const issues = all.slice(0, MAX_TICKETS);

  // Only the request's own files: a row with a comment_id belongs to a comment,
  // and comments are not on this page.
  const ids = issues.map((i) => i.id);
  const attachmentRows = (await Promise.all(chunks(ids).map(async (part) => {
    const { data } = await admin.from("attachments")
      .select("id, issue_id, file_name, file_path, mime_type, size_bytes")
      .in("issue_id", part).is("comment_id", null)
      .order("created_at");
    return data ?? [];
  }))).flat();

  // The bucket stays private; each attachment gets its own short-lived URL.
  const urlByPath = new Map<string, string>();
  for (const part of chunks(attachmentRows.map((a) => a.file_path))) {
    const { data } = await admin.storage
      .from("attachments").createSignedUrls(part, SIGNED_URL_TTL_SECONDS);
    for (const s of data ?? []) if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
  }

  const filesOf = (issueId: string) =>
    attachmentRows.filter((a) => a.issue_id === issueId).map((a) => ({
      id: a.id,
      file_name: a.file_name,
      mime_type: a.mime_type,
      size_bytes: a.size_bytes,
      url: urlByPath.get(a.file_path) ?? null,
    }));

  return json({
    // The name people read, and the code already in the link they were sent.
    company: { name: hit.name, code: hit.code },
    // Statuses in workflow order, so a list sorted or grouped by status reads
    // the way the work moves rather than alphabetically — each with its type,
    // which is what the page colours it by.
    statuses: (statuses ?? []).map((s) => ({ name: s.name, status_type: s.status_type })),
    truncated: all.length > MAX_TICKETS,
    closed_visible_days: CLOSED_VISIBLE_DAYS,
    // The ticket id is used for grouping attachments here and never sent: a
    // ticket is named by its project key and number, as everywhere else.
    tickets: issues.map((i) => ({
      project: { name: i.projects.name, key: i.projects.key },
      number: i.number,
      title: i.title,
      description: i.description,
      product: i.product,
      area: i.area,
      status: i.status,
      company: i.company,
      requester_name: i.requester_name,
      source: i.source,
      source_url: i.source_url,
      submitted_date: i.submitted_date,
      attachments: filesOf(i.id),
    })),
  });
});
