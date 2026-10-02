import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { cert, getApps, initializeApp } from "firebase-admin";
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

  // ✅ FIXED — define `body` once, then destructure
  const body = JSON.parse(event.body || "{}");
  const { action, qr, id } = body;

  // ─── LIST ────────────────────────────────────────────────
  if (action === "list") {
    const { data, error } = await supabase
      .from("qr_codes")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: error.message }),
      };
    }

    const qrCodes = (data ?? []).map((row) => ({
      id: row.id,
      type: row.type || "personal",
      title: row.title || "Personal Info",
      form: {
        ...(row.data || {}), // all template fields
        name: row.name || "",
        phone: row.phone || "",
        email: row.email || "",
        company: row.company || "",
        website: row.website || "",
        note: row.note || "",
        menuItems: row.menu_items || [],
      },
      url: row.url,
      createdAt: new Date(row.created_at).getTime(),
      scan_count: row.scan_count || 0,
      last_scanned_at: row.last_scanned_at || null,
    }));

    return { statusCode: 200, headers, body: JSON.stringify({ qrCodes }) };
  }

  // ─── UPDATE URL ──────────────────────────────────────────
  if (action === "updateUrl") {
    const { qrId, url } = body;

    if (!qrId || !url) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "qrId and url required" }),
      };
    }

    const { error } = await supabase
      .from("qr_codes")
      .update({ url })
      .eq("id", qrId)
      .eq("user_id", userId);

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

  // ─── CREATE ──────────────────────────────────────────────
  if (action === "create") {
    const {
      action: _action,
      userId: _userId,
      type,
      title,
      url,
      menuItems,
      name,
      phone,
      email,
      company,
      website,
      note,
      ...fields // all other template fields → JSONB
    } = body;

    const row = {
      user_id: userId,
      type: type || "personal",
      title: title || name || "Profile",
      url: url || "",
      // core columns (kept for indexing / legacy code)
      name: name || "",
      phone: phone || "",
      email: email || "",
      company: company || "",
      website: website || "",
      note: note || "",
      menu_items: Array.isArray(menuItems) ? menuItems : [],
      // everything else (designation, bloodGroup, ssid, upiId, ...)
      data: fields,
      id: id,
    };

    const { data, error } = await supabase
      .from("qr_codes")
      .insert(row)
      .select()
      .single();

    if (error) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: error.message }),
      };
    }

    // Send notification (fire-and-forget)
    // sendQRNotifications(supabase, userId, {
    //   type: row.type,
    //   title: row.title,
    //   name: row.name,
    // }).catch((e) => console.warn("notif failed:", e));
    // Log activity
    await supabase.from("user_activity_log").insert({
      user_id: userId,
      event_type: "qr_create",
      title: `Created "${row.title}"`,
      meta: { type: row.type },
    });
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ qrCode: data }),
    };
  }

  // ─── UPDATE ──────────────────────────────────────────────
  if (action === "update") {
    const { id: qrId, type, title, form = {} } = qr;

    const { name, phone, email, company, website, note, menuItems, ...fields } =
      form;

    const patch = {
      type,
      title,
      name: name || "",
      phone: phone || "",
      email: email || "",
      company: company || "",
      website: website || "",
      note: note || "",
      menu_items: Array.isArray(menuItems) ? menuItems : [],
      data: fields,
    };

    const { data, error } = await supabase
      .from("qr_codes")
      .update(patch)
      .eq("id", qrId)
      .eq("user_id", userId)
      .select()
      .single();

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
      body: JSON.stringify({
        qr: {
          id: data.id,
          type: data.type,
          title: data.title,
          form: {
            ...(data.data || {}),
            name: data.name || "",
            phone: data.phone || "",
            email: data.email || "",
            company: data.company || "",
            website: data.website || "",
            note: data.note || "",
            menuItems: data.menu_items || [],
          },
          url: data.url,
          createdAt: new Date(data.created_at).getTime(),
          scan_count: data.scan_count || 0,
          last_scanned_at: data.last_scanned_at || null,
        },
      }),
    };
  }

  // ─── DELETE ──────────────────────────────────────────────
  if (action === "delete") {
    const qrId = id || qr?.id;

    if (!qrId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing id" }),
      };
    }

    const { data, error } = await supabase
      .from("qr_codes")
      .delete()
      .eq("id", qrId)
      .eq("user_id", userId)
      .select();

    if (error) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: error.message }),
      };
    }

    if (!data || data.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          error: "QR not found or already deleted",
          qrId,
          userId,
        }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, deletedId: data[0].id }),
    };
  }

  return {
    statusCode: 400,
    headers,
    body: JSON.stringify({ error: "Invalid action" }),
  };
};

// ─── Notification helper ────────────────────────────────
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
    title: "✅ QR code created",
    body: `Your "${qr.title}" QR code${qr.name ? ` for ${qr.name}` : ""} is ready to share. Tap to view it.`,
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
        title: "✅ QR code created",
        body: `Your "${qr.title}" is ready. Tap to view or share.`,
      },
      data: {
        type: "qr_created",
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
