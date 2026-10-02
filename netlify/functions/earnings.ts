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

  if (action !== "get") {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Invalid action" }),
    };
  }

  // ─── All rewards for this user ─────────────────────────
  const { data: rewards } = await supabase
    .from("user_rewards")
    .select("amount, source, created_at, meta")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  const all = rewards || [];

  // ─── Lifetime totals ───────────────────────────────────
  const lifetimeCredits = all.reduce((s, r) => s + (r.amount || 0), 0);
  const totalAwards = all.length;

  // ─── Breakdown by source ───────────────────────────────
  const bySource = {
    streak: 0,
    spin: 0,
    achievement: 0,
    other: 0,
  };
  all.forEach((r) => {
    if (r.source === "streak") bySource.streak += r.amount || 0;
    else if (r.source === "spin") bySource.spin += r.amount || 0;
    else if (r.source === "achievement") bySource.achievement += r.amount || 0;
    else bySource.other += r.amount || 0;
  });

  // ─── Today / week / month ──────────────────────────────
  const startOfToday = new Date(
    new Date().toISOString().slice(0, 10) + "T00:00:00.000Z",
  ).getTime();
  const startOfWeek = Date.now() - 7 * 86400000;
  const startOfMonth = Date.now() - 30 * 86400000;

  let today = 0;
  let week = 0;
  let month = 0;
  all.forEach((r) => {
    const t = new Date(r.created_at).getTime();
    if (t >= startOfToday) today += r.amount || 0;
    if (t >= startOfWeek) week += r.amount || 0;
    if (t >= startOfMonth) month += r.amount || 0;
  });

  // ─── Last 14 days chart data ───────────────────────────
  const dayMap: Record<string, number> = {};
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    dayMap[d] = 0;
  }
  all.forEach((r) => {
    const d = new Date(r.created_at).toISOString().slice(0, 10);
    if (dayMap[d] !== undefined) dayMap[d] += r.amount || 0;
  });

  const chart = Object.entries(dayMap).map(([date, amount]) => ({
    date,
    amount,
  }));

  // ─── Recent 10 rewards ─────────────────────────────────
  const recent = all.slice(0, 10).map((r) => ({
    source: r.source,
    amount: r.amount,
    meta: r.meta || {},
    created_at: r.created_at,
  }));

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      lifetimeCredits,
      totalAwards,
      bySource,
      today,
      week,
      month,
      chart,
      recent,
    }),
  };
};
