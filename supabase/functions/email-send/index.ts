// Sends an email to a ticket's requester, from the ticket's Conversation tab.
//
// The browser never talks to Mailgun: the API key can send as the support
// address, so it lives in this function's environment. The browser sends what
// a person wrote; everything that makes it an email — who it is from, the
// subject, the reply address, the threading headers and the layout — is decided
// here, so every message the team sends looks the same and lands in one thread.
//
// The body arrives as a rich text document (src/lib/richText.js), never as
// HTML: it is checked again here and the email's HTML is built from it, with
// every piece of text escaped — so nothing a browser, a paste or a crafted
// request sends can put markup of its own in a customer's inbox. The sender's
// signature is read from their profile and appended here; the browser never
// sends one, and only shows it.
//
// Threading. Every message carries:
//   * Reply-To  t-<email_token>@<MAILGUN_DOMAIN> — the ticket's own address, so
//     a reply comes back through `email-webhook` and onto this ticket. The token
//     is random; the ticket reference is public and must not be the address.
//   * Message-ID minted here, and In-Reply-To / References naming the messages
//     already in the thread, so the customer's mail app keeps one conversation.
//   * The subject `[GDT-32] <ticket title>` — on the first message and every
//     reply alike, so the reference is always in front of the customer and the
//     subject never drifts.
//
// Deploy with:  supabase functions deploy email-send
//
// Required env:
//   MAILGUN_API_KEY      a sending key for MAILGUN_DOMAIN
//   MAILGUN_DOMAIN       the Mailgun domain, e.g. mg.example.com — also the
//                        domain of every reply address
//   MAILGUN_API_BASE     https://api.mailgun.net (US) or https://api.eu.mailgun.net (EU)
//   SUPPORT_FROM         e.g. "Example Support <support@example.com>"
//
// Optional env:
//   APP_BASE_URL         origin of the deployed SPA, e.g. https://support.acme.com —
//                        links the footer's ticket reference to its share page;
//                        without it the reference goes out as plain text
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

/** Mirrors MAX_CC in src/lib/email.js. */
const MAX_CC = 10;
/** Mailgun refuses a message over 25 MB; leave room for the encoding. */
const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024;
/** Enough history for any mail app to place the message; headers have limits. */
const MAX_REFERENCES = 20;

// Deliberately simple — one @, no spaces, a dot in the domain. It exists to
// catch a typo before Mailgun does, not to judge what a mail server accepts.
const EMAIL = /^[^\s@<>(),;:]+@[^\s@<>(),;:]+\.[^\s@<>(),;:]+$/;

const esc = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Mirrors ticketSubject() in src/lib/email.js: `[GDT-32] Ticket title`, always. */
const ticketSubject = (ref: string, title: string) =>
  `[${ref}] ${String(title ?? "").replace(/\s+/g, " ").trim()}`.trim();

/**
 * The name the email is signed with. Mirrors displayName() in src/lib/users.js,
 * except that a profile with neither name nor email signs as the team.
 */
