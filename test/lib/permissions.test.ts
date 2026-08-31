import { describe, it, expect } from "vitest";
import {
  AUTH_LEVEL,
  canDo,
  canMod,
  filterViewable,
  type ForumAclMap,
} from "../../src/lib/permissions.js";
import { USER_LEVEL } from "../../src/lib/userLevel.js";

// These are pure-function tests — no DB, no app. They cover the
// matrix of (auth level on the forum) × (user level) × (per-forum
// ACL bit) and the most-permissive resolution that runs inside
// loadUserGroupAcls's OR loop. Database integration is exercised
// separately in test/security/permissions.test.ts.

const guest = null;
const reg = { id: "u-reg", userLevel: USER_LEVEL.USER };
const mod = { id: "u-mod", userLevel: USER_LEVEL.MOD };
const admin = { id: "u-admin", userLevel: USER_LEVEL.ADMIN };

function forum(authCol: string, level: number) {
  return { id: 1, [authCol]: level };
}

const noAcl: ForumAclMap = {};
const aclPost: ForumAclMap = {
  1: {
    view: false, read: false, post: true, reply: false, edit: false,
    delete: false, sticky: false, announce: false, vote: false,
    pollcreate: false, mod: false,
  },
};
const aclMod: ForumAclMap = {
  1: {
    view: false, read: false, post: false, reply: false, edit: false,
    delete: false, sticky: false, announce: false, vote: false,
    pollcreate: false, mod: true,
  },
};

describe("canDo — AUTH_LEVEL.ALL", () => {
  const f = forum("auth_post", AUTH_LEVEL.ALL);
  it("guest can do", () => expect(canDo("post", f, guest, noAcl)).toBe(true));
  it("regular user can do", () => expect(canDo("post", f, reg, noAcl)).toBe(true));
});

describe("canDo — AUTH_LEVEL.REG", () => {
  const f = forum("auth_post", AUTH_LEVEL.REG);
  it("guest blocked", () => expect(canDo("post", f, guest, noAcl)).toBe(false));
  it("regular allowed", () => expect(canDo("post", f, reg, noAcl)).toBe(true));
});

describe("canDo — AUTH_LEVEL.ACL", () => {
  const f = forum("auth_post", AUTH_LEVEL.ACL);
  it("guest blocked", () => expect(canDo("post", f, guest, noAcl)).toBe(false));
  it("regular without ACL bit blocked", () =>
    expect(canDo("post", f, reg, noAcl)).toBe(false));
  it("regular WITH ACL bit allowed", () =>
    expect(canDo("post", f, reg, aclPost)).toBe(true));
  it("global mod bypasses ACL", () =>
    expect(canDo("post", f, mod, noAcl)).toBe(true));
  it("admin bypasses ACL", () =>
    expect(canDo("post", f, admin, noAcl)).toBe(true));
});

describe("canDo — AUTH_LEVEL.MOD", () => {
  const f = forum("auth_sticky", AUTH_LEVEL.MOD);
  it("guest blocked", () => expect(canDo("sticky", f, guest, noAcl)).toBe(false));
  it("regular blocked", () =>
    expect(canDo("sticky", f, reg, noAcl)).toBe(false));
  it("global mod allowed", () =>
    expect(canDo("sticky", f, mod, noAcl)).toBe(true));
  it("admin allowed", () =>
    expect(canDo("sticky", f, admin, noAcl)).toBe(true));
  it("per-forum mod allowed (auth_mod bit on this forum)", () =>
    expect(canDo("sticky", f, reg, aclMod)).toBe(true));
  it("per-forum mod on OTHER forum still blocked", () => {
    const otherAcl: ForumAclMap = { 99: aclMod[1] };
    expect(canDo("sticky", f, reg, otherAcl)).toBe(false);
  });
});

describe("canDo — AUTH_LEVEL.ADMIN", () => {
  const f = forum("auth_post", AUTH_LEVEL.ADMIN);
  it("guest blocked", () => expect(canDo("post", f, guest, noAcl)).toBe(false));
  it("regular blocked even with ACL bit set", () =>
    expect(canDo("post", f, reg, aclPost)).toBe(false));
  it("global mod blocked", () =>
    expect(canDo("post", f, mod, noAcl)).toBe(false));
  it("admin allowed", () =>
    expect(canDo("post", f, admin, noAcl)).toBe(true));
});

describe("canDo — NULL level means unrestricted, absent column is an error", () => {
  // Two cases that used to be conflated, with very different meanings:
  //
  //  - The column is present and NULL. The forum genuinely has no level set
  //    (older data, or an admin never touched it). AUTH_ALL is right.
  //  - The column is absent from the object entirely. The CALLER's select()
  //    didn't fetch it. Defaulting here silently granted access to everyone —
  //    viewtopic selected only auth_view/auth_read, then asked about
  //    reply/edit/delete and got `true` for every visitor. Fail loud instead.

  it("treats a NULL level as ALL (guest allowed)", () =>
    expect(canDo("post", { id: 1, auth_post: null } as any, guest, noAcl)).toBe(true));

  it("throws when the auth column was never selected", () =>
    expect(() => canDo("post", { id: 1 } as any, guest, noAcl)).toThrow(
      /requires forums\.auth_post/
    ));

  it("names the offending action and forum so the caller is findable", () =>
    expect(() => canDo("delete", { id: 42 } as any, admin, noAcl)).toThrow(
      /canDo\("delete"\).*forum 42/s
    ));
});

describe("canMod", () => {
  it("guest is never mod", () => expect(canMod(1, guest, noAcl)).toBe(false));
  it("regular without mod ACL is never mod", () =>
    expect(canMod(1, reg, noAcl)).toBe(false));
  it("global mod is mod everywhere", () =>
    expect(canMod(1, mod, noAcl)).toBe(true));
  it("admin is mod everywhere", () =>
    expect(canMod(1, admin, noAcl)).toBe(true));
  it("per-forum mod is mod on that forum", () =>
    expect(canMod(1, reg, aclMod)).toBe(true));
  it("per-forum mod is NOT mod on a different forum", () =>
    expect(canMod(99, reg, aclMod)).toBe(false));
});

describe("filterViewable", () => {
  const forums = [
    { id: 1, auth_view: AUTH_LEVEL.ALL },
    { id: 2, auth_view: AUTH_LEVEL.REG },
    { id: 3, auth_view: AUTH_LEVEL.ACL },
    { id: 4, auth_view: AUTH_LEVEL.MOD },
  ];

  it("guest sees only ALL forums", () => {
    const visible = filterViewable(forums, guest, noAcl);
    expect(visible.map((f) => f.id)).toEqual([1]);
  });

  it("regular user sees ALL + REG", () => {
    const visible = filterViewable(forums, reg, noAcl);
    expect(visible.map((f) => f.id)).toEqual([1, 2]);
  });

  it("regular with view-ACL bit on forum 3 sees ALL + REG + 3", () => {
    const acl: ForumAclMap = {
      3: {
        view: true, read: false, post: false, reply: false, edit: false,
        delete: false, sticky: false, announce: false, vote: false,
        pollcreate: false, mod: false,
      },
    };
    const visible = filterViewable(forums, reg, acl);
    expect(visible.map((f) => f.id).sort()).toEqual([1, 2, 3]);
  });

  it("global mod sees all", () => {
    const visible = filterViewable(forums, mod, noAcl);
    expect(visible.map((f) => f.id)).toEqual([1, 2, 3, 4]);
  });

  it("admin sees all", () => {
    const visible = filterViewable(forums, admin, noAcl);
    expect(visible.map((f) => f.id)).toEqual([1, 2, 3, 4]);
  });
});
