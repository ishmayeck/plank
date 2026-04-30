import { Hono } from "hono";
import { createPageTemplate, renderPage, renderMessagePage, fetchAndRenderJumpbox } from "../lib/render.js";
import { getSupabaseAdmin } from "../db/client.js";
import { loginRedirect } from "./auth.js";

const groupcp = new Hono();

// ─── Group List (no group selected) ───────────────────────────

groupcp.get("/groupcp", async (c) => {
  const user = c.get("user");
  const groupId = parseInt(c.req.query("g") ?? "0", 10);

  // If a group is selected, show group info
  if (groupId) {
    return renderGroupInfo(c, groupId);
  }

  // Otherwise show the group list page
  if (!user) return c.redirect(loginRedirect(c));

  const supabase = c.get("supabase");
  const adminDb = getSupabaseAdmin();

  // Get groups user belongs to
  const { data: memberGroups } = await adminDb
    .from("user_group")
    .select("group_id, user_pending, groups(id, group_name, group_type)")
    .eq("user_id", user.id)
    .eq("user_pending", false);

  // Get groups user has pending membership
  const { data: pendingGroups } = await adminDb
    .from("user_group")
    .select("group_id, groups(id, group_name, group_type)")
    .eq("user_id", user.id)
    .eq("user_pending", true);

  // Get available groups (open/closed, not hidden, not already member)
  const memberGroupIds = (memberGroups ?? []).map((g: any) => g.group_id);
  const pendingGroupIds = (pendingGroups ?? []).map((g: any) => g.group_id);
  const excludeIds = [...memberGroupIds, ...pendingGroupIds];

  const { data: availableGroups } = await adminDb
    .from("groups")
    .select("id, group_name, group_type")
    .eq("group_single_user", false)
    .in("group_type", [0, 1]) // open or closed, not hidden
    .order("group_name");

  const filteredAvailable = (availableGroups ?? []).filter(
    (g: any) => !excludeIds.includes(g.id)
  );

  const tpl = createPageTemplate({
    user: { id: user.id, username: user.username, unreadPms: user.unreadPms, userLevel: user.userLevel },
    pageTitle: "Usergroups",
  });

  tpl.loadFile("body", "groupcp_user_body.tpl");

  tpl.assignVars({
    U_INDEX: "/",
    L_INDEX: "Index",
    S_USERGROUP_ACTION: "/groupcp",
    S_HIDDEN_FIELDS: "",
    S_TIMEZONE: "All times are GMT",
    JUMPBOX: await fetchAndRenderJumpbox(supabase),

    L_GROUP_MEMBERSHIP_DETAILS: "Group Membership Details",
    L_YOU_BELONG_GROUPS: "You belong to the following groups:",
    L_PENDING_GROUPS: "Your membership is pending for:",
    L_JOIN_A_GROUP: "Join a Group",
    L_SELECT_A_GROUP: "Select a group to view information:",
    L_VIEW_INFORMATION: "View Information",
  });

  // Build selects
  const hasMembers = (memberGroups ?? []).length > 0;
  const hasPending = (pendingGroups ?? []).length > 0;
  const hasRemaining = filteredAvailable.length > 0;

  if (hasMembers || hasPending) {
    tpl.assignBlockVars("switch_groups_joined", {});

    if (hasMembers) {
      let memberSelect = '<select name="g">';
      for (const mg of memberGroups!) {
        const g = mg.groups as any;
        if (g && !g.group_single_user) {
          memberSelect += `<option value="${g.id}">${g.group_name}</option>`;
        }
      }
      memberSelect += "</select>";

      tpl.assignVars({ GROUP_MEMBER_SELECT: memberSelect });
      tpl.assignBlockVars("switch_groups_joined.switch_groups_member", {});
    }

    if (hasPending) {
      let pendingSelect = '<select name="g">';
      for (const pg of pendingGroups!) {
        const g = pg.groups as any;
        if (g) {
          pendingSelect += `<option value="${g.id}">${g.group_name}</option>`;
        }
      }
      pendingSelect += "</select>";

      tpl.assignVars({ GROUP_PENDING_SELECT: pendingSelect });
      tpl.assignBlockVars("switch_groups_joined.switch_groups_pending", {});
    }
  }

  if (hasRemaining) {
    let listSelect = '<select name="g">';
    for (const g of filteredAvailable) {
      listSelect += `<option value="${g.id}">${g.group_name}</option>`;
    }
    listSelect += "</select>";

    tpl.assignVars({ GROUP_LIST_SELECT: listSelect });
    tpl.assignBlockVars("switch_groups_remaining", {});
  }

  return c.html(renderPage(tpl));
});

// ─── Group Info Page ──────────────────────────────────────────

