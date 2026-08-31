import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { config } from "dotenv";
import { zipSync, strToU8 } from "fflate";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../src/app.js";
import { cleanupTestUser } from "../util/users.js";
import {
  listThemes,
  deactivateAllThemes,
  deleteTheme,
  getActiveThemeRecord,
} from "../../src/lib/theme_store.js";
import {
  clearThemeRuntimeCache,
  currentUploadedTheme,
} from "../../src/lib/theme_runtime.js";

/**
 * The admin-facing half of Chunk 23: upload, activate, revert, delete —
 * driven through the actual HTTP surface an admin uses, including the
 * permission gates on each one.
 */

config({ path: ".env" });

let adminDb: SupabaseClient;
let adminId: string, adminAccess: string, adminRefresh: string;
let userId: string, userAccess: string, userRefresh: string;

const uploadedHashes = new Set<string>();

function themeZip(name: string, marker: string): Uint8Array {
  return zipSync({
    [`${name}/overall_header.tpl`]: strToU8(
      `<html><head><title>{PAGE_TITLE}</title></head><body><!--${marker}-->`
    ),
    [`${name}/overall_footer.tpl`]: strToU8("</body></html>"),
    [`${name}/index_body.tpl`]: strToU8("<!-- BEGIN catrow -->{catrow.CAT_TITLE}<!-- END catrow -->"),
    [`${name}/${name}.css`]: strToU8("body{}"),
  });
}

async function createAndLogin(username: string, email: string, level: number) {
  await cleanupTestUser(adminDb, username, email);
  const { data } = await adminDb.auth.admin.createUser({
    email,
    password: "themes-pass-1234",
    email_confirm: true,
  });
  const id = data.user!.id;
  await adminDb.from("profiles").insert({ id, username, user_level: level });

  const form = new FormData();
  form.append("username", username);
  form.append("password", "themes-pass-1234");
  const res = await app.request("/login", { method: "POST", body: form });
  const cookies = res.headers.getSetCookie();
  return {
    id,
    access: cookies
      .find((x) => x.startsWith("sb-access-token="))!
      .substring("sb-access-token=".length)
      .split(";")[0],
    refresh: cookies
      .find((x) => x.startsWith("sb-refresh-token="))!
      .substring("sb-refresh-token=".length)
      .split(";")[0],
  };
}

function cookies(access: string, refresh: string): HeadersInit {
  return { Cookie: `sb-access-token=${access}; sb-refresh-token=${refresh}` };
}

async function uploadTheme(zip: Uint8Array, filename: string, as: HeadersInit) {
  const form = new FormData();
  form.append("theme", new File([zip], filename, { type: "application/zip" }));
  return app.request("/admin/themes", { method: "POST", body: form, headers: as });
}

beforeAll(async () => {
  adminDb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const a = await createAndLogin("ThemesAdmin", "themes-admin@plank.local", 1);
  adminId = a.id; adminAccess = a.access; adminRefresh = a.refresh;
  const u = await createAndLogin("ThemesUser", "themes-user@plank.local", 0);
  userId = u.id; userAccess = u.access; userRefresh = u.refresh;
});

afterEach(async () => {
  // Theme selection is process-wide state; don't leak it between tests.
  await deactivateAllThemes(adminDb);
  clearThemeRuntimeCache();
});

afterAll(async () => {
  await deactivateAllThemes(adminDb);
  for (const hash of uploadedHashes) {
    await deleteTheme(adminDb, hash).catch(() => {});
  }
  clearThemeRuntimeCache();
  for (const id of [adminId, userId]) {
    await adminDb.auth.admin.deleteUser(id).catch(() => {});
  }
});

