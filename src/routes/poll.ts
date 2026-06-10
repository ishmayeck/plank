import { Hono } from "hono";
import { renderMessagePage } from "../lib/render.js";
import { getSupabaseAdmin } from "../db/client.js";
import { escapeHtml } from "../lib/escape.js";
import { markup, type MarkupString } from "../lib/markup.js";
import { loginRedirect } from "./auth.js";
import { loadUserGroupAcls, canDo } from "../lib/permissions.js";
const poll = new Hono();

// ─── Vote Submission ──────────────────────────────────────────

poll.post("/poll", async (c) => {
  const user = c.get("user");
  if (!user) return c.redirect(loginRedirect(c));

  const body = await c.req.parseBody();
  const topicId = parseInt(body.topic_id as string, 10);
  const optionId = parseInt(body.vote_id as string, 10);

  if (!topicId || !optionId) {
    return c.text("Invalid vote", 400);
  }

  const adminDb = getSupabaseAdmin();
  const supabase = getSupabaseAdmin();

  // Per-forum auth_vote gate. Fetch the topic + its parent forum to
  // resolve the ACL — the user might be allowed to view the topic but
  // not vote in its forum (e.g. read-only group permission).
  const { data: pollTopic } = await supabase
    .from("topics")
    .select("forum_id, forums(*)")
    .eq("id", topicId)
    .maybeSingle();
  if (!pollTopic) return c.text("Topic not found", 404);
  const pollForum = (pollTopic as any).forums;
  if (!pollForum) return c.text("Topic not found", 404);
  const userAcls = await loadUserGroupAcls(supabase, user);
  if (!canDo("view", pollForum, user, userAcls)) return c.text("Topic not found", 404);
  if (!canDo("vote", pollForum, user, userAcls)) {
    return c.text("You do not have permission to vote in this forum.", 403);
  }

  // Get the poll for this topic — most topics have no poll, so 0 rows
  // is the common case (would otherwise log a Supabase error per call).
  const { data: pollQ } = await adminDb
    .from("poll_questions")
    .select("id, poll_start, poll_length")
    .eq("topic_id", topicId)
    .maybeSingle();

  if (!pollQ) return c.text("Poll not found", 404);

  // Check if poll has expired
  if (pollQ.poll_length) {
    const start = new Date(pollQ.poll_start);
    const lengthMs = parsePgInterval(pollQ.poll_length);
    if (lengthMs && Date.now() > start.getTime() + lengthMs) {
      return c.redirect(`/viewtopic/${topicId}`);
    }
  }

  // Check if user already voted (most users haven't, so 0 rows is normal)
  const { data: existingVote } = await adminDb
    .from("poll_votes")
    .select("poll_id")
    .eq("poll_id", pollQ.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingVote) {
    return c.redirect(`/viewtopic/${topicId}`);
  }

  // Verify option belongs to this poll
  const { data: option } = await adminDb
    .from("poll_options")
    .select("id")
    .eq("id", optionId)
    .eq("poll_id", pollQ.id)
    .maybeSingle();

  if (!option) return c.text("Invalid option", 400);

  // Record vote and atomically bump the option's tally
  await adminDb.from("poll_votes").insert({
    poll_id: pollQ.id,
    user_id: user.id,
    option_id: optionId,
  });
  await adminDb.rpc("increment_poll_vote", { p_option_id: optionId });

  const viewUrl = `/viewtopic/${topicId}`;
  return c.html(renderMessagePage({
    ctx: { user: { id: user.id, username: user.username, unreadPms: user.unreadPms, userLevel: user.userLevel } },
    title: "Information",
    messageHtml:
      'Your vote has been cast.<br /><br />' +
      `Click <a href="${viewUrl}">Here</a> to view the topic`,
    redirectUrl: viewUrl,
  }));
});

// ─── Poll Display Helper ─────────────────────────────────────

