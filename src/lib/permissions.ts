/**
 * Per-forum permissions, modelled on phpBB2's three-tier auth system.
 *
 * Each `forums.auth_*` column stores the *required* auth level for an
 * action (view, read, post, reply, edit, delete, sticky, announce,
 * vote, pollcreate). A user passes the gate if their effective level
 * for that forum is at least the required level.
 *
 * Effective level is derived per-request from:
 *  - the user's global `user_level` (USER / ADMIN / MOD), and
 *  - the user's `auth_access` rows (groups they're in × per-forum bits).
 *
 * We deliberately do NOT auto-sync `user_level` from group membership.
 * Mods and admins are still set explicitly by an admin; per-forum mods
 * (groups with `auth_mod = true` on a specific forum) pass forum-MOD
 * gates but are not promoted globally.
 *
 * AUTH levels match phpBB2's constants.php so future imports drop in
 * cleanly:
 *   0 ALL    — everyone, even guests
 *   1 REG    — any logged-in user
 *   2 ACL    — must have the matching `auth_access` bit on this forum
 *   3 MOD    — global mod/admin, OR group with `auth_mod = true`
 *   5 ADMIN  — global admin only
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { USER_LEVEL } from "./userLevel.js";

export const AUTH_LEVEL = {
  ALL: 0,
  REG: 1,
  ACL: 2,
  MOD: 3,
  ADMIN: 5,
} as const;

export type AuthLevel = typeof AUTH_LEVEL[keyof typeof AUTH_LEVEL];

/**
 * Every per-forum action that has a corresponding `forums.auth_*`
 * column and `auth_access.auth_*` bit. The names match the columns —
 * `auth_mod` is the per-forum "make this group a mod here" bit and is
 * not in this list; it feeds into the MOD-level checks below.
 */
export type ForumAction =
  | "view"
  | "read"
  | "post"
  | "reply"
  | "edit"
  | "delete"
  | "sticky"
  | "announce"
  | "vote"
  | "pollcreate";

const FORUM_AUTH_COLUMNS: Record<ForumAction, string> = {
  view: "auth_view",
  read: "auth_read",
  post: "auth_post",
  reply: "auth_reply",
  edit: "auth_edit",
  delete: "auth_delete",
  sticky: "auth_sticky",
  announce: "auth_announce",
  vote: "auth_vote",
  pollcreate: "auth_pollcreate",
};

interface UserLike {
  id: string;
  userLevel?: number | null;
}

/**
 * A user's `auth_access` rows joined across all groups they're in,
 * keyed by forum_id with each per-action bit OR'd across rows
 * (most-permissive wins). Build this once per request — most pages
 * check several actions on several forums.
 */
export interface ForumAclMap {
  [forumId: number]: {
    view: boolean;
    read: boolean;
    post: boolean;
    reply: boolean;
    edit: boolean;
    delete: boolean;
    sticky: boolean;
    announce: boolean;
    vote: boolean;
    pollcreate: boolean;
    mod: boolean;
  };
}

function emptyAcl(): ForumAclMap[number] {
  return {
    view: false,
    read: false,
    post: false,
    reply: false,
    edit: false,
    delete: false,
    sticky: false,
    announce: false,
    vote: false,
    pollcreate: false,
    mod: false,
  };
}

/**
 * Load every `auth_access` bit for every group the user belongs to,
 * OR'd across groups so the caller sees a single resolved row per
 * forum. Returns an empty map for guests.
 *
 * One round-trip via a join, not one query per group.
 */
export async function loadUserGroupAcls(
  supabase: SupabaseClient,
  user: UserLike | null | undefined
): Promise<ForumAclMap> {
  if (!user) return {};

  const { data: groups } = await supabase
    .from("user_group")
    .select("group_id")
    .eq("user_id", user.id)
    .eq("user_pending", false);

  const groupIds = (groups ?? []).map((g: any) => g.group_id as number);
  if (groupIds.length === 0) return {};

  const { data: rows } = await supabase
    .from("auth_access")
    .select(
      "forum_id, auth_view, auth_read, auth_post, auth_reply, auth_edit, " +
        "auth_delete, auth_sticky, auth_announce, auth_vote, auth_pollcreate, auth_mod"
    )
    .in("group_id", groupIds);

  const acl: ForumAclMap = {};
  for (const row of rows ?? []) {
    const fid = (row as any).forum_id as number;
    const cur = acl[fid] ?? emptyAcl();
    acl[fid] = {
      view: cur.view || !!(row as any).auth_view,
      read: cur.read || !!(row as any).auth_read,
      post: cur.post || !!(row as any).auth_post,
      reply: cur.reply || !!(row as any).auth_reply,
      edit: cur.edit || !!(row as any).auth_edit,
      delete: cur.delete || !!(row as any).auth_delete,
      sticky: cur.sticky || !!(row as any).auth_sticky,
      announce: cur.announce || !!(row as any).auth_announce,
      vote: cur.vote || !!(row as any).auth_vote,
      pollcreate: cur.pollcreate || !!(row as any).auth_pollcreate,
      mod: cur.mod || !!(row as any).auth_mod,
    };
  }
  return acl;
}