describe("admin themes — access control", () => {
  it("refuses the page to a guest", async () => {
    expect((await app.request("/admin/themes")).status).toBe(403);
  });

  it("refuses the page to a normal user", async () => {
    const res = await app.request("/admin/themes", {
      headers: cookies(userAccess, userRefresh),
    });
    expect(res.status).toBe(403);
  });

  it("refuses upload to a normal user", async () => {
    const res = await uploadTheme(
      themeZip("Sneaky", "sneaky"),
      "Sneaky.zip",
      cookies(userAccess, userRefresh)
    );
    expect(res.status).toBe(403);
    expect((await listThemes(adminDb)).some((t) => t.theme_name === "Sneaky")).toBe(false);
  });

  it("refuses theme actions to a normal user", async () => {
    const res = await app.request("/admin/themes/action?mode=deactivate", {
      headers: cookies(userAccess, userRefresh),
    });
    expect(res.status).toBe(403);
  });

  it("allows an admin in", async () => {
    const res = await app.request("/admin/themes", {
      headers: cookies(adminAccess, adminRefresh),
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Themes");
    // The trust warning must be on the page an admin uploads from.
    expect(html).toMatch(/only install themes you trust/i);
  });
});

describe("admin themes — upload", () => {
  it("installs a valid theme and reports what it found", async () => {
    const res = await uploadTheme(
      themeZip("Alpha", "alpha-marker"),
      "Alpha.zip",
      cookies(adminAccess, adminRefresh)
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Installed &quot;Alpha&quot;");
    expect(html).toContain("Alpha");

    const installed = (await listThemes(adminDb)).find((t) => t.theme_name === "Alpha");
    expect(installed).toBeDefined();
    uploadedHashes.add(installed!.theme_hash);
    // Uploading must not change what visitors see.
    expect(installed!.is_active).toBe(false);
  });

  it("rejects a file that is not a zip", async () => {
    const res = await uploadTheme(
      new Uint8Array([1, 2, 3, 4, 5]),
      "notazip.zip",
      cookies(adminAccess, adminRefresh)
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/valid zip|could not be processed/i);
  });

  it("rejects an archive with no templates", async () => {
    const res = await uploadTheme(
      zipSync({ "Empty/readme.css": strToU8("body{}") }),
      "Empty.zip",
      cookies(adminAccess, adminRefresh)
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/no \.tpl/i);
  });

  it("rejects a zip-slip archive", async () => {
    const res = await uploadTheme(
      zipSync({
        "Evil/ok.tpl": strToU8("x"),
        "../../../etc/passwd": strToU8("pwned"),
      }),
      "Evil.zip",
      cookies(adminAccess, adminRefresh)
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/unsafe|zip-slip/i);
    expect((await listThemes(adminDb)).some((t) => t.theme_name === "Evil")).toBe(false);
  });

  it("reports a missing file instead of failing obscurely", async () => {
    const form = new FormData();
    const res = await app.request("/admin/themes", {
      method: "POST",
      body: form,
      headers: cookies(adminAccess, adminRefresh),
    });
    expect(await res.text()).toMatch(/choose a \.zip/i);
  });
});

describe("admin themes — switching", () => {
  it("activates a theme and the board renders with it", async () => {
    await uploadTheme(
      themeZip("Switchable", "switchable-marker"),
      "Switchable.zip",
      cookies(adminAccess, adminRefresh)
    );
    const record = (await listThemes(adminDb)).find((t) => t.theme_name === "Switchable")!;
    uploadedHashes.add(record.theme_hash);

    const res = await app.request(
      `/admin/themes/action?mode=activate&hash=${record.theme_hash}`,
      { headers: cookies(adminAccess, adminRefresh) }
    );
    expect(res.status).toBe(302);
    expect((await getActiveThemeRecord(adminDb))!.theme_hash).toBe(record.theme_hash);

    // The board now renders through the uploaded theme's templates.
    const index = await app.request("/");
    expect(index.status).toBe(200);
    expect(await index.text()).toContain("switchable-marker");
    expect(currentUploadedTheme()?.name).toBe("Switchable");
  });

  it("reverts to the bundled theme", async () => {
    await uploadTheme(
      themeZip("Revertible", "revertible-marker"),
      "Revertible.zip",
      cookies(adminAccess, adminRefresh)
    );
    const record = (await listThemes(adminDb)).find((t) => t.theme_name === "Revertible")!;
    uploadedHashes.add(record.theme_hash);

    await app.request(`/admin/themes/action?mode=activate&hash=${record.theme_hash}`, {
      headers: cookies(adminAccess, adminRefresh),
    });
    await app.request("/admin/themes/action?mode=deactivate", {
      headers: cookies(adminAccess, adminRefresh),
    });

    expect(await getActiveThemeRecord(adminDb)).toBeNull();
    const index = await app.request("/");
    expect(index.status).toBe(200);
    expect(await index.text()).not.toContain("revertible-marker");
  });

  it("refuses to delete the theme currently in use", async () => {
    await uploadTheme(
      themeZip("InUse", "inuse-marker"),
      "InUse.zip",
      cookies(adminAccess, adminRefresh)
    );
    const record = (await listThemes(adminDb)).find((t) => t.theme_name === "InUse")!;
    uploadedHashes.add(record.theme_hash);

    await app.request(`/admin/themes/action?mode=activate&hash=${record.theme_hash}`, {
      headers: cookies(adminAccess, adminRefresh),
    });
    const res = await app.request(
      `/admin/themes/action?mode=delete&hash=${record.theme_hash}`,
      { headers: cookies(adminAccess, adminRefresh) }
    );

    expect(await res.text()).toMatch(/active theme/i);
    expect(
      (await listThemes(adminDb)).some((t) => t.theme_hash === record.theme_hash)
    ).toBe(true);
  });

  it("deletes an inactive theme", async () => {
    await uploadTheme(
      themeZip("Disposable", "disposable-marker"),
      "Disposable.zip",
      cookies(adminAccess, adminRefresh)
    );
    const record = (await listThemes(adminDb)).find((t) => t.theme_name === "Disposable")!;

    const res = await app.request(
      `/admin/themes/action?mode=delete&hash=${record.theme_hash}`,
      { headers: cookies(adminAccess, adminRefresh) }
    );
    expect(res.status).toBe(302);
    expect(
      (await listThemes(adminDb)).some((t) => t.theme_hash === record.theme_hash)
    ).toBe(false);
  });
});