export async function renderPollForTopic(
  topicId: number,
  userId: string | null,
  showViewResults: boolean
): Promise<MarkupString> {
  const adminDb = getSupabaseAdmin();

  const { data: pollQ } = await adminDb
    .from("poll_questions")
    .select("*")
    .eq("topic_id", topicId)
    .maybeSingle();

  if (!pollQ) return markup("");

  // Get options
  const { data: options } = await adminDb
    .from("poll_options")
    .select("*")
    .eq("poll_id", pollQ.id)
    .order("option_order");

  if (!options || options.length === 0) return markup("");

  // Check if user has voted
  let hasVoted = false;
  if (userId) {
    const { data: vote } = await adminDb
      .from("poll_votes")
      .select("poll_id")
      .eq("poll_id", pollQ.id)
      .eq("user_id", userId)
      .maybeSingle();
    hasVoted = !!vote;
  }

  // Check if poll expired
  let isExpired = false;
  if (pollQ.poll_length) {
    const start = new Date(pollQ.poll_start);
    const lengthMs = parsePgInterval(pollQ.poll_length);
    if (lengthMs && Date.now() > start.getTime() + lengthMs) {
      isExpired = true;
    }
  }

  const showResults = hasVoted || isExpired || !userId;

  if (showResults || showViewResults) {
    return markup(renderPollResults(pollQ, options, topicId));
  } else {
    return markup(renderPollBallot(pollQ, options, topicId));
  }
}

function renderPollBallot(
  pollQ: any,
  options: any[],
  topicId: number
): string {
  let html = `<tr><td class="row2" colspan="2"><br clear="all" /><form method="POST" action="/poll"><table cellspacing="0" cellpadding="4" border="0" align="center">`;
  html += `<tr><td align="center"><span class="genmed"><b>${escapeHtml(pollQ.poll_text)}</b></span></td></tr>`;
  html += `<tr><td align="center"><table cellspacing="0" cellpadding="2" border="0">`;

  for (const opt of options) {
    html += `<tr><td><input type="radio" name="vote_id" value="${opt.id}" class="checkbox" />&nbsp;</td>`;
    html += `<td><span class="genmed">${escapeHtml(opt.option_text)}</span></td></tr>`;
  }

  html += `</table></td></tr>`;
  html += `<tr><td align="center"><input type="submit" name="submit" value="Submit Vote" class="liteoption" /></td></tr>`;
  html += `<tr><td align="center"><span class="gensmall"><b><a href="/viewtopic/${topicId}?poll_results=1" class="gensmall">View Results</a></b></span></td></tr>`;
  html += `</table><input type="hidden" name="topic_id" value="${topicId}" /></form></td></tr>`;

  return html;
}

function renderPollResults(
  pollQ: any,
  options: any[],
  topicId: number
): string {
  const totalVotes = options.reduce((sum, o) => sum + (o.vote_count ?? 0), 0);

  let html = `<tr><td class="row2" colspan="2"><br clear="all" /><table cellspacing="0" cellpadding="4" border="0" align="center">`;
  html += `<tr><td colspan="4" align="center"><span class="genmed"><b>${escapeHtml(pollQ.poll_text)}</b></span></td></tr>`;
  html += `<tr><td align="center"><table cellspacing="0" cellpadding="2" border="0">`;

  for (const opt of options) {
    const votes = opt.vote_count ?? 0;
    const percent = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
    const barWidth = Math.max(1, Math.round(percent * 2)); // max 200px wide

    html += `<tr>`;
    html += `<td><span class="genmed">${escapeHtml(opt.option_text)}</span></td>`;
    html += `<td><table cellspacing="0" cellpadding="0" border="0"><tr>`;
    html += `<td><img src="templates/Solaris/images/voting_bar_lcap.gif" width="8" alt="" height="17" /></td>`;
    html += `<td><img src="templates/Solaris/images/voting_bar.gif" width="${barWidth}" height="17" alt="${percent}%" /></td>`;
    html += `<td><img src="templates/Solaris/images/voting_bar_rcap.gif" width="8" alt="" height="17" /></td>`;
    html += `</tr></table></td>`;
    html += `<td align="center"><b><span class="genmed">&nbsp;${percent}%&nbsp;</span></b></td>`;
    html += `<td align="center"><span class="genmed">[ ${votes} ]</span></td>`;
    html += `</tr>`;
  }

  html += `</table></td></tr>`;
  html += `<tr><td colspan="4" align="center"><span class="genmed"><b>Total Votes : ${totalVotes}</b></span></td></tr>`;
  html += `</table><br clear="all" /></td></tr>`;

  return html;
}

function parsePgInterval(interval: string): number | null {
  // Parse common Postgres interval formats like "7 days", "1 mon", etc.
  const match = interval.match(/(\d+)\s*(day|hour|min|sec|mon|year)/i);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = {
    sec: 1000,
    min: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    mon: 30 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000,
  };
  return value * (multipliers[unit] ?? 0);
}

export default poll;
