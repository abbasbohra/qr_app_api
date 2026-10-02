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
  // MONTH — counts per day for a given YYYY-MM
  // ═════════════════════════════════════════════════════
  if (action === "month") {
    const { year, month } = body; // month: 1-12

    if (!year || !month) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "year and month required" }),
      };
    }

    const start = new Date(Date.UTC(year, month - 1, 1)).toISOString();
    const end = new Date(Date.UTC(year, month, 1)).toISOString();

    const { data: events } = await supabase
      .from("user_activity_log")
      .select("event_type, occurred_at")
      .eq("user_id", userId)
      .gte("occurred_at", start)
      .lt("occurred_at", end);

    const days: Record<
      string,
      {
        date: string;
        qr_create: number;
        streak: number;
        spin: number;
        note: number;
        task: number;
        total: number;
      }
    > = {};

    (events || []).forEach((e) => {
      const date = e.occurred_at.slice(0, 10);
      if (!days[date]) {
        days[date] = {
          date,
          qr_create: 0,
          streak: 0,
          spin: 0,
          note: 0,
          task: 0,
          total: 0,
        };
      }
      const key = e.event_type as keyof (typeof days)[typeof date];
      if (key !== "date" && key !== "total") {
        (days[date][key] as number) += 1;
      }
      days[date].total += 1;
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ days: Object.values(days) }),
    };
  }

  // ═════════════════════════════════════════════════════
  // DAY — full detail for one day
  // ═════════════════════════════════════════════════════
  if (action === "day") {
    const { date } = body; // YYYY-MM-DD
    if (!date) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "date required" }),
      };
    }

    const start = new Date(date + "T00:00:00.000Z").toISOString();
    const end = new Date(date + "T23:59:59.999Z").toISOString();

    const { data: events } = await supabase
      .from("user_activity_log")
      .select("*")
      .eq("user_id", userId)
      .gte("occurred_at", start)
      .lte("occurred_at", end)
      .order("occurred_at", { ascending: true });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ events: events || [] }),
    };
  }

  return {
    statusCode: 400,
    headers,
    body: JSON.stringify({ error: "Invalid action" }),
  };
};
