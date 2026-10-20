// Everything Mailgun tells us, in one place: an email that has arrived, and
// what happened to one we sent.
//
//   * Inbound mail arrives as a form post from the Mailgun route
//     (`match_recipient(".*@<MAILGUN_DOMAIN>")` → forward here). It is filed on
//     the ticket it answers, or becomes a new ticket.
//   * Delivery events (delivered, permanent failure) arrive as JSON from the
//     domain's webhooks, and update the outbound message they are about — so a
//     send that bounced says so on the ticket instead of failing silently.
//
// Which ticket an email belongs to, in order:
//   1. Addressed to t-<email_token>@<MAILGUN_DOMAIN> — the Reply-To on
//      everything `email-send` sends.
//   2. In-Reply-To / References naming a message already on a ticket.
//   3. Neither: a new request. It becomes a ticket in EMAIL_INTAKE_PROJECT_KEY,
//      with source `Email` — but only when the helpdesk is in its To. An email
//      that merely copies the helpdesk (Cc), or blind-copies it (Bcc, which no
//      header shows), is someone else's conversation, not a request; it is
//      left in the helpdesk mailbox and files nothing. Nor do auto-replies,
//      bounces or our own mail coming back, none of which is a request (and
//      answering one is how mail loops start).
//
// Deploy with:  supabase functions deploy email-webhook --no-verify-jwt
//
// --no-verify-jwt is required — the caller is Mailgun, which has no user JWT.
// Mailgun's signature (HMAC-SHA256 of timestamp + token under the webhook
// signing key) is what stands in for it, and every request is checked. Env:
//
//   MAILGUN_WEBHOOK_SIGNING_KEY   Mailgun → Sending → Webhooks → signing key
//   MAILGUN_DOMAIN                the domain reply addresses live on
//   SUPPORT_FROM                  the address we send as; mail from it is ours,
//                                 and mail *to* it may open a ticket
//   EMAIL_INTAKE_PROJECT_KEY      project key new email tickets go to, e.g. ACME
//   EMAIL_INTAKE_ADDRESSES        optional, comma-separated: other helpdesk
//                                 addresses that open a ticket when in To
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/**
 * Mirrors the `attachments` bucket's allowed types and size (schema.sql). A
 * file the bucket would refuse is named on the message instead of stored.
 */
const BUCKET_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf",
  "video/mp4", "video/webm", "video/quicktime",
]);
const BUCKET_MAX_BYTES = 31457280;

const TITLE_MAX = 200;

/** Constant-time, so the signature can't be found a character at a time. */
function sameString(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function signatureValid(key: string, timestamp: string, token: string, signature: string) {
  if (!timestamp || !token || !signature) return false;
  const k = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(timestamp + token));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return sameString(hex, signature.toLowerCase());
}

/** `<abc@host>` → `abc@host`; every id is stored without its brackets. */
const bare = (id: string) => id.trim().replace(/^<|>$/g, "");

/** A References / In-Reply-To header → the message ids in it. */
const messageIds = (header: string | null) =>
  (String(header ?? "").match(/<[^<>\s]+>/g) ?? []).map(bare);

/** `"Jane Doe" <jane@acme.com>, bob@x.com` → [{ name, email }, …]. */
function addresses(header: string | null) {
  const out: { name: string | null; email: string }[] = [];
  // Split on commas that are not inside quotes.
  for (const part of String(header ?? "").split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
    const angled = part.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
    const email = (angled ? angled[2] : part).trim().toLowerCase();
    if (!email.includes("@")) continue;
    const name = angled?.[1]?.trim() || null;
    out.push({ name, email });
  }
  return out;
}

/** A subject without its "Re: Fwd: Re[2]:" chain. */
const baseSubject = (subject: string | null) => {
  let s = String(subject ?? "").trim();
  for (;;) {
    const next = s.replace(/^(re|fw|fwd|aw|sv|wg)\s*(\[\d+\])?\s*:\s*/i, "");
    if (next === s) return s;
    s = next;
  }
};

