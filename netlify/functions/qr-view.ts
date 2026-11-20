import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

// Resolve both direct function URLs and public URLs rewritten by Netlify.
const QR_ID_KEYS = ["id", "qrId", "qr_id"];
const QR_ROUTES = new Set(["qr", "qr-view", "qrview", "q"]);

function cleanQrId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const id = value.trim();
  if (!id || id.length > 512 || /[\x00-\x1f\x7f/\\?#]/.test(id)) return undefined;
  if (QR_ROUTES.has(id.toLowerCase()) || id === "." || id === "..") return undefined;
  return id;
}

function idFromPath(path: string, routedOnly: boolean): string | undefined {
  const parts = path.split(/[?#]/, 1)[0].split("/").filter(Boolean);
  // The segment following a known route is the intended QR ID.
  for (let i = 0; i < parts.length - 1; i++) {
    if (QR_ROUTES.has(parts[i].toLowerCase()) && i === parts.length - 2) {
      try { return cleanQrId(decodeURIComponent(parts[i + 1])); }
      catch { return undefined; }
    }
  }
  if (routedOnly || !parts.length || parts.includes(".netlify")) return undefined;
  // Preserve the original viewer's last-path-segment fallback for legacy links.
  try { return cleanQrId(decodeURIComponent(parts[parts.length - 1])); }
  catch { return undefined; }
}

function resolveQrId(event: Parameters<Handler>[0]): string | undefined {
  // Netlify queryStringParameters values are already URL-decoded.
  for (const key of QR_ID_KEYS) {
    const id = cleanQrId(event.queryStringParameters?.[key]);
    if (id) return id;
  }
  let raw: URL | undefined;
  if (event.rawUrl) {
    try { raw = new URL(event.rawUrl); } catch { /* Fall back to event.path */ }
  }
  for (const key of QR_ID_KEYS) {
    const id = cleanQrId(raw?.searchParams.get(key));
    if (id) return id;
  }
  if (raw) {
    const id = idFromPath(raw.pathname, true);
    if (id) return id;
  }
  return idFromPath(event.path || "", true)
    || (raw && idFromPath(raw.pathname, false))
    || idFromPath(event.path || "", false);
}

function qrError(event: Parameters<Handler>[0], status: number, title: string, message: string) {
  let json = event.queryStringParameters?.format === "json";
  if (!json && event.rawUrl) {
    try { json = new URL(event.rawUrl).searchParams.get("format") === "json"; } catch { /* ignore */ }
  }
  if (json) return {
    statusCode: status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
    body: JSON.stringify({ error: title, message }),
  };
  return html404(title, message, status);
}

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

  const qrId = resolveQrId(event);
  if (!qrId) return qrError(event, 400, "Invalid QR link", "This QR link is missing a valid QR ID. Please scan the original QR code again.");

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("[qr-view] Missing Supabase environment configuration");
    return qrError(event, 503, "QR temporarily unavailable", "The QR service is not configured correctly. Please try again later.");
  }
  let supabase: ReturnType<typeof createClient>;
  let qr;
  try {
    supabase = createClient(url, key);
    const { data, error } = await supabase
      .from("qr_codes")
      .select("*")
      .eq("id", qrId)
      .maybeSingle();
    if (error) {
      console.error("[qr-view] Database lookup failed", { code: error.code, message: error.message });
      if (error.code === "22P02") {
        return qrError(event, 400, "Invalid QR link", "The QR ID is not in the format expected by the database.");
      }
      return qrError(event, 503, "QR temporarily unavailable", "We could not load this QR right now. Please try again later.");
    }
    if (!data) {
      console.warn("[qr-view] No matching row in qr_codes");
      return qrError(event, 404, "QR not found", "This QR code does not exist or may have been removed.");
    }
    qr = data;
  } catch (error) {
    console.error("[qr-view] Lookup exception", error instanceof Error ? error.message : "Unknown error");
    return qrError(event, 503, "QR temporarily unavailable", "We could not connect to the QR service. Please try again later.");
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
  const payload = {
    type: qr.type || "personal",
    title: qr.title || "Profile",
    data: {
      ...d,
      name: qr.name || d.name || "",
      phone: qr.phone || d.phone || "",
      email: qr.email || d.email || "",
      company: qr.company || d.company || "",
      website: qr.website || d.website || "",
      note: qr.note || d.note || "",
      menuItems: (Array.isArray(qr.menu_items) && qr.menu_items.length ? qr.menu_items : d.menuItems || d.menu_items || qr.menu_items || []),
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

  let wantsJson = event.queryStringParameters?.format === "json";
  if (!wantsJson && event.rawUrl) {
    try { wantsJson = new URL(event.rawUrl).searchParams.get("format") === "json"; } catch { /* ignore */ }
  }
  if (wantsJson) {
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

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-TapCard-Viewer": "studio-v3",
    },
    body: buildViewerHTML(payload),
  };
};

// ─── Responsive public QR viewer (server-rendered) ─────────────────────────
type QRData = Record<string, unknown>;
type QRPayload = { type: string; title: string; data: QRData };
type Entry = [string, unknown];

const THEMES: Record<string, [string, string, string, string]> = {
  personal: ['Personal profile', '#4338ca', '#eef2ff', 'user'],
  business: ['Business card', '#0f766e', '#e6f6f3', 'briefcase'],
  hotel_menu: ['Hotel menu', '#a84313', '#fff2e5', 'menu'],
  restaurant: ['Restaurant', '#a84313', '#fff2e5', 'menu'],
  pet_id: ['Pet ID', '#a84313', '#fff2e5', 'heart'],
  vehicle: ['Vehicle ID', '#036b86', '#e3f5fb', 'car'],
  medical: ['Medical ID', '#b42335', '#fff0f2', 'heart'],
  social: ['Social profile', '#6d28d9', '#f3eefe', 'link'],
  product: ['Product information', '#0f766e', '#e6f6f3', 'box'],
  resume: ['Résumé', '#1d4ed8', '#edf4ff', 'file'],
  appointment: ['Appointment', '#a84313', '#fff2e5', 'calendar'],
  upi_payment: ['UPI payment', '#4338ca', '#eef2ff', 'wallet'],
  wifi: ['Wi-Fi access', '#036b86', '#e3f5fb', 'wifi'],
  local_shop: ['Local shop', '#167247', '#e9f8ef', 'bag'],
  family_tree: ['Family tree', '#6d28d9', '#f3eefe', 'users'],
  event: ['Event invitation', '#be185d', '#fff0f7', 'calendar'],
  custom: ['Custom information', '#475569', '#edf2f7', 'file'],
};
const ICONS: Record<string,string> = {
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  users:'<circle cx="9" cy="8" r="3"/><path d="M2 21v-2a7 7 0 0 1 14 0v2M17 5a3 3 0 0 1 0 6m1 3a5 5 0 0 1 4 5v2"/>',
  briefcase:'<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V4h8v3M3 13h18M10 13v2h4v-2"/>',
  phone:'<path d="M22 16.9v3a2 2 0 0 1-2.2 2 18 18 0 0 1-7.9-2.8 18 18 0 0 1-5.5-5.5 18 18 0 0 1-2.8-8A2 2 0 0 1 5.6 3h3a2 2 0 0 1 2 1.7l.5 3a2 2 0 0 1-.6 1.7L9.2 10.7a14 14 0 0 0 4.9 4.9l1.3-1.3a2 2 0 0 1 1.7-.6l3 .5a2 2 0 0 1 1.9 2.7z"/>',
  mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  link:'<path d="M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-2 2m3 5a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l2-2"/>',
  heart:'<path d="M20.8 8.5c0 5-8.8 11-8.8 11S3.2 13.5 3.2 8.5A4.8 4.8 0 0 1 12 5.9a4.8 4.8 0 0 1 8.8 2.6Z"/><path d="M3 12h5l2-3 3 6 2-3h6"/>',
  car:'<path d="m5 11 2-6h10l2 6M3 11h18v8H3zM5 19v2m14-2v2M6 15h2m8 0h2"/>',
  box:'<path d="m12 3 9 5v8l-9 5-9-5V8zM3 8l9 5 9-5M12 13v8M7.5 5.5l9 5"/>',
  file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8m-8 4h8"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4m8-4v4M3 11h18m-13 4h2m4 0h2"/>',
  wifi:'<path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0m-11 4a6 6 0 0 1 8 0"/><circle cx="12" cy="20" r="1"/>',
  wallet:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M15 15h3"/>',
  bag:'<path d="M5 7h14l2 14H3zM9 9V6a3 3 0 0 1 6 0v3"/>',
  menu:'<path d="M4 3v7a3 3 0 0 0 6 0V3M7 3v18M20 3c-4 1-5 5-5 10h5m0-10v18"/>',
  map:'<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0z"/><circle cx="12" cy="10" r="2.5"/>',
  download:'<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
  share:'<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.7 10.5 6.6-4m-6.6 7 6.6 4"/>',
  arrow:'<path d="M7 17 17 7M7 7h10v10"/>',
  chat:'<path d="M21 11a9 9 0 0 1-9 9 10 10 0 0 1-4-.9L3 21l1.9-5A9 9 0 1 1 21 11z"/><path d="M8 11h8"/>',
  image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-5 5 6"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
};
function icon(name: string) {
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.info}</svg>`;
}
function esc(value: unknown): string {
  return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function filled(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.some(filled);
  if (typeof v === 'object') return Object.values(v as QRData).some(filled);
  return true; // Includes zero and false.
}
function scalar(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
}
function norm(k: string) { return k.replace(/[^a-z0-9]/gi,'').toLowerCase(); }
function label(k: string): string {
  const special: Record<string,string> = { ssid:'Network name (SSID)', upiid:'UPI ID', sku:'SKU', googlemapsurl:'Google Maps', altphone:'Alternate phone', emergencyname:'Emergency contact name', emergencyphone:'Emergency phone', doctorphone:'Doctor phone', vetphone:'Veterinarian phone', model:'Make & model', vehicleNumber:'Vehicle number', body:'Message', note:'Notes', menuitems:'Menu items', photoUrl:'Profile photo', petphotourl:'Pet photo', productimageurl:'Product image', rsvp:'RSVP', url:'URL', bio:'Bio', whatsapp:'WhatsApp', linkedin:'LinkedIn', youtube:'YouTube', twitter:'X / Twitter', wifi:'Wi-Fi', encryption:'Security type', manualurl:'Product manual', orderurl:'Order link', bookingurl:'Booking link', linkurl:'Link', ownername:'Owner name', purchaseDate:'Purchase date' };
  return special[k] || special[norm(k)] || k.replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase()).replace(/\bUrl\b/g,'URL').replace(/\bId\b/g,'ID');
}
function get(p: QRData, ...keys: string[]): unknown {
  for (const key of keys) {
    if (filled(p[key])) return p[key];
    const alias = Object.keys(p).find(k => norm(k) === norm(key) && filled(p[k]));
    if (alias) return p[alias];
  }
  return '';
}
function webUrl(v: unknown): string {
  const s = scalar(v); if (!s || /[\s\u0000-\u001f]/.test(s)) return '';
  try {
    const raw = s.startsWith('//') ? 'https:' + s : /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : 'https://' + s;
    const u = new URL(raw);
    return /^https?:$/.test(u.protocol) && u.hostname && !u.username && !u.password ? u.href : '';
  } catch { return ''; }
}
function tel(v: unknown) { const s=scalar(v); return /^[+\d().\s-]+$/.test(s) && /\d/.test(s) ? 'tel:'+s.replace(/[^+\d]/g,'') : ''; }
function mail(v: unknown) { const s=scalar(v); return /^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(s) ? 'mailto:'+encodeURIComponent(s).replace(/%40/g,'@') : ''; }
function whatsapp(v: unknown) { const s=scalar(v); if (/^https?:\/\//i.test(s)) { const u=webUrl(s); if (!u) return ''; const h=new URL(u).hostname; return ['wa.me','api.whatsapp.com','www.whatsapp.com','whatsapp.com'].includes(h) ? u : ''; } const digits=s.replace(/\D/g,''); return /^[+\d().\s-]+$/.test(s) && digits.length>=7 && digits.length<=15 ? 'https://wa.me/'+digits : ''; }
const SOCIAL: Record<string,string> = {instagram:'https://www.instagram.com/',youtube:'https://www.youtube.com/@',twitter:'https://x.com/',x:'https://x.com/',facebook:'https://www.facebook.com/',linkedin:'https://www.linkedin.com/in/',tiktok:'https://www.tiktok.com/@',telegram:'https://t.me/',github:'https://github.com/',snapchat:'https://www.snapchat.com/add/'};
function socialUrl(k:string,v:unknown) { const s=scalar(v); if (!s) return ''; if (/^https?:\/\//i.test(s) || /^[\w.-]+\.[a-z]{2,}\//i.test(s)) return webUrl(s); return SOCIAL[k]+encodeURIComponent(s.replace(/^@/,'')); }
function imageKey(k:string) { return /^(photo|image|avatar|logo|picture|petphoto|productimage|profilephoto|coverimage|profileimage|menuphoto|itemimage|thumbnail)(url)?$/.test(norm(k)); }
function linkFor(k:string,v:unknown):string {
  const n=norm(k);
  if (n==='whatsapp'||n==='whatsappnumber') return whatsapp(v);
  if (/phone$|phonenumber$|^mobile$|^contactnumber$|^rsvp$/.test(n)) return tel(v);
  if (n.endsWith('email')) return mail(v);
  if (Object.prototype.hasOwnProperty.call(SOCIAL,n)) return socialUrl(n,v);
  if (imageKey(k)||/url$|website$|^link$|^links$|^portfolio$|^manual$/.test(n)||/^https?:\/\//i.test(scalar(v))) return webUrl(v);
  return '';
}
function external(href:string) { return /^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : ''; }
function textLink(v:unknown,href:string) { return href ? `<a href="${esc(href)}"${external(href)}>${esc(v)} ${/^https?:/.test(href)?icon('arrow'):''}</a>` : esc(v); }
function renderValue(k:string,v:unknown,depth=0):string {
  if (depth>15) return `<pre>${esc(JSON.stringify(v,null,2))}</pre>`;
  if (Array.isArray(v)) return `<div class="array">${v.filter(filled).map((item,i)=>`<div class="array-item">${typeof item==='object'&&item!==null?`<span class="array-index">${i+1}</span>`:''}${renderValue(k,item,depth+1)}</div>`).join('')}</div>`;
  if (v && typeof v==='object') return `<dl class="nested">${Object.entries(v as QRData).filter(([,val])=>filled(val)).map(([key,val])=>`<div><dt>${esc(label(key))}</dt><dd>${renderValue(key,val,depth+1)}</dd></div>`).join('')}</dl>`;
  if (typeof v==='boolean') return v?'Yes':'No';
  const href=linkFor(k,v);
  if (imageKey(k)&&href) return `<a class="inline-image" href="${esc(href)}"${external(href)}><img src="${esc(href)}" alt="${esc(label(k))}" loading="lazy" decoding="async" referrerpolicy="no-referrer"/><span>View ${esc(label(k).toLowerCase())} ${icon('arrow')}</span></a>`;
  return textLink(v,href);
}
const CONTACT = ['phone','altPhone','mobile','email','whatsapp','whatsappNumber','website','address','location','googleMapsUrl','contactNumber','supportPhone','sellerPhone','vetPhone','doctorPhone'];
const GROUPS: Record<string, [string,string,string[]][]> = {
  personal:[['Profile','user',['name','company','designation','bio','photoUrl']],['Contact details','phone',CONTACT]],
  business:[['Business information','briefcase',['name','businessName','company','designation','department','industry','photoUrl','logoUrl']],['Contact details','phone',CONTACT]],
  medical:[['Medical information','heart',['name','bloodGroup','allergies','medicalConditions','conditions','medications','medicine','medicalHistory','doctorName','doctorPhone','hospital','insurance','dateOfBirth','age','photoUrl']],['Emergency contacts','phone',['emergencyName','emergencyPhone','emergencyContact','altPhone','phone','address','email']]],
  vehicle:[['Vehicle details','car',['vehicleNumber','model','make','brand','year','color','registrationNumber','vehicleType','insurance','photoUrl']],['Owner & contact','user',['name','ownerName','owner','phone','altPhone','emergencyName','emergencyPhone','emergencyContact','email','address']]],
  pet_id:[['Pet details','heart',['petName','name','species','breed','age','gender','color','microchip','bloodGroup','allergies','vaccinations','medicalConditions','petPhotoUrl','photoUrl']],['Owner & veterinarian','phone',['ownerName','owner','phone','altPhone','vetName','vetPhone','email','address','emergencyPhone']]],
  hotel_menu:[['About the venue','menu',['name','businessName','company','description','hours','cuisine','photoUrl','logoUrl']],['Contact & location','map',[...CONTACT,'orderUrl','bookingUrl']]],
  restaurant:[['About the restaurant','menu',['name','businessName','company','description','hours','cuisine','photoUrl','logoUrl']],['Contact & ordering','phone',[...CONTACT,'orderUrl','bookingUrl']]],
  product:[['Product details','box',['productName','name','brand','sku','price','currency','description','warranty','purchaseDate','serialNumber','model','category','productImageUrl','photoUrl']],['Support & purchase','phone',['manualUrl','sellerPhone','supportPhone','orderUrl',...CONTACT]]],
  resume:[['Professional profile','briefcase',['name','title','designation','company','summary','bio','skills','experience','education','certifications','projects','photoUrl']],['Contact & portfolio','link',[...CONTACT,'linkedin','github','portfolio','resumeUrl','linkUrl']]],
  appointment:[['Service information','calendar',['name','businessName','serviceType','description','hours','date','time','duration','price','bookingUrl']],['Contact details','phone',CONTACT]],
  social:[['About','user',['name','bio','company','designation','photoUrl']],['Social links','link',[...Object.keys(SOCIAL),'linkUrl',...CONTACT]]],
  wifi:[['Network information','wifi',['ssid','password','encryption','hidden','networkName']],['Contact details','phone',CONTACT]],
  upi_payment:[['Payment information','wallet',['upiId','name','businessName','amount','currency','transactionNote']],['Contact details','phone',CONTACT]],
  local_shop:[['Shop information','bag',['name','businessName','owner','ownerName','hours','products','description','photoUrl','logoUrl']],['Contact & location','map',[...CONTACT,'orderUrl']]],
  family_tree:[['Family information','users',['name','title','members','familyName','photoUrl','description']],['Contact details','phone',CONTACT]],
  event:[['Event information','calendar',['name','title','date','time','endDate','endTime','location','venue','host','description','photoUrl']],['RSVP & directions','map',['rsvp','phone','altPhone','email','address','googleMapsUrl','bookingUrl','linkUrl']]],
  custom:[['Information','file',['name','title','body','description','photoUrl','linkUrl']],['Contact details','phone',CONTACT]],
};
function privateKey(k:string,type:string) {
  // Do not render obvious internal credentials or ownership metadata in a public card.
  const n=norm(k);
  return ['id','userid','ownerid','accountid','qrid','fcmToken'.toLowerCase(),'accesstoken','refreshtoken','authtoken','apikey','servicerolekey','secretkey','privatekey','passwordhash','createdat','updatedat','scancount','lastscannedat'].includes(n) || (n==='password'&&type!=='wifi');
}
function section(title:string,ic:string,body:string,extra='') {
  return body ? `<section class="panel ${extra}"><header class="panel-head"><span class="panel-icon">${icon(ic)}</span><h2>${esc(title)}</h2></header>${body}</section>` : '';
}
function field(k:string,v:unknown) { const n=norm(k); const copy=['password','ssid','upiid'].includes(n)&&scalar(v); return `<div class="field ${typeof v==='object'||imageKey(k)||scalar(v).length>100?'wide':''}"><dt>${esc(label(k))}</dt><dd>${renderValue(k,v)}${copy?`<button type="button" class="copy" data-copy="${esc(scalar(v))}" aria-label="Copy ${esc(label(k))}">${icon('copy')} Copy</button>`:''}</dd></div>`; }
function entries(p:QRData,type:string):Entry[] {
  const seen=new Map<string,string[]>();
  return Object.entries(p).filter(([k,v])=>{
    if (!filled(v)||privateKey(k,type)) return false;
    const key=norm(k), sig=JSON.stringify(v); const values=seen.get(key)||[];
    if(values.includes(sig)) return false; seen.set(key,[...values,sig]); return true;
  });
}
function details(p:QRData,type:string) {
  const all=entries(p,type), used=new Set<string>();
  const pick=(keys:string[])=>all.filter(([k])=>keys.some(key=>norm(key)===norm(k))&&!used.has(k)).sort(([a],[b])=>keys.findIndex(k=>norm(k)===norm(a))-keys.findIndex(k=>norm(k)===norm(b)));
  const fields=(items:Entry[])=>{items.forEach(([k])=>used.add(k)); return items.length?`<dl class="fields">${items.map(([k,v])=>field(k,v)).join('')}</dl>`:'';};
  let html='';
  // Menu data is rendered for every QR type, if provided.
  const menus=pick(['menuItems']);
  for (const [k,v] of menus) { used.add(k); html+=menuSection(v); }
  for (const [title,ic,keys] of (GROUPS[type]||GROUPS.personal)) html+=section(title,ic,fields(pick(keys)),type==='medical'&&title==='Emergency contacts'?'urgent':'');
  const notes=pick(['note','notes','instructions']);
  html+=section('Notes & instructions','file',fields(notes));
  html+=section('Additional information','info',fields(all.filter(([k])=>!used.has(k))));
  return html||`<section class="panel empty">${icon('info')}<h2>No additional details yet</h2><p>The owner has not added information to this QR card.</p></section>`;
}
function menuSection(v:unknown) {
  if(!Array.isArray(v)) return section('Menu','menu',`<div class="menu-other">${renderValue('menuItems',v)}</div>`);
  const items=v.filter(filled);
  return section('Menu · '+items.length+' '+(items.length===1?'item':'items'),'menu',`<div class="menu-grid">${items.map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item)) return `<article class="menu-card"><div class="menu-body">${renderValue('item',item)}</div></article>`;
    const p=item as QRData, name=scalar(get(p,'name','title'))||'Menu item', price=get(p,'price'), img=webUrl(get(p,'image','imageUrl','photoUrl','photo','productImageUrl'));
    const rest=Object.entries(p).filter(([k,val])=>filled(val)&&!(['name','title'].includes(norm(k))&&scalar(val)===name)&&!(norm(k)==='price'&&val===price)&&!(imageKey(k)&&webUrl(val)===img));
    return `<article class="menu-card"><div class="menu-photo">${img?`<a href="${esc(img)}"${external(img)}><img src="${esc(img)}" alt="${esc(name)}" loading="lazy" referrerpolicy="no-referrer"/></a>`:icon('menu')}</div><div class="menu-body"><h3>${esc(name)}</h3>${filled(price)?`<div class="price">${renderValue('price',price)}</div>`:''}${rest.length?`<dl class="nested">${rest.map(([k,val])=>`<div><dt>${esc(label(k))}</dt><dd>${renderValue(k,val)}</dd></div>`).join('')}</dl>`:''}</div></article>`;
  }).join('')}</div>`,'menu-panel');
}
function vcard(p:QRData,name:string) {
  const clean=(v:unknown)=>scalar(v).replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
  const rows=['BEGIN:VCARD','VERSION:3.0','FN:'+clean(name),'N:'+clean(name)+';;;;'];
  for (const [key,v] of [['ORG',get(p,'company','businessName')],['TITLE',get(p,'designation')],['TEL;TYPE=CELL',get(p,'phone')],['TEL;TYPE=VOICE',get(p,'altPhone')],['EMAIL',get(p,'email')],['URL',webUrl(get(p,'website'))],['NOTE',get(p,'note')]] as Entry[]) if(scalar(v)) rows.push(key+':'+clean(v));
  if(scalar(get(p,'address'))) rows.push('ADR;TYPE=WORK:;;'+clean(get(p,'address'))+';;;;');
  rows.push('END:VCARD'); return 'data:text/vcard;charset=utf-8,'+encodeURIComponent(rows.join('\r\n')+'\r\n');
}
function actions(p:QRData,type:string,name:string) {
  const items:string[]=[]; const seen=new Set<string>();
  const add=(title:string,ic:string,href:string,download=false,urgent=false)=>{if(!href||seen.has(href))return; seen.add(href);items.push(`<a class="action ${items.length===0?'primary':''} ${urgent?'emergency':''}" href="${esc(href)}"${external(href)}${download?' download="'+esc(name.replace(/[^\p{L}\p{N}_.-]+/gu,'_')||'contact')+'.vcf"':''}>${icon(ic)}<span>${esc(title)}</span>${icon('arrow')}</a>`);};
  if(type==='medical') add('Call emergency contact','phone',tel(get(p,'emergencyPhone')),false,true);
  if(type==='restaurant'||type==='hotel_menu'||type==='local_shop') add('Order online','bag',webUrl(get(p,'orderUrl')));
  if(type==='appointment') add('Book appointment','calendar',webUrl(get(p,'bookingUrl')));
  if(type==='upi_payment') { const id=scalar(get(p,'upiId')), amount=scalar(get(p,'amount')); if(/^[\w.\-]+@[\w.\-]+$/.test(id)){const params=new URLSearchParams({pa:id,pn:scalar(get(p,'name','businessName'))||name,cu:'INR'}); if(/^\d+(\.\d{1,2})?$/.test(amount)&&Number(amount)>0)params.set('am',amount); add('Open UPI app','wallet','upi://pay?'+params.toString());} }
  add(type==='pet_id'||type==='vehicle'?'Call owner':type==='restaurant'?'Call to order':'Call','phone',tel(get(p,'phone','mobile','contactNumber')));
  add('WhatsApp','chat',whatsapp(get(p,'whatsapp','whatsappNumber')));
  add('Email','mail',mail(get(p,'email')));
  if(['personal','business','resume'].includes(type)) add('Save contact','download',vcard(p,name),true);
  add('Get directions','map',webUrl(get(p,'googleMapsUrl')));
  add('Visit website','link',webUrl(get(p,'website')));
  add('Open link','link',webUrl(get(p,'linkUrl')));
  add('Book now','calendar',webUrl(get(p,'bookingUrl')));
  add('Order online','bag',webUrl(get(p,'orderUrl')));
  add('Product manual','file',webUrl(get(p,'manualUrl')));
  if(type==='pet_id') add('Call veterinarian','phone',tel(get(p,'vetPhone')));
  if(type==='medical') add('Call doctor','phone',tel(get(p,'doctorPhone')));
  if(type==='product') {add('Call support','phone',tel(get(p,'supportPhone')));add('Call seller','phone',tel(get(p,'sellerPhone')));}
  if(type==='social') for(const k of Object.keys(SOCIAL)) if(filled(get(p,k)))add(label(k),'link',socialUrl(k,get(p,k)));
  return items.length?`<div class="quick"><h2>Quick actions</h2><div class="actions">${items.join('')}</div></div>`:'';
}
function displayName(p:QRData,type:string,title:string) {
  const priority:Record<string,string[]>={pet_id:['petName','name','ownerName'], product:['productName','name'], vehicle:['vehicleNumber','name','ownerName'], wifi:['ssid','networkName','name'], hotel_menu:['businessName','name','company'], restaurant:['businessName','name','company'], local_shop:['businessName','name','company','owner'], appointment:['businessName','name','serviceType'], family_tree:['familyName','name','title'], event:['name','title'], custom:['title','name']};
  return scalar(get(p,...(priority[type]||['name','businessName','title','company'])))||scalar(title)||'QR profile';
}
function head(title:string,accent:string) {return `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/><meta name="theme-color" content="${accent}"/><meta name="referrer" content="no-referrer"/><title>${esc(title)} | TapCard</title><link rel="icon" href="/logo.png"/><link rel="apple-touch-icon" href="/logo.png"/><style>${VIEWER_CSS}</style></head>`;}
function brand(){return `<div class="brand"><span class="brand-mark"><img src="/logo.png" alt="" width="32" height="32"/><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 7h8v8H7zM17 7h8v8h-8zM7 17h8v8H7zM18 18h3v3h-3zM23 23h3v3h-3z" fill="none" stroke="currentColor" stroke-width="2"/></svg></span><span>TapCard<span class="brand-sub">Digital QR viewer</span></span></div>`;}
function buildViewerHTML(payload: QRPayload) {
  const type=Object.prototype.hasOwnProperty.call(THEMES,payload.type)?payload.type:'custom', p=payload.data||{};
  const [typeName,accent,tint,ic]=THEMES[type], name=displayName(p,type,payload.title);
  const subtitle=scalar(get(p,'company','designation','serviceType','breed','brand','location','address'));
  const photo=webUrl(get(p,...(type==='pet_id'?['petPhotoUrl','photoUrl']:type==='product'?['productImageUrl','photoUrl']:['photoUrl','profilePhotoUrl','logoUrl','imageUrl'])));
  const initial=name.split(/\s+/).slice(0,2).map(w=>Array.from(w)[0]||'').join('').toUpperCase();
  const feature=type==='medical'?get(p,'bloodGroup'):type==='upi_payment'?get(p,'amount'):type==='vehicle'?get(p,'vehicleNumber'):'';
  const hasFeature=filled(feature); const featureLabel=type==='medical'?'Blood group':type==='vehicle'?'Vehicle number':'Amount';
  const featureText=type==='upi_payment'?'₹ '+scalar(feature):scalar(feature);
  return `${head(name,accent)}<body style="--accent:${accent};--tint:${tint}"><div class="shell"><header class="topbar">${brand()}<button type="button" class="share" id="share">${icon('share')}<span>Share card</span></button></header><main class="layout"><section class="profile" aria-label="QR card overview"><div class="hero"><div class="cover-art" aria-hidden="true"><span></span><span></span><span></span></div><div class="hero-top"><span class="type">${icon(ic)} ${esc(typeName)}</span><span class="hero-mark">TAPCARD / DIGITAL CARD</span></div><div class="identity"><div class="portrait"><span>${['personal','business','resume','social'].includes(type)?esc(initial):icon(ic)}</span>${photo?`<img src="${esc(photo)}" alt="${esc(name)}" referrerpolicy="no-referrer"/>`:''}</div><div class="identity-text"><h1>${esc(name)}</h1>${subtitle&&subtitle!==name?`<p class="subtitle">${esc(subtitle)}</p>`:''}${payload.title&&payload.title!==name&&payload.title!==typeName?`<p class="card-title">${esc(payload.title)}</p>`:''}</div>${hasFeature?`<div class="feature"><span>${esc(featureLabel)}</span><strong>${esc(featureText)}</strong></div>`:''}</div></div>${actions(p,type,name)}${type==='upi_payment'?'<div class="hint">Confirm the payee and amount in your UPI app before paying. You can also copy the UPI ID.</div>':''}</section><div class="content"><div class="content-title"><div><span class="eyebrow">THE DETAILS</span><h2>Explore this card</h2></div><p>Information shared by the card owner.</p></div>${details(p,type)}</div></main><footer class="footer"><span>Powered by <strong>TapCard</strong></span><span class="footer-version">STUDIO EDITION · V3</span></footer></div><div id="status" class="toast" role="status" aria-live="polite"></div><script>${VIEWER_SCRIPT}</script></body></html>`;
}
function html404(title:string,message:string,status=404) {return {statusCode:status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'},body:`${head(title,'#4338ca')}<body><div class="shell"><header class="topbar">${brand()}</header><main class="not-found"><span class="panel-icon">${icon('info')}</span><h1>${esc(title)}</h1><p>${esc(message)}</p></main><footer class="footer">Powered by TapCard</footer></div></body></html>`};}

const VIEWER_CSS = `
*{box-sizing:border-box}html{min-width:0}body{margin:0;min-height:100vh;background:#f5f4ef;color:#182321;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:15px;line-height:1.55;--accent:#4338ca;--tint:#eef2ff;-webkit-font-smoothing:antialiased}h1,h2,h3,p,dl,dd{margin:0}a{color:var(--accent);text-decoration:none}button{font:inherit;cursor:pointer}svg{width:22px;height:22px;flex-shrink:0;vertical-align:middle}a:focus-visible,button:focus-visible{outline:3px solid #729cf6;outline-offset:3px}img{display:block;max-width:100%}.shell{max-width:1200px;margin:0 auto;padding:0 38px}.topbar{min-height:90px;display:flex;align-items:center;justify-content:space-between;gap:14px}.brand{display:flex;align-items:center;gap:11px;font-size:24px;letter-spacing:-1.4px;font-weight:850;line-height:1.1;color:#182321}.brand-mark{height:42px;width:42px;display:grid;place-items:center;background:#192d2b;color:#e8ffba;border-radius:14px;position:relative;overflow:hidden}.brand-mark img,.brand-mark svg{grid-area:1/1;width:28px;height:28px;object-fit:contain}.brand-mark img{z-index:1;background:#fff;border-radius:6px}.brand-sub{display:block;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#66716c;font-weight:650;margin-top:5px}.share{display:flex;align-items:center;gap:9px;border:1px solid #d7dcd3;background:#fff;color:#263b35;border-radius:99px;padding:11px 19px;font-weight:700;font-size:13px;min-height:46px}.share svg{width:18px;height:18px}.layout{display:grid;gap:38px;padding:6px 0 36px;min-width:0}.profile{min-width:0;background:#fff;border-radius:30px;box-shadow:0 14px 36px #182d2310;overflow:hidden;border:1px solid #dfe3db}.hero{position:relative;isolation:isolate;overflow:hidden;padding:30px 38px 42px;min-height:276px;background:#172826;background:linear-gradient(112deg,#132421 0%,#203934 52%,var(--accent) 150%);color:#fff}.cover-art{position:absolute;inset:0;z-index:-1;overflow:hidden;pointer-events:none}.cover-art span{position:absolute;border:1px solid #ffffff27;border-radius:50%;width:530px;height:530px;right:-123px;top:-200px}.cover-art span:nth-child(2){width:410px;height:410px;right:-63px;top:-140px}.cover-art span:nth-child(3){width:290px;height:290px;right:-3px;top:-80px;background:radial-gradient(circle at 70% 70%,#ffffff13,transparent 65%)}.hero-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:36px}.type{display:inline-flex;align-items:center;gap:8px;border-radius:100px;padding:8px 14px;background:#e9ffc5;color:#274035;font-size:11px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;max-width:100%;overflow-wrap:anywhere}.type svg{width:16px;height:16px}.hero-mark{font-size:10px;color:#c1d4cb;font-weight:700;letter-spacing:2px;text-align:right}.identity{display:flex;align-items:center;gap:27px;min-width:0}.portrait{flex:none;position:relative;display:grid;place-items:center;width:132px;height:132px;border:5px solid #ffffffd9;background:var(--tint);color:var(--accent);border-radius:36px;font-size:47px;font-weight:800;letter-spacing:-2px;overflow:hidden;box-shadow:0 14px 30px #0003}.portrait>span,.portrait>img{grid-area:1/1}.portrait>span svg{width:49px;height:49px}.portrait img{width:100%;height:100%;object-fit:cover;z-index:1}.identity-text{min-width:0;flex:1}.hero h1{font-size:clamp(32px,5vw,56px);font-weight:780;letter-spacing:-.045em;line-height:1.05;overflow-wrap:anywhere}.subtitle{color:#d9e8df;font-size:17px;line-height:1.5;margin-top:13px;white-space:pre-wrap;overflow-wrap:anywhere}.card-title{color:#b4c8bd;font-size:12px;letter-spacing:.5px;margin-top:9px;overflow-wrap:anywhere}.feature{border:1px solid #ffffff45;border-radius:18px;background:#ffffff12;padding:17px 22px;max-width:230px;min-width:125px;flex-shrink:0}.feature span{display:block;color:#d8e3dd;text-transform:uppercase;font-size:10px;font-weight:750;letter-spacing:1px}.feature strong{display:block;font-size:28px;color:#e9ffc5;font-weight:850;line-height:1.2;margin-top:6px;overflow-wrap:anywhere}.quick{padding:23px 30px 26px}.quick h2{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1.7px;color:#64736b;margin:0 0 13px}.actions{display:flex;flex-wrap:wrap;gap:10px}.action{min-width:0;max-width:100%;display:flex;align-items:center;gap:9px;padding:12px 17px;min-height:49px;border:1px solid #dbe2d9;background:#fff;border-radius:13px;color:#243a30;font-size:13px;line-height:1.3;font-weight:700;transition:transform .16s,background .16s}.action svg{width:19px;height:19px;color:var(--accent)}.action span{min-width:0;overflow-wrap:anywhere}.action svg:last-child{width:13px;height:13px;color:#6c7a73;margin-left:4px}.action.primary{background:#e9ffc5;color:#193228;border-color:#cce6a5}.action.primary svg{color:#193228}.action.emergency{background:#b42335;color:white;border-color:#b42335}.action.emergency svg{color:white}.hint{margin:0 30px 24px;padding:13px 16px;background:var(--tint);border-radius:12px;color:var(--accent);font-size:13px}.content{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:18px;min-width:0}.content-title{grid-column:1/-1;display:flex;align-items:end;justify-content:space-between;gap:15px;padding:0 2px 4px}.eyebrow{font-size:10px;font-weight:850;letter-spacing:2.1px;color:#597161}.content-title h2{font-size:32px;font-weight:780;letter-spacing:-1.3px;line-height:1.25;margin:4px 0 0}.content-title p{font-size:13px;color:#66716a;padding-bottom:4px}.panel{background:#fff;border-radius:22px;border:1px solid #dfe3db;overflow:hidden;min-width:0;box-shadow:0 5px 14px #25402b05}.panel-head{display:flex;align-items:center;gap:11px;padding:19px 21px;border-bottom:1px solid #edf0eb}.panel-icon{display:grid;place-items:center;background:var(--tint);color:var(--accent);width:39px;height:39px;border-radius:12px;flex-shrink:0}.panel-icon svg{width:20px;height:20px}.panel-head h2{font-size:17px;font-weight:750;letter-spacing:-.45px;overflow-wrap:anywhere}.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));padding:16px;gap:9px}.field{padding:13px 14px;border:1px solid #e9ede7;background:#f7f9f6;border-radius:13px;min-width:0}.field.wide{grid-column:1/-1}.field dt,.nested dt{color:#5d6e62;font-weight:750;font-size:11px;letter-spacing:.3px;margin-bottom:5px;overflow-wrap:anywhere}.field dd{font-size:14px;font-weight:600;white-space:pre-wrap;overflow-wrap:anywhere;min-width:0;line-height:1.6}.field dd a,.nested dd a{color:var(--accent);text-decoration:underline;text-decoration-color:#b8c3d8;text-underline-offset:3px;overflow-wrap:anywhere}.field dd a svg,.nested dd a svg{width:13px;height:13px;opacity:.8}.urgent{border-color:#efbfc8}.urgent .panel-head{background:#fff4f5}.urgent .field{background:#fff9f9;border-color:#f4dbde}.nested{display:grid;gap:9px;min-width:0;white-space:normal}.nested>div{min-width:0}.nested dd{font-size:13px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}.array{display:grid;gap:8px;white-space:normal}.array-item{background:#fff;border:1px solid #e3e9e0;padding:11px;border-radius:9px;min-width:0;overflow-wrap:anywhere}.array-index{display:block;color:var(--accent);font-weight:800;font-size:11px;margin-bottom:5px}.copy{display:inline-flex;align-items:center;gap:5px;background:var(--tint);color:var(--accent);border:0;border-radius:8px;padding:8px 10px;margin:6px 0 0 8px;font-size:12px;font-weight:750;min-height:36px;vertical-align:middle}.copy svg{width:14px;height:14px}.inline-image{display:flex;flex-direction:column;gap:7px;width:fit-content;max-width:100%;text-decoration:none!important}.inline-image img{max-width:100%;max-height:320px;object-fit:contain;border-radius:12px;background:#fff;border:1px solid #e6eae4}.inline-image span{font-size:12px}.menu-panel{grid-column:1/-1}.menu-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;padding:19px}.menu-card{border:1px solid #e2e6de;border-radius:17px;overflow:hidden;min-width:0;background:#fff}.menu-photo{aspect-ratio:16/10;display:grid;place-items:center;background:var(--tint);color:var(--accent);overflow:hidden}.menu-photo>svg{width:40px;height:40px;opacity:.6}.menu-photo a{display:block;width:100%;height:100%;min-height:0}.menu-photo img{width:100%;height:100%;object-fit:cover}.menu-body{padding:16px;display:grid;gap:10px;min-width:0;overflow-wrap:anywhere}.menu-body h3{font-size:17px;font-weight:750;line-height:1.4}.price{font-size:21px;line-height:1.4;font-weight:850;color:var(--accent)}.menu-other{padding:20px}.empty{grid-column:1/-1;padding:26px;color:#64748b}.empty h2{font-size:17px;color:#26334a;margin:8px 0}.footer{display:flex;align-items:center;justify-content:space-between;border-top:1px solid #dce1d7;padding:21px 0 max(24px,env(safe-area-inset-bottom));font-size:12px;color:#66736a;gap:10px}.footer strong{color:#243b31}.footer-version{letter-spacing:1.1px;font-weight:700;font-size:10px}.toast{position:fixed;bottom:24px;left:50%;transform:translate(-50%,16px);background:#192d2b;color:#fff;padding:12px 18px;border-radius:11px;font-size:13px;box-shadow:0 4px 20px #17243b30;opacity:0;pointer-events:none;transition:.2s;z-index:5;max-width:calc(100% - 24px);text-align:center}.toast.show{opacity:1;transform:translate(-50%,0)}.not-found{text-align:center;background:#fff;border:1px solid #dfe3db;padding:50px 20px;margin:40px auto;border-radius:24px;max-width:480px}.not-found .panel-icon{margin:0 auto 18px;width:50px;height:50px}.not-found h1{font-size:27px;margin-bottom:8px}.not-found p{color:#667287}.broken-image{display:none!important}
@media(hover:hover){.action:hover,.share:hover{background:var(--tint);border-color:var(--accent);transform:translateY(-2px)}.action.emergency:hover{background:#991b2b;color:#fff}.action.primary:hover{background:#daf6ae}}
@media(max-width:900px){.shell{padding:0 24px}.hero{padding:26px 28px 34px}.quick{padding:20px 24px}.fields{grid-template-columns:1fr}.menu-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.identity{gap:20px}.feature{max-width:170px}.portrait{width:112px;height:112px;border-radius:29px}}
@media(max-width:650px){.shell{padding:0 max(14px,env(safe-area-inset-left)) 0 max(14px,env(safe-area-inset-right));max-width:540px}.topbar{min-height:74px}.brand{font-size:21px}.brand-mark{width:37px;height:37px;border-radius:11px}.brand-sub{font-size:9px}.share{padding:9px 12px;font-size:12px;min-height:42px}.layout{gap:26px;padding-top:4px}.profile{border-radius:23px}.hero{padding:22px 20px 27px;min-height:0}.hero-top{margin-bottom:24px}.hero-mark{display:none}.identity{flex-wrap:wrap;align-items:flex-start;gap:14px}.portrait{width:92px;height:92px;border-radius:24px;font-size:33px;border-width:3px}.portrait>span svg{width:36px;height:36px}.identity-text{flex:1 1 100%}.hero h1{font-size:35px}.subtitle{font-size:15px;margin-top:8px}.feature{max-width:100%;width:100%}.feature strong{font-size:24px}.quick{padding:19px 16px}.actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.action{padding:11px 10px;font-size:12px;min-height:48px}.action svg:last-child{display:none}.action.primary,.action.emergency{grid-column:1/-1;justify-content:center}.content{grid-template-columns:minmax(0,1fr);gap:14px}.content-title{align-items:start;flex-direction:column;gap:5px}.content-title h2{font-size:27px}.panel-head{padding:15px 16px}.fields{grid-template-columns:repeat(2,minmax(0,1fr));padding:13px;gap:8px}.field{padding:12px}.panel{border-radius:18px}.menu-grid{grid-template-columns:repeat(2,minmax(0,1fr));padding:13px;gap:10px}.hint{margin:0 16px 18px}.footer{flex-wrap:wrap}.cover-art span{right:-310px;top:-180px}.cover-art span:nth-child(2){right:-250px;top:-120px}.cover-art span:nth-child(3){right:-190px;top:-60px}}
@media(max-width:380px){.shell{padding-left:10px;padding-right:10px}.fields,.menu-grid{grid-template-columns:minmax(0,1fr)}.hero h1{font-size:30px}.share{gap:5px}.brand-sub{letter-spacing:.5px}.actions{grid-template-columns:minmax(0,1fr)}.action{justify-content:center}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important;scroll-behavior:auto!important}}
@media print{body{background:white}.shell{padding:0}.topbar{min-height:56px}.layout,.content{display:block}.profile,.panel{margin-bottom:16px}.hero{background:white;color:#172826;padding:20px}.subtitle,.card-title{color:#34493e}.feature strong,.feature span{color:#172826}.share,.quick,.copy,.toast,.cover-art{display:none!important}.panel,.menu-card{break-inside:avoid;box-shadow:none}}

`;
const VIEWER_SCRIPT = `
(function(){
  function hideBroken(img){img.classList.add('broken-image');}
  document.querySelectorAll('img').forEach(function(img){img.addEventListener('error',function(){hideBroken(img);});if(img.complete&&!img.naturalWidth)hideBroken(img);});
  var status=document.getElementById('status'),timer;
  function notify(text){if(!status)return;status.textContent=text;status.classList.add('show');clearTimeout(timer);timer=setTimeout(function(){status.classList.remove('show');},2300);}
  async function copy(text){try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(text);}else{var input=document.createElement('textarea');input.value=text;input.style.position='fixed';input.style.opacity='0';document.body.appendChild(input);input.select();var ok=document.execCommand('copy');input.remove();if(!ok)throw Error('copy');}notify('Copied to clipboard');}catch(e){window.prompt('Copy this text:',text);}}
  document.querySelectorAll('[data-copy]').forEach(function(btn){btn.addEventListener('click',function(){copy(btn.dataset.copy);});});
  var share=document.getElementById('share');if(share)share.addEventListener('click',async function(){try{if(navigator.share){await navigator.share({title:document.title,url:location.href});}else{await copy(location.href);}}catch(e){if(e.name!=='AbortError')await copy(location.href);}});
})();
`;
