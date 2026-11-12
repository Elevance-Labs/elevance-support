// Delivers notifications to people's devices (Web Push).
//
// Called by the `notifications_push` trigger (migration 0023) through pg_net,
// never by a browser: once per write, with the ids of the notifications that
// write created. Everything else is read here with service_role — the
// notification, its ticket, who caused it, the comment it is about, and the
// devices of the person it is for — so the database sends ids, not content.
//
// Each device gets one encrypted message (webpush.ts): only that browser can
// read it, not the push service carrying it. A device the push service says is
// gone (404/410 — the app uninstalled, permission withdrawn, the subscription
// expired) is deleted, so it is never tried again.
//
// Deploy with:  supabase functions deploy push-send --no-verify-jwt
//
// --no-verify-jwt is required — the caller is Postgres, which has no user JWT.
// The `x-notify-secret` header stands in for it: the same secret notify-issue
// uses. Required env:
//
//   NOTIFY_SHARED_SECRET   must match the `notify_issue_secret` Vault secret
//   VAPID_PUBLIC_KEY       base64url, 65 bytes — the same value as the app's
//                          VITE_VAPID_PUBLIC_KEY
//   VAPID_PRIVATE_KEY      base64url, 32 bytes
//   VAPID_SUBJECT          mailto: or https: — who the push services contact
//
// `npm run vapid-keys` prints a fresh pair.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPush } from "./webpush.ts";

interface NotificationRow {
  id: string;
  recipient_id: string;
  kind: string;
  detail: string | null;
  issue_id: string | null;
  actor: { full_name: string | null; email: string | null } | null;
  comment: { body: string | null } | null;
  issue: { id: string; number: number; title: string; project_id: string; projects: { key: string } | null } | null;
}

interface DeviceRow { id: string; user_id: string; endpoint: string; p256dh: string; auth: string }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Mirrors displayName() in src/lib/users.js. */
function displayName(p: { full_name: string | null; email: string | null } | null) {
  if (!p) return null;
  const name = (p.full_name ?? "").trim();
  if (name) return name;
  const local = (p.email ?? "").split("@")[0];
  const words = local.replace(/\d+$/, "").split(/[._+-]+/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.length ? words.join(" ") : local || null;
}

/** Mirrors notificationSentence() in src/lib/notifications.js. */
function sentence(kind: string, detail: string | null, actor: string | null) {
  const who = actor || "Someone";
  switch (kind) {
    case "assigned": return actor ? `${actor} assigned you` : "Assigned to you";
    case "mentioned": return `${who} mentioned you`;
    case "commented": return `${who} commented`;
    case "status_changed": return detail ? `${who} moved it to ${detail}` : `${who} changed its status`;
    case "email_received": return detail ? `${detail} replied by email` : "The customer replied by email";
    case "test": return "Notifications are working on this device.";
    default: return "Something changed";
  }
}

/** Mirrors excerpt() in src/lib/notifications.js. */
function excerpt(text: string | null, max = 140) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** What the device shows, and where a tap leads (relative to the app). */
function message(n: NotificationRow, unread: number) {
  const ref = n.issue ? `${n.issue.projects?.key ?? ""}-${n.issue.number}` : null;
  const line = sentence(n.kind, n.detail, displayName(n.actor));
  // A comment's words come along for a mention or a comment: the payload is
  // encrypted to the device, so the push service never reads them.
  const said = n.kind === "mentioned" || n.kind === "commented" ? excerpt(n.comment?.body ?? null) : "";
  return {
    id: n.id,
    title: n.issue ? `${ref} · ${n.issue.title}` : "Elevance Support",
    body: said ? `${line}: “${said}”` : line,
    // Mirrors notificationPath() in src/lib/notifications.js.
    path: n.issue ? `issues?issue=${n.issue.id}&project=${n.issue.project_id}` : "profile",
    // One notification per ticket on the device; a newer one replaces it.
    tag: n.issue_id ?? `test-${n.id}`,
    unread,
  };
}

/** At most `limit` at once — a push service throttles a sender that floods it. */
async function eachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
  }));
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const secret = Deno.env.get("NOTIFY_SHARED_SECRET");
  if (!secret || req.headers.get("x-notify-secret") !== secret) return json({ error: "unauthorized" }, 401);

  const vapid = {
    publicKey: Deno.env.get("VAPID_PUBLIC_KEY") ?? "",
    privateKey: Deno.env.get("VAPID_PRIVATE_KEY") ?? "",
    subject: Deno.env.get("VAPID_SUBJECT") ?? "",
  };
  if (!vapid.publicKey || !vapid.privateKey || !vapid.subject) {
    // Not configured: the notifications are in the app; nothing goes to devices.
    return json({ sent: 0, skipped: "vapid_not_configured" });
  }

  let ids: string[] = [];
  try {
    const body = await req.json();
    ids = Array.isArray(body?.notification_ids) ? body.notification_ids.filter((x: unknown) => typeof x === "string") : [];
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (!ids.length) return json({ sent: 0 });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: rows, error } = await admin.from("notifications")
    .select(`id, recipient_id, kind, detail, issue_id,
      actor:profiles!notifications_actor_id_fkey(full_name, email),
      comment:comments(body),
      issue:issues(id, number, title, project_id, projects(key))`)
    .in("id", ids.slice(0, 500));
  if (error) return json({ error: error.message }, 500);
  const notifications = (rows ?? []) as unknown as NotificationRow[];
  const recipients = [...new Set(notifications.map((n) => n.recipient_id))];
  if (!recipients.length) return json({ sent: 0 });

  const [{ data: devices }, { data: unreadRows }] = await Promise.all([
    admin.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth").in("user_id", recipients),
    // What each person's app icon should count once this arrives.
    admin.from("notifications").select("recipient_id").in("recipient_id", recipients).is("read_at", null).limit(20000),
  ]);
  const unread = new Map<string, number>();
  for (const r of unreadRows ?? []) unread.set(r.recipient_id, (unread.get(r.recipient_id) ?? 0) + 1);

  const deviceList = (devices ?? []) as DeviceRow[];
  const jobs = notifications.flatMap((n) =>
    deviceList.filter((d) => d.user_id === n.recipient_id).map((d) => ({ n, d })));

  const gone: string[] = [];
  const used: string[] = [];
  let sent = 0;
  await eachLimited(jobs, 8, async ({ n, d }) => {
    try {
      const status = await sendPush(d, message(n, unread.get(n.recipient_id) ?? 0), vapid, {
        // A mention or an assignment is somebody waiting on you.
        urgency: n.kind === "mentioned" || n.kind === "assigned" ? "high" : "normal",
        topic: n.issue_id?.replace(/-/g, ""),
      });
      if (status === 404 || status === 410) gone.push(d.id);
      else if (status >= 200 && status < 300) { sent++; used.push(d.id); }
      else console.error(`push-send: ${status} from ${new URL(d.endpoint).host}`);
    } catch (err) {
      console.error(`push-send: ${(err as Error).message}`);
    }
  });

  if (gone.length) await admin.from("push_subscriptions").delete().in("id", [...new Set(gone)]);
  if (used.length) {
    await admin.from("push_subscriptions").update({ last_used_at: new Date().toISOString() })
      .in("id", [...new Set(used)]);
  }
  return json({ sent, removed: gone.length });
});
