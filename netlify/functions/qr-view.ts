import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const handler: Handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      },
      body: "",
    };
  }

  let qrId = event.queryStringParameters?.id;
  if (!qrId) {
    const parts = (event.path || "").split("/").filter(Boolean);
    const lastPart = parts[parts.length - 1];
    if (lastPart && lastPart !== "qr-view") qrId = lastPart;
  }

  if (!qrId) return html404("Invalid link", "This QR link is malformed.");

  const { data: qr, error } = await supabase
    .from("qr_codes")
    .select("*")
    .eq("id", qrId)
    .single();

  if (error || !qr) {
    return html404(
      "QR not found",
      "This QR code doesn't exist or was removed.",
    );
  }

  const country =
    (event.headers["x-country"] as string) ||
    (event.headers["x-nf-geo-country"] as string) ||
    null;
  const userAgent = event.headers["user-agent"] || null;
  const deviceType = /mobile/i.test(userAgent || "") ? "mobile" : "desktop";

  (async () => {
    try {
      await supabase.from("qr_scans").insert({
        qr_id: qr.id,
        country,
        device_type: deviceType,
        user_agent: userAgent,
      });
      await supabase
        .from("qr_codes")
        .update({
          scan_count: (qr.scan_count || 0) + 1,
          last_scanned_at: new Date().toISOString(),
        })
        .eq("id", qr.id);
    } catch (e) {
      console.warn("scan log failed:", e);
    }
  })();

  // Merge JSONB data + core columns
  const d = qr.data || {};
  // Merge all fields from `data` JSONB with camelCase + snake_case aliases
  const payload = {
    type: qr.type || "personal",
    title: qr.title || "Profile",
    data: {
      ...d,
      // Core columns
      name: qr.name || d.name || "",
      phone: qr.phone || d.phone || "",
      email: qr.email || d.email || "",
      company: qr.company || d.company || "",
      website: qr.website || d.website || "",
      note: qr.note || d.note || "",
      menuItems: qr.menu_items || d.menuItems || [],
      // camelCase aliases for fields that use snake_case in the DB
      ownerName: d.ownerName || d.owner_name || "",
      altPhone: d.altPhone || d.alt_phone || "",
      vehicleNumber: d.vehicleNumber || d.vehicle_number || "",
      bloodGroup: d.bloodGroup || d.blood_group || "",
      emergencyName: d.emergencyName || d.emergency_name || "",
      emergencyPhone: d.emergencyPhone || d.emergency_phone || "",
      doctorPhone: d.doctorPhone || d.doctor_phone || "",
      serviceType: d.serviceType || d.service_type || "",
      businessName: d.businessName || d.business_name || "",
      productName: d.productName || d.product_name || "",
      upiId: d.upiId || d.upi_id || "",
      petName: d.petName || d.pet_name || "",
      orderUrl: d.orderUrl || d.order_url || "",
      bookingUrl: d.bookingUrl || d.booking_url || "",
      manualUrl: d.manualUrl || d.manual_url || "",
      purchaseDate: d.purchaseDate || d.purchase_date || "",
      supportPhone: d.supportPhone || d.support_phone || "",
      petPhotoUrl: d.petPhotoUrl || d.pet_photo_url || "",
      vetPhone: d.vetPhone || d.vet_phone || "",
      sellerPhone: d.sellerPhone || d.seller_phone || "",
      productImageUrl: d.productImageUrl || d.product_image_url || "",
      photoUrl: d.photoUrl || d.photo_url || "",
      googleMapsUrl: d.googleMapsUrl || d.google_maps_url || "",
      linkUrl: d.linkUrl || d.link_url || "",
      emergencyContact: d.emergencyContact || d.emergency_contact || "",
    },
  };

  // ─── JSON MODE — for React website ─────────────────────
  if (event.queryStringParameters?.format === "json") {
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Cache-Control": "public, max-age=60",
      },
      body: JSON.stringify(payload),
    };
  }

  // ─── HTML MODE — for old QRs ──────────────────────────
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=60",
    },
    body: buildViewerHTML(payload),
  };
};

