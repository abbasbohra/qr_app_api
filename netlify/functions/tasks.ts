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

// Next due date for a recurring task
function nextDueDate(current: string, recurring: string): string | null {
  const d = new Date(current + "T00:00:00.000Z");
  if (recurring === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else if (recurring === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (recurring === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  else return null;
  return d.toISOString().slice(0, 10);
}

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
  // LIST
  // ═════════════════════════════════════════════════════
  if (action === "list") {
    const { data, error } = await supabase
      .from("user_tasks")
      .select("*")
      .eq("user_id", userId)
      .order("done", { ascending: true })
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });

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
      body: JSON.stringify({ tasks: data || [] }),
    };
  }

  // ═════════════════════════════════════════════════════
  // CREATE
  // ═════════════════════════════════════════════════════
  if (action === "create") {
    const {
      title = "",
      notes = "",
      dueDate = null,
      recurring = "none",
      priority = "normal",
    } = body;

    if (!title.trim()) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Task title required" }),
      };
    }

    const { data, error } = await supabase
      .from("user_tasks")
      .insert({
        user_id: userId,
        title: title.trim(),
        notes: notes.trim(),
        due_date: dueDate || null,
        recurring,
        priority,
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
      body: JSON.stringify({ task: data }),
    };
  }

  // ═════════════════════════════════════════════════════
  // UPDATE (fields)
  // ═════════════════════════════════════════════════════
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
    if (patch.title !== undefined) updates.title = patch.title.trim();
    if (patch.notes !== undefined) updates.notes = patch.notes;
    if (patch.dueDate !== undefined) updates.due_date = patch.dueDate;
    if (patch.recurring !== undefined) updates.recurring = patch.recurring;
    if (patch.priority !== undefined) updates.priority = patch.priority;

    const { data, error } = await supabase
      .from("user_tasks")
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
      body: JSON.stringify({ task: data }),
    };
  }

  // ═════════════════════════════════════════════════════
  // TOGGLE — flip done; if recurring, spawn next occurrence
  // ═════════════════════════════════════════════════════
  if (action === "toggle") {
    const { id } = body;
    if (!id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "id required" }),
      };
    }

    const { data: current, error: fetchErr } = await supabase
      .from("user_tasks")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .single();

    if (fetchErr || !current) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "Task not found" }),
      };
    }

    const willBeDone = !current.done;
    const now = new Date().toISOString();

    const { data: updated, error } = await supabase
      .from("user_tasks")
      .update({
        done: willBeDone,
        completed_at: willBeDone ? now : null,
        updated_at: now,
      })
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

    // If we just marked a recurring task done, spawn the next one
    let nextTask = null;
    if (willBeDone && current.recurring !== "none" && current.due_date) {
      const nextDate = nextDueDate(current.due_date, current.recurring);
      if (nextDate) {
        const { data: created } = await supabase
          .from("user_tasks")
          .insert({
            user_id: userId,
            title: current.title,
            notes: current.notes,
            due_date: nextDate,
            recurring: current.recurring,
            priority: current.priority,
            done: false,
          })
          .select()
          .single();
        nextTask = created;
      }
    }
    await supabase.from("user_activity_log").insert({
      user_id: userId,
      event_type: "task",
      title: `Completed: ${current.title}`,
      meta: { task_id: current.id },
    });
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ task: updated, nextTask }),
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
      .from("user_tasks")
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
