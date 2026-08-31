import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Topic watching (Chunk 18).
 *
 * The topics_watch table has existed since the initial schema and nothing ever
 * read or wrote it. This is the implementation.
 *
 * **Deliberately not email.** The roadmap wrote this item as "subscribe to
 * email notifications", but sending mail means SMTP credentials, deliverability
 * reputation, bounce handling and an unsubscribe obligation — a lot of moving
 * parts for a private forum whose members are already visiting the site. The
 * same roadmap already cut mass email for exactly this reasoning.
 *
 * So watching is in-board: a watched topic with new posts is surfaced through
 * the read-tracking machinery that already exists (src/lib/readtracking.ts),
 * via a "watched topics" view. If email is ever wanted, notify_status is
 * already the flag a sender would drive from — the data model doesn't need to
 * change, only a delivery mechanism gets added.
 */

export interface WatchState {
  watching: boolean;
  /** phpBB2's flag: set when something has happened since the user last looked. */
  notify: boolean;
}

/** Is this user watching this topic? */
export async function getWatchState(
  db: SupabaseClient,
  userId: string,
  topicId: number
): Promise<WatchState> {
  const { data } = await db
    .from("topics_watch")
    .select("notify_status")
    .eq("user_id", userId)
    .eq("topic_id", topicId)
    .maybeSingle();

  return { watching: !!data, notify: !!(data as any)?.notify_status };
}

/** Start watching. Idempotent — re-watching an already-watched topic is fine. */
export async function watchTopic(
  db: SupabaseClient,
  userId: string,
  topicId: number
): Promise<void> {
  const { error } = await db
    .from("topics_watch")
    .upsert(
      { user_id: userId, topic_id: topicId, notify_status: false },
      { onConflict: "topic_id,user_id" }
    );
  if (error) console.error("[watch] watchTopic failed:", error.message);
}

export async function unwatchTopic(
  db: SupabaseClient,
  userId: string,
  topicId: number
): Promise<void> {
  const { error } = await db
    .from("topics_watch")
    .delete()
    .eq("user_id", userId)
    .eq("topic_id", topicId);
  if (error) console.error("[watch] unwatchTopic failed:", error.message);
}

/**
 * Every topic this user watches.
 *
 * Returned as ids so the caller can hand them straight to the same batched
 * queries the topic lists already use, rather than inventing a second way to
 * render a list of topics.
 */
export async function watchedTopicIds(
  db: SupabaseClient,
  userId: string
): Promise<number[]> {
  const { data } = await db
    .from("topics_watch")
    .select("topic_id")
    .eq("user_id", userId);
  return (data ?? []).map((r: any) => r.topic_id as number);
}

/**
 * Mark every watcher of a topic as having something to see — except the person
 * who caused it. Called when a reply lands.
 *
 * Fire-and-forget from the posting path: a failure here costs a notification
 * flag, and must never cost someone their post.
 */
export async function flagWatchersOnReply(
  db: SupabaseClient,
  topicId: number,
  posterId: string
): Promise<void> {
  const { error } = await db
    .from("topics_watch")
    .update({ notify_status: true })
    .eq("topic_id", topicId)
    .neq("user_id", posterId);
  if (error) console.error("[watch] flagWatchersOnReply failed:", error.message);
}

/** Clear the flag for one user — they've now seen the topic. */
export async function clearNotifyFlag(
  db: SupabaseClient,
  userId: string,
  topicId: number
): Promise<void> {
  const { error } = await db
    .from("topics_watch")
    .update({ notify_status: false })
    .eq("user_id", userId)
    .eq("topic_id", topicId)
    .eq("notify_status", true);
  if (error) console.error("[watch] clearNotifyFlag failed:", error.message);
}
