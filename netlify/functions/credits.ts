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

  const { action, amount } = JSON.parse(event.body || "{}");

  // ─── GET ─────────────────────────────────────────────────
  if (action === "get") {
    const { data } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .single();

    // If no row exists, create it with 100 credits
    if (!data) {
      await supabase.from("profiles").insert({
        id: userId,
        name: "",
        credits: 100,
      });
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ credits: 100 }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ credits: data.credits ?? 0 }),
    };
  }

  // ─── ADD ─────────────────────────────────────────────────
  if (action === "add") {
    const { data } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .single();

    const newCredits = (data?.credits ?? 0) + (amount ?? 1);

    await supabase
      .from("profiles")
      .update({ credits: newCredits })
      .eq("id", userId);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ credits: newCredits }),
    };
  }

  // ─── SPEND ───────────────────────────────────────────────
  if (action === "spend") {
    const { data } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .single();

    const current = data?.credits ?? 0;
    const cost = amount ?? 1;

    if (current < cost) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Not enough credits", credits: current }),
      };
    }

    const newCredits = current - cost;
    await supabase
      .from("profiles")
      .update({ credits: newCredits })
      .eq("id", userId);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ credits: newCredits }),
    };
  }

  return {
    statusCode: 400,
    headers,
    body: JSON.stringify({ error: "Invalid action" }),
  };
};
