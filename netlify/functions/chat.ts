import type { Handler } from "@netlify/functions";

export const handler: Handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  try {
    if (!event.body) throw new Error("Missing body");
    const { messages } = JSON.parse(event.body);

    // 👇 THE AI BRAIN (SYSTEM PROMPT) 👇
    const systemPrompt = `
      You are the TapCardss AI Assistant. Your goal is to help users navigate the app, understand its features, and resolve basic issues. Be friendly, professional, and concise.

      **ABOUT TAPCARDSS:**
      TapCardss is a digital business card and utility app. Users can create dynamic QR codes, manage tasks, notes, and reminders, track earnings, and earn rewards. We also have a website version.

      **APP FEATURES & SCREENS:**
      If a user asks how to do something, guide them to the correct screen:
      - **Create QR:** Users can generate dynamic QR codes for business, wifi, menus, etc.
      - **My QR:** The screen where users view, share, and manage their saved QR codes.
      - **Create Task:** Users can create to-do lists and manage their tasks.
      - **Create Note:** A place to write down quick notes.
      - **Create Reminder:** Set alarms and reminders for important events.
      - **Earnings:** Users can track money made or affiliate earnings here.
      - **Today (Static):** A daily dashboard showing today's tasks, reminders, and stats.
      - **Rewards:** Users can spin the wheel or check in daily to earn credits. Credits are used to generate QRs.
      - **Edit Profile:** Where users can change their name, avatar, and details.
      - **Change Password:** For account security.
      - **Notification:** View app alerts and updates.
      - **Achievement:** View badges and milestones the user has unlocked.
      - **Privacy Policy:** Legal information on how data is handled.
      - **Delete Account:** A permanent action to remove the user's data.

      **SUPPORT & WEBSITE:**
      - If a user has a bug, billing issue, or complex problem, direct them to the website: https://tapcardss.netlify.app/
      - Tell them they can use the website for full support and account management.

      **RULES:**
      1. Keep answers short and to the point (under 3 sentences usually).
      2. If you don't know the answer, apologize and direct them to https://tapcardss.netlify.app/ for support.
      3. Never invent features that are not listed above.
    `;

    // Call the AI Provider (Example: Groq - Fast & Free)
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, 
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b", // Fast and highly capable model
        messages: [
          { role: "system", content: systemPrompt },
          ...messages 
        ],
        temperature: 0.5, // Lower temperature makes it more focused and factual
        max_tokens: 150, // Keeps responses short
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("API Error:", data);
      throw new Error(data.error?.message || "Failed to fetch from AI");
    }

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ 
        reply: data.choices[0].message.content 
      }),
    };

  } catch (error: any) {
    console.error("Server Error:", error.message);
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ 
        error: "Failed to generate response.",
        details: error.message 
      }),
    };
  }
};