/**
 * Check whether the user may perform `action` on `forum`, given their
 * pre-loaded ACL map. The `forum` value can be the raw row or just the
 * subset that includes `id` and the relevant `auth_*` column.
 */
export function canDo(
  action: ForumAction,
  forum: { id: number } & Record<string, any>,
  user: UserLike | null | undefined,
  acl: ForumAclMap
): boolean {
  const column = FORUM_AUTH_COLUMNS[action];

  // Fail LOUD, not open. A missing property means the caller's select()
  // didn't fetch this column — not that the forum is unrestricted. Treating
  // the two the same silently granted access to everyone (viewtopic selected
  // only auth_view/auth_read, then asked about reply/edit/delete). A DB NULL
  // is a different thing and still means "no restriction" below.
  if (!(column in forum)) {
    throw new Error(
      `canDo("${action}") requires forums.${column}, which was not selected ` +
        `for forum ${forum.id}. Add it to the select() — defaulting it would ` +
        `silently grant access.`
    );
  }

  const required = forum[column] as number | null;
  const level = required ?? AUTH_LEVEL.ALL;

  // ADMIN always wins.
  if (user?.userLevel === USER_LEVEL.ADMIN) return true;

  switch (level) {
    case AUTH_LEVEL.ALL:
      return true;
    case AUTH_LEVEL.REG:
      return !!user;
    case AUTH_LEVEL.ACL:
      // Must be in a group with the matching per-forum bit set.
      // Global mods also pass — they can do anything a per-forum mod
      // could, by virtue of being a mod everywhere.
      if (user?.userLevel === USER_LEVEL.MOD) return true;
      return !!user && !!acl[forum.id]?.[action];
    case AUTH_LEVEL.MOD:
      // Global mod/admin OR per-forum mod (auth_mod bit on this forum).
      if (user?.userLevel === USER_LEVEL.MOD) return true;
      return !!user && !!acl[forum.id]?.mod;
    case AUTH_LEVEL.ADMIN:
      // Already handled above.
      return false;
    default:
      // Unknown level — fail closed.
      return false;
  }
}

/**
 * True if the user has moderator authority over `forumId`. Used to
 * gate modcp actions, IP visibility, edit-anyone's-post, etc.
 *
 * Global mods/admins pass everywhere. Per-forum mods pass for their
 * forum(s) only.
 */
export function canMod(
  forumId: number,
  user: UserLike | null | undefined,
  acl: ForumAclMap
): boolean {
  if (!user) return false;
  if (user.userLevel === USER_LEVEL.ADMIN) return true;
  if (user.userLevel === USER_LEVEL.MOD) return true;
  return !!acl[forumId]?.mod;
}

/**
 * Filter a list of forums down to ones the user can see (`auth_view`).
 * Cheap helper for the index + jumpbox + last-post lookups, which all
 * need to omit forums the viewer can't reach.
 */
export function filterViewable<T extends { id: number; auth_view?: number | null }>(
  forums: T[],
  user: UserLike | null | undefined,
  acl: ForumAclMap
): T[] {
  return forums.filter((f) => canDo("view", f, user, acl));
}

/**
 * The ids of every forum this user may reach for `action` (always also
 * requiring `view` — you must not find content in a forum you can't see).
 *
 * This is the primitive for queries that range across forums rather than
 * starting from one: search, quick-searches, "new posts". Those can't gate on
 * a single forum row, so they need the allowed set pushed into the query as a
 * `forum_id IN (...)` predicate. Returning [] means "nothing is reachable" —
 * callers must render an empty result, NOT skip the filter.
 */
export async function loadAccessibleForumIds(
  supabase: SupabaseClient,
  user: UserLike | null | undefined,
  action: ForumAction = "read"
): Promise<number[]> {
  const column = FORUM_AUTH_COLUMNS[action];
  // Dedupe: action "view" would otherwise select auth_view twice.
  const columns = Array.from(new Set(["id", "auth_view", column])).join(", ");

  const { data: forums } = await supabase.from("forums").select(columns);
  if (!forums || forums.length === 0) return [];

  const acl = await loadUserGroupAcls(supabase, user);
  return (forums as unknown as ({ id: number } & Record<string, any>)[])
    .filter((f) => canDo("view", f, user, acl) && canDo(action, f, user, acl))
    .map((f) => f.id);
}
