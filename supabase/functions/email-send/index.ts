// Sends an email about a ticket, from the ticket's Conversation tab (to its
// requester) or from the Inbox (to one of a contact's addresses). Also sends a
// message that was not delivered again (`resend_of`, 0026): the same email, to
// the same people, as a new message in the same thread.
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
    resend_of?: unknown;
    to?: unknown;
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
  if (!issueId) return json({ error: "Missing issue_id" }, 400);
  const resendOf = typeof payload.resend_of === "string" ? payload.resend_of : "";

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

  // deno-lint-ignore no-explicit-any
  const key = (issue as any).projects.key as string;
  const ref = `${key}-${issue.number}`;

  // ---- what goes, and to whom ----
  // Either a new draft, or — `resend_of` — a message that was not delivered,
  // sent again exactly as it first went. Everything after this is the same.
  let to: string[];
  let cc: string[];
  let files: { path: string; name: string }[];
  let content: { text: string; html: string; doc: unknown; stripped: string; fromName: string };

  if (resendOf) {
    const { data: original } = await admin.from("email_messages")
      .select("id, direction, status, to_emails, cc_emails, from_name, body_text, body_html, body_doc, stripped_text")
      .eq("id", resendOf).eq("issue_id", issue.id).maybeSingle();
    if (!original || original.direction !== "outbound") return json({ error: "not_found" }, 404);
    if (original.status !== "failed") {
      return json({ error: "Only an email that was not delivered can be sent again" }, 400);
    }
    // One resend per message (a unique index, 0026). Checked before sending,
    // so a second click does not reach the customer twice.
    const { data: again, error: againErr } = await admin.from("email_messages")
      .select("id").eq("resend_of", original.id).maybeSingle();
    if (againErr) {
      console.error("email-send could not check for an earlier resend — is migration 0026 applied?", againErr);
      return json({ error: "Resending is not set up yet — ask an admin" }, 500);
    }
    if (again) return json({ error: "This email has already been sent again" }, 409);

    to = (original.to_emails ?? []).map((t: string) => String(t).trim().toLowerCase()).filter(Boolean);
    cc = (original.cc_emails ?? []).map((c: string) => String(c).trim().toLowerCase()).filter(Boolean);
    const bad = [...to, ...cc].find((a) => !EMAIL.test(a));
    if (!to.length || bad) {
      return json({ error: bad ? `"${bad}" is not an email address` : "This email had nobody to send to" }, 400);
    }
    if (!original.body_text || !original.body_html) {
      return json({ error: "This email has nothing to send again" }, 400);
    }
    const { data: kept } = await admin.from("attachments")
      .select("file_path, file_name").eq("email_message_id", original.id).order("created_at");
    files = (kept ?? []).map((a) => ({ path: a.file_path, name: a.file_name }));
    // The same words, signature and footer — the sign-off is the original
    // sender's, so the name it went under stays with it.
    content = {
      text: original.body_text,
      html: original.body_html,
      doc: original.body_doc,
      stripped: original.stripped_text ?? "",
      fromName: original.from_name || displayName(me),
    };
  } else {
    // The composer sends a document; plain `body` text is still taken, as lines.
    const body = payload.doc !== undefined
      ? normalizeDoc(payload.doc)
      : docFromText(typeof payload.body === "string" ? payload.body : "");
    if (isEmptyDoc(body)) return json({ error: "Write a message before sending" }, 400);

    cc = Array.isArray(payload.cc)
      ? [...new Set(payload.cc.map((c) => String(c).trim().toLowerCase()).filter(Boolean))]
      : [];
    if (cc.length > MAX_CC) return json({ error: `At most ${MAX_CC} people can be copied` }, 400);
    const badCc = cc.find((c) => !EMAIL.test(c));
    if (badCc) return json({ error: `"${badCc}" is not an email address` }, 400);

    // Who it goes to. The ticket's requester unless the request names someone
    // else — the Inbox writes to a contact about a ticket that may be someone
    // else's — and then only an address this project already knows
    // (`project_contacts`): the function sends as the support address, so it
    // must not become a way to write to anyone at all.
    const requester = String(issue.requester_email ?? "").trim().toLowerCase();
    const asked = typeof payload.to === "string" ? payload.to.trim().toLowerCase() : "";
    const recipient = asked || requester;
    if (!EMAIL.test(recipient)) {
      return json({
        error: asked ? `"${payload.to}" is not an email address` : "This ticket has no requester email to write to",
      }, 400);
    }
    if (asked && asked !== requester) {
      const { data: known } = await admin.from("project_contacts")
        .select("email").eq("project_id", issue.project_id).eq("email", asked).maybeSingle();
      if (!known) return json({ error: `${asked} is not one of this project's contacts` }, 400);
    }
    to = [recipient];

    files = (Array.isArray(payload.attachments) ? payload.attachments : []).map((f) => ({
      path: String((f as { path?: unknown })?.path ?? ""),
      name: String((f as { name?: unknown })?.name ?? "").trim() || "attachment",
    }));

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
    content = { text, html, doc: asSent, stripped: docToText(asSent), fromName: sender };
  }

  // ---- the thread so far ----
  const { data: thread } = await admin.from("email_messages")
    .select("message_id, created_at")
    .eq("issue_id", issue.id)
    .order("created_at", { ascending: true });
  const history = thread ?? [];
  const subject = ticketSubject(ref, issue.title);
  const references = history.map((m) => m.message_id).slice(-MAX_REFERENCES);
  const inReplyTo = references.at(-1) ?? null;

  // ---- files already in the bucket ----
  // Each must sit under this ticket's folder — the path the browser uploads to
  // — so a request cannot attach some other ticket's file to a customer email.
  const attachments: { path: string; name: string; mime: string; blob: Blob }[] = [];
  let total = 0;
  for (const { path, name } of files) {
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

  const fromAddress = from.match(/<([^>]+)>/)?.[1] ?? from;
  const form = new FormData();
  form.append("from", from);
  // Mailgun sends through MAILGUN_DOMAIN (el.…) while From is on the main
  // domain, and in that case adds a Sender header naming an address of its own
  // — which Outlook shows as "helpdesk=…@el.… on behalf of Helpdesk". Naming
  // the From address as the Sender keeps the display to the From alone. The
  // envelope (bounce) address is unchanged, so SPF, DKIM and DMARC are too.
  form.append("h:Sender", fromAddress);
  for (const t of to) form.append("to", t);
  for (const c of cc) form.append("cc", c);
  form.append("subject", subject);
  form.append("text", content.text);
  form.append("html", content.html);
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
    from_name: content.fromName,
    to_emails: to,
    cc_emails: cc,
    subject,
    body_text: content.text,
    body_html: content.html,
    stripped_text: content.stripped,
    body_doc: content.doc,
    message_id: messageId,
    in_reply_to: inReplyTo,
    references,
    sent_by: me.id,
    status: "sent",
    provider_id: providerId ? String(providerId).replace(/^<|>$/g, "") : null,
    // Only on a resend, so a plain send works whether or not 0026 is applied.
    ...(resendOf ? { resend_of: resendOf } : {}),
  }).select("*").single();
  if (insErr) {
    // It has gone; the thread just does not know. Say so rather than inviting
    // a second send.
    console.error(`email-send sent ${ref} but could not record it`, insErr);
    return json({ error: "The email was sent, but could not be saved to the ticket" }, 500);
  }

  // A resent file is the same object in the bucket, recorded again against
  // the new message — email attachments are never removed, so sharing is safe.
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
