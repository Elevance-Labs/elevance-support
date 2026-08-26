// Posts a card to Google Chat when a new ticket arrives.
//
// Called by the `issues_notify_new` trigger (migration 0001), never by a
// browser: the Chat webhook URL is a bearer secret — anyone holding it can post
// into the space — so it lives in this function's environment and the anon key
// never comes near it.
//
// The trigger sends only `{ issue_id }`; everything on the card is read here
// with service_role, so the field list and the card that renders it stay in one
// place.
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

  let issueId: unknown;
  try {
    ({ issue_id: issueId } = await req.json());
  } catch {
    return json({ error: "Malformed request" }, 400);
  }
  if (typeof issueId !== "string" || !issueId) {
    return json({ error: "Missing issue_id" }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

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

  const chatResponse = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // Card content doesn't reach mobile notification previews; this line does.
      // Plain text, not HTML — escaping it here would show the entities literally.
      text: `*New support request · ${ref}* — ${issue.title}`,
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

  return json({ ok: true, ref });
});
