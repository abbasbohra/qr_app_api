import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const recent: Record<string, number[]> = {};
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;

export const handler: Handler = async (event) => {
  if (event.httpMethod === "OPTIONS")
    return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST")
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };

  let body: any;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Invalid JSON" }),
    };
  }

  const name = String(body.name || "").trim();
  const email = String(body.email || "")
    .trim()
    .toLowerCase();
  const topic = String(body.topic || "Other").trim();
  const message = String(body.message || "").trim();

  if (!name || name.length > 100)
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Invalid name" }),
    };
  if (!email.includes("@") || email.length > 200)
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Invalid email" }),
    };
  if (message.length < 5 || message.length > 2000)
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Message must be 5–2000 characters" }),
    };

  const ip =
    event.headers["x-nf-client-connection-ip"] ||
    event.headers["client-ip"] ||
    "unknown";
  const now = Date.now();
  const hits = (recent[ip] || []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_PER_WINDOW)
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({ error: "Too many requests. Try later." }),
    };
  hits.push(now);
  recent[ip] = hits;

  const { error } = await supabase.from("support_tickets").insert({
    name,
    email,
    topic,
    message,
    status: "open",
    ip_address: ip,
  });

  if (error)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to save ticket" }),
    };

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ok: true }),
  };
};
