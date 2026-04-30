/**
 * Numeric user_level values, matching phpBB2's constants.php.
 * Stored in profiles.user_level. Higher number ≠ higher authority —
 * admin authority sits at 1, moderator at 2, regular user at 0.
 */
export const USER_LEVEL = {
  USER: 0,
  ADMIN: 1,
  MOD: 2,
} as const;

export type UserLevel = typeof USER_LEVEL[keyof typeof USER_LEVEL];

interface UserLike {
  userLevel?: number | null;
}

export function isAdmin(user: UserLike | null | undefined): boolean {
  return !!user && user.userLevel === USER_LEVEL.ADMIN;
}

export function isMod(user: UserLike | null | undefined): boolean {
  return !!user && user.userLevel === USER_LEVEL.MOD;
}

/** True for both admins and moderators — used to gate moderation actions. */
export function isModOrAdmin(user: UserLike | null | undefined): boolean {
  return isAdmin(user) || isMod(user);
}
