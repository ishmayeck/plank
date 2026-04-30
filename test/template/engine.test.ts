import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { Template } from "../../src/template/engine.js";

const SOLARIS_DIR = join(import.meta.dirname, "..", "..", "vendor", "Solaris");

describe("phpBB2 Template Engine", () => {
  // ─── Variable Substitution ───────────────────────────────────────

  describe("variable substitution", () => {
    it("replaces simple variables", () => {
      const tpl = new Template();
      tpl.loadString("body", "Hello, {USERNAME}!");
      tpl.assignVars({ USERNAME: "Lem" });
      expect(tpl.render("body")).toBe("Hello, Lem!");
    });

    it("replaces multiple variables on the same line", () => {
      const tpl = new Template();
      tpl.loadString("body", "{SITENAME} :: {PAGE_TITLE}");
      tpl.assignVars({ SITENAME: "Plank", PAGE_TITLE: "Index" });
      expect(tpl.render("body")).toBe("Plank :: Index");
    });

    it("leaves undefined variables as empty strings", () => {
      const tpl = new Template();
      tpl.loadString("body", "Hello, {USERNAME}! You have {PM_COUNT} messages.");
      tpl.assignVars({ USERNAME: "Lem" });
      expect(tpl.render("body")).toBe("Hello, Lem! You have  messages.");
    });

    it("handles variables with hyphens and underscores", () => {
      const tpl = new Template();
      tpl.loadString("body", "{MY_VAR} and {MY-VAR}");
      tpl.assignVars({ MY_VAR: "one", "MY-VAR": "two" });
      expect(tpl.render("body")).toBe("one and two");
    });

    it("does not replace variables inside HTML comments", () => {
      const tpl = new Template();
      tpl.loadString("body", "<!-- {NOT_A_VAR} -->{REAL_VAR}");
      tpl.assignVars({ NOT_A_VAR: "nope", REAL_VAR: "yes" });
      // The engine should not touch content inside <!-- --> comments
      // UNLESS they are BEGIN/END blocks
      expect(tpl.render("body")).toContain("yes");
    });

    it("handles empty string values", () => {
      const tpl = new Template();
      tpl.loadString("body", "[{VALUE}]");
      tpl.assignVars({ VALUE: "" });
      expect(tpl.render("body")).toBe("[]");
    });

    it("handles numeric values", () => {
      const tpl = new Template();
      tpl.loadString("body", "{COUNT} posts");
      tpl.assignVars({ COUNT: "42" });
      expect(tpl.render("body")).toBe("42 posts");
    });
  });

  // ─── Block Iteration ─────────────────────────────────────────────

  describe("block iteration", () => {
    it("iterates over a simple block", () => {
      const tpl = new Template();
      tpl.loadString(
        "body",
        "<!-- BEGIN item -->{item.NAME}\n<!-- END item -->"
      );
      tpl.assignBlockVars("item", { NAME: "Alpha" });
      tpl.assignBlockVars("item", { NAME: "Beta" });
      tpl.assignBlockVars("item", { NAME: "Gamma" });
      const result = tpl.render("body");
      expect(result).toContain("Alpha");
      expect(result).toContain("Beta");
      expect(result).toContain("Gamma");
    });

    it("renders nothing for an empty block", () => {
      const tpl = new Template();
      tpl.loadString(
        "body",
        "before<!-- BEGIN item -->{item.NAME}<!-- END item -->after"
      );
      // No block vars assigned
      expect(tpl.render("body")).toBe("beforeafter");
    });

    it("renders surrounding content with blocks", () => {
      const tpl = new Template();
      tpl.loadString(
        "body",
        "Header\n<!-- BEGIN row -->{row.VAL}\n<!-- END row -->Footer"
      );
      tpl.assignBlockVars("row", { VAL: "A" });
      const result = tpl.render("body");
      expect(result).toContain("Header");
      expect(result).toContain("A");
      expect(result).toContain("Footer");
    });

    it("supports multiple separate blocks", () => {
      const tpl = new Template();
      tpl.loadString(
        "body",
        "<!-- BEGIN alpha -->{alpha.X}<!-- END alpha -->|<!-- BEGIN beta -->{beta.Y}<!-- END beta -->"
      );
      tpl.assignBlockVars("alpha", { X: "1" });
      tpl.assignBlockVars("beta", { Y: "2" });
      const result = tpl.render("body");
      expect(result).toContain("1");
      expect(result).toContain("2");
    });

    it("handles block with multiple variables", () => {
      const tpl = new Template();
      tpl.loadString(
        "body",
        "<!-- BEGIN post -->{post.AUTHOR}: {post.MESSAGE}\n<!-- END post -->"
      );
      tpl.assignBlockVars("post", { AUTHOR: "Lem", MESSAGE: "Hello" });
      tpl.assignBlockVars("post", { AUTHOR: "Kelvin", MESSAGE: "Hi" });
      const result = tpl.render("body");
      expect(result).toContain("Lem: Hello");
      expect(result).toContain("Kelvin: Hi");
    });
  });

  // ─── Nested Blocks ────────────────────────────────────────────────

  describe("nested blocks", () => {
    it("renders nested blocks with dot-scoped variables", () => {
      const tpl = new Template();
      tpl.loadString(
        "body",
        [
          "<!-- BEGIN catrow -->",
          "Category: {catrow.CAT_TITLE}",
          "<!-- BEGIN forumrow -->",
          "  Forum: {catrow.forumrow.FORUM_NAME}",
          "<!-- END forumrow -->",
          "<!-- END catrow -->",
        ].join("\n")
      );

      tpl.assignBlockVars("catrow", { CAT_TITLE: "General" });
      tpl.assignBlockVars("catrow.forumrow", { FORUM_NAME: "Chat" });
      tpl.assignBlockVars("catrow.forumrow", { FORUM_NAME: "Help" });

      const result = tpl.render("body");
      expect(result).toContain("Category: General");
      expect(result).toContain("Forum: Chat");
      expect(result).toContain("Forum: Help");
    });

    it("renders multiple parent iterations with nested children", () => {
      const tpl = new Template();
      tpl.loadString(
        "body",
        [
          "<!-- BEGIN cat -->",
          "[{cat.NAME}]",
          "<!-- BEGIN forum -->",
          "({cat.forum.TITLE})",
          "<!-- END forum -->",
          "<!-- END cat -->",
        ].join("\n")
      );

      tpl.assignBlockVars("cat", { NAME: "A" });
      tpl.assignBlockVars("cat.forum", { TITLE: "A1" });
      tpl.assignBlockVars("cat.forum", { TITLE: "A2" });

      tpl.assignBlockVars("cat", { NAME: "B" });
      tpl.assignBlockVars("cat.forum", { TITLE: "B1" });

      const result = tpl.render("body");
      expect(result).toContain("[A]");
      expect(result).toContain("(A1)");
      expect(result).toContain("(A2)");
      expect(result).toContain("[B]");
      expect(result).toContain("(B1)");
      // B1 should not appear under A
    });

    it("handles three levels of nesting", () => {
      const tpl = new Template();
      tpl.loadString(
        "body",
        [
          "<!-- BEGIN a -->",
          "<!-- BEGIN b -->",
          "<!-- BEGIN c -->",
          "{a.b.c.VAL}",
          "<!-- END c -->",
          "<!-- END b -->",
          "<!-- END a -->",
        ].join("\n")
      );

      tpl.assignBlockVars("a", {});
      tpl.assignBlockVars("a.b", {});
      tpl.assignBlockVars("a.b.c", { VAL: "deep" });

      expect(tpl.render("body")).toContain("deep");
    });

    it("renders empty nested block when parent has no children", () => {
      const tpl = new Template();
      tpl.loadString(
        "body",
        [
          "<!-- BEGIN parent -->",
          "P:{parent.NAME}",
          "<!-- BEGIN child -->",
          "C:{parent.child.NAME}",
          "<!-- END child -->",
          "<!-- END parent -->",
        ].join("\n")
      );

      tpl.assignBlockVars("parent", { NAME: "solo" });
      // No child block vars assigned

      const result = tpl.render("body");
      expect(result).toContain("P:solo");
      expect(result).not.toContain("C:");
    });
  });

  // ─── Conditional Switches ─────────────────────────────────────────

  describe("conditional switches (BEGIN switch_*)", () => {
    it("renders switch block when condition is truthy", () => {
      const tpl = new Template();
      tpl.loadString(
        "body",
        "<!-- BEGIN switch_user_logged_in -->Welcome back!<!-- END switch_user_logged_in -->"
      );
      tpl.assignBlockVars("switch_user_logged_in", {});
      expect(tpl.render("body")).toContain("Welcome back!");
    });

    it("hides switch block when condition is not set", () => {
      const tpl = new Template();
      tpl.loadString(
        "body",
        "before<!-- BEGIN switch_user_logged_in -->Welcome back!<!-- END switch_user_logged_in -->after"
      );
      // Not assigned
      expect(tpl.render("body")).toBe("beforeafter");
    });

    it("supports both logged-in and logged-out switches", () => {
      const tpl = new Template();
      tpl.loadString(
        "body",
        [
          "<!-- BEGIN switch_user_logged_in -->logged in<!-- END switch_user_logged_in -->",
          "<!-- BEGIN switch_user_logged_out -->logged out<!-- END switch_user_logged_out -->",
        ].join("\n")
      );

      // Only assign the logged_in switch
      tpl.assignBlockVars("switch_user_logged_in", {});

      const result = tpl.render("body");
      expect(result).toContain("logged in");
      expect(result).not.toContain("logged out");
    });

    it("allows variables inside switch blocks", () => {
      const tpl = new Template();
      tpl.loadString(
        "body",
        "<!-- BEGIN switch_user_logged_in -->Hello, {USERNAME}!<!-- END switch_user_logged_in -->"
      );
      tpl.assignBlockVars("switch_user_logged_in", {});
      tpl.assignVars({ USERNAME: "Lem" });
      expect(tpl.render("body")).toContain("Hello, Lem!");
    });
  });

  // ─── File Loading ─────────────────────────────────────────────────

  describe("file loading", () => {
    it("loads a .tpl file from the theme root", () => {
      const tpl = new Template(SOLARIS_DIR);
      tpl.loadFile("footer", "overall_footer.tpl");
      // Should not throw, and render should produce some HTML
      const result = tpl.render("footer");
      expect(result).toContain("</html>");
    });

    it("throws on missing file", () => {
      const tpl = new Template(SOLARIS_DIR);
      expect(() => tpl.loadFile("missing", "nonexistent.tpl")).toThrow();
    });
  });

  // ─── Edge Cases ───────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles template with no variables or blocks", () => {
      const tpl = new Template();
      tpl.loadString("body", "<p>Static content</p>");
      expect(tpl.render("body")).toBe("<p>Static content</p>");
    });

    it("handles curly braces that are not variables", () => {
      const tpl = new Template();
      tpl.loadString("body", "function() { return true; }");
      // Bare braces without a valid var pattern should pass through
      expect(tpl.render("body")).toBe("function() { return true; }");
    });

    it("handles BEGIN and END on separate lines with whitespace", () => {
      const tpl = new Template();
      tpl.loadString(
        "body",
        "  <!-- BEGIN items -->  \n  {items.X}  \n  <!-- END items -->  "
      );
      tpl.assignBlockVars("items", { X: "val" });
      expect(tpl.render("body")).toContain("val");
    });

    it("preserves HTML structure around blocks", () => {
      const tpl = new Template();
      tpl.loadString(
        "body",
        [
          "<table>",
          "<!-- BEGIN row -->",
          "<tr><td>{row.CELL}</td></tr>",
          "<!-- END row -->",
          "</table>",
        ].join("\n")
      );
      tpl.assignBlockVars("row", { CELL: "A" });
      tpl.assignBlockVars("row", { CELL: "B" });
      const result = tpl.render("body");
      expect(result).toContain("<table>");
      expect(result).toContain("<tr><td>A</td></tr>");
      expect(result).toContain("<tr><td>B</td></tr>");
      expect(result).toContain("</table>");
    });

    it("escapes HTML in plain-string variable values by default", () => {
      const tpl = new Template();
      tpl.loadString("body", "{MSG}");
      tpl.assignVars({ MSG: '<script>alert("xss")</script>' });
      expect(tpl.render("body")).toBe(
        "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"
      );
    });

    it("handles root-level vars mixed with block vars in same template", () => {
      const tpl = new Template();
      tpl.loadString(
        "body",
        [
          "{TITLE}",
          "<!-- BEGIN item -->",
          "{item.NAME} in {TITLE}",
          "<!-- END item -->",
        ].join("\n")
      );
      tpl.assignVars({ TITLE: "My Forum" });
      tpl.assignBlockVars("item", { NAME: "Widget" });
      const result = tpl.render("body");
      expect(result).toContain("My Forum");
      expect(result).toContain("Widget in My Forum");
    });
  });

  // ─── Solaris Integration ──────────────────────────────────────────

  describe("Solaris theme integration", () => {
    it("renders overall_header.tpl with basic variables", () => {
      const tpl = new Template(SOLARIS_DIR);
      tpl.loadFile("header", "overall_header.tpl");
      tpl.assignVars({
        S_CONTENT_DIRECTION: "ltr",
        S_CONTENT_ENCODING: "utf-8",
        SITENAME: "Plank Forum",
        PAGE_TITLE: "Index",
        T_HEAD_STYLESHEET: "Solaris.css",
        META: "",
        NAV_LINKS: "",
        U_INDEX: "/",
        U_FAQ: "/faq",
        U_SEARCH: "/search",
        U_MEMBERLIST: "/memberlist",
        U_PROFILE: "/profile",
        U_PRIVATEMSGS: "/privmsg",
        U_LOGIN_LOGOUT: "/login",
        U_REGISTER: "/register",
        U_GROUP_CP: "/groupcp",
        PRIVATE_MESSAGE_INFO: "0 new messages",
        PRIVATE_MESSAGE_NEW_FLAG: "0",
        PRIVMSG_IMG: "templates/Solaris/images/lang_english/topimg_pms-d.jpg",
        L_FAQ: "FAQ",
        L_SEARCH: "Search",
        L_MEMBERLIST: "Memberlist",
        L_PROFILE: "Profile",
        L_USERGROUPS: "Usergroups",
        L_LOGIN_LOGOUT: "Login",
        L_REGISTER: "Register",
        U_PRIVATEMSGS_POPUP: "/privmsg?mode=popup",
      });
      // Render the logged-out header
      tpl.assignBlockVars("switch_user_logged_out", {});

      const result = tpl.render("header");
      expect(result).toContain("Plank Forum :: Index");
      expect(result).toContain('dir="ltr"');
      expect(result).toContain("Solaris.css");
    });

    it("renders index_body.tpl with categories and forums", () => {
      const tpl = new Template(SOLARIS_DIR);
      tpl.loadFile("body", "index_body.tpl");
      tpl.assignVars({
        U_INDEX: "/",
        L_INDEX: "Index",
        L_FORUM: "Forum",
        L_TOPICS: "Topics",
        L_POSTS: "Posts",
        L_LASTPOST: "Last Post",
        L_WHO_IS_ONLINE: "Who Is Online",
        TOTAL_POSTS: "42 posts",
        TOTAL_USERS: "5 users",
        NEWEST_USER: "Harey",
        TOTAL_USERS_ONLINE: "1 user online",
        L_WHOSONLINE_ADMIN: "Admin",
        L_WHOSONLINE_MOD: "Mod",
        RECORD_USERS: "5",
        LOGGED_IN_USER_LIST: "Lem",
        L_ONLINE_EXPLAIN: "Legend",
        CURRENT_TIME: "Sat Mar 14, 2026 12:00 am",
        U_VIEWONLINE: "/viewonline",
        L_NEW_POSTS: "New posts",
        L_NO_NEW_POSTS: "No new posts",
        L_FORUM_LOCKED: "Forum locked",
        S_TIMEZONE: "UTC",
        U_MARK_READ: "/markread",
        L_MARK_FORUMS_READ: "Mark all forums read",
        S_LOGIN_ACTION: "/login",
        L_LOGIN_LOGOUT: "Login",
        L_USERNAME: "Username",
        L_PASSWORD: "Password",
        L_AUTO_LOGIN: "Log me on automatically",
        L_LOGIN: "Login",
      });

      // Add a category with a forum
      tpl.assignBlockVars("catrow", {
        U_VIEWCAT: "/category/1",
        CAT_DESC: "General Discussion",
      });
      tpl.assignBlockVars("catrow.forumrow", {
        FORUM_FOLDER_IMG: "images/folder.gif",
        U_VIEWFORUM: "/viewforum/1",
        FORUM_NAME: "Chat",
        FORUM_DESC: "General chat",
        L_MODERATOR: "Moderator:",
        MODERATORS: "Admin",
        TOPICS: "10",
        POSTS: "42",
        LAST_POST: "Today",
      });

      tpl.assignBlockVars("switch_user_logged_out", {});
      tpl.assignBlockVars("switch_allow_autologin", {});

      const result = tpl.render("body");
      expect(result).toContain("General Discussion");
      expect(result).toContain("Chat");
      expect(result).toContain("42 posts");
    });
  });
});
