import { describe, it, expect } from "vitest";
import {
  USER_LEVEL,
  isAdmin,
  isMod,
  isModOrAdmin,
} from "../../src/lib/userLevel.js";

describe("USER_LEVEL", () => {
  it("matches phpBB2's constants.php values", () => {
    expect(USER_LEVEL.USER).toBe(0);
    expect(USER_LEVEL.ADMIN).toBe(1);
    expect(USER_LEVEL.MOD).toBe(2);
  });
});

describe("isAdmin", () => {
  it("true only for ADMIN level", () => {
    expect(isAdmin({ userLevel: USER_LEVEL.ADMIN })).toBe(true);
    expect(isAdmin({ userLevel: USER_LEVEL.MOD })).toBe(false);
    expect(isAdmin({ userLevel: USER_LEVEL.USER })).toBe(false);
  });

  it("false for null/undefined user", () => {
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });

  it("false when userLevel is missing", () => {
    expect(isAdmin({})).toBe(false);
  });
});

describe("isMod", () => {
  it("true only for MOD level", () => {
    expect(isMod({ userLevel: USER_LEVEL.MOD })).toBe(true);
    expect(isMod({ userLevel: USER_LEVEL.ADMIN })).toBe(false);
    expect(isMod({ userLevel: USER_LEVEL.USER })).toBe(false);
  });

  it("false for null/undefined user", () => {
    expect(isMod(null)).toBe(false);
    expect(isMod(undefined)).toBe(false);
  });
});

describe("isModOrAdmin", () => {
  it("true for either admin or mod", () => {
    expect(isModOrAdmin({ userLevel: USER_LEVEL.ADMIN })).toBe(true);
    expect(isModOrAdmin({ userLevel: USER_LEVEL.MOD })).toBe(true);
  });

  it("false for regular users and missing users", () => {
    expect(isModOrAdmin({ userLevel: USER_LEVEL.USER })).toBe(false);
    expect(isModOrAdmin(null)).toBe(false);
  });
});
