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

  // LIST
  if (action === "list") {
    const { data, error } = await supabase
      .from("user_reminders")
      .select("*")
      .eq("user_id", userId)
      .order("remind_at", { ascending: true });

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
      body: JSON.stringify({ reminders: data || [] }),
    };
  }

  // CREATE
  if (action === "create") {
    const {
      title = "",
      body: reminderBody = "",
      remindAt,
      repeatRule = "none",
      notificationId = null,
    } = body;

    if (!title.trim() || !remindAt) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Title and remindAt required" }),
      };
    }

    const { data, error } = await supabase
      .from("user_reminders")
      .insert({
        user_id: userId,
        title: title.trim(),
        body: reminderBody.trim(),
        remind_at: remindAt,
        repeat_rule: repeatRule,
        notification_id: notificationId,
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

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reminder: data }),
    };
  }

  // UPDATE
  if (action === "update") {
    const { id, ...patch } = body;
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
    if (patch.title !== undefined) updates.title = patch.title;
    if (patch.body !== undefined) updates.body = patch.body;
    if (patch.remindAt !== undefined) updates.remind_at = patch.remindAt;
    if (patch.repeatRule !== undefined) updates.repeat_rule = patch.repeatRule;
    if (patch.enabled !== undefined) updates.enabled = patch.enabled;
    if (patch.notificationId !== undefined)
      updates.notification_id = patch.notificationId;

    const { data, error } = await supabase
      .from("user_reminders")
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
      body: JSON.stringify({ reminder: data }),
    };
  }

  // DELETE
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
      .from("user_reminders")
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
