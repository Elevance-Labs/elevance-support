// Posts a card to Google Chat when a new ticket arrives, and a one-line reply
// in that ticket's thread each time its status changes or an email is sent to
// or received from the requester — and a comment, when its author ticks
// "Notify in thread".
//
// Called by the `issues_notify_new` trigger (migration 0001), the
// `status_events_notify` / `email_messages_notify` triggers (migration 0016)
// and the `comments_notify` trigger (migration 0019),
// never by a browser: the Chat webhook URL is a bearer secret — anyone holding
// it can post into the space — so it lives in this function's environment and
// the anon key never comes near it.
//
// The triggers send only an id — `{ issue_id }` for a new ticket,
// `{ status_event_id }` for a status change, `{ email_message_id }` for an
// email, `{ comment_id }` for a comment; everything posted is read here with service_role, so the field list
// and the message that renders it stay in one place.
//
// Each ticket gets its own thread: the post carries a `threadKey` of the ticket
// reference, so a second post for the same ticket — a retry, or anything sent
// for it later — lands in that thread rather than starting another. The thread
// Chat answers with is saved on the ticket (`issues.chat_thread`, migration
// 0015), which is what the ticket dialog's "View thread" button opens.
//
// Deploy with:  supabase functions deploy notify-issue --no-verify-jwt
//
// --no-verify-jwt is required — the caller is Postgres, which has no user JWT.
// The `x-notify-secret` header is what stands in for it. Required env:
//
//   GOOGLE_CHAT_WEBHOOK_URL   the space's incoming webhook
//   NOTIFY_SHARED_SECRET      must match the `notify_issue_secret` Vault secret
//   APP_BASE_URL              origin of the deployed SPA, e.g. https://support.acme.com
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * The row the card is built from. Declared because an embedded select comes back
 * loosely typed from an untyped client, and every field below is nullable on a
 * form the public fills in — only `title` and the project are guaranteed.
 */
interface IssueRow {
  number: number;
  type: string | null;
  priority: string | null;
  title: string;
  company: string | null;
  requester_name: string | null;
  requester_email: string | null;
  projects: { name: string; key: string };
}

/** A status change and what the reply needs to name it. */
interface StatusEventRow {
  to_status: string;
  profiles: { full_name: string | null; email: string | null } | null;
  issues: { number: number; chat_thread: string | null; projects: { key: string } };
}

/** An email on the ticket — who it was from or by, never what it said. */
interface EmailMessageRow {
  direction: "outbound" | "inbound";
  from_email: string | null;
  from_name: string | null;
  profiles: { full_name: string | null; email: string | null } | null;
  issues: { number: number; chat_thread: string | null; projects: { key: string } };
}

/** A comment its author chose to share in the thread. */
interface CommentRow {
  body: string;
  profiles: { full_name: string | null; email: string | null } | null;
  issues: { number: number; chat_thread: string | null; projects: { key: string } };
}

/** Chat refuses a message over 4,096 characters; leave room for the header. */
const MAX_COMMENT_CHARS = 3500;

/** The service_role client every handler reads with; RLS does not apply. */
const adminClient = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
type Admin = ReturnType<typeof adminClient>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/**
 * Mirrors publicIssuePath() in src/lib/projects.js — a Deno function cannot
 * import from src/, and this is the one URL a recipient is expected to click.
 */
const publicIssueUrl = (origin: string, key: string, number: number) =>
  `${origin.replace(/\/+$/, "")}/i/${key}/${number}`;

/**
 * The webhook URL with the ticket's thread named on it. The reference is unique
 * across projects and never reissued, so it is a stable key within the space;
 * REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD starts the thread on the first post and
 * replies in it after that.
 */
function threadedWebhookUrl(webhookUrl: string, ref: string) {
  const url = new URL(webhookUrl);
  url.searchParams.set("threadKey", ref);
  url.searchParams.set("messageReplyOption", "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD");
  return url.toString();
}

/**
 * The webhook URL for a reply into a thread that must already exist. A status
 * line or an email line has no context of its own, so it never starts a thread.
 */
function replyWebhookUrl(webhookUrl: string) {
  const url = new URL(webhookUrl);
  url.searchParams.set("messageReplyOption", "REPLY_MESSAGE_OR_FAIL");
  return url.toString();
}

/**
 * Who did it. Mirrors displayName() in src/lib/users.js. Nobody recorded — a
 * server-side change, or an account since deleted — reads as "Someone".
 */
