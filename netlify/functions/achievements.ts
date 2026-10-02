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
//  CHECK RULES — determines which badges the user has now earned
//  Returns newly-earned badge keys (not already unlocked).
// ═══════════════════════════════════════════════════════
async function computeEarned(
  userId: string,
  alreadyUnlocked: Set<string>,
): Promise<string[]> {
  const earned: string[] = [];

  const add = (key: string) => {
    if (!alreadyUnlocked.has(key)) earned.push(key);
  };

  // QR counts
  const { count: qrCount } = await supabase
    .from("qr_codes")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  if ((qrCount || 0) >= 1) add("first_qr");
  if ((qrCount || 0) >= 10) add("qr_10");
  if ((qrCount || 0) >= 50) add("qr_50");

  // Scan counts (sum over user's QRs)
  const { data: userQRs } = await supabase
    .from("qr_codes")
    .select("scan_count")
    .eq("user_id", userId);

  const totalScans = (userQRs || []).reduce(
    (s, q) => s + (q.scan_count || 0),
    0,
  );
  if (totalScans >= 5) add("social_5");

  // Streaks
  const { data: streak } = await supabase
    .from("user_streak_state")
    .select("current_streak, longest_streak")
    .eq("user_id", userId)
    .single();

  const bestStreak = Math.max(
    streak?.current_streak || 0,
    streak?.longest_streak || 0,
  );
  if (bestStreak >= 3) add("streak_3");
  if (bestStreak >= 7) add("streak_7");
  if (bestStreak >= 30) add("streak_30");

  // Spins
  const { count: spinCount } = await supabase
    .from("user_spins")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  if ((spinCount || 0) >= 1) add("spin_first");

  const { data: bigSpin } = await supabase
    .from("user_spins")
    .select("id")
    .eq("user_id", userId)
    .gte("prize_amount", 10)
    .limit(1)
    .maybeSingle();

  if (bigSpin) add("spin_jackpot");

  // Notes
  const { count: noteCount } = await supabase
    .from("user_notes")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  if ((noteCount || 0) >= 1) add("note_first");

  // Tasks
  const { count: doneTasks } = await supabase
    .from("user_tasks")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("done", true);

  if ((doneTasks || 0) >= 1) add("task_first");
  if ((doneTasks || 0) >= 25) add("task_25");

  return earned;
}

// ═══════════════════════════════════════════════════════
//  Award badges + credits + notification
// ═══════════════════════════════════════════════════════
async function awardBadges(userId: string, keys: string[]) {
  if (!keys.length) return [];

  // Fetch badge details
  const { data: badges } = await supabase
    .from("achievements")
    .select("*")
    .in("key", keys);

  if (!badges?.length) return [];

  // Insert unlocks
  const rows = badges.map((b) => ({
    user_id: userId,
    achievement_key: b.key,
  }));
  await supabase.from("user_achievements").insert(rows);

  // Award credits
  const totalReward = badges.reduce((s, b) => s + (b.reward_credits || 0), 0);

  if (totalReward > 0) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .single();

    const newCredits = (profile?.credits || 0) + totalReward;

    await supabase
      .from("profiles")
      .update({ credits: newCredits })
      .eq("id", userId);

    // Log each as a reward
    for (const b of badges) {
      await supabase.from("user_rewards").insert({
        user_id: userId,
        source: "achievement",
        amount: b.reward_credits,
        meta: { achievement_key: b.key, title: b.title },
      });
    }
  }

  // Send notification
  for (const b of badges) {
    await supabase.from("notifications").insert({
      user_id: userId,
      title: `${b.emoji} Achievement unlocked!`,
      body: `${b.title} — ${b.description}${b.reward_credits > 0 ? ` (+${b.reward_credits} credits)` : ""}`,
      type: "success",
      is_read: false,
      is_broadcast: false,
    });
  }

  return badges;
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
  // LIST — all badges + user's unlock status
  // ═════════════════════════════════════════════════════
  if (action === "list") {
    const { data: allBadges } = await supabase
      .from("achievements")
      .select("*")
      .order("sort_order", { ascending: true });

    const { data: userBadges } = await supabase
      .from("user_achievements")
      .select("achievement_key, unlocked_at")
      .eq("user_id", userId);

    const unlockMap: Record<string, string> = {};
    (userBadges || []).forEach((ub) => {
      unlockMap[ub.achievement_key] = ub.unlocked_at;
    });

    const badges = (allBadges || []).map((b) => ({
      ...b,
      unlocked: !!unlockMap[b.key],
      unlocked_at: unlockMap[b.key] || null,
    }));

    const unlockedCount = badges.filter((b) => b.unlocked).length;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        badges,
        unlockedCount,
        totalCount: badges.length,
      }),
    };
  }

  // ═════════════════════════════════════════════════════
  // CHECK — recompute; award any newly-earned badges
  // ═════════════════════════════════════════════════════
  if (action === "check") {
    const { data: userBadges } = await supabase
      .from("user_achievements")
      .select("achievement_key")
      .eq("user_id", userId);

    const alreadyUnlocked = new Set(
      (userBadges || []).map((b) => b.achievement_key),
    );

    const earned = await computeEarned(userId, alreadyUnlocked);
    const awarded = await awardBadges(userId, earned);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        newlyUnlocked: awarded,
        count: awarded.length,
      }),
    };
  }

  return {
    statusCode: 400,
    headers,
    body: JSON.stringify({ error: "Invalid action" }),
  };
};