/** What a file may be called in the bucket: no folders, nothing odd. */
const safeName = (name: string) =>
  name.replace(/[/\\]/g, "_").replace(/[^\w.\- ()]/g, "_").slice(-120) || "attachment";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const signingKey = Deno.env.get("MAILGUN_WEBHOOK_SIGNING_KEY");
  const domain = Deno.env.get("MAILGUN_DOMAIN")?.toLowerCase();
  const supportFrom = Deno.env.get("SUPPORT_FROM") ?? "";
  if (!signingKey || !domain) {
    // A 5xx makes Mailgun retry, which is what we want while it is being set up.
    console.error("email-webhook is missing configuration");
    return json({ error: "Not configured" }, 500);
  }
  const ourAddress = (supportFrom.match(/<([^>]+)>/)?.[1] ?? supportFrom).trim().toLowerCase();

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ---------- delivery events ----------
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    // deno-lint-ignore no-explicit-any
    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Malformed request" }, 400);
    }
    const sig = body?.signature ?? {};
    if (!(await signatureValid(signingKey, String(sig.timestamp ?? ""), String(sig.token ?? ""), String(sig.signature ?? "")))) {
      return json({ error: "Unauthorized" }, 401);
    }

    const ev = body?.["event-data"] ?? {};
    const rowId = ev?.["user-variables"]?.email_message_id;
    const providerId = ev?.message?.headers?.["message-id"];
    const patch =
      ev.event === "delivered" ? { status: "delivered", error: null }
      // A temporary failure is still being retried by Mailgun; only a permanent
      // one means the customer will never get it.
      : ev.event === "failed" && ev.severity === "permanent"
        ? {
          status: "failed",
          error: String(
            ev?.["delivery-status"]?.description || ev?.["delivery-status"]?.message ||
              ev.reason || "Delivery failed",
          ).slice(0, 500),
        }
        : null;
    if (!patch) return json({ ok: true, ignored: ev.event ?? null });

    let q = admin.from("email_messages").update(patch).eq("direction", "outbound");
    q = rowId ? q.eq("id", rowId) : q.eq("provider_id", bare(String(providerId ?? "")));
    const { error } = await q;
    if (error) {
      console.error("email-webhook could not record a delivery event", error);
      return json({ error: "Could not record" }, 500);
    }
    return json({ ok: true });
  }

  // ---------- inbound mail ----------
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "Malformed request" }, 400);
  }
  const field = (name: string) => {
    const v = form.get(name);
    return typeof v === "string" ? v : null;
  };

  if (!(await signatureValid(signingKey, field("timestamp") ?? "", field("token") ?? "", field("signature") ?? ""))) {
    return json({ error: "Unauthorized" }, 401);
  }

  // Every header the message carried, case-insensitively — Mailgun flattens
  // some into fields, but the loop-detection ones only live here.
  const headers = new Map<string, string>();
  try {
    for (const [k, v] of JSON.parse(field("message-headers") ?? "[]")) {
      if (!headers.has(String(k).toLowerCase())) headers.set(String(k).toLowerCase(), String(v));
    }
  } catch { /* no header list; the flattened fields still work */ }
  const header = (name: string) => field(name) ?? headers.get(name.toLowerCase()) ?? null;

  const sender = addresses(header("From"))[0] ?? addresses(field("sender"))[0] ?? null;
  const subject = header("Subject") ?? field("subject");
  const messageId = bare(header("Message-Id") ?? "") || `${crypto.randomUUID()}@inbound.${domain}`;
  const inReplyTo = messageIds(header("In-Reply-To"))[0] ?? null;
  const references = messageIds(header("References"));
  const to = addresses(header("To"));
  // What the person wrote, signature included. Mailgun's `stripped-text`
  // removes both the quoted history and the signature; only the history is a
  // repeat of what the thread already shows, so the signature goes back on.
  // The whole email is kept as `body_text` either way.
  const reply = (field("stripped-text") ?? "").trim();
  const signature = (field("stripped-signature") ?? "").trim();
  const written = (reply ? [reply, signature].filter(Boolean).join("\n\n") : "") ||
    (field("body-plain") ?? "").trim() || null;
  const cc = addresses(header("Cc"));

  // Mailgun retries until it hears a 2xx, so the same email can arrive twice.
  const { data: seen } = await admin.from("email_messages")
    .select("id").eq("message_id", messageId).maybeSingle();
  if (seen) return json({ ok: true, duplicate: true });

  // ---- which ticket ----
  const recipients = [
    ...String(field("recipient") ?? "").split(","),
    ...to.map((a) => a.email),
    ...cc.map((a) => a.email),
  ].map((r) => r.trim().toLowerCase());
  const tokenPattern = new RegExp(`^t-([0-9a-f]{32})@${domain.replace(/\./g, "\\.")}$`);
  const token = recipients.map((r) => r.match(tokenPattern)?.[1]).find(Boolean) ?? null;

  let issueId: string | null = null;
  if (token) {
    const { data } = await admin.from("issues").select("id").eq("email_token", token).maybeSingle();
    issueId = data?.id ?? null;
  }
  if (!issueId) {
    const ids = [...new Set([inReplyTo, ...references].filter(Boolean))] as string[];
    if (ids.length) {
      const { data } = await admin.from("email_messages")
        .select("issue_id").in("message_id", ids).limit(1);
      issueId = data?.[0]?.issue_id ?? null;
    }
  }

  // ---- or a new one ----
  if (!issueId) {
    const autoSubmitted = (header("Auto-Submitted") ?? "no").toLowerCase();
    const precedence = (header("Precedence") ?? "").toLowerCase();
    const machine =
      autoSubmitted !== "no" ||
      ["bulk", "junk", "list", "auto_reply"].includes(precedence) ||
      header("X-Autoreply") !== null || header("X-Autorespond") !== null ||
      header("List-Id") !== null ||
      /^(mailer-daemon|postmaster|no-?reply)@/i.test(sender?.email ?? "") ||
      // Our own address coming back — a misconfigured forward, or a loop.
      (ourAddress !== "" && sender?.email === ourAddress) ||
      Boolean(sender?.email.endsWith(`@${domain}`));
    if (machine || !sender) {
      console.log(`email-webhook dropped an unmatched automatic message ${messageId}`);
      return json({ ok: true, dropped: "automatic" });
    }

    // Only an email written *to* the helpdesk is a request. The forward from
    // the helpdesk mailbox keeps the original To and Cc, so they say where the
    // helpdesk stood; a Bcc'd helpdesk is in neither, and is treated like Cc.
    const helpdesk = new Set(
      [ourAddress, ...(Deno.env.get("EMAIL_INTAKE_ADDRESSES") ?? "").split(",")]
        .map((a) => a.trim().toLowerCase()).filter(Boolean),
    );
    if (helpdesk.size === 0) {
      // Without an address to look for, every request would be dropped — so
      // fail loudly, and let Mailgun retry while it is set.
      console.error("email-webhook has no helpdesk address (SUPPORT_FROM is unset)");
      return json({ error: "No helpdesk address" }, 500);
    }
    if (!to.some((a) => helpdesk.has(a.email))) {
      const where = cc.some((a) => helpdesk.has(a.email)) ? "cc" : "bcc";
      console.log(`email-webhook filed no ticket for ${messageId}: the helpdesk was in ${where}, not To`);
      return json({ ok: true, dropped: `helpdesk in ${where}` });
    }

    const projectKey = (Deno.env.get("EMAIL_INTAKE_PROJECT_KEY") ?? "").trim().toUpperCase();
    const { data: project } = projectKey
      ? await admin.from("projects").select("id").eq("key", projectKey).maybeSingle()
      : { data: null };
    if (!project) {
      // Retried by Mailgun for hours, which gives an admin time to set it.
      console.error(`email-webhook has no intake project (EMAIL_INTAKE_PROJECT_KEY=${projectKey || "unset"})`);
      return json({ error: "No intake project" }, 500);
    }

    // Every email we send is "[GDT-32] title", so a forwarded old one would
    // otherwise file a ticket called "[GDT-32] …" and go out as
    // "[GDT-35] [GDT-32] …". The new ticket gets the title alone.
    const title = (baseSubject(subject).replace(/^(\[[A-Za-z]{3,4}-\d+\]\s*)+/, "").trim() ||
      "(no subject)").slice(0, TITLE_MAX);
    const { data: created, error } = await admin.from("issues").insert({
      project_id: project.id,
      title,
      description: written,
      requester_name: sender.name,
      requester_email: sender.email,
      // The database pins the date and drops any severity; see stamp_issue_origin().
      source: "Email",
    }).select("id").single();
    if (error || !created) {
      console.error("email-webhook could not create a ticket", error);
      return json({ error: "Could not create ticket" }, 500);
    }
    issueId = created.id;
  }

  // ---- the files ----
  // Uploaded before the message row exists, so a failure here leaves no
  // half-filed email; the rows are written once the message has an id.
  const kept: { name: string; path: string; mime: string; size: number }[] = [];
  const refused: string[] = [];
  const count = Number(field("attachment-count") ?? 0);
  for (let i = 1; i <= count; i++) {
    const file = form.get(`attachment-${i}`);
    if (!(file instanceof File)) continue;
    const mime = (file.type || "").toLowerCase();
    if (!BUCKET_TYPES.has(mime) || file.size > BUCKET_MAX_BYTES) {
      refused.push(file.name || `attachment ${i}`);
      continue;
    }
    const path = `${issueId}/${crypto.randomUUID()}-${safeName(file.name)}`;
    const { error } = await admin.storage.from("attachments").upload(path, file, { contentType: mime });
    if (error) {
      refused.push(file.name || `attachment ${i}`);
      continue;
    }
    kept.push({ name: file.name || safeName(file.name), path, mime, size: file.size });
  }

  // ---- the message ----
  const rowId = crypto.randomUUID();
  const { error: msgErr } = await admin.from("email_messages").insert({
    id: rowId,
    issue_id: issueId,
    direction: "inbound",
    from_email: sender?.email ?? null,
    from_name: sender?.name ?? null,
    to_emails: to.map((a) => a.email),
    cc_emails: cc.map((a) => a.email),
    subject,
    body_text: field("body-plain"),
    body_html: field("body-html"),
    stripped_text: written,
    message_id: messageId,
    in_reply_to: inReplyTo,
    references,
    status: "received",
    // Not a failure of ours, but the thing a reader most needs to know: the
    // customer sent something that is not on the ticket.
    error: refused.length
      ? `Not kept (type or size not accepted): ${refused.join(", ")}`.slice(0, 500)
      : null,
  });
  if (msgErr) {
    // The unique message_id makes a retry safe if this was a race.
    console.error("email-webhook could not store a message", msgErr);
    if (kept.length) await admin.storage.from("attachments").remove(kept.map((k) => k.path));
    return json({ error: "Could not store message" }, 500);
  }

  if (kept.length) {
    const { error } = await admin.from("attachments").insert(kept.map((k) => ({
      issue_id: issueId,
      email_message_id: rowId,
      file_name: k.name,
      file_path: k.path,
      mime_type: k.mime,
      size_bytes: k.size,
    })));
    if (error) console.error("email-webhook could not record attachments", error);
  }

  return json({ ok: true, issue_id: issueId });
});
