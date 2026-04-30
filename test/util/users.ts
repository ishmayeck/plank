import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * `supabase db reset` truncates the public schema but not auth.users.
 * Tests that re-create the same fixed-email user across runs need to
 * defensively wipe both:
 *  - the profile row keyed by username (cascades to anything else with
 *    profiles(id) cascade FKs)
 *  - any auth.users rows with the matching email
 *  - posts / topics / privmsgs the user authored, since those FKs do
 *    NOT cascade and would block the auth.users delete.
 */
export async function deleteUserAndAllRefs(
  adminDb: SupabaseClient,
  userId: string
) {
  await adminDb.from("posts").delete().eq("poster_id", userId);
  await adminDb.from("topics").delete().eq("topic_poster", userId);
  await adminDb.from("privmsgs").delete().eq("privmsgs_from_userid", userId);
  await adminDb.from("privmsgs").delete().eq("privmsgs_to_userid", userId);
  await adminDb.from("user_group").delete().eq("user_id", userId);
  await adminDb.from("banlist").delete().eq("ban_userid", userId);
  await adminDb.auth.admin.deleteUser(userId);
}

/**
 * Remove a test user thoroughly so the next run starts from a clean
 * slate even if the previous run left debris. Pass both the username
 * (looked up via profiles) and the email (looked up via auth.users
 * listUsers) — either may identify the leftover row.
 */
export async function cleanupTestUser(
  adminDb: SupabaseClient,
  username: string,
  email?: string
) {
  const { data: profile } = await adminDb
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();
  if (profile) await deleteUserAndAllRefs(adminDb, profile.id);

  if (email) {
    const { data: list } = await adminDb.auth.admin.listUsers({ perPage: 1000 });
    for (const u of list?.users ?? []) {
      if (u.email === email) await deleteUserAndAllRefs(adminDb, u.id);
    }
  }
}
