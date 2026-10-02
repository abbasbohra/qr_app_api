import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

export const handler: Handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  const token = event.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: "Missing auth token" }),
    };
  }

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData.user) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: "Invalid token" }),
    };
  }
  const userId = userData.user.id;

  const body = JSON.parse(event.body || "{}");
  const { action } = body;

  // ═════════════════════════════════════════════════════
  // LIST — all notes, newest first
  // ═════════════════════════════════════════════════════
  if (action === "list") {
    const { data, error } = await supabase
      .from("user_notes")
      .select("*")
      .eq("user_id", userId)
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false });

    if (error) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: error.message }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ notes: data || [] }),
    };
  }

  // ═════════════════════════════════════════════════════
  // CREATE
  // ═════════════════════════════════════════════════════
  if (action === "create") {
    const { title = "", body: noteBody = "", tags = [] } = body;

    if (!title.trim() && !noteBody.trim()) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Note must have a title or body" }),
      };
    }

    const { data, error } = await supabase
      .from("user_notes")
      .insert({
        user_id: userId,
        title: title.trim(),
        body: noteBody.trim(),
        tags: Array.isArray(tags) ? tags.filter(Boolean) : [],
      })
      .select()
      .single();

    if (error) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: error.message }),
      };
    }
    await supabase.from("user_activity_log").insert({
      user_id: userId,
      event_type: "note",
      title: `Note: ${data.title || "Untitled"}`,
      meta: { note_id: data.id },
    });
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ note: data }),
    };
  }

  // ═════════════════════════════════════════════════════
  // UPDATE
  // ═════════════════════════════════════════════════════
  if (action === "update") {
    const { id, title, body: noteBody, tags, pinned } = body;

    if (!id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "id required" }),
      };
    }

    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };
    if (title !== undefined) updates.title = title.trim();
    if (noteBody !== undefined) updates.body = noteBody.trim();
    if (tags !== undefined)
      updates.tags = Array.isArray(tags) ? tags.filter(Boolean) : [];
    if (pinned !== undefined) updates.pinned = !!pinned;

    const { data, error } = await supabase
      .from("user_notes")
      .update(updates)
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: error.message }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ note: data }),
    };
  }

  // ═════════════════════════════════════════════════════
  // DELETE
  // ═════════════════════════════════════════════════════
  if (action === "delete") {
    const { id } = body;
    if (!id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "id required" }),
      };
    }

    const { error } = await supabase
      .from("user_notes")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    if (error) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: error.message }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true }),
    };
  }

  return {
    statusCode: 400,
    headers,
    body: JSON.stringify({ error: "Invalid action" }),
  };
};