// ─── 404 ────────────────────────────────────────────────
function html404(title: string, message: string) {
  return {
    statusCode: 404,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: `<!doctype html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${esc(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:"Inter",-apple-system,sans-serif;background:linear-gradient(135deg,#eef2ff,#f8fafc);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.card{background:#fff;max-width:420px;width:100%;border-radius:24px;padding:40px 28px;box-shadow:0 20px 60px rgba(15,23,42,.1);text-align:center}.icon{font-size:48px;margin-bottom:16px}h1{font-size:22px;color:#0f172a;margin-bottom:8px}p{font-size:14px;color:#64748b;line-height:1.5}</style></head>
<body><div class="card"><div class="icon">🔍</div><h1>${esc(title)}</h1><p>${esc(message)}</p></div></body></html>`,
  };
}

// ─── Wrapper ────────────────────────────────────────────
function buildViewerHTML(payload: any) {
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  const pageTitle = payload.data.name || payload.title || "Profile";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<title>${esc(pageTitle)}</title>
<meta name="theme-color" content="#2563eb" />
<link rel="icon" type="image/png" href="/logo.png" />
<link rel="apple-touch-icon" href="/logo.png" />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>${VIEWER_CSS}</style>
</head>
<body>
<div class="card" id="card"></div>
<script>
const PAYLOAD = ${json};
${VIEWER_SCRIPT}
render(PAYLOAD.type, PAYLOAD.title, PAYLOAD.data);
</script>
</body>
</html>`;
}

function esc(str: string) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── CSS ────────────────────────────────────────────────
const VIEWER_CSS = `
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
:root{--text:#0f172a;--muted:#64748b;--border:#e2e8f0}
html,body{min-height:100%}
body{font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
background:radial-gradient(circle at 20% 10%,rgba(37,99,235,.08),transparent 45%),
radial-gradient(circle at 80% 90%,rgba(13,148,136,.08),transparent 45%),
linear-gradient(135deg,#eef2ff 0%,#f8fafc 100%);
background-attachment:fixed;min-height:100vh;display:flex;align-items:center;justify-content:center;
padding:20px;color:var(--text);-webkit-font-smoothing:antialiased}
.card{background:#fff;max-width:440px;width:100%;border-radius:32px;padding:32px 24px 28px;
box-shadow:0 1px 3px rgba(15,23,42,.04),0 20px 60px rgba(15,23,42,.1);
animation:fadeIn .5s cubic-bezier(.16,1,.3,1);position:relative;overflow:hidden}
.card::before{content:"";position:absolute;top:0;left:0;right:0;height:6px;background:var(--accent,linear-gradient(135deg,#2563eb,#0d9488))}
@keyframes fadeIn{from{opacity:0;transform:translateY(16px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
.typeBadgeWrap{display:flex;justify-content:center;margin-bottom:18px}
.typeBadge{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:999px;font-size:11px;font-weight:800;letter-spacing:.6px;text-transform:uppercase}
.avatar{width:96px;height:96px;border-radius:28px;color:#fff;font-size:34px;font-weight:800;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;box-shadow:0 10px 30px rgba(15,23,42,.15),inset 0 -3px 0 rgba(0,0,0,.08);letter-spacing:-1px}
h1{text-align:center;font-size:26px;font-weight:800;color:var(--text);margin-bottom:6px;letter-spacing:-.5px;line-height:1.2;word-break:break-word}
.company{text-align:center;color:var(--muted);font-size:14px;margin-bottom:24px;font-weight:500;word-break:break-word}
.actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:24px}
.action{display:flex;align-items:center;justify-content:center;gap:8px;padding:14px 12px;background:#2563eb;color:#fff;border-radius:14px;text-decoration:none;font-size:14px;font-weight:700;transition:transform .15s,box-shadow .2s;border:none;cursor:pointer;font-family:inherit;box-shadow:0 4px 12px rgba(37,99,235,.25);text-align:center;min-width:0}
.action:active{transform:scale(.97)}
.action.secondary{background:#f1f5f9;color:#0f172a;box-shadow:none}
.action.full{grid-column:1/-1}
.info{display:flex;flex-direction:column;gap:4px;padding:16px;background:#f8fafc;border-radius:16px;margin-bottom:8px}
.row{display:flex;align-items:flex-start;gap:12px;padding:8px 0;border-bottom:1px solid rgba(226,232,240,.6)}
.row:last-child{border-bottom:none}
.row .label{color:#94a3b8;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;min-width:76px;padding-top:3px;flex-shrink:0}
.row .value{color:var(--text);font-size:15px;font-weight:500;word-break:break-word;flex:1;white-space:pre-wrap;line-height:1.4;min-width:0}
.row .value a{color:#2563eb;text-decoration:none;font-weight:600}
.note{margin-top:14px;padding:16px;background:#f8fafc;border-radius:16px;color:#475569;font-size:14px;line-height:1.6;white-space:pre-wrap;border-left:4px solid #cbd5e1;word-break:break-word}
.footer{display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;margin-top:24px;padding-top:20px;border-top:1px solid var(--border);color:#cbd5e1;font-size:11px;font-weight:600;letter-spacing:.5px;text-transform:uppercase}
.footerLogo{width:40px;height:40px;border-radius:50%;object-fit:contain}
.menuSection{margin-top:20px}
.menuTitle{display:flex;align-items:center;gap:10px;padding:0 4px 12px;border-bottom:1px solid #f1f5f9;margin-bottom:14px}
.menuTitleIcon{font-size:18px;line-height:1}
.menuTitle > span:nth-child(2){flex:1;font-size:15px;font-weight:800;color:#0f172a;letter-spacing:-.2px}
.menuCount{font-size:11px;font-weight:700;color:#c2410c;background:#ffedd5;padding:4px 10px;border-radius:999px;letter-spacing:.3px;text-transform:uppercase}
.menuGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.menuItem{background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 1px 2px rgba(15,23,42,.04);display:flex;flex-direction:column;transition:transform .15s,box-shadow .2s}
.menuItem:active{transform:scale(.98)}
.menuItemImageWrap{width:100%;aspect-ratio:4/3;background:linear-gradient(135deg,#fff7ed 0%,#ffedd5 100%);display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative}
.menuItemImage{width:100%;height:100%;object-fit:cover;display:block}
.menuItemPlaceholder{font-size:32px;opacity:.4}
.menuItemBody{padding:12px 14px 14px;display:flex;flex-direction:column;gap:6px;flex:1}
.menuItemName{font-size:13.5px;font-weight:700;color:#0f172a;line-height:1.35;letter-spacing:-.1px;word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.menuItemPrice{font-size:14px;font-weight:800;color:#c2410c;margin-top:auto;letter-spacing:-.2px}
@media (hover:hover){.menuItem:hover{box-shadow:0 8px 24px rgba(15,23,42,.08);transform:translateY(-2px)}.action:hover{box-shadow:0 8px 20px rgba(37,99,235,.3)}}
@media (max-width:420px){body{padding:12px;align-items:flex-start;padding-top:max(16px,env(safe-area-inset-top))}.card{padding:26px 18px 22px;border-radius:26px}h1{font-size:22px}.avatar{width:80px;height:80px;font-size:28px;border-radius:22px;margin-bottom:14px}.action{padding:12px 10px;font-size:13px;border-radius:12px}.row .label{min-width:66px;font-size:10px}.row .value{font-size:14px}}
@media (max-width:380px){.menuGrid{grid-template-columns:1fr}.menuItemImageWrap{aspect-ratio:16/9}}
@media (max-width:360px){.actions{grid-template-columns:1fr}.row{flex-direction:column;gap:4px}}
`;

// ─── Viewer JS ──────────────────────────────────────────
const VIEWER_SCRIPT = `
const card = document.getElementById("card");
function escapeHtml(str){return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
function initials(name){if(!name) return "?";return name.split(" ").filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join("");}
function row(label,value,link){if(!value) return "";const v=escapeHtml(value);const content=link?'<a href="'+link+'">'+v+'</a>':v;return '<div class="row"><div class="label">'+label+'</div><div class="value">'+content+'</div></div>';}
function normalizeUrl(u){if(!u) return "";return u.startsWith("http")?u:"https://"+u;}

function theme(type){
  const T={
    restaurant:{bg:"#fee2e2",color:"#dc2626",gradient:"linear-gradient(135deg,#ef4444,#dc2626)",accent:"linear-gradient(90deg,#ef4444,#dc2626)",emoji:"🍕"},
    pet_id:{bg:"#ffedd5",color:"#ea580c",gradient:"linear-gradient(135deg,#fb923c,#ea580c)",accent:"linear-gradient(90deg,#fb923c,#ea580c)",emoji:"🐾"},
    vehicle:{bg:"#cffafe",color:"#0891b2",gradient:"linear-gradient(135deg,#06b6d4,#0891b2)",accent:"linear-gradient(90deg,#06b6d4,#0891b2)",emoji:"🚗"},
    medical:{bg:"#fee2e2",color:"#dc2626",gradient:"linear-gradient(135deg,#ef4444,#991b1b)",accent:"linear-gradient(90deg,#ef4444,#991b1b)",emoji:"🩺"},
    social:{bg:"#ede9fe",color:"#7c3aed",gradient:"linear-gradient(135deg,#a78bfa,#7c3aed)",accent:"linear-gradient(90deg,#a78bfa,#7c3aed)",emoji:"🔗"},
    product:{bg:"#ccfbf1",color:"#0d9488",gradient:"linear-gradient(135deg,#14b8a6,#0d9488)",accent:"linear-gradient(90deg,#14b8a6,#0d9488)",emoji:"📦"},
    resume:{bg:"#dbeafe",color:"#1e40af",gradient:"linear-gradient(135deg,#3b82f6,#1e40af)",accent:"linear-gradient(90deg,#3b82f6,#1e40af)",emoji:"📄"},
    appointment:{bg:"#fed7aa",color:"#7c2d12",gradient:"linear-gradient(135deg,#f97316,#7c2d12)",accent:"linear-gradient(90deg,#f97316,#7c2d12)",emoji:"📅"},
    business:{bg:"#ccfbf1",color:"#0d9488",gradient:"linear-gradient(135deg,#14b8a6,#0d9488)",accent:"linear-gradient(90deg,#14b8a6,#0d9488)",emoji:"💼"},
    hotel_menu:{bg:"#ffedd5",color:"#c2410c",gradient:"linear-gradient(135deg,#fb923c,#c2410c)",accent:"linear-gradient(90deg,#fb923c,#c2410c)",emoji:"🍽️"},
    local_shop:{bg:"#dcfce7",color:"#16a34a",gradient:"linear-gradient(135deg,#22c55e,#15803d)",accent:"linear-gradient(90deg,#22c55e,#15803d)",emoji:"🛒"},
    family_tree:{bg:"#ede9fe",color:"#7c3aed",gradient:"linear-gradient(135deg,#a78bfa,#7c3aed)",accent:"linear-gradient(90deg,#a78bfa,#7c3aed)",emoji:"🌳"},
    event:{bg:"#fce7f3",color:"#db2777",gradient:"linear-gradient(135deg,#ec4899,#be185d)",accent:"linear-gradient(90deg,#ec4899,#be185d)",emoji:"🎉"},
    wifi:{bg:"#cffafe",color:"#0891b2",gradient:"linear-gradient(135deg,#06b6d4,#0e7490)",accent:"linear-gradient(90deg,#06b6d4,#0e7490)",emoji:"📶"},
    custom:{bg:"#e2e8f0",color:"#475569",gradient:"linear-gradient(135deg,#64748b,#334155)",accent:"linear-gradient(90deg,#64748b,#334155)",emoji:"✏️"},
    upi_payment:{bg:"#dbeafe",color:"#2563eb",gradient:"linear-gradient(135deg,#3b82f6,#1e40af)",accent:"linear-gradient(90deg,#3b82f6,#1e40af)",emoji:"💳"},
  };
  return T[type]||{bg:"#dbeafe",color:"#2563eb",gradient:"linear-gradient(135deg,#3b82f6,#0d9488)",accent:"linear-gradient(90deg,#3b82f6,#0d9488)",emoji:"👤"};
}

function vcard(p,name){
  const phone=p.phone||p.emergencyPhone||"";
  const email=p.email||"";
  const v=["BEGIN:VCARD","VERSION:3.0","FN:"+name,
    phone?"TEL;TYPE=CELL:"+phone:"",email?"EMAIL:"+email:"",
    p.company?"ORG:"+p.company:"",
    p.website?"URL:"+normalizeUrl(p.website):"",
    "END:VCARD"].filter(Boolean).join("\\n");
  return "data:text/vcard;charset=utf-8,"+encodeURIComponent(v);
}

function renderPersonal(p){
  const name=p.name||"Unknown";
  return '<div class="actions">'
    +(p.phone?'<a class="action" href="tel:'+escapeHtml(p.phone)+'">📞 Call</a>':'')
    +(p.email?'<a class="action" href="mailto:'+escapeHtml(p.email)+'">✉️ Email</a>':'')
    +'<a class="action secondary full" href="'+vcard(p,name)+'" download="'+escapeHtml(name.replace(/\\s+/g,"_"))+'.vcf">💾 Save to Contacts</a>'
    +'</div>'
    +'<div class="info">'
    +row("Phone",p.phone,"tel:"+p.phone)
    +row("Email",p.email,"mailto:"+p.email)
    +row("Website",p.website,normalizeUrl(p.website))
    +'</div>'
    +(p.note?'<div class="note">'+escapeHtml(p.note)+'</div>':'');
}

function renderBusiness(p){
  const name=p.name||"Unknown";
  return '<div class="actions">'
    +(p.phone?'<a class="action" href="tel:'+escapeHtml(p.phone)+'">📞 Call</a>':'')
    +(p.email?'<a class="action" href="mailto:'+escapeHtml(p.email)+'">✉️ Email</a>':'')
    +'<a class="action secondary full" href="'+vcard(p,name)+'" download="'+escapeHtml(name.replace(/\\s+/g,"_"))+'.vcf">💾 Save to Contacts</a>'
    +'</div>'
    +'<div class="info">'
    +row("Designation",p.designation)
    +row("Company",p.company)
    +row("Phone",p.phone,"tel:"+p.phone)
    +row("Email",p.email,"mailto:"+p.email)
    +row("Website",p.website,normalizeUrl(p.website))
    +row("Address",p.address)
    +'</div>'
    +(p.note?'<div class="note">'+escapeHtml(p.note)+'</div>':'');
}

function renderHotelMenu(p){
  let items=[];
  if(Array.isArray(p.menuItems)&&p.menuItems.length) items=p.menuItems;
  let menuHtml="";
  if(items.length){
    menuHtml='<div class="menuSection"><div class="menuTitle"><span class="menuTitleIcon">📋</span><span>Our Menu</span><span class="menuCount">'+items.length+' item'+(items.length>1?'s':'')+'</span></div><div class="menuGrid">'
    +items.map(it=>{
      const nm=escapeHtml(it.name||"");
      const pr=escapeHtml(it.price||"");
      const img=it.image?escapeHtml(it.image):"";
      return '<div class="menuItem"><div class="menuItemImageWrap">'
        +(img?'<img class="menuItemImage" src="'+img+'" alt="'+nm+'" loading="lazy" onerror="this.style.display=\\'none\\'"/>':'<div class="menuItemPlaceholder">🍽️</div>')
        +'</div><div class="menuItemBody"><div class="menuItemName">'+(nm||"Untitled dish")+'</div>'+(pr?'<div class="menuItemPrice">'+pr+'</div>':'')+'</div></div>';
    }).join("")+'</div></div>';
  }
  return '<div class="info">'
    +row("Phone",p.phone,"tel:"+p.phone)
    +row("Address",p.address)
    +'</div>'+menuHtml
    +(p.note?'<div class="note">'+escapeHtml(p.note)+'</div>':'')
    +(p.phone?'<div class="actions" style="margin-top:16px"><a class="action full" href="tel:'+escapeHtml(p.phone)+'">📞 Call Hotel</a></div>':'');
}

function renderShop(p){
  return '<div class="info">'
    +row("Owner",p.owner)
    +row("Phone",p.phone,"tel:"+p.phone)
    +row("Address",p.address)
    +row("Hours",p.hours)
    +'</div>'
    +(p.products?'<div class="note" style="background:#f0fdf4;color:#166534;border-left-color:#22c55e">🛍️ <b>Products</b>\\n\\n'+escapeHtml(p.products)+'</div>':'')
    +(p.phone?'<div class="actions" style="margin-top:16px"><a class="action full" href="tel:'+escapeHtml(p.phone)+'">📞 Call Shop</a></div>':'');
}

function renderFamily(p){
  return '<div class="info">'
    +row("Contact",p.phone,"tel:"+p.phone)
    +row("Address",p.address)
    +'</div>'
    +(p.members?'<div class="note" style="background:#f5f3ff;color:#5b21b6;border-left-color:#a78bfa">👨‍👩‍👧 <b>Members</b>\\n\\n'+escapeHtml(p.members)+'</div>':'')
    +(p.note?'<div class="note">'+escapeHtml(p.note)+'</div>':'');
}

function renderEvent(p){
  return '<div class="info">'
    +row("Date",p.date)
    +row("Location",p.location)
    +row("Host",p.host)
    +row("RSVP",p.phone,"tel:"+p.phone)
    +'</div>'
    +(p.note?'<div class="note">'+escapeHtml(p.note)+'</div>':'');
}

function renderWifi(p){
  return '<div class="info">'
    +row("Network",p.ssid)
    +row("Password",p.password)
    +row("Security",p.encryption)
    +'</div>'
    +(p.note?'<div class="note">'+escapeHtml(p.note)+'</div>':'');
}

function renderCustom(p){
  return '<div class="info">'
    +(p.title?row("Title",p.title):'')
    +'</div>'
    +(p.body?'<div class="note">'+escapeHtml(p.body)+'</div>':'')
    +(p.note?'<div class="note">'+escapeHtml(p.note)+'</div>':'');
}

function renderRestaurant(p){
  return '<div class="info">'
    +row("Phone",p.phone,"tel:"+p.phone)
    +row("Address",p.address)
    +row("Hours",p.hours)
    +'</div>'
    +(p.note?'<div class="note">'+escapeHtml(p.note)+'</div>':'')
    +'<div class="actions" style="margin-top:16px">'
    +(p.phone?'<a class="action full" href="tel:'+escapeHtml(p.phone)+'">📞 Call to Order</a>':'')
    +'</div>';
}

function renderPetID(p){
  return '<div class="info">'
    +row("Species",p.species)
    +row("Owner",p.ownerName)
    +row("Phone",p.phone,"tel:"+p.phone)
    +row("Address",p.address)
    +'</div>'
    +(p.note?'<div class="note" style="background:#fef2f2;color:#991b1b;border-left-color:#ef4444">🩺 <b>Medical</b>\\n\\n'+escapeHtml(p.note)+'</div>':'')
    +(p.phone?'<div class="actions" style="margin-top:16px"><a class="action full" href="tel:'+escapeHtml(p.phone)+'">📞 Call Owner</a></div>':'');
}

function renderVehicle(p){
  return '<div class="info">'
    +row("Vehicle No.",p.vehicleNumber)
    +row("Make & Model",p.model)
    +row("Owner",p.ownerName)
    +row("Phone",p.phone,"tel:"+p.phone)
    +'</div>'
    +(p.note?'<div class="note">'+escapeHtml(p.note)+'</div>':'')
    +(p.phone?'<div class="actions" style="margin-top:16px"><a class="action full" href="tel:'+escapeHtml(p.phone)+'">📞 Call Owner</a></div>':'');
}

function renderMedical(p){
  return '<div class="info" style="background:#fef2f2;border-left:4px solid #ef4444">'
    +row("Blood Group",p.bloodGroup)
    +'</div>'
    +(p.allergies?'<div class="note" style="background:#fef2f2;color:#991b1b;border-left-color:#ef4444">⚠️ <b>Allergies</b>\\n\\n'+escapeHtml(p.allergies)+'</div>':'')
    +(p.emergencyPhone?'<div class="actions" style="margin-top:16px"><a class="action full" href="tel:'+escapeHtml(p.emergencyPhone)+'">🚨 Call Emergency</a></div>':'');
}

function renderSocial(p){
  const items=[
    {label:"Instagram",url:p.instagram?"https://instagram.com/"+p.instagram.replace(/^@/,""):null,emoji:"📷"},
    {label:"YouTube",url:p.youtube?"https://youtube.com/"+(p.youtube.startsWith("@")?p.youtube:"@"+p.youtube):null,emoji:"▶️"},
    {label:"Twitter",url:p.twitter?"https://twitter.com/"+p.twitter.replace(/^@/,""):null,emoji:"🐦"},
    {label:"LinkedIn",url:p.linkedin?normalizeUrl(p.linkedin):null,emoji:"💼"},
    {label:"Website",url:p.website?normalizeUrl(p.website):null,emoji:"🌐"},
    {label:"Email",url:p.email?"mailto:"+p.email:null,emoji:"✉️"},
  ].filter(x=>x.url);
  return (p.bio?'<div class="note">'+escapeHtml(p.bio)+'</div>':'')
    +'<div class="actions" style="margin-top:16px">'
    +items.map(x=>'<a class="action secondary" href="'+escapeHtml(x.url)+'" target="_blank" rel="noopener">'+x.emoji+' '+escapeHtml(x.label)+'</a>').join("")
    +'</div>';
}

function renderProduct(p){
  return '<div class="info">'
    +row("Brand",p.brand)
    +row("SKU",p.sku)
    +row("Price",p.price)
    +row("Warranty",p.warranty)
    +'</div>'
    +(p.note?'<div class="note">'+escapeHtml(p.note)+'</div>':'');
}

function renderResume(p){
  return '<div class="info">'
    +row("Title",p.title)
    +row("Email",p.email,"mailto:"+p.email)
    +row("Phone",p.phone,"tel:"+p.phone)
    +row("Location",p.location)
    +'</div>'
    +(p.summary?'<div class="note">'+escapeHtml(p.summary)+'</div>':'')
    +(p.skills?'<div class="note" style="background:#dbeafe;color:#1e40af;border-left-color:#3b82f6">💡 <b>Skills</b>\\n\\n'+escapeHtml(p.skills)+'</div>':'');
}

function renderAppointment(p){
  const wa=(p.whatsapp||"").replace(/[^\\d]/g,"");
  return '<div class="info">'
    +row("Service",p.serviceType)
    +row("Phone",p.phone,"tel:"+p.phone)
    +row("Hours",p.hours)
    +'</div>'
    +(p.note?'<div class="note">'+escapeHtml(p.note)+'</div>':'')
    +'<div class="actions" style="margin-top:16px">'
    +(p.phone?'<a class="action full" href="tel:'+escapeHtml(p.phone)+'">📞 Call</a>':'')
    +(wa?'<a class="action full" href="https://wa.me/'+wa+'" target="_blank" rel="noopener" style="background:#25D366">💬 WhatsApp</a>':'')
    +'</div>';
}

function renderUpi(p){
  return '<div class="info" style="background:#eff6ff;border-left:4px solid #2563eb">'
    +row("UPI ID",p.upiId)
    +row("Payee",p.name)
    +(p.amount?row("Amount","₹"+p.amount):'')
    +'</div>'
    +(p.note?'<div class="note">'+escapeHtml(p.note)+'</div>':'')
    +'<div class="actions" style="margin-top:16px">'
    +'<div class="note" style="background:#dbeafe;color:#1e40af;border-left-color:#2563eb;text-align:center;margin-top:0">'
    +'💳 Open any UPI app (GPay, PhonePe, Paytm) and scan this QR to pay'
    +'</div>'
    +'</div>';
}

function render(type,typeTitle,p){
  const t=theme(type);
  card.style.setProperty("--accent",t.accent);
  const displayName=p.name||p.title||p.ssid||p.owner||"Untitled";
  const badge='<div class="typeBadgeWrap"><div class="typeBadge" style="background:'+t.bg+';color:'+t.color+'"><span>'+t.emoji+'</span><span>'+escapeHtml(typeTitle||"Profile")+'</span></div></div>';
  let body="";
  if(type==="hotel_menu") body=renderHotelMenu(p);
  else if(type==="restaurant") body=renderRestaurant(p);
  else if(type==="pet_id") body=renderPetID(p);
  else if(type==="vehicle") body=renderVehicle(p);
  else if(type==="medical") body=renderMedical(p);
  else if(type==="social") body=renderSocial(p);
  else if(type==="product") body=renderProduct(p);
  else if(type==="resume") body=renderResume(p);
  else if(type==="appointment") body=renderAppointment(p);
  else if(type==="upi_payment") body=renderUpi(p);
  else if(type==="wifi") body=renderWifi(p);
  else if(type==="local_shop") body=renderShop(p);
  else if(type==="family_tree") body=renderFamily(p);
  else if(type==="event") body=renderEvent(p);
  else if(type==="business") body=renderBusiness(p);
  else if(type==="custom") body=renderCustom(p);
  else body=renderPersonal(p);
  const avatar='<div class="avatar" style="background:'+t.gradient+'">'+(type==="custom"?"✏️":(type==="upi_payment"?"💳":initials(displayName)))+'</div>';
  const subtitle=p.company||p.designation||p.address||p.location||"";
  const subHtml=subtitle?'<div class="company">'+escapeHtml(subtitle)+'</div>':"";
  card.innerHTML=badge+avatar+'<h1>'+escapeHtml(displayName)+'</h1>'+subHtml+body
    +'<div class="footer"><img src="/logo.png" alt="TapCard" class="footerLogo"/><span>Powered by TapCard</span></div>';
}
`;