const displayName = (p: { full_name?: string | null; email?: string | null } | null) => {
  const name = (p?.full_name ?? "").trim();
  if (name) return name;
  const local = (p?.email ?? "").split("@")[0].replace(/\d+$/, "");
  return local.split(/[._+-]+/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || "Someone";
};

/**
 * Text for a plain Chat message. Chat reads `<users/all>` and the like in
 * message text as a mention, and a requester's name and a ticket's title are
 * typed by the public — so angle brackets never reach it, and asterisks, which
 * would unbalance the bold around them, are dropped too.
 */
const plain = (value: unknown) =>
  String(value ?? "").replace(/[<>*]/g, "").replace(/\s+/g, " ").trim();

/**
 * Chat renders a small subset of HTML inside card text, so anything typed by a
 * requester is escaped before it goes in. The title, company and name fields
 * are free text on a form open to the public.
 */
const esc = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/** Empty optional fields read better as a dash than as a blank row. */
const orDash = (value: unknown) => {
  const text = esc(value).trim();
  return text.length ? text : "—";
};

/**
 * Compares in constant time, so a wrong secret can't be discovered a character
 * at a time by timing the response.
 */
function secretMatches(given: string | null, expected: string) {
  if (!given || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const webhookUrl = Deno.env.get("GOOGLE_CHAT_WEBHOOK_URL");
  const sharedSecret = Deno.env.get("NOTIFY_SHARED_SECRET");
  const appBaseUrl = Deno.env.get("APP_BASE_URL");
  if (!webhookUrl || !sharedSecret || !appBaseUrl) {
    console.error("notify-issue is missing configuration; nothing was sent");
    return json({ error: "Not configured" }, 500);
  }

  if (!secretMatches(req.headers.get("x-notify-secret"), sharedSecret)) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: {
    issue_id?: unknown;
    status_event_id?: unknown;
    email_message_id?: unknown;
    comment_id?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Malformed request" }, 400);
  }

  const admin = adminClient();

  if (typeof body?.issue_id === "string" && body.issue_id) {
    return announceIssue(admin, webhookUrl, appBaseUrl, body.issue_id);
  }
  if (typeof body?.status_event_id === "string" && body.status_event_id) {
    return announceStatusChange(admin, webhookUrl, body.status_event_id);
  }
  if (typeof body?.email_message_id === "string" && body.email_message_id) {
    return announceEmail(admin, webhookUrl, body.email_message_id);
  }
  if (typeof body?.comment_id === "string" && body.comment_id) {
    return announceComment(admin, webhookUrl, body.comment_id);
  }
  return json({ error: "Missing issue_id, status_event_id, email_message_id or comment_id" }, 400);
});

/** The new-ticket card, which starts the ticket's thread. */
async function announceIssue(admin: Admin, webhookUrl: string, appBaseUrl: string, issueId: string) {
  const { data, error } = await admin
    .from("issues")
    .select(
      "number, type, priority, title, company, requester_name, requester_email, " +
        "projects!inner(name, key)",
    )
    .eq("id", issueId)
    .maybeSingle();

  if (error) {
    console.error("notify-issue could not read the ticket", error);
    return json({ error: "Lookup failed" }, 500);
  }
  if (!data) return json({ error: "not_found" }, 404);

  const issue = data as unknown as IssueRow;
  const project = issue.projects;
  const ref = `${project.key}-${issue.number}`;
  const link = publicIssueUrl(appBaseUrl, project.key, issue.number);

  const chatResponse = await fetch(threadedWebhookUrl(webhookUrl, ref), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // Card content doesn't reach mobile notification previews; this line does.
      // Plain text, not HTML — escaping it here would show the entities
      // literally — so the title goes through plain() instead.
      text: `*New support request · ${ref}* — ${plain(issue.title)}`,
      cardsV2: [{
        cardId: `issue-${issueId}`,
        card: {
          header: {
            title: `New support request · ${esc(ref)}`,
            subtitle: esc(project.name),
          },
          sections: [
            {
              widgets: [
                {
                  decoratedText: {
                    topLabel: "Type · Priority",
                    text: `${orDash(issue.type)} · ${orDash(issue.priority)}`,
                  },
                },
                {
                  decoratedText: {
                    topLabel: "Title",
                    text: orDash(issue.title),
                    wrapText: true,
                  },
                },
              ],
            },
            {
              widgets: [
                { decoratedText: { topLabel: "Company", text: orDash(issue.company) } },
                {
                  decoratedText: {
                    topLabel: "Requester",
                    text: orDash(issue.requester_name),
                    bottomLabel: orDash(issue.requester_email),
                  },
                },
              ],
            },
            {
              widgets: [{
                buttonList: {
                  buttons: [{
                    text: "Open ticket",
                    onClick: { openLink: { url: link } },
                  }],
                },
              }],
            },
          ],
        },
      }],
    }),
  });

  if (!chatResponse.ok) {
    // pg_net has already returned, so this is the only record that it failed.
    console.error(
      `Google Chat rejected the message for ${ref}: ${chatResponse.status} ${await chatResponse.text()}`,
    );
    return json({ error: "Chat rejected the message" }, 502);
  }

  // Chat answers with the message it created. The thread is only a convenience
  // for the ticket dialog, so failing to record it is logged, not an error —
  // the message itself went out.
  let thread: string | null = null;
  try {
    const message = await chatResponse.json();
    thread = typeof message?.thread?.name === "string" ? message.thread.name : null;
  } catch {
    // An unreadable body still means the post succeeded.
  }
  if (thread) {
    const { error: saveError } = await admin
      .from("issues").update({ chat_thread: thread }).eq("id", issueId);
    if (saveError) console.error(`notify-issue could not record the thread for ${ref}`, saveError);
  } else {
    console.error(`Google Chat named no thread for ${ref}; the ticket gets no link`);
  }

  return json({ ok: true, ref, thread });
}

