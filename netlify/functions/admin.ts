import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

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

function checkAuth(event: any) {
  const token = event.headers.authorization?.replace("Bearer ", "");
  return token === process.env.ADMIN_PASSWORD;
}
async function sendQRNotifications(
  supabase: any,
  userId: string,
  qr: { type: string; title: string; name: string },
) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("name, fcm_token")
    .eq("id", userId)
    .single();

  if (!profile) return;

  await supabase.from("notifications").insert({
    user_id: userId,
    title: qr.title,
    body: qr.name,
    type: "success",
    is_read: false,
    is_broadcast: false,
  });

  if (!profile.fcm_token) return;

  try {
    if (!getApps().length) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!);
      initializeApp({ credential: cert(serviceAccount) });
    }

    await getMessaging().send({
      token: profile.fcm_token,
      notification: {
        title: qr.title,
        body: qr.name,
      },
      data: {
        type: "info_notification",
        qrType: qr.type,
        qrTitle: qr.title,
      },
      android: {
        priority: "high",
        notification: {
          channelId: "qr-profile-default",
          sound: "default",
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            contentAvailable: true,
          },
        },
      },
    });
  } catch (e: any) {
    const code = e?.code;
    if (
      code === "messaging/registration-token-not-registered" ||
      code === "messaging/invalid-registration-token"
    ) {
      await supabase
        .from("profiles")
        .update({ fcm_token: null })
        .eq("id", userId);
    }
    throw e;
  }
}
export const handler: Handler = async (event) => {
  if (event.httpMethod === "OPTIONS")
    return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST")
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };

  if (!checkAuth(event))
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: "Unauthorized" }),
    };

  const body = JSON.parse(event.body || "{}");
  const { action } = body;

  // ─── STATS ──────────────────────────────────────────────
  if (action === "stats") {
    const { count: userCount } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true });

    const { count: qrCount } = await supabase
      .from("qr_codes")
      .select("*", { count: "exact", head: true });

    const { data: creditsSum } = await supabase
      .from("profiles")
      .select("credits");
    const totalCredits = (creditsSum || []).reduce(
      (s, p) => s + (p.credits || 0),
      0,
    );

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: activeToday } = await supabase
      .from("qr_codes")
      .select("*", { count: "exact", head: true })
      .gte("created_at", since);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        totalUsers: userCount || 0,
        totalQRs: qrCount || 0,
        totalCredits,
        activeToday: activeToday || 0,
      }),
    };
  }

  // ─── SUPPORT TICKETS ────────────────────────────────────
  if (action === "listSupportTickets") {
    const { status } = body;
    let q = supabase
      .from("support_tickets")
      .select("*")
      .order("created_at", { ascending: false });
    if (status && status !== "all") q = q.eq("status", status);

    const { data, error } = await q;
    if (error)
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: error.message }),
      };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ tickets: data || [] }),
    };
  }

  if (action === "updateSupportTicket") {
    const { id, status, admin_reply } = body;
    if (!id)
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "id required" }),
      };

    const updates: any = { updated_at: new Date().toISOString() };
    if (status !== undefined) updates.status = status;
    if (admin_reply !== undefined) updates.admin_reply = admin_reply;

    const { error } = await supabase
      .from("support_tickets")
      .update(updates)
      .eq("id", id);

    if (error)
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: error.message }),
      };

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  if (action === "deleteSupportTicket") {
    const { id } = body;
    if (!id)
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "id required" }),
      };

    const { error } = await supabase
      .from("support_tickets")
      .delete()
      .eq("id", id);

    if (error)
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: error.message }),
      };

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  // ─── SEND PUSH NOTIFICATION ─────────────────────────────
  if (action === "sendPushNotification") {
    if (!getApps().length) {
      try {
        const serviceAccount = JSON.parse(
          process.env.FIREBASE_SERVICE_ACCOUNT!,
        );
        initializeApp({ credential: cert(serviceAccount) });
      } catch (e: any) {
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: "Firebase init failed: " + e.message }),
        };
      }
    }

    const { userId, title, body: notifBody, broadcast } = body;

    if (!title || !notifBody) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Title and body required" }),
      };
    }

    const messageOptions = {
      notification: { title, body: notifBody },
      data: { type: "notification", title, body: notifBody },
      android: {
        priority: "high" as const,
        notification: {
          channelId: "qr-profile-default",
          sound: "default",
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            contentAvailable: true,
          },
        },
      },
    };

    try {
      if (broadcast) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, fcm_token")
          .not("fcm_token", "is", null);

        const validProfiles = (profiles || []).filter((p) => p.fcm_token);
        const tokens = validProfiles.map((p) => p.fcm_token as string);

        if (tokens.length === 0) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ sent: 0, failed: 0, cleaned: 0 }),
          };
        }

        const response = await getMessaging().sendEachForMulticast({
          tokens,
          ...messageOptions,
        });

        const invalidIds: string[] = [];
        response.responses.forEach((r, i) => {
          if (!r.success) {
            const code = r.error?.code;
            if (
              code === "messaging/registration-token-not-registered" ||
              code === "messaging/invalid-registration-token"
            ) {
              invalidIds.push(validProfiles[i].id);
            }
          }
        });

        if (invalidIds.length > 0) {
          await supabase
            .from("profiles")
            .update({ fcm_token: null })
            .in("id", invalidIds);
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            sent: response.successCount,
            failed: response.failureCount,
            cleaned: invalidIds.length,
          }),
        };
      }

      if (!userId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "userId required for single send" }),
        };
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("fcm_token")
        .eq("id", userId)
        .single();

      if (!profile?.fcm_token) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "User has no FCM token" }),
        };
      }

      try {
        await getMessaging().send({
          token: profile.fcm_token,
          ...messageOptions,
        });
      } catch (err: any) {
        if (
          err.code === "messaging/registration-token-not-registered" ||
          err.code === "messaging/invalid-registration-token"
        ) {
          await supabase
            .from("profiles")
            .update({ fcm_token: null })
            .eq("id", userId);
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: "FCM token invalid — cleared" }),
          };
        }
        throw err;
      }

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    } catch (error: any) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: error.message }),
      };
    }
  }

  // ─── LIST USERS ─────────────────────────────────────────
  if (action === "listUsers") {
    const { data: authUsers, error: authErr } =
      await supabase.auth.admin.listUsers();
    if (authErr)
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: authErr.message }),
      };

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, name, credits, plan, status, fcm_token");

    const { data: qrCounts } = await supabase
      .from("qr_codes")
      .select("user_id");

    const profileMap: Record<string, any> = {};
    (profiles || []).forEach((p) => (profileMap[p.id] = p));

    const qrCountMap: Record<string, number> = {};
    (qrCounts || []).forEach((q) => {
      qrCountMap[q.user_id] = (qrCountMap[q.user_id] || 0) + 1;
    });

    const users = (authUsers?.users || []).map((u) => ({
      id: u.id,
      email: u.email,
      name: profileMap[u.id]?.name || u.user_metadata?.name || "",
      credits: profileMap[u.id]?.credits ?? 0,
      plan: profileMap[u.id]?.plan || "free",
      status: profileMap[u.id]?.status || "active",
      qrCount: qrCountMap[u.id] || 0,
      createdAt: u.created_at,
      lastSignIn: u.last_sign_in_at,
      fcmToken: profileMap[u.id]?.fcm_token || null,
    }));

    return { statusCode: 200, headers, body: JSON.stringify({ users }) };
  }

  // ─── CREATE USER ────────────────────────────────────────
  if (action === "createUser") {
    const { email, password, name, credits = 100 } = body;

    if (!email || !password || !name) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: "Email, password and name are required",
        }),
      };
    }

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { name },
      email_confirm: true,
    });

    if (error)
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: error.message }),
      };

    await supabase.from("profiles").insert({
      id: data.user.id,
      name,
      email,
      credits,
      plan: "free",
      status: "active",
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ userId: data.user.id }),
    };
  }

  // ─── UPDATE USER ────────────────────────────────────────
  if (action === "updateUser") {
    const { userId, name, email, credits, plan, status } = body;

    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email;
    if (credits !== undefined) updates.credits = credits;
    if (plan !== undefined) updates.plan = plan;
    if (status !== undefined) updates.status = status;

    if (Object.keys(updates).length > 0) {
      await supabase.from("profiles").update(updates).eq("id", userId);
    }

    if (email) {
      await supabase.auth.admin.updateUserById(userId, { email });
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  if (action === "updateCredits") {
    await supabase
      .from("profiles")
      .update({ credits: body.amount })
      .eq("id", body.userId);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  if (action === "addCredits") {
    const { data: current } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", body.userId)
      .single();
    const newAmount = (current?.credits ?? 0) + (body.amount ?? 0);
    await supabase
      .from("profiles")
      .update({ credits: newAmount })
      .eq("id", body.userId);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ credits: newAmount }),
    };
  }

  if (action === "deleteUser") {
    await supabase.from("qr_codes").delete().eq("user_id", body.userId);
    await supabase.from("notifications").delete().eq("user_id", body.userId);
    await supabase.from("profiles").delete().eq("id", body.userId);
    await supabase.auth.admin.deleteUser(body.userId);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  // ─── LIST QRs ───────────────────────────────────────────
  if (action === "listQRs") {
    const { data } = await supabase
      .from("qr_codes")
      .select("*")
      .order("created_at", { ascending: false });
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ qrCodes: data ?? [] }),
    };
  }

  if (action === "deleteQR") {
    await supabase.from("qr_codes").delete().eq("id", body.qrId);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  // ─── NOTIFICATIONS ──────────────────────────────────────
  if (action === "sendNotification") {
    const { userId, title, body: notifBody, type, broadcast } = body;

    if (!title || !notifBody) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Title and body required" }),
      };
    }

    // ─── Init Firebase once ───────────────────────────────
    if (!getApps().length) {
      try {
        const serviceAccount = JSON.parse(
          process.env.FIREBASE_SERVICE_ACCOUNT!,
        );
        initializeApp({ credential: cert(serviceAccount) });
      } catch (e: any) {
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({
            error: "Firebase init failed: " + e.message,
          }),
        };
      }
    }

    // ─── BROADCAST ────────────────────────────────────────
    if (broadcast) {
      // 1) Insert in-app notification for every user
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, fcm_token");

      const rows = (profiles || []).map((p) => ({
        user_id: p.id,
        title,
        body: notifBody,
        type: type || "info",
        is_broadcast: true,
      }));
      if (rows.length) await supabase.from("notifications").insert(rows);

      // 2) Send FCM push to all users with a token
      const tokens = (profiles || [])
        .map((p) => p.fcm_token)
        .filter(Boolean) as string[];

      let sent = 0;
      let failed = 0;
      let cleaned = 0;

      if (tokens.length > 0) {
        try {
          const resp = await getMessaging().sendEachForMulticast({
            tokens,
            notification: { title, body: notifBody },
            data: { type: "notification", title, body: notifBody },
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

          sent = resp.successCount;
          failed = resp.failureCount;

          // Clean invalid tokens
          const invalidIds: string[] = [];
          resp.responses.forEach((r, i) => {
            if (!r.success) {
              const code = r.error?.code;
              if (
                code === "messaging/registration-token-not-registered" ||
                code === "messaging/invalid-registration-token"
              ) {
                const idx = tokens.indexOf(tokens[i]);
                if (idx !== -1 && profiles) {
                  const prof = profiles.find((p) => p.fcm_token === tokens[i]);
                  if (prof) invalidIds.push(prof.id);
                }
              }
            }
          });

          if (invalidIds.length > 0) {
            await supabase
              .from("profiles")
              .update({ fcm_token: null })
              .in("id", invalidIds);
            cleaned = invalidIds.length;
          }
        } catch (e: any) {
          console.warn("Broadcast FCM failed:", e);
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          sent: rows.length,
          pushSent: sent,
          pushFailed: failed,
          cleaned,
        }),
      };
    }

    // ─── SINGLE USER ──────────────────────────────────────
    if (!userId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: "userId required for single notification",
        }),
      };
    }

    // 1) In-app notification
    await supabase.from("notifications").insert({
      user_id: userId,
      title,
      body: notifBody,
      type: type || "info",
      is_broadcast: false,
    });

    // 2) Push to this user's device
    const { data: profile } = await supabase
      .from("profiles")
      .select("fcm_token")
      .eq("id", userId)
      .single();

    let pushSent = 0;

    if (profile?.fcm_token) {
      try {
        await getMessaging().send({
          token: profile.fcm_token,
          notification: { title, body: notifBody },
          data: { type: "notification", title, body: notifBody },
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
        pushSent = 1;
      } catch (err: any) {
        if (
          err.code === "messaging/registration-token-not-registered" ||
          err.code === "messaging/invalid-registration-token"
        ) {
          await supabase
            .from("profiles")
            .update({ fcm_token: null })
            .eq("id", userId);
        } else {
          console.warn("Push failed:", err);
        }
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, pushSent }),
    };
  }
  if (action === "listNotifications") {
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ notifications: data ?? [] }),
    };
  }

  if (action === "deleteNotification") {
    await supabase.from("notifications").delete().eq("id", body.notifId);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  // ─── STREAKS ────────────────────────────────────────────
  if (action === "listStreaks") {
    const { data: states } = await supabase
      .from("user_streak_state")
      .select("*")
      .order("current_streak", { ascending: false })
      .limit(200);

    const userIds = (states || []).map((s) => s.user_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, name, email")
      .in("id", userIds);

    const profileMap: Record<string, any> = {};
    (profiles || []).forEach((p) => (profileMap[p.id] = p));

    const rows = (states || []).map((s) => ({
      ...s,
      name: profileMap[s.user_id]?.name || "",
      email: profileMap[s.user_id]?.email || "",
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ streaks: rows }),
    };
  }

  if (action === "listRewards") {
    const { data } = await supabase
      .from("user_rewards")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ rewards: data || [] }),
    };
  }

  // ─── ACTIVITY STATS ─────────────────────────────────────
  if (action === "activityStats") {
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86400000)
      .toISOString()
      .slice(0, 10);
    const monthAgo = new Date(Date.now() - 30 * 86400000)
      .toISOString()
      .slice(0, 10);

    const { count: todayCount } = await supabase
      .from("user_activity")
      .select("*", { count: "exact", head: true })
      .eq("activity_date", today);

    const { count: weekCount } = await supabase
      .from("user_activity")
      .select("*", { count: "exact", head: true })
      .gte("activity_date", weekAgo);

    const { count: monthCount } = await supabase
      .from("user_activity")
      .select("*", { count: "exact", head: true })
      .gte("activity_date", monthAgo);

    const { count: totalCheckIns } = await supabase
      .from("user_streaks")
      .select("*", { count: "exact", head: true });

    const { data: topStreaks } = await supabase
      .from("user_streak_state")
      .select("current_streak, longest_streak")
      .order("current_streak", { ascending: false })
      .limit(5);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        activeToday: todayCount || 0,
        activeThisWeek: weekCount || 0,
        activeThisMonth: monthCount || 0,
        totalCheckIns: totalCheckIns || 0,
        topStreaks: topStreaks || [],
      }),
    };
  }

  // ─── ACTIVITY LOG STATS (for Activity tab) ──────────────
  if (action === "activityLogStats") {
    const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();

    const { data: logs } = await supabase
      .from("user_activity_log")
      .select("event_type, user_id, occurred_at")
      .gte("occurred_at", monthAgo);

    const all = logs || [];

    const byFeature = [
      { key: "qr_create", label: "QR Created", emoji: "▤" },
      { key: "streak", label: "Streak Check-in", emoji: "🔥" },
      { key: "spin", label: "Daily Spin", emoji: "🎡" },
      { key: "note", label: "Note Created", emoji: "📝" },
      { key: "task", label: "Task Completed", emoji: "✅" },
    ].map((f) => {
      const items = all.filter((l) => l.event_type === f.key);
      return {
        ...f,
        count: items.length,
        users: new Set(items.map((i) => i.user_id)).size,
      };
    });

    const dayMap: Record<string, Set<string>> = {};
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      dayMap[d] = new Set();
    }
    all.forEach((l) => {
      const d = l.occurred_at.slice(0, 10);
      if (dayMap[d]) dayMap[d].add(l.user_id);
    });

    const dailyCounts = Object.entries(dayMap).map(([date, users]) => ({
      date,
      count: users.size,
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ byFeature, dailyCounts }),
    };
  }

  // ─── SPINS ──────────────────────────────────────────────
  if (action === "listSpins") {
    const { data: spins } = await supabase
      .from("user_spins")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    const userIds = Array.from(new Set((spins || []).map((s) => s.user_id)));
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, name, email")
      .in("id", userIds);

    const profileMap: Record<string, any> = {};
    (profiles || []).forEach((p) => (profileMap[p.id] = p));

    const rows = (spins || []).map((s) => ({
      ...s,
      name: profileMap[s.user_id]?.name || "",
      email: profileMap[s.user_id]?.email || "",
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ spins: rows }),
    };
  }

  if (action === "spinStats") {
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86400000)
      .toISOString()
      .slice(0, 10);

    const { count: todayCount } = await supabase
      .from("user_spins")
      .select("*", { count: "exact", head: true })
      .eq("spin_date", today);

    const { count: weekCount } = await supabase
      .from("user_spins")
      .select("*", { count: "exact", head: true })
      .gte("spin_date", weekAgo);

    const { data: allSpins } = await supabase
      .from("user_spins")
      .select("prize_amount");

    const totalSpins = allSpins?.length || 0;
    const totalCreditsWon =
      allSpins?.reduce((s, r) => s + (r.prize_amount || 0), 0) || 0;
    const winners = allSpins?.filter((s) => s.prize_amount > 0).length || 0;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        spinsToday: todayCount || 0,
        spinsThisWeek: weekCount || 0,
        totalSpins,
        totalCreditsWon,
        winners,
        winRate: totalSpins ? Math.round((winners / totalSpins) * 100) : 0,
      }),
    };
  }

  // ─── NOTES ──────────────────────────────────────────────
  if (action === "listNotes") {
    const { data: notes } = await supabase
      .from("user_notes")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(200);

    const userIds = Array.from(new Set((notes || []).map((n) => n.user_id)));
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, name, email")
      .in("id", userIds);

    const profileMap: Record<string, any> = {};
    (profiles || []).forEach((p) => (profileMap[p.id] = p));

    const rows = (notes || []).map((n) => ({
      ...n,
      user_name: profileMap[n.user_id]?.name || "",
      user_email: profileMap[n.user_id]?.email || "",
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ notes: rows }),
    };
  }

  if (action === "notesStats") {
    const { count: totalNotes } = await supabase
      .from("user_notes")
      .select("*", { count: "exact", head: true });

    const { data: allNotes } = await supabase
      .from("user_notes")
      .select("user_id");

    const uniqueUsers = new Set((allNotes || []).map((n) => n.user_id)).size;

    const today = new Date().toISOString().slice(0, 10);
    const { count: notesToday } = await supabase
      .from("user_notes")
      .select("*", { count: "exact", head: true })
      .gte("created_at", today);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        totalNotes: totalNotes || 0,
        uniqueUsers,
        notesToday: notesToday || 0,
      }),
    };
  }

  // ─── TASKS ──────────────────────────────────────────────
  if (action === "listTasks") {
    const { data: tasks } = await supabase
      .from("user_tasks")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    const userIds = Array.from(new Set((tasks || []).map((t) => t.user_id)));
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, name, email")
      .in("id", userIds);

    const profileMap: Record<string, any> = {};
    (profiles || []).forEach((p) => (profileMap[p.id] = p));

    const rows = (tasks || []).map((t) => ({
      ...t,
      user_name: profileMap[t.user_id]?.name || "",
      user_email: profileMap[t.user_id]?.email || "",
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ tasks: rows }),
    };
  }

  if (action === "tasksStats") {
    const { count: totalTasks } = await supabase
      .from("user_tasks")
      .select("*", { count: "exact", head: true });

    const { count: completedTasks } = await supabase
      .from("user_tasks")
      .select("*", { count: "exact", head: true })
      .eq("done", true);

    const { data: allTasks } = await supabase
      .from("user_tasks")
      .select("user_id");

    const uniqueUsers = new Set((allTasks || []).map((t) => t.user_id)).size;

    const completionRate = totalTasks
      ? Math.round(((completedTasks || 0) / totalTasks) * 100)
      : 0;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        totalTasks: totalTasks || 0,
        completedTasks: completedTasks || 0,
        completionRate,
        uniqueUsers,
      }),
    };
  }

  // ─── REMINDERS ──────────────────────────────────────────
  if (action === "listReminders") {
    const { data: reminders } = await supabase
      .from("user_reminders")
      .select("*")
      .order("remind_at", { ascending: false })
      .limit(200);

    const userIds = Array.from(
      new Set((reminders || []).map((r) => r.user_id)),
    );
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, name, email")
      .in("id", userIds);

    const profileMap: Record<string, any> = {};
    (profiles || []).forEach((p) => (profileMap[p.id] = p));

    const rows = (reminders || []).map((r) => ({
      ...r,
      user_name: profileMap[r.user_id]?.name || "",
      user_email: profileMap[r.user_id]?.email || "",
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reminders: rows }),
    };
  }

  if (action === "remindersStats") {
    const { count: total } = await supabase
      .from("user_reminders")
      .select("*", { count: "exact", head: true });

    const { count: active } = await supabase
      .from("user_reminders")
      .select("*", { count: "exact", head: true })
      .eq("enabled", true);

    const now = new Date().toISOString();
    const { count: upcoming } = await supabase
      .from("user_reminders")
      .select("*", { count: "exact", head: true })
      .gte("remind_at", now);

    const { data: allRem } = await supabase
      .from("user_reminders")
      .select("user_id");

    const uniqueUsers = new Set((allRem || []).map((r) => r.user_id)).size;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        totalReminders: total || 0,
        activeReminders: active || 0,
        upcomingReminders: upcoming || 0,
        uniqueUsers,
      }),
    };
  }

  // ─── EARNINGS OVERVIEW ──────────────────────────────────
  if (action === "earningsOverview") {
    const { data: rewards } = await supabase
      .from("user_rewards")
      .select("amount, source, user_id, created_at");

    const all = rewards || [];
    const lifetime = all.reduce((s, r) => s + (r.amount || 0), 0);

    const bySource = { streak: 0, spin: 0, achievement: 0, other: 0 };
    all.forEach((r) => {
      if (bySource[r.source as keyof typeof bySource] !== undefined) {
        bySource[r.source as keyof typeof bySource] += r.amount || 0;
      } else {
        bySource.other += r.amount || 0;
      }
    });

    const uniqueUsers = new Set(all.map((r) => r.user_id)).size;

    const today = new Date().toISOString().slice(0, 10);
    const todaySum = all
      .filter((r) => r.created_at.slice(0, 10) === today)
      .reduce((s, r) => s + (r.amount || 0), 0);

    const byUser: Record<string, number> = {};
    all.forEach((r) => {
      byUser[r.user_id] = (byUser[r.user_id] || 0) + (r.amount || 0);
    });
    const topUserIds = Object.entries(byUser)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id]) => id);

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, name, email")
      .in("id", topUserIds);

    const profileMap: Record<string, any> = {};
    (profiles || []).forEach((p) => (profileMap[p.id] = p));

    const topEarners = topUserIds.map((id) => ({
      id,
      name: profileMap[id]?.name || "",
      email: profileMap[id]?.email || "",
      credits: byUser[id],
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        lifetimeCredits: lifetime,
        bySource,
        uniqueUsers,
        todayCredits: todaySum,
        topEarners,
      }),
    };
  }

  // ─── ACHIEVEMENTS (admin) ───────────────────────────────
  if (action === "listAchievements") {
    const { data: badges } = await supabase
      .from("achievements")
      .select("*")
      .order("sort_order", { ascending: true });

    const { data: unlocks } = await supabase
      .from("user_achievements")
      .select("achievement_key");

    const countByKey: Record<string, number> = {};
    (unlocks || []).forEach((u) => {
      countByKey[u.achievement_key] = (countByKey[u.achievement_key] || 0) + 1;
    });

    const rows = (badges || []).map((b) => ({
      ...b,
      unlock_count: countByKey[b.key] || 0,
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ achievements: rows }),
    };
  }

  if (action === "achievementsStats") {
    const { count: totalUnlocks } = await supabase
      .from("user_achievements")
      .select("*", { count: "exact", head: true });

    const { data: users } = await supabase
      .from("user_achievements")
      .select("user_id");

    const uniqueUsers = new Set((users || []).map((u) => u.user_id)).size;

    const { count: badgeCount } = await supabase
      .from("achievements")
      .select("*", { count: "exact", head: true });

    const { data: allUnlocks } = await supabase
      .from("user_achievements")
      .select("achievement_key");

    const counts: Record<string, number> = {};
    (allUnlocks || []).forEach((u) => {
      counts[u.achievement_key] = (counts[u.achievement_key] || 0) + 1;
    });

    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];

    let topBadge = null;
    if (top) {
      const { data: badge } = await supabase
        .from("achievements")
        .select("key, title, emoji")
        .eq("key", top[0])
        .single();
      if (badge) topBadge = { ...badge, count: top[1] };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        totalUnlocks: totalUnlocks || 0,
        uniqueUsers,
        badgeCount: badgeCount || 0,
        topBadge,
      }),
    };
  }
  // ─── RESET USER PASSWORD (admin) ────────────────────────
  if (action === "resetUserPassword") {
    const { userId, newPassword } = body;

    if (!userId || !newPassword) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: "userId and newPassword are required",
        }),
      };
    }

    if (typeof newPassword !== "string" || newPassword.length < 6) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: "Password must be at least 6 characters",
        }),
      };
    }

    const { data, error } = await supabase.auth.admin.updateUserById(userId, {
      password: newPassword,
    });

    if (error) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: error.message }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, userId: data.user?.id }),
    };
  }
  return {
    statusCode: 400,
    headers,
    body: JSON.stringify({ error: "Invalid action" }),
  };
};
