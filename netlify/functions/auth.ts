import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { cert, getApps, initializeApp } from "firebase-admin";
import { getMessaging } from "firebase-admin/messaging";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Regular client (used for signIn/signUp/getUser — respects user token scope)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Admin client — no session persistence, use for admin API only
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

// ─── PUBLIC ACTIONS — no token required ────────────────────
const PUBLIC_ACTIONS = new Set(["register", "login", "refresh"]);

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

  // Parse body once
  let body: any = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Invalid JSON" }),
    };
  }

  const { action } = body;

  // Get token from header
  const token = event.headers.authorization?.replace("Bearer ", "") || "";

  // ═══════════════════════════════════════════════════════════
  //  CHANGE PASSWORD
  // ═══════════════════════════════════════════════════════════
  if (action === "changePassword") {
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing fields" }),
      };
    }

    if (newPassword.length < 6) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: "Password must be at least 6 characters",
        }),
      };
    }

    if (!token) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: "Session expired" }),
      };
    }

    // 1. Get the current user
    const { data: userData } = await supabase.auth.getUser(token);
    const user = userData?.user;
    if (!user?.email) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: "User not found" }),
      };
    }

    // 2. Verify current password
    const { error: verifyErr } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });

    if (verifyErr) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Current password is incorrect" }),
      };
    }

    // 3. Update password
    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(
      user.id,
      { password: newPassword },
    );

    if (updateErr) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: updateErr.message }),
      };
    }

    // 4. ✅ CRITICAL — Sign in again to get a FRESH session
    const { data: freshSession, error: sessionErr } =
      await supabase.auth.signInWithPassword({
        email: user.email,
        password: newPassword,
      });

    if (sessionErr || !freshSession?.session) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: "Password updated. Please log in again.",
        }),
      };
    }

    // 5. ✅ Return the fresh session to the app
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        session: {
          access_token: freshSession.session.access_token,
          refresh_token: freshSession.session.refresh_token,
        },
      }),
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  REGISTER
  // ═══════════════════════════════════════════════════════════
  if (action === "register") {
    const { email, password, name, phone, fcmToken } = body;

    if (!email || !password || !name) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: "Name, email, and password are required",
        }),
      };
    }

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      user_metadata: { name, phone },
      email_confirm: true,
    });

    if (error) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: error.message }),
      };
    }

    // Create profile with 100 free credits
    await supabaseAdmin.from("profiles").insert({
      id: data.user.id,
      name,
      email,
      phone,
      credits: 100,
      plan: "free",
      status: "active",
      fcm_token: fcmToken || null,
    });

    // Welcome notifications
    await supabaseAdmin.from("notifications").insert([
      {
        user_id: data.user.id,
        title: "🎉 Welcome to QR Profile!",
        body: `Hi ${name.split(" ")[0]}, thanks for joining. Create your first digital QR card and share your info with a single scan.`,
        type: "success",
        is_read: false,
        is_broadcast: false,
      },
      {
        user_id: data.user.id,
        title: "🎁 100 free credits added",
        body: "You've received 100 free credits to get started. Each QR costs 1 credit. Watch a short ad anytime to earn more.",
        type: "promo",
        is_read: false,
        is_broadcast: false,
      },
    ]);

    // Send welcome push (non-blocking)
    if (fcmToken) {
      try {
        if (!getApps().length) {
          const serviceAccount = JSON.parse(
            process.env.FIREBASE_SERVICE_ACCOUNT!,
          );
          initializeApp({ credential: cert(serviceAccount) });
        }

        await getMessaging().send({
          token: fcmToken,
          notification: {
            title: "🎉 Welcome to QR Profile!",
            body: "100 free credits are waiting for you. Tap to create your first QR.",
          },
          data: { type: "welcome", credits: "100" },
          android: {
            priority: "high",
            notification: {
              channelId: "qr-profile-default",
              sound: "default",
            },
          },
          apns: {
            payload: {
              aps: { sound: "default", contentAvailable: true },
            },
          },
        });
      } catch (e: any) {
        console.warn("Welcome push failed (non-blocking):", e?.message);
      }
    }

    // Sign in to get session
    const { data: session, error: loginErr } =
      await supabase.auth.signInWithPassword({ email, password });

    if (loginErr) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Account created but login failed" }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        user: { id: data.user.id, email: data.user.email, name, phone },
        session: {
          access_token: session.session?.access_token,
          refresh_token: session.session?.refresh_token,
        },
        credits: 100,
      }),
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  LOGIN
  // ═══════════════════════════════════════════════════════════
  if (action === "login") {
    const { email, password, fcmToken } = body;

    if (!email || !password) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Email and password are required" }),
      };
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user) {
      // ✅ FIX: clear, single message for both wrong email and wrong password
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: "Invalid email or password" }),
      };
    }

    // Fetch profile
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("name, credits, phone, fcm_token")
      .eq("id", data.user.id)
      .single();

    console.log("[login] user id:", data.user.id);
    console.log("[login] profile:", profile);
    console.log("[login] profileErr:", profileErr);

    // Self-heal: create profile if missing
    if (!profile) {
      const metaName = data.user.user_metadata?.name || "";
      const metaPhone = data.user.user_metadata?.phone || "";

      await supabaseAdmin.from("profiles").insert({
        id: data.user.id,
        name: metaName,
        email: data.user.email,
        phone: metaPhone,
        credits: 100,
        plan: "free",
        status: "active",
        fcm_token: fcmToken || null,
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          user: {
            id: data.user.id,
            email: data.user.email,
            name: metaName,
            phone: metaPhone,
          },
          session: {
            access_token: data.session?.access_token,
            refresh_token: data.session?.refresh_token,
          },
          credits: 100,
        }),
      };
    }

    // Update FCM token if changed
    if (fcmToken && fcmToken !== profile.fcm_token) {
      await supabaseAdmin
        .from("profiles")
        .update({ fcm_token: fcmToken })
        .eq("id", data.user.id);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        user: {
          id: data.user.id,
          email: data.user.email,
          name: profile.name ?? "",
          phone: profile.phone ?? "",
        },
        session: {
          access_token: data.session?.access_token,
          refresh_token: data.session?.refresh_token,
        },
        credits: profile.credits ?? 100,
      }),
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  RESET USER PASSWORD (admin action — used by admin panel)
  // ═══════════════════════════════════════════════════════════
  if (action === "resetUserPassword") {
    // ✅ FIX: use body, not undefined `body` variable
    const { userId, newPassword } = body;

    if (!userId || !newPassword || newPassword.length < 6) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: "userId and newPassword (6+ chars) required",
        }),
      };
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: newPassword,
    });

    if (error) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: error.message }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true }),
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  UPDATE NAME
  // ═══════════════════════════════════════════════════════════
  if (action === "updateName") {
    if (!token) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: "Session expired" }),
      };
    }

    const { data: userData } = await supabase.auth.getUser(token);
    if (!userData.user) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: "Invalid token" }),
      };
    }

    const { name } = body;
    if (!name || typeof name !== "string" || !name.trim()) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Name required" }),
      };
    }

    await supabaseAdmin
      .from("profiles")
      .update({ name: name.trim() })
      .eq("id", userData.user.id);

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  // ═══════════════════════════════════════════════════════════
  //  DELETE ACCOUNT
  // ═══════════════════════════════════════════════════════════
  if (action === "deleteAccount") {
    if (!token) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: "Session expired" }),
      };
    }

    const { data: userData } = await supabase.auth.getUser(token);
    if (!userData.user) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: "Invalid token" }),
      };
    }

    // Delete user data first (FK dependencies), then the auth user
    await supabaseAdmin
      .from("qr_codes")
      .delete()
      .eq("user_id", userData.user.id);
    await supabaseAdmin
      .from("notifications")
      .delete()
      .eq("user_id", userData.user.id);
    await supabaseAdmin.from("profiles").delete().eq("id", userData.user.id);
    await supabaseAdmin.auth.admin.deleteUser(userData.user.id);

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  // ═══════════════════════════════════════════════════════════
  //  REFRESH TOKEN
  // ═══════════════════════════════════════════════════════════
  if (action === "refresh") {
    const { refreshToken } = body;

    if (!refreshToken) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing refreshToken" }),
      };
    }

    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: "Refresh failed" }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        session: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        },
      }),
    };
  }

  return {
    statusCode: 400,
    headers,
    body: JSON.stringify({ error: "Invalid action" }),
  };
};