/**
 * One line in the ticket's thread. Only for a ticket whose announcement
 * recorded its thread — the triggers already skip the rest, and this checks
 * again rather than start a thread with no card above it.
 */
async function replyInThread(webhookUrl: string, ref: string, thread: string | null, text: string) {
  if (!thread) return json({ ok: true, ref, skipped: "no thread" });

  const chatResponse = await fetch(replyWebhookUrl(webhookUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, thread: { name: thread } }),
  });

  if (!chatResponse.ok) {
    console.error(
      `Google Chat rejected the reply for ${ref}: ${chatResponse.status} ${await chatResponse.text()}`,
    );
    return json({ error: "Chat rejected the message" }, 502);
  }
  return json({ ok: true, ref });
}

/**
 * The new status and who moved it. No time: Chat stamps every message itself,
 * in each reader's own zone.
 */
async function announceStatusChange(admin: Admin, webhookUrl: string, eventId: string) {
  const { data, error } = await admin
    .from("status_events")
    .select(
      "to_status, profiles!changed_by(full_name, email), " +
        "issues!inner(number, chat_thread, projects!inner(key))",
    )
    .eq("id", eventId)
    .maybeSingle();

  if (error) {
    console.error("notify-issue could not read the status change", error);
    return json({ error: "Lookup failed" }, 500);
  }
  if (!data) return json({ error: "not_found" }, 404);

  const event = data as unknown as StatusEventRow;
  const ref = `${event.issues.projects.key}-${event.issues.number}`;
  return replyInThread(webhookUrl, ref, event.issues.chat_thread,
    `Status changed to *${plain(event.to_status)}* by ${plain(displayName(event.profiles))}`);
}

/**
 * An email sent to the requester (and by whom) or received from them. Never
 * the subject or the body: the space is a wider audience than the
 * ticket, and what a customer wrote stays on the ticket.
 */
async function announceEmail(admin: Admin, webhookUrl: string, messageId: string) {
  const { data, error } = await admin
    .from("email_messages")
    .select(
      "direction, from_email, from_name, profiles!sent_by(full_name, email), " +
        "issues!inner(number, chat_thread, projects!inner(key))",
    )
    .eq("id", messageId)
    .maybeSingle();

  if (error) {
    console.error("notify-issue could not read the email", error);
    return json({ error: "Lookup failed" }, 500);
  }
  if (!data) return json({ error: "not_found" }, 404);

  const email = data as unknown as EmailMessageRow;
  const ref = `${email.issues.projects.key}-${email.issues.number}`;

  let text: string;
  if (email.direction === "outbound") {
    text = `Email sent by *${plain(displayName(email.profiles))}*`;
  } else {
    // The requester as their mail client named them, with the address beside
    // it — the address is what tells two Janes apart.
    const name = plain(email.from_name);
    const address = plain(email.from_email);
    const from = name && address ? `${name} (${address})` : name || address || "the requester";
    text = `Email received from *${from}*`;
  }
  return replyInThread(webhookUrl, ref, email.issues.chat_thread, text);
}

/**
 * A comment, text and all — its author ticked "Notify in thread", so unlike an
 * email it is meant for the space. Line breaks survive; angle brackets don't,
 * for the same reason as plain(). A comment that is only a file says so.
 */
async function announceComment(admin: Admin, webhookUrl: string, commentId: string) {
  const { data, error } = await admin
    .from("comments")
    .select(
      "body, profiles!author_id(full_name, email), " +
        "issues!inner(number, chat_thread, projects!inner(key))",
    )
    .eq("id", commentId)
    .maybeSingle();

  if (error) {
    console.error("notify-issue could not read the comment", error);
    return json({ error: "Lookup failed" }, 500);
  }
  if (!data) return json({ error: "not_found" }, 404);

  const comment = data as unknown as CommentRow;
  const ref = `${comment.issues.projects.key}-${comment.issues.number}`;
  let text = String(comment.body ?? "").replace(/[<>]/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length > MAX_COMMENT_CHARS) text = `${text.slice(0, MAX_COMMENT_CHARS).trimEnd()}…`;
  return replyInThread(webhookUrl, ref, comment.issues.chat_thread,
    `Comment by *${plain(displayName(comment.profiles))}*\n${text || "_(attachment only)_"}`);
}
