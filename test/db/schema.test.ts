import { describe, it, expect, beforeAll } from "vitest";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Load env for test
config({ path: ".env" });

let db: SupabaseClient;

beforeAll(() => {
  db = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
});

describe("Database Schema", () => {
  it("has seeded categories", async () => {
    const { data, error } = await db
      .from("categories")
      .select("*")
      .order("cat_order");
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data![0].cat_title).toBe("General");
    expect(data![1].cat_title).toBe("Off-Topic");
  });

  it("has seeded forums", async () => {
    const { data, error } = await db
      .from("forums")
      .select("*")
      .order("forum_order");
    expect(error).toBeNull();
    expect(data).toHaveLength(3);
    expect(data![0].forum_name).toBe("Announcements");
    expect(data![1].forum_name).toBe("General Discussion");
    expect(data![2].forum_name).toBe("Off-Topic");
  });

  it("has seeded config", async () => {
    const { data, error } = await db
      .from("config")
      .select("*")
      .eq("config_name", "sitename")
      .single();
    expect(error).toBeNull();
    expect(data!.config_value).toBe("Plank Forum");
  });

  it("has seeded smilies", async () => {
    const { data, error } = await db.from("smilies").select("*");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(20);
  });

  it("has seeded ranks", async () => {
    const { data, error } = await db
      .from("ranks")
      .select("*")
      .order("rank_min");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(3);
    expect(data!.find((r: any) => r.rank_title === "Site Admin")?.rank_special).toBe(
      true
    );
  });

  it("can create a user profile via auth + profile", async () => {
    // Create a test user through Supabase Auth
    const { data: authData, error: authError } = await db.auth.admin.createUser(
      {
        email: "testuser@plank.local",
        password: "testpassword123",
        email_confirm: true,
      }
    );
    expect(authError).toBeNull();
    const userId = authData.user!.id;

    // Create matching profile
    const { error: profileError } = await db.from("profiles").insert({
      id: userId,
      username: "TestUser",
    });
    expect(profileError).toBeNull();

    // Verify profile exists
    const { data: profile, error: fetchError } = await db
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    expect(fetchError).toBeNull();
    expect(profile!.username).toBe("TestUser");
    expect(profile!.user_posts).toBe(0);
    expect(profile!.user_level).toBe(0);

    // Cleanup
    await db.auth.admin.deleteUser(userId);
  });

  it("cascades profile deletion when auth user is deleted", async () => {
    const { data: authData } = await db.auth.admin.createUser({
      email: "cascade-test@plank.local",
      password: "testpassword123",
      email_confirm: true,
    });
    const userId = authData.user!.id;

    await db.from("profiles").insert({
      id: userId,
      username: "CascadeTest",
    });

    // Delete auth user — profile should cascade
    await db.auth.admin.deleteUser(userId);

    const { data: profile } = await db
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    expect(profile).toBeNull();
  });

  it("can insert and query topics and posts", async () => {
    // Create a test user
    const { data: authData } = await db.auth.admin.createUser({
      email: "poster@plank.local",
      password: "testpassword123",
      email_confirm: true,
    });
    const userId = authData.user!.id;
    await db.from("profiles").insert({ id: userId, username: "Poster" });

    // Get the first forum
    const { data: forums } = await db
      .from("forums")
      .select("id")
      .limit(1)
      .single();

    // Create a topic
    const { data: topic, error: topicError } = await db
      .from("topics")
      .insert({
        forum_id: forums!.id,
        topic_title: "Test Topic",
        topic_poster: userId,
      })
      .select()
      .single();
    expect(topicError).toBeNull();

    // Create a post
    const { data: post, error: postError } = await db
      .from("posts")
      .insert({
        topic_id: topic!.id,
        forum_id: forums!.id,
        poster_id: userId,
      })
      .select()
      .single();
    expect(postError).toBeNull();

    // Create post text
    const { error: textError } = await db.from("posts_text").insert({
      post_id: post!.id,
      post_subject: "Test Topic",
      post_text: "Hello, World! [b]Bold text[/b]",
      post_text_html: "Hello, World! <b>Bold text</b>",
    });
    expect(textError).toBeNull();

    // Verify full-text search works
    const { data: searchResults, error: searchError } = await db
      .from("posts_text")
      .select("*")
      .textSearch("search_vector", "Bold");
    expect(searchError).toBeNull();
    expect(searchResults!.length).toBeGreaterThan(0);

    // Cleanup
    await db.from("topics").delete().eq("id", topic!.id);
    await db.auth.admin.deleteUser(userId);
  });

  it("forums reference categories correctly", async () => {
    const { data, error } = await db
      .from("forums")
      .select("*, categories(cat_title)")
      .order("forum_order");
    expect(error).toBeNull();
    expect(data![0].categories).toEqual({ cat_title: "General" });
  });
});
