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

  const { action } = JSON.parse(event.body || "{}");

  if (action !== "get") {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Invalid action" }),
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const startOfToday = new Date(today + "T00:00:00.000Z").toISOString();

  // ─── 1. Profile (credits) ──────────────────────────────
  const { data: profile } = await supabase
    .from("profiles")
    .select("credits")
    .eq("id", userId)
    .single();

  // ─── 2. Streak state ───────────────────────────────────
  const { data: streak } = await supabase
    .from("user_streak_state")
    .select("*")
    .eq("user_id", userId)
    .single();

  // ─── 3. Today's spins ──────────────────────────────────
  const { data: todaysSpin } = await supabase
    .from("user_spins")
    .select("*")
    .eq("user_id", userId)
    .eq("spin_date", today)
    .single();

  // ─── 4. Today's rewards ────────────────────────────────
  const { data: todaysRewards } = await supabase
    .from("user_rewards")
    .select("amount, source, created_at")
    .eq("user_id", userId)
    .gte("created_at", startOfToday);

  const creditsEarnedToday =
    todaysRewards?.reduce((s, r) => s + (r.amount || 0), 0) || 0;

  // ─── 5. Today's QR creations ───────────────────────────
  const { count: qrsToday } = await supabase
    .from("qr_codes")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", startOfToday);

  // ─── 6. Recent activity feed (last 10 events) ──────────
  // Combine rewards, spins, and QR creations into one timeline
  const { data: recentRewards } = await supabase
    .from("user_rewards")
    .select("source, amount, created_at, meta")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(5);

  const { data: recentQRs } = await supabase
    .from("qr_codes")
    .select("id, title, type, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(5);

  type FeedItem = {
    kind: "reward" | "qr";
    label: string;
    amount?: number;
    created_at: string;
  };

  const feed: FeedItem[] = [];

  (recentRewards || []).forEach((r) => {
    let label = "Earned credits";
    if (r.source === "streak")
      label = `Streak day ${r.meta?.streak_day || ""} reward`;
    if (r.source === "spin") label = `Daily spin: ${r.meta?.prize_label || ""}`;
    if (r.source === "achievement") label = "Achievement unlocked";
    feed.push({
      kind: "reward",
      label: label.trim(),
      amount: r.amount,
      created_at: r.created_at,
    });
  });

  (recentQRs || []).forEach((q) => {
    feed.push({
      kind: "qr",
      label: `Created "${q.title}" QR`,
      created_at: q.created_at,
    });
  });

  feed.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  // ─── 7. 7-day activity heat strip ──────────────────────
  const days: { date: string; active: boolean }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    days.push({ date: d, active: false });
  }

  const { data: activity } = await supabase
    .from("user_activity")
    .select("activity_date")
    .eq("user_id", userId)
    .gte("activity_date", days[0].date);

  const activeDays = new Set((activity || []).map((a) => a.activity_date));
  days.forEach((d) => {
    d.active = activeDays.has(d.date);
  });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      credits: profile?.credits || 0,
      creditsEarnedToday,
      qrsToday: qrsToday || 0,
      streak: {
        current: streak?.current_streak || 0,
        longest: streak?.longest_streak || 0,
        checkedInToday: streak?.last_check_in === today,
      },
      spin: {
        spunToday: !!todaysSpin,
        todayPrize: todaysSpin?.prize_label || null,
        todayAmount: todaysSpin?.prize_amount || 0,
      },
      activityFeed: feed.slice(0, 8),
      heatStrip: days,
    }),
  };
};
