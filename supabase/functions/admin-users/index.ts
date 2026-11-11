// User management. Creating, deleting, banning, correcting a login email and
// granting the right to email customers all need the service_role key, which
// must never ship to a browser — so it lives here.
//
// Nobody has a password: people sign in with Google, and Supabase finds their
// account by its email. So an account here is an auth user with a confirmed
// address and nothing else, and its email is the one thing that decides who
// can get into it.
// Deploy with:  supabase functions deploy admin-users
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

// Long enough to be permanent; Supabase has no "forever" ban value.
const BAN_FOREVER = "876000h";
const UNBAN = "none";

/**
 * Mirrors DEPARTMENTS in src/lib/users.js and the check constraint on
 * `profiles.department` — a Deno function cannot import from src/. Validated
 * here so a bad value comes back as a sentence rather than as a constraint
 * violation from a table the caller never named.
 */
const DEPARTMENTS = ["Product", "Design", "Support", "Engineering", "Quality"];
const DEFAULT_DEPARTMENT = "Support";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return json({ error: "Not signed in" }, 401);

  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return json({ error: "Not signed in" }, 401);

  const { data: me } = await admin
    .from("profiles").select("role, is_active").eq("id", user.id).single();

  if (!me) return json({ error: "No profile record" }, 403);
  if (!me.is_active) return json({ error: "Your account is disabled" }, 403);

  const isAdmin = me.role === "admin";
  const isManager = me.role === "manager";
  if (!isAdmin && !isManager) return json({ error: "Not permitted" }, 403);

  const body = await req.json();
  const { action, id, full_name, role, is_active, department, can_email } = body;
  // Stored the way Google will present it, so the two can only ever match.
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : undefined;
  if (email !== undefined && !/^\S+@\S+\.\S+$/.test(email)) {
    return json({ error: "That is not an email address" }, 400);
  }

  if (department !== undefined && !DEPARTMENTS.includes(department)) {
    return json({ error: `Department must be one of: ${DEPARTMENTS.join(", ")}` }, 400);
  }
  if (can_email !== undefined && typeof can_email !== "boolean") {
    return json({ error: "can_email must be true or false" }, 400);
  }
  // Who may write to customers on the team's behalf is an admin's decision —
  // the same line the database draws in profiles_freeze_privileged_fields().
  if (can_email !== undefined && !isAdmin) {
    return json({ error: "Only admins can change who may email customers" }, 403);
  }

  // Managers may only act on managers and members, never on admins.
  const loadTarget = async (targetId: string) => {
    const { data } = await admin
      .from("profiles").select("id, role, email").eq("id", targetId).single();
    return data;
  };
  const managerMayTouch = (targetRole: string) =>
    targetRole === "manager" || targetRole === "member";

  try {
    switch (action) {
      case "create": {
        if (!isAdmin) return json({ error: "Only admins can create users" }, 403);
        if (!email) return json({ error: "An email is required: it is how they sign in" }, 400);
        // The UI shows a name everywhere instead of the email, so never store a
        // blank one — fall back to a name derived from the address.
        const derived = (full_name ?? "").trim() ||
          (email ?? "").split("@")[0]
            .replace(/\d+$/, "").split(/[._+-]+/).filter(Boolean)
            .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") ||
          email;
        // `handle_new_user` refuses any auth user nobody asked for, so the
        // address is put on the list it checks first. It takes the row as it
        // lets the account in; one left behind by a failure is removed here,
        // so a stale invite can never admit a later Google sign-up.
        const { error: invErr } = await admin.from("account_invites")
          .upsert({ email, invited_by: user.id }, { onConflict: "email" });
        if (invErr) throw invErr;
        // Confirmed, and no password: the first Google sign-in with this
        // address is attached to this account.
        const { data, error } = await admin.auth.admin.createUser({
          email, email_confirm: true,
        });
        if (error) {
          await admin.from("account_invites").delete().eq("email", email);
          throw error;
        }
        // The `on_auth_user_created` trigger has already written a profiles row
        // (as a plain member) by the time createUser returns — so upsert over it
        // rather than insert, which would collide on the primary key.
        const { error: pErr } = await admin.from("profiles").upsert({
          id: data.user.id, email, full_name: derived,
          role: role ?? "member", is_active: true,
          // Everyone has one: it decides who they can be paired with on a
          // ticket, and the column is `not null`.
          department: department ?? DEFAULT_DEPARTMENT,
          can_email: can_email ?? false,
        }, { onConflict: "id" });
        if (pErr) {
          await admin.auth.admin.deleteUser(data.user.id); // no orphaned auth user
          throw pErr;
        }
        return json({ id: data.user.id });
      }

      case "delete": {
        if (!isAdmin) return json({ error: "Only admins can delete users" }, 403);
        if (id === user.id) return json({ error: "You cannot delete yourself" }, 400);
        const { error } = await admin.auth.admin.deleteUser(id); // cascades to profiles
        if (error) throw error;
        return json({ ok: true });
      }

      case "set_active": {
        const target = await loadTarget(id);
        if (!target) return json({ error: "User not found" }, 404);
        if (id === user.id) return json({ error: "You cannot disable yourself" }, 400);
        if (!isAdmin && !managerMayTouch(target.role)) {
          return json({ error: "Managers cannot disable an admin" }, 403);
        }
        // Ban at the auth layer so a disabled account genuinely cannot sign in;
        // the profile flag is what the UI reads.
        const { error: banErr } = await admin.auth.admin.updateUserById(id, {
          ban_duration: is_active ? UNBAN : BAN_FOREVER,
        });
        if (banErr) throw banErr;
        const { error } = await admin.from("profiles")
          .update({ is_active }).eq("id", id);
        if (error) throw error;
        return json({ ok: true });
      }

      case "update": {
        const target = await loadTarget(id);
        if (!target) return json({ error: "User not found" }, 404);
        if (!isAdmin && !managerMayTouch(target.role)) {
          return json({ error: "Managers cannot edit an admin" }, 403);
        }
        if (role !== undefined && role !== target.role && !isAdmin) {
          return json({ error: "Only admins can change roles" }, 403);
        }
        const patch: Record<string, unknown> = {};
        // Correcting the login email. The account keeps its id, so every
        // ticket, comment and project membership stays on it; only the Google
        // address that opens it changes. Confirmed at once — an unconfirmed
        // address is one Google sign-in will not be attached to.
        if (email !== undefined && email !== (target.email ?? "").toLowerCase()) {
          if (!isAdmin) return json({ error: "Only admins can change a login email" }, 403);
          const { error } = await admin.auth.admin.updateUserById(id, {
            email, email_confirm: true,
          });
          if (error) throw error;
          patch.email = email;
        }
        if (full_name !== undefined) patch.full_name = full_name;
        if (role !== undefined && isAdmin) patch.role = role;
        // Same boundary as editing anything else about the account: an admin
        // for anyone, a manager for managers and members.
        if (department !== undefined) patch.department = department;
        if (can_email !== undefined) patch.can_email = can_email;
        if (Object.keys(patch).length) {
          const { error } = await admin.from("profiles").update(patch).eq("id", id);
          if (error) throw error;
        }
        return json({ ok: true });
      }

      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
});
