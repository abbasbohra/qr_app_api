import type { Handler } from "@netlify/functions";

export const handler: Handler = async (event) => {
  // 1. Handle CORS Preflight (OPTIONS) requests from the browser (if you use this API for web too)
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

  // 2. Only allow POST requests
  if (event.httpMethod !== "POST") {
    return { 
      statusCode: 405, 
      body: JSON.stringify({ error: "Method Not Allowed" }) 
    };
  }

  try {
    // 3. Parse the messages sent from your React Native app
    if (!event.body) throw new Error("Missing body");
    const { messages } = JSON.parse(event.body);

    // 4. Call the AI Provider (Example: OpenAI)
    // Make sure you set OPENAI_API_KEY in your Netlify Environment Variables
  // ... (keep the CORS and method checks the same)

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Change the env variable name to GROQ_API_KEY
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, 
      },
      body: JSON.stringify({
        // Change the model to a Groq-supported model
        model: "llama-3.3-70b-versatile", 
        messages: [
          { 
            role: "system", 
            content: "You are the TapCardss Assistant. You help users with their digital business cards. Be friendly and concise." 
          },
          ...messages 
        ],
        temperature: 0.7,
      }),
    });

// ... (the rest of the error handling remains the same)

    const data = await response.json();

    // Check if OpenAI returned an error (e.g., out of credits, bad key)
    if (!response.ok) {
      console.error("OpenAI Error:", data);
      throw new Error(data.error?.message || "Failed to fetch from OpenAI");
    }

    // 5. Return the AI's reply back to React Native
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*", // Allows frontend to access it
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