async function renderGroupInfo(c: any, groupId: number) {
  const user = c.get("user");
  if (!user) return c.redirect(loginRedirect(c));

  const supabase = c.get("supabase");
  const adminDb = getSupabaseAdmin();

  const { data: group } = await adminDb
    .from("groups")
    .select("*, moderator:profiles!groups_group_moderator_fkey(id, username, user_posts, user_from)")
    .eq("id", groupId)
    .single();

  if (!group) return c.text("Group not found", 404);

  // Hidden groups: only show to members and mods
  if (group.group_type === 2) {
    const { data: membership } = await adminDb
      .from("user_group")
      .select("user_pending")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .single();
    if (!membership && user.userLevel < 1) {
      return c.text("Group not found", 404);
    }
  }

  // Get user's membership status
  const { data: membership } = await adminDb
    .from("user_group")
    .select("user_pending")
    .eq("group_id", groupId)
    .eq("user_id", user.id)
    .single();

  const isMember = membership && !membership.user_pending;
  const isPending = membership && membership.user_pending;
  const isGroupMod = group.group_moderator === user.id;
  const isAdmin = user.userLevel === 1;

  // Get members
  const { data: members } = await adminDb
    .from("user_group")
    .select("user_id, user_pending, profiles(id, username, user_posts, user_from)")
    .eq("group_id", groupId)
    .eq("user_pending", false);

  // Get pending members (for group mod)
  let pendingMembers: any[] = [];
  if (isGroupMod || isAdmin) {
    const { data: pending } = await adminDb
      .from("user_group")
      .select("user_id, profiles(id, username, user_posts, user_from)")
      .eq("group_id", groupId)
      .eq("user_pending", true);
    pendingMembers = pending ?? [];
  }

  const tpl = createPageTemplate({
    user: { id: user.id, username: user.username, unreadPms: user.unreadPms, userLevel: user.userLevel },
    pageTitle: group.group_name,
  });

  tpl.loadFile("body", "groupcp_info_body.tpl");

  // Membership status text
  let groupDetails = "";
  if (isMember) {
    groupDetails = "You are a member of this group";
  } else if (isPending) {
    groupDetails = "Your membership of this group is pending";
  } else if (group.group_type === 0) {
    groupDetails = "This is an open group: click to request membership";
  } else if (group.group_type === 1) {
    groupDetails = "This is a closed group: no more users accepted";
  }

  const groupTypeNames: Record<number, string> = { 0: "Open", 1: "Closed", 2: "Hidden" };

  tpl.assignVars({
    U_INDEX: "/",
    L_INDEX: "Index",
    L_GROUP_INFORMATION: "Group Information",
    L_GROUP_NAME: "Group name",
    L_GROUP_DESC: "Group description",
    L_GROUP_MEMBERSHIP: "Group membership",
    L_GROUP_TYPE: "Group type",
    L_GROUP_OPEN: "Open",
    L_GROUP_CLOSED: "Closed",
    L_GROUP_HIDDEN: "Hidden",
    L_JOIN_GROUP: "Join Group",
    L_UNSUBSCRIBE_GROUP: "Unsubscribe",
    L_UPDATE: "Update",
    GROUP_NAME: group.group_name,
    GROUP_DESC: group.group_description ?? "",
    GROUP_DETAILS: groupDetails,
    S_GROUPCP_ACTION: "/groupcp",
    S_HIDDEN_FIELDS: `<input type="hidden" name="g" value="${groupId}" />`,
    S_GROUP_OPEN_TYPE: "0",
    S_GROUP_CLOSED_TYPE: "1",
    S_GROUP_HIDDEN_TYPE: "2",
    S_GROUP_OPEN_CHECKED: group.group_type === 0 ? 'checked="checked"' : "",
    S_GROUP_CLOSED_CHECKED: group.group_type === 1 ? 'checked="checked"' : "",
    S_GROUP_HIDDEN_CHECKED: group.group_type === 2 ? 'checked="checked"' : "",

    // Moderator info
    L_GROUP_MODERATOR: "Group Moderator",
    MOD_USERNAME: group.moderator?.username ?? "None",
    MOD_POSTS: String(group.moderator?.user_posts ?? 0),
    MOD_FROM: group.moderator?.user_from ?? "",
    MOD_PM_IMG: group.moderator
      ? `<a href="/privmsg?mode=post&u=${group.moderator.id}"><img src="templates/Solaris/images/lang_english/icon_pm.gif" alt="PM" border="0" /></a>`
      : "",
    MOD_EMAIL_IMG: "",
    MOD_WWW_IMG: "",
    U_MOD_VIEWPROFILE: group.moderator ? `/profile/${group.moderator.id}` : "#",

    // Members
    L_GROUP_MEMBERS: "Group Members",
    L_NO_MEMBERS: "This group has no members",
    L_HIDDEN_MEMBERS: "This group has hidden membership",
    L_REMOVE_SELECTED: "Remove Selected",
    L_PM: "PM",
    L_USERNAME: "Username",
    L_POSTS: "Posts",
    L_FROM: "Location",
    L_EMAIL: "Email",
    L_WEBSITE: "Website",
    L_SELECT: "Select",

    // Add member
    L_ADD_MEMBER: "Add Member",
    L_FIND_USERNAME: "Find a username",
    U_SEARCH_USER: "/search",

    PAGINATION: "",
    PAGE_NUMBER: "",
    S_TIMEZONE: "All times are GMT",
    JUMPBOX: await fetchAndRenderJumpbox(supabase),
    PENDING_USER_BOX: "",
  });

  // Show join/unsub buttons based on status
  if (!isMember && !isPending && group.group_type !== 2) {
    tpl.assignBlockVars("switch_subscribe_group_input", {});
  }
  if (isMember && !isGroupMod) {
    tpl.assignBlockVars("switch_unsubscribe_group_input", {});
  }

  // Show mod options if user is group mod or admin
  if (isGroupMod || isAdmin) {
    tpl.assignBlockVars("switch_mod_option", {});
  }

  // Populate members
  if (group.group_type === 2 && !isMember && !isGroupMod && !isAdmin) {
    tpl.assignBlockVars("switch_hidden_group", {});
  } else if (!members || members.length === 0) {
    tpl.assignBlockVars("switch_no_members", {});
  } else {
    let rowIndex = 0;
    for (const m of members) {
      const profile = m.profiles as any;
      if (!profile) continue;

      const vars: Record<string, string> = {
        ROW_CLASS: rowIndex % 2 === 0 ? "row1" : "row2",
        USERNAME: profile.username,
        U_VIEWPROFILE: `/profile/${profile.id}`,
        POSTS: String(profile.user_posts ?? 0),
        FROM: profile.user_from ?? "",
        PM_IMG: `<a href="/privmsg?mode=post&u=${profile.id}"><img src="templates/Solaris/images/lang_english/icon_pm.gif" alt="PM" border="0" /></a>`,
        EMAIL_IMG: "",
        WWW_IMG: "",
        USER_ID: profile.id,
      };

      tpl.assignBlockVars("member_row", vars);

      if (isGroupMod || isAdmin) {
        tpl.assignBlockVars("member_row.switch_mod_option", {});
      }

      rowIndex++;
    }
  }

  // Pending members box
  if ((isGroupMod || isAdmin) && pendingMembers.length > 0) {
    // Render pending members inline using the pending template
    const pendingTpl = createPageTemplate({
      user: { id: user.id, username: user.username, unreadPms: user.unreadPms, userLevel: user.userLevel },
      pageTitle: "",
    });
    pendingTpl.loadFile("pending", "groupcp_pending_info.tpl");
    pendingTpl.assignVars({
      L_PENDING_MEMBERS: "Pending Members",
      L_PM: "PM",
      L_USERNAME: "Username",
      L_POSTS: "Posts",
      L_FROM: "Location",
      L_EMAIL: "Email",
      L_WEBSITE: "Website",
      L_SELECT: "Select",
      L_APPROVE_SELECTED: "Approve Selected",
      L_DENY_SELECTED: "Deny Selected",
    });

    let rowIdx = 0;
    for (const pm of pendingMembers) {
      const profile = pm.profiles as any;
      if (!profile) continue;
      pendingTpl.assignBlockVars("pending_members_row", {
        ROW_CLASS: rowIdx % 2 === 0 ? "row1" : "row2",
        USERNAME: profile.username,
        U_VIEWPROFILE: `/profile/${profile.id}`,
        POSTS: String(profile.user_posts ?? 0),
        FROM: profile.user_from ?? "",
        PM_IMG: "",
        EMAIL_IMG: "",
        WWW_IMG: "",
        USER_ID: profile.id,
      });
      rowIdx++;
    }

    // Set the rendered pending box as the PENDING_USER_BOX var
    tpl.assignVars({
      PENDING_USER_BOX: pendingTpl.render("pending"),
    });
  }

  return c.html(renderPage(tpl));
}

// ─── Group Actions (POST) ─────────────────────────────────────

groupcp.post("/groupcp", async (c) => {
  const user = c.get("user");
  if (!user) return c.redirect(loginRedirect(c));

  const body = await c.req.parseBody();
  const groupId = parseInt(body.g as string, 10);

  if (!groupId) return c.redirect("/groupcp");

  const adminDb = getSupabaseAdmin();

  // Verify group exists
  const { data: group } = await adminDb
    .from("groups")
    .select("id, group_type, group_moderator")
    .eq("id", groupId)
    .single();

  if (!group) return c.text("Group not found", 404);

  const isGroupMod = group.group_moderator === user.id;
  const isAdmin = user.userLevel === 1;

  // Join group
  if (body.joingroup) {
    if (group.group_type === 0) {
      // Open group: join immediately
      await adminDb.from("user_group").insert({
        group_id: groupId,
        user_id: user.id,
        user_pending: false,
      });
    } else if (group.group_type === 1) {
      // Closed group: request membership (pending)
      await adminDb.from("user_group").insert({
        group_id: groupId,
        user_id: user.id,
        user_pending: true,
      });
    }
    const joinMsg = group.group_type === 1
      ? 'Your request to join this group has been submitted and is pending approval.'
      : 'You have joined this group.';
    return c.html(
      renderMessagePage({
        ctx: { user: { id: user.id, username: user.username, unreadPms: user.unreadPms, userLevel: user.userLevel } },
        title: "Information",
        messageHtml:
          `${joinMsg}<br /><br />` +
          `Click <a href="/groupcp?g=${groupId}">Here</a> to return to group information<br /><br />` +
          'Click <a href="/">Here</a> to return to the Index',
        redirectUrl: `/groupcp?g=${groupId}`,
      })
    );
  }

  // Unsubscribe
  if (body.unsub) {
    await adminDb
      .from("user_group")
      .delete()
      .eq("group_id", groupId)
      .eq("user_id", user.id);
    return c.html(
      renderMessagePage({
        ctx: { user: { id: user.id, username: user.username, unreadPms: user.unreadPms, userLevel: user.userLevel } },
        title: "Information",
        messageHtml:
          'You have been removed from this group.<br /><br />' +
          'Click <a href="/groupcp">Here</a> to return to Usergroups<br /><br />' +
          'Click <a href="/">Here</a> to return to the Index',
        redirectUrl: "/groupcp",
      })
    );
  }

  // Group mod/admin actions
  if (!isGroupMod && !isAdmin) {
    return c.text("Forbidden", 403);
  }

  // Update group type
  if (body.groupstatus) {
    const newType = parseInt(body.group_type as string, 10);
    if ([0, 1, 2].includes(newType)) {
      await adminDb
        .from("groups")
        .update({ group_type: newType })
        .eq("id", groupId);
    }
    return c.html(
      renderMessagePage({
        ctx: { user: { id: user.id, username: user.username, unreadPms: user.unreadPms, userLevel: user.userLevel } },
        title: "Information",
        messageHtml:
          'Successfully updated group type.<br /><br />' +
          `Click <a href="/groupcp?g=${groupId}">Here</a> to return to group information<br /><br />` +
          'Click <a href="/">Here</a> to return to the Index',
        redirectUrl: `/groupcp?g=${groupId}`,
      })
    );
  }

  // Add member
  if (body.add) {
    const username = (body.username as string)?.trim();
    if (username) {
      const { data: profile } = await adminDb
        .from("profiles")
        .select("id")
        .eq("username", username)
        .single();
      if (profile) {
        await adminDb.from("user_group").upsert({
          group_id: groupId,
          user_id: profile.id,
          user_pending: false,
        });
      }
    }
    return c.redirect(`/groupcp?g=${groupId}`);
  }

  // Remove members
  if (body.remove) {
    const memberIds = extractArrayField(body, "members[]");
    if (memberIds.length > 0) {
      for (const memberId of memberIds) {
        await adminDb
          .from("user_group")
          .delete()
          .eq("group_id", groupId)
          .eq("user_id", memberId);
      }
    }
    return c.redirect(`/groupcp?g=${groupId}`);
  }

  // Approve pending members
  if (body.approve) {
    const pendingIds = extractArrayField(body, "pending_members[]");
    for (const pid of pendingIds) {
      await adminDb
        .from("user_group")
        .update({ user_pending: false })
        .eq("group_id", groupId)
        .eq("user_id", pid);
    }
    return c.redirect(`/groupcp?g=${groupId}`);
  }

  // Deny pending members
  if (body.deny) {
    const pendingIds = extractArrayField(body, "pending_members[]");
    for (const pid of pendingIds) {
      await adminDb
        .from("user_group")
        .delete()
        .eq("group_id", groupId)
        .eq("user_id", pid);
    }
    return c.redirect(`/groupcp?g=${groupId}`);
  }

  return c.redirect(`/groupcp?g=${groupId}`);
});

function extractArrayField(body: Record<string, any>, fieldName: string): string[] {
  const result: string[] = [];
  // Hono parseBody may return array or single value
  const base = fieldName.replace("[]", "");
  for (const key of [fieldName, base]) {
    const val = body[key];
    if (Array.isArray(val)) {
      result.push(...val.map(String));
    } else if (val) {
      result.push(String(val));
    }
  }
  return result;
}

export default groupcp;
