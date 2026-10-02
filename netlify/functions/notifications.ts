import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { cert, getApps, initializeApp } from "firebase-admin";
import { getMessaging } from "firebase-admin/messaging";

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
  if (event.httpMethod === "OPTIONS")
    return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST")
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };

  const token = event.headers.authorization?.replace("Bearer ", "");
  if (!token)
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: "Missing token" }),
    };

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData.user)
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: "Invalid token" }),
    };

  const userId = userData.user.id;
  const { action, notifId } = JSON.parse(event.body || "{}");

  if (action === "list") {
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);

    const unread = (data || []).filter((n) => !n.is_read).length;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ notifications: data || [], unread }),
    };
  }

  if (action === "markRead") {
    if (notifId) {
      await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", notifId)
        .eq("user_id", userId);
    } else {
      // mark all
      await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", userId)
        .eq("is_read", false);
    }
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  return {
    statusCode: 400,
    headers,
    body: JSON.stringify({ error: "Invalid action" }),
  };
};
