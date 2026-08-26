// The read-only, sign-in-free view of a ticket, addressed the way the ticket is
// named everywhere else: project key + number, so ACME-42 is /i/ACME/42.
//
// Ticket numbers are sequential per project, so these addresses are guessable by
// design — a caller can walk 1, 2, 3… and read the public view of every ticket in
// a project. That was chosen deliberately for the convenience of links anyone can
// write down; see "Share links" in README.md.
//
// It puts all the weight on the allow-list below, which is the only thing that
// leaves the building. This runs with the service_role key so the browser never
// needs read access to `issues` — the anon key is public, so any RLS policy wide
// enough to serve this page would hand over every column of every ticket, rather
// than the handful of fields here.
//
// Deploy with:  supabase functions deploy public-issue
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

/**
 * Mirrors displayName()/humanize() in src/lib/users.js — a Deno function cannot
 * import from src/, and showing a raw email on a page customers can see would
 * be worse than the duplication.
 */
function displayName(profile: { full_name?: string; email?: string } | null) {
  const name = profile?.full_name?.trim();
  if (name) return name;

  const local = profile?.email?.split("@")[0];
  if (!local) return "Support team";

  const words = local
    .replace(/\d+$/, "")
    .split(/[._\-+]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.length ? words.join(" ") : local;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let number: unknown;
  let key: unknown;
  try {
    ({ number, key } = await req.json());
  } catch {
    return json({ error: "Malformed request" }, 400);
  }
  if (typeof key !== "string" || !/^[A-Z]{3,4}$/.test(key)) {
    return json({ error: "Missing project key" }, 400);
  }
  // Reject anything that isn't a plain positive integer before it reaches the
  // query, so the number can't smuggle in a filter expression.
  const ticketNumber = Number(number);
  if (!Number.isInteger(ticketNumber) || ticketNumber < 1) {
    return json({ error: "Missing ticket number" }, 400);
  }

  const { data: issue } = await admin
    .from("issues")
    .select(
      "id, number, title, description, company, jira_ticket, submitted_date, " +
        "projects!inner(name, key)",
    )
    .eq("number", ticketNumber)
    // Numbers restart at 1 in every project, so the key is what makes the pair
    // unique — without it ACME-42 and BILL-42 are the same address.
    .eq("projects.key", key)
    .maybeSingle();

  if (!issue) return json({ error: "not_found" }, 404);

  const [{ data: attachments }, { data: comments }] = await Promise.all([
    admin.from("attachments")
      .select("id, file_name, file_path, mime_type")
      .eq("issue_id", issue.id)
      .order("created_at"),
    admin.from("comments")
      .select("id, body, created_at, author_id")
      .eq("issue_id", issue.id)
      .order("created_at"),
  ]);

  // The bucket stays private; each attachment gets its own short-lived URL.
  const signed = await Promise.all((attachments ?? []).map(async (a) => {
    const { data } = await admin.storage
      .from("attachments")
      .createSignedUrl(a.file_path, SIGNED_URL_TTL_SECONDS);
    return {
      id: a.id,
      file_name: a.file_name,
      mime_type: a.mime_type,
      url: data?.signedUrl ?? null,
    };
  }));

  const authorIds = [...new Set((comments ?? []).map((c) => c.author_id).filter(Boolean))];
  const { data: authors } = authorIds.length
    ? await admin.from("profiles").select("id, full_name, email, avatar_url").in("id", authorIds)
    : { data: [] };
  const authorById = new Map((authors ?? []).map((p) => [p.id, p]));

  // deno-lint-ignore no-explicit-any
  const project = (issue as any).projects as { name: string; key: string };

  return json({
    // Only the project's public face: the name a customer may read on the page
    // and the key that is already in the URL they clicked.
    project: { name: project.name, key: project.key },
    issue: {
      number: issue.number,
      title: issue.title,
      description: issue.description,
      company: issue.company,
      jira_ticket: issue.jira_ticket,
      submitted_date: issue.submitted_date,
    },
    attachments: signed,
    // The author's name and photo go out — never the email, and never the id.
    //
    // The photo is a deliberate addition to this allow-list: the `avatars`
    // bucket is public already, so the file was always reachable, but this page
    // is what ties a face to a name for anyone holding a share link. That is the
    // same exposure the name itself carries, and a support reply reads better
    // from a person than from a grey circle. Drop `author_avatar_url` here if a
    // customer-facing page should stay anonymous — the page falls back to
    // initials on its own.
    comments: (comments ?? []).map((c) => {
      const author = authorById.get(c.author_id) ?? null;
      return {
        id: c.id,
        body: c.body,
        created_at: c.created_at,
        author_name: displayName(author),
        author_avatar_url: author?.avatar_url ?? null,
      };
    }),
  });
});
