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
//  PRIZE TABLE — 8 slices
//  Slice index matches the wheel order in the app.
// ═══════════════════════════════════════════════════════
const PRIZES = [
  { index: 0, label: "+1 credit", amount: 1, weight: 35 },
  { index: 1, label: "+2 credits", amount: 2, weight: 25 },
  { index: 2, label: "Try again", amount: 0, weight: 15 },
  { index: 3, label: "+3 credits", amount: 3, weight: 12 },
  { index: 4, label: "+5 credits", amount: 5, weight: 8 },
  { index: 5, label: "+1 credit", amount: 1, weight: 3 },
  { index: 6, label: "+10 credits", amount: 10, weight: 1.5 },
  { index: 7, label: "+1 credit", amount: 1, weight: 0.5 },
];

// Weighted random pick
function pickPrize() {
  const total = PRIZES.reduce((s, p) => s + p.weight, 0);
  let r = Math.random() * total;
  for (const p of PRIZES) {
    r -= p.weight;
    if (r <= 0) return p;
  }
  return PRIZES[0];
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
  // GET — check if user has spun today
  // ═════════════════════════════════════════════════════
  if (action === "get") {
    const today = new Date().toISOString().slice(0, 10);

    const { data: spin } = await supabase
      .from("user_spins")
      .select("*")
      .eq("user_id", userId)
      .eq("spin_date", today)
      .single();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        canSpin: !spin,
        todaySpin: spin
          ? {
              prizeIndex: spin.prize_index,
              prizeLabel: spin.prize_label,
              prizeAmount: spin.prize_amount,
              createdAt: spin.created_at,
            }
          : null,
      }),
    };
  }

  // ═════════════════════════════════════════════════════
  // SPIN — server picks the prize, credit if a winner
  // ═════════════════════════════════════════════════════
  if (action === "spin") {
    const today = new Date().toISOString().slice(0, 10);

    // Check for existing spin today
    const { data: existing } = await supabase
      .from("user_spins")
      .select("*")
      .eq("user_id", userId)
      .eq("spin_date", today)
      .single();

    if (existing) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          alreadySpun: true,
          prizeIndex: existing.prize_index,
          prizeLabel: existing.prize_label,
          prizeAmount: existing.prize_amount,
        }),
      };
    }

    // Server picks the prize (client CANNOT control this)
    const prize = pickPrize();

    // Log the spin
    const { error: insertErr } = await supabase.from("user_spins").insert({
      user_id: userId,
      spin_date: today,
      prize_index: prize.index,
      prize_label: prize.label,
      prize_amount: prize.amount,
    });

    if (insertErr) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: insertErr.message }),
      };
    }

    // Award credits if a winner
    if (prize.amount > 0) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("credits")
        .eq("id", userId)
        .single();

      const newCredits = (profile?.credits || 0) + prize.amount;

      await supabase
        .from("profiles")
        .update({ credits: newCredits })
        .eq("id", userId);

      await supabase.from("user_rewards").insert({
        user_id: userId,
        source: "spin",
        amount: prize.amount,
        meta: { prize_index: prize.index, prize_label: prize.label },
      });
    }
    await supabase.from("user_activity_log").insert({
      user_id: userId,
      event_type: "spin",
      title: `Spin: ${prize.label}`,
      meta: { prize_index: prize.index, amount: prize.amount },
    });
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        alreadySpun: false,
        prizeIndex: prize.index,
        prizeLabel: prize.label,
        prizeAmount: prize.amount,
      }),
    };
  }

  return {
    statusCode: 400,
    headers,
    body: JSON.stringify({ error: "Invalid action" }),
  };
};
