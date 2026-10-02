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

// ═══════════════════════════════════════════════════════
// STREAK REWARDS TABLE
// Day 3 → +2 credits
// Day 7 → +5 credits
// Day 14 → +10 credits
// Day 30 → +25 credits
// Every other day → +0 (just keeps streak alive)
// ═══════════════════════════════════════════════════════
function rewardForStreakDay(day: number): number {
  if (day === 3) return 2;
  if (day === 7) return 5;
  if (day === 14) return 10;
  if (day === 30) return 25;
  if (day > 0 && day % 30 === 0) return 25; // every 30 days after
  return 0;
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

  const { action } = JSON.parse(event.body || "{}");

  // ═════════════════════════════════════════════════════
  // GET — current streak state (no side effects)
  // ═════════════════════════════════════════════════════
  if (action === "get") {
    const { data: state } = await supabase
      .from("user_streak_state")
      .select("*")
      .eq("user_id", userId)
      .single();

    const today = new Date().toISOString().slice(0, 10);
    const checkedInToday = state?.last_check_in === today;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        currentStreak: state?.current_streak || 0,
        longestStreak: state?.longest_streak || 0,
        totalCheckIns: state?.total_check_ins || 0,
        lastCheckIn: state?.last_check_in || null,
        checkedInToday,
      }),
    };
  }

  // ═════════════════════════════════════════════════════
  // CHECK-IN — award streak day, credit if milestone
  // ═════════════════════════════════════════════════════
  if (action === "checkIn") {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000)
      .toISOString()
      .slice(0, 10);

    // Insert today's check-in (idempotent due to unique constraint)
    const { error: insertErr } = await supabase
      .from("user_streaks")
      .insert({ user_id: userId, check_in_date: today });

    if (insertErr && !insertErr.message.includes("duplicate")) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: insertErr.message }),
      };
    }

    // Fetch current state
    const { data: state } = await supabase
      .from("user_streak_state")
      .select("*")
      .eq("user_id", userId)
      .single();

    // If already checked in today, return current state
    if (state?.last_check_in === today) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          alreadyCheckedIn: true,
          currentStreak: state.current_streak,
          longestStreak: state.longest_streak,
          rewardEarned: 0,
        }),
      };
    }

    // Compute new streak
    let newStreak = 1;
    if (state?.last_check_in === yesterday) {
      newStreak = (state.current_streak || 0) + 1;
    }
    const newLongest = Math.max(state?.longest_streak || 0, newStreak);
    const totalCheckIns = (state?.total_check_ins || 0) + 1;

    // Upsert state
    await supabase.from("user_streak_state").upsert({
      user_id: userId,
      current_streak: newStreak,
      longest_streak: newLongest,
      last_check_in: today,
      total_check_ins: totalCheckIns,
      updated_at: new Date().toISOString(),
    });

    // Award milestone reward if any
    const rewardEarned = rewardForStreakDay(newStreak);

    if (rewardEarned > 0) {
      // Credit the user
      const { data: profile } = await supabase
        .from("profiles")
        .select("credits")
        .eq("id", userId)
        .single();

      const newCredits = (profile?.credits || 0) + rewardEarned;
      await supabase
        .from("profiles")
        .update({ credits: newCredits })
        .eq("id", userId);

      // Log the reward
      await supabase.from("user_rewards").insert({
        user_id: userId,
        source: "streak",
        amount: rewardEarned,
        meta: { streak_day: newStreak },
      });

      // Send notification
      await supabase.from("notifications").insert({
        user_id: userId,
        title: `🔥 ${newStreak}-day streak!`,
        body: `You earned +${rewardEarned} bonus credits. Keep going!`,
        type: "success",
        is_read: false,
        is_broadcast: false,
      });
    }
    await supabase.from("user_activity_log").insert({
      user_id: userId,
      event_type: "streak",
      title: `Day ${newStreak} streak`,
      meta: { day: newStreak, reward: rewardEarned },
    });
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        alreadyCheckedIn: false,
        currentStreak: newStreak,
        longestStreak: newLongest,
        totalCheckIns,
        rewardEarned,
      }),
    };
  }

  return {
    statusCode: 400,
    headers,
    body: JSON.stringify({ error: "Invalid action" }),
  };
};