const displayName = (p: { full_name?: string | null; email?: string | null } | null) => {
  const name = (p?.full_name ?? "").trim();
  if (name) return name;
  const local = (p?.email ?? "").split("@")[0].replace(/\d+$/, "");
  return local.split(/[._+-]+/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || "Support";
};

// ---------------------------------------------------------------------------
// Rich text. Mirrors normalizeDoc() and docToText() in src/lib/richText.js; the
// HTML here differs only in carrying inline styles, which is what mail apps
// honour.

type Run = { text: string; b?: true; i?: true; u?: true; href?: string };
type Block = { type: "p"; runs: Run[] } | { type: "ul" | "ol"; items: Run[][] };
type Doc = { blocks: Block[] };

const MAX_BLOCKS = 500;
const MAX_TEXT = 50_000;

const safeHref = (href: unknown) => {
  const h = String(href ?? "").trim();
  return /^(https?:\/\/|mailto:)/i.test(h) && !/[\s<>"]/.test(h) ? h : null;
};

const blank = (runs: Run[]) => runs.every((r) => !r.text.trim());

function normalizeDoc(input: unknown): Doc {
  const blocks: Block[] = [];
  let budget = MAX_TEXT;
  const runsOf = (list: unknown): Run[] => {
    const out: Run[] = [];
    for (const r of Array.isArray(list) ? list : []) {
      // deno-lint-ignore no-explicit-any
      const x = r as any;
      let text = typeof x?.text === "string" ? x.text.replace(/\r\n?/g, "\n") : "";
      if (text.length > budget) text = text.slice(0, budget);
      budget -= text.length;
      if (!text) continue;
      const run: Run = { text };
      if (x.b === true) run.b = true;
      if (x.i === true) run.i = true;
      if (x.u === true) run.u = true;
      const href = safeHref(x.href);
      if (href) run.href = href;
      out.push(run);
    }
    return out;
  };
  // deno-lint-ignore no-explicit-any
  const list = (input as any)?.blocks;
  for (const b of Array.isArray(list) ? list : []) {
    if (blocks.length >= MAX_BLOCKS || budget <= 0) break;
    if (b?.type === "p") blocks.push({ type: "p", runs: runsOf(b.runs) });
    else if (b?.type === "ul" || b?.type === "ol") {
      const items = (Array.isArray(b.items) ? b.items : []).map(runsOf).filter((r: Run[]) => !blank(r));
      if (items.length) blocks.push({ type: b.type, items });
    }
  }
  const isBlankP = (b: Block | undefined) => b?.type === "p" && blank(b.runs);
  while (blocks.length && isBlankP(blocks[0])) blocks.shift();
  while (blocks.length && isBlankP(blocks.at(-1))) blocks.pop();
  return { blocks };
}

const isEmptyDoc = (doc: Doc) =>
  !doc.blocks.some((b) => (b.type === "p" ? !blank(b.runs) : b.items.some((it) => !blank(it))));

/** Plain text, one paragraph per line — a typed message without formatting. */
const docFromText = (text: string): Doc =>
  normalizeDoc({
    blocks: text.replace(/\r\n?/g, "\n").split("\n").map((line) => ({ type: "p", runs: [{ text: line }] })),
  });

const runText = (r: Run) =>
  r.href && r.href !== r.text && r.href !== `mailto:${r.text}`
    ? `${r.text} (${r.href.replace(/^mailto:/i, "")})`
    : r.text;

function docToText(doc: Doc) {
  const lines: string[] = [];
  for (const b of doc.blocks) {
    if (b.type === "p") lines.push(b.runs.map(runText).join(""));
    else b.items.forEach((it, n) => lines.push(`${b.type === "ol" ? `${n + 1}.` : "•"} ${it.map(runText).join("")}`));
  }
  return lines.join("\n");
}

function runsToHtml(runs: Run[]) {
  return runs.map((r) => {
    let html = esc(r.text).replace(/\n/g, "<br>");
    if (r.b) html = `<strong>${html}</strong>`;
    if (r.i) html = `<em>${html}</em>`;
    if (r.u) html = `<u>${html}</u>`;
    if (r.href) html = `<a href="${esc(r.href)}" style="color:#1976d2">${html}</a>`;
    return html;
  }).join("");
}

/** A paragraph per line as typed — no gaps between them, an empty one is a blank line. */
function docToHtml(doc: Doc) {
  return doc.blocks.map((b) => {
    if (b.type === "p") return `<div style="margin:0">${runsToHtml(b.runs) || "<br>"}</div>`;
    const items = b.items.map((it) => `<li style="margin:0 0 2px">${runsToHtml(it)}</li>`).join("");
    return `<${b.type} style="margin:4px 0;padding-left:24px">${items}</${b.type}>`;
  }).join("");
}

/**
 * The sign-off: the sender's own signature when they have set one, otherwise
 * their name. The composer shows the same thing under the text, so what the
 * sender sees is what goes.
 */
const signatureOf = (saved: unknown, sender: string): Doc => {
  const doc = normalizeDoc(saved);
  return isEmptyDoc(doc) ? docFromText(`— ${sender}`) : doc;
};

/**
 * Where a customer follows their ticket, signed in. The reference itself links
 * to the ticket's share page when APP_BASE_URL is set.
 */
const FOLLOW_UP = "Follow this ticket in Hub > Help Center > Support Tickets";

/**
 * Mirrors publicIssuePath() in src/lib/projects.js — a Deno function cannot
 * import from src/. The share page shows only the `public-issue` allow-list.
 */
const publicIssueUrl = (origin: string, key: string, number: number) =>
  `${origin.replace(/\/+$/, "")}/i/${encodeURIComponent(key)}/${number}`;

/**
 * The one layout every message goes out in: the text as written, the
 * signature, and a footer naming the ticket and where to follow it.
 */
function render(
  { body, signature, ref, link }: { body: Doc; signature: Doc; ref: string; link: string | null },
) {
  const text = `${docToText(body)}\n\n${docToText(signature)}\n\n` +
    `Ticket ${link ? `${ref} (${link})` : ref} · ${FOLLOW_UP}\n` +
    `Reply to this email to add to the conversation.`;
  const refHtml = link
    ? `<a href="${esc(link)}" style="color:#1976d2"><strong>${esc(ref)}</strong></a>`
    : `<strong>${esc(ref)}</strong>`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f5f6f8">
<div style="max-width:600px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2933">
<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:20px">
${docToHtml(body)}
<div style="margin:16px 0 0;color:#4b5563">${docToHtml(signature)}</div>
</div>
<p style="margin:12px 4px 0;font-size:12px;color:#6b7280">
Ticket ${refHtml} · ${esc(FOLLOW_UP)}<br>
Reply to this email to add to the conversation.
</p>
</div></body></html>`;
  return { text, html };
}

const bracket = (id: string) => `<${id}>`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = Deno.env.get("MAILGUN_API_KEY");
  const domain = Deno.env.get("MAILGUN_DOMAIN");
  const apiBase = (Deno.env.get("MAILGUN_API_BASE") ?? "https://api.mailgun.net").replace(/\/+$/, "");
  const from = Deno.env.get("SUPPORT_FROM");
  if (!apiKey || !domain || !from) {
    console.error("email-send is missing configuration; nothing was sent");
    return json({ error: "Email is not set up yet — ask an admin" }, 500);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ---- who is asking ----
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return json({ error: "Not signed in" }, 401);
  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return json({ error: "Not signed in" }, 401);

  const { data: me } = await admin.from("profiles")
    .select("id, role, is_active, can_email, full_name, email, email_signature")
    .eq("id", user.id).single();
  if (!me) return json({ error: "No profile record" }, 403);
  if (!me.is_active) return json({ error: "Your account is disabled" }, 403);
  // Mirrors can.emailCustomer() in src/lib/permissions.js.
  if (!me.can_email) return json({ error: "You are not allowed to email customers" }, 403);

  let payload: {
    issue_id?: unknown;
    body?: unknown;
    doc?: unknown;
    cc?: unknown;
    attachments?: unknown;
  };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Malformed request" }, 400);
  }

  const issueId = typeof payload.issue_id === "string" ? payload.issue_id : "";
  // The composer sends a document; plain `body` text is still taken, as lines.
  const body = payload.doc !== undefined
    ? normalizeDoc(payload.doc)
    : docFromText(typeof payload.body === "string" ? payload.body : "");
  if (!issueId) return json({ error: "Missing issue_id" }, 400);
  if (isEmptyDoc(body)) return json({ error: "Write a message before sending" }, 400);

  const cc = Array.isArray(payload.cc)
    ? [...new Set(payload.cc.map((c) => String(c).trim().toLowerCase()).filter(Boolean))]
    : [];
  if (cc.length > MAX_CC) return json({ error: `At most ${MAX_CC} people can be copied` }, 400);
  const badCc = cc.find((c) => !EMAIL.test(c));
  if (badCc) return json({ error: `"${badCc}" is not an email address` }, 400);

  // ---- the ticket, and whether this person may see it ----
  const { data: issue } = await admin.from("issues")
    .select("id, number, title, requester_email, project_id, email_token, projects!inner(key)")
    .eq("id", issueId).maybeSingle();
  if (!issue) return json({ error: "not_found" }, 404);

  // service_role reads past row-level security, so the membership rule
  // `can_see_issue` applies is applied here by hand: admins see every project,
  // everyone else only the ones they belong to.
  if (me.role !== "admin") {
    const { data: membership } = await admin.from("project_members")
      .select("user_id").eq("project_id", issue.project_id).eq("user_id", me.id).maybeSingle();
    if (!membership) return json({ error: "not_found" }, 404);
  }

  const to = String(issue.requester_email ?? "").trim();
  if (!EMAIL.test(to)) {
    return json({ error: "This ticket has no requester email to write to" }, 400);
  }

  // deno-lint-ignore no-explicit-any
  const key = (issue as any).projects.key as string;
  const ref = `${key}-${issue.number}`;

  // ---- the thread so far ----
  const { data: thread } = await admin.from("email_messages")
    .select("message_id, created_at")
    .eq("issue_id", issue.id)
    .order("created_at", { ascending: true });
  const history = thread ?? [];
  const subject = ticketSubject(ref, issue.title);
  const references = history.map((m) => m.message_id).slice(-MAX_REFERENCES);
  const inReplyTo = references.at(-1) ?? null;

  // ---- files the composer already put in the bucket ----
  // Each must sit under this ticket's folder — the path the browser uploads to
  // — so a request cannot attach some other ticket's file to a customer email.
  const files = Array.isArray(payload.attachments) ? payload.attachments : [];
  const attachments: { path: string; name: string; mime: string; blob: Blob }[] = [];
  let total = 0;
  for (const f of files) {
    const path = String((f as { path?: unknown })?.path ?? "");
    const name = String((f as { name?: unknown })?.name ?? "").trim() || "attachment";
    if (!path.startsWith(`${issue.id}/`) || path.includes("..")) {
      return json({ error: "An attachment is not on this ticket" }, 400);
    }
    const { data: blob, error } = await admin.storage.from("attachments").download(path);
    if (error || !blob) return json({ error: `Could not read ${name}` }, 400);
    total += blob.size;
    if (total > MAX_ATTACHMENT_BYTES) {
      return json({ error: "Attachments are too large to email together — send fewer at once" }, 400);
    }
    attachments.push({ path, name, mime: blob.type || "application/octet-stream", blob });
  }

  // ---- the message ----
  const rowId = crypto.randomUUID();
  const messageId = `${crypto.randomUUID()}@${domain}`;
  const replyTo = `t-${issue.email_token}@${domain}`;
  const sender = displayName(me);
  const signature = signatureOf(me.email_signature, sender);
  const appBaseUrl = Deno.env.get("APP_BASE_URL");
  const { text, html } = render({
    body, signature, ref,
    link: appBaseUrl ? publicIssueUrl(appBaseUrl, key, issue.number) : null,
  });
  // The message as the customer reads it — body, a blank line, the signature —
  // which is what the thread draws.
  const asSent: Doc = {
    blocks: [...body.blocks, { type: "p", runs: [] }, ...signature.blocks],
  };

  const fromAddress = from.match(/<([^>]+)>/)?.[1] ?? from;
  const form = new FormData();
  form.append("from", from);
  // Mailgun sends through MAILGUN_DOMAIN (el.…) while From is on the main
  // domain, and in that case adds a Sender header naming an address of its own
  // — which Outlook shows as "helpdesk=…@el.… on behalf of Helpdesk". Naming
  // the From address as the Sender keeps the display to the From alone. The
  // envelope (bounce) address is unchanged, so SPF, DKIM and DMARC are too.
  form.append("h:Sender", fromAddress);
  form.append("to", to);
  for (const c of cc) form.append("cc", c);
  form.append("subject", subject);
  form.append("text", text);
  form.append("html", html);
  form.append("h:Reply-To", replyTo);
  form.append("h:Message-Id", bracket(messageId));
  if (inReplyTo) form.append("h:In-Reply-To", bracket(inReplyTo));
  if (references.length) form.append("h:References", references.map(bracket).join(" "));
  // Comes back on every delivery event, so `email-webhook` can find the row.
  form.append("v:email_message_id", rowId);
  // No link rewriting or tracking pixel: a support reply should arrive exactly
  // as written, and a rewritten link depends on a tracking DNS record existing.
  form.append("o:tracking", "no");
  form.append("o:tracking-clicks", "no");
  form.append("o:tracking-opens", "no");
  for (const a of attachments) form.append("attachment", a.blob, a.name);

  const sent = await fetch(`${apiBase}/v3/${domain}/messages`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`api:${apiKey}`)}` },
    body: form,
  });
  if (!sent.ok) {
    const detail = await sent.text();
    console.error(`Mailgun refused the message for ${ref}: ${sent.status} ${detail}`);
    return json({ error: `The email was not sent — Mailgun said: ${detail.slice(0, 200)}` }, 502);
  }
  const { id: providerId } = await sent.json().catch(() => ({ id: null }));

  // ---- the record ----
  const { data: row, error: insErr } = await admin.from("email_messages").insert({
    id: rowId,
    issue_id: issue.id,
    direction: "outbound",
    from_email: fromAddress,
    from_name: sender,
    to_emails: [to],
    cc_emails: cc,
    subject,
    body_text: text,
    body_html: html,
    stripped_text: docToText(asSent),
    body_doc: asSent,
    message_id: messageId,
    in_reply_to: inReplyTo,
    references,
    sent_by: me.id,
    status: "sent",
    provider_id: providerId ? String(providerId).replace(/^<|>$/g, "") : null,
  }).select("*").single();
  if (insErr) {
    // It has gone; the thread just does not know. Say so rather than inviting
    // a second send.
    console.error(`email-send sent ${ref} but could not record it`, insErr);
    return json({ error: "The email was sent, but could not be saved to the ticket" }, 500);
  }

  if (attachments.length) {
    const { error } = await admin.from("attachments").insert(attachments.map((a) => ({
      issue_id: issue.id,
      email_message_id: rowId,
      file_name: a.name,
      file_path: a.path,
      mime_type: a.mime,
      size_bytes: a.blob.size,
    })));
    if (error) console.error(`email-send could not record attachments for ${ref}`, error);
  }

  return json({ message: row });
});
