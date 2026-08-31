import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-user read tracking (Chunk 18).
 *
 * Answers one question — "has this user seen this since the last post in it?"
 * — against three watermarks, most specific first:
 *
 *   1. topics_read      they opened this topic
 *   2. forums_read      they marked this forum read
 *   3. user_lastmark    they marked the whole board read
 *
 * Everything here is batched. The naive shape ("is this topic unread?" once
 * per row) is 25 queries on a topic list, so callers load the state for a
 * whole page in one round trip and then ask questions of it in memory.
 */

/** A user's read watermarks, loaded once per request. */
export interface ReadState {
  topics: Map<number, number>; // topic_id → epoch ms
  forums: Map<number, number>; // forum_id → epoch ms
  boardMark: number; // epoch ms, 0 when never marked
}

/** Guests track nothing, and everything reads as already-seen for them. */
export const GUEST_READ_STATE: ReadState = {
  topics: new Map(),
  forums: new Map(),
  boardMark: Number.POSITIVE_INFINITY,
};

function toEpoch(value: string | null | undefined): number {
  if (!value) return 0;
  const t = Date.parse(value);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Load the read state a page needs.
 *
 * Pass only the ids actually on the page; `topicIds` empty is fine (the index
 * needs forum watermarks but no topic rows).
 */
export async function loadReadState(
  db: SupabaseClient,
  user: { id: string } | null | undefined,
  opts: { topicIds?: number[]; forumIds?: number[] } = {}
): Promise<ReadState> {
  if (!user) return GUEST_READ_STATE;

  const topicIds = [...new Set(opts.topicIds ?? [])];
  const forumIds = [...new Set(opts.forumIds ?? [])];

  const [profileRes, topicsRes, forumsRes] = await Promise.all([
    db.from("profiles").select("user_lastmark").eq("id", user.id).maybeSingle(),
    topicIds.length
      ? db
          .from("topics_read")
          .select("topic_id, read_time")
          .eq("user_id", user.id)
          .in("topic_id", topicIds)
      : Promise.resolve({ data: [] as any[] }),
    forumIds.length
      ? db
          .from("forums_read")
          .select("forum_id, read_time")
          .eq("user_id", user.id)
          .in("forum_id", forumIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const topics = new Map<number, number>();
  for (const row of (topicsRes as any).data ?? []) {
    topics.set(row.topic_id, toEpoch(row.read_time));
  }
  const forums = new Map<number, number>();
  for (const row of (forumsRes as any).data ?? []) {
    forums.set(row.forum_id, toEpoch(row.read_time));
  }

  return {
    topics,
    forums,
    boardMark: toEpoch((profileRes.data as any)?.user_lastmark),
  };
}

/**
 * Has this topic been posted in since the user last saw it?
 *
 * `lastPostTime` null means the topic has no posts, which can't be unread.
 */
export function isTopicUnread(
  state: ReadState,
  topicId: number,
  forumId: number,
  lastPostTime: string | Date | null | undefined
): boolean {
  if (!lastPostTime) return false;
  const posted =
    lastPostTime instanceof Date ? lastPostTime.getTime() : toEpoch(lastPostTime);
  if (!posted) return false;

  const watermark = Math.max(
    state.topics.get(topicId) ?? 0,
    state.forums.get(forumId) ?? 0,
    state.boardMark
  );
  return posted > watermark;
}

/**
 * Forum-level unread, for the index.
 *
 * Uses the forum's own last-post time against the forum and board watermarks
 * only — deliberately NOT "does this forum contain any unread topic", which
 * would need a per-forum subquery on every index render. The difference shows
 * up only when a user has read the newest topic without marking the forum,
 * and phpBB2 behaved the same way. Cheap and almost always right beats exact
 * and slow on the busiest page of the board.
 */
export function isForumUnread(
  state: ReadState,
  forumId: number,
  lastPostTime: string | Date | null | undefined
): boolean {
  if (!lastPostTime) return false;
  const posted =
    lastPostTime instanceof Date ? lastPostTime.getTime() : toEpoch(lastPostTime);
  if (!posted) return false;

  return posted > Math.max(state.forums.get(forumId) ?? 0, state.boardMark);
}

/** Record that the user has now seen this topic. Fire-and-forget by design. */
export async function markTopicRead(
  db: SupabaseClient,
  userId: string,
  topicId: number
): Promise<void> {
  const { error } = await db
    .from("topics_read")
    .upsert(
      { user_id: userId, topic_id: topicId, read_time: new Date().toISOString() },
      { onConflict: "user_id,topic_id" }
    );
  if (error) console.error("[readtracking] markTopicRead failed:", error.message);
}

/** Mark one forum read. */
export async function markForumRead(
  db: SupabaseClient,
  userId: string,
  forumId: number
): Promise<void> {
  const { error } = await db
    .from("forums_read")
    .upsert(
      { user_id: userId, forum_id: forumId, read_time: new Date().toISOString() },
      { onConflict: "user_id,forum_id" }
    );
  if (error) console.error("[readtracking] markForumRead failed:", error.message);
}

/**
 * Mark the entire board read, and drop the now-redundant per-topic and
 * per-forum rows: anything read before this watermark can no longer change an
 * answer, so keeping it would just grow the table forever.
 */
export async function markAllRead(
  db: SupabaseClient,
  userId: string
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db
    .from("profiles")
    .update({ user_lastmark: now })
    .eq("id", userId);
  if (error) {
    console.error("[readtracking] markAllRead failed:", error.message);
    return;
  }
  const { error: pruneError } = await db.rpc("prune_read_rows", {
    p_user_id: userId,
    p_before: now,
  });
  if (pruneError) {
    // Non-fatal: the watermark is what makes the answer correct, the prune is
    // only housekeeping.
    console.error("[readtracking] prune failed:", pruneError.message);
  }
}
