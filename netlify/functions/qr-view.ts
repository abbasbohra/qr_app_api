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
  return `${head(name,accent)}<body style="--accent:${accent};--tint:${tint}"><div class="shell"><header class="topbar">${brand()}<button type="button" class="share" id="share">${icon('share')}<span>Share</span></button></header><main class="layout"><aside class="profile"><div class="hero"><div class="hero-top"><span class="type">${icon(ic)} ${esc(typeName)}</span><span class="hero-mark" aria-hidden="true">${icon(ic)}</span></div><div class="portrait"><span>${['personal','business','resume','social'].includes(type)?esc(initial):icon(ic)}</span>${photo?`<img src="${esc(photo)}" alt="${esc(name)}" referrerpolicy="no-referrer"/>`:''}</div><h1>${esc(name)}</h1>${subtitle&&subtitle!==name?`<p class="subtitle">${esc(subtitle)}</p>`:''}${payload.title&&payload.title!==name&&payload.title!==typeName?`<p class="card-title">${esc(payload.title)}</p>`:''}${hasFeature?`<div class="feature"><span>${esc(featureLabel)}</span><strong>${esc(featureText)}</strong></div>`:''}</div>${actions(p,type,name)}${type==='upi_payment'?'<div class="hint">Confirm the payee and amount in your UPI app before paying. You can also copy the UPI ID.</div>':''}</aside><div class="content"><div class="content-title"><span class="eyebrow">QR CARD DETAILS</span><h2>Information</h2><p>Contact details and information shared by the card owner.</p></div>${details(p,type)}</div></main><footer class="footer"><span>Powered by <strong>TapCard</strong></span><span>Digital information, made simple.</span></footer></div><div id="status" class="toast" role="status" aria-live="polite"></div><script>${VIEWER_SCRIPT}</script></body></html>`;
}
function html404(title:string,message:string) {return {statusCode:404,headers:{'Content-Type':'text/html; charset=utf-8'},body:`${head(title,'#4338ca')}<body><div class="shell"><header class="topbar">${brand()}</header><main class="not-found"><span class="panel-icon">${icon('info')}</span><h1>${esc(title)}</h1><p>${esc(message)}</p></main><footer class="footer">Powered by TapCard</footer></div></body></html>`};}

const VIEWER_CSS = `
*{box-sizing:border-box}html{min-width:0}body{margin:0;min-height:100vh;background:#f5f6fa;color:#182235;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:15px;line-height:1.55;--accent:#4338ca;--tint:#eef2ff;-webkit-font-smoothing:antialiased}a{color:var(--accent);text-decoration:none}button{font:inherit;cursor:pointer}button,a{-webkit-tap-highlight-color:transparent}a:focus-visible,button:focus-visible{outline:3px solid var(--accent);outline-offset:4px}svg{flex-shrink:0}h1,h2,h3,p,dl,dd{margin:0}img{max-width:100%;display:block}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:0}.shell{max-width:1180px;margin:auto;padding:0 32px}.topbar{min-height:88px;display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid #e1e5ee}.brand{display:flex;align-items:center;gap:11px;font-weight:850;font-size:19px;letter-spacing:-.6px;line-height:1.15}.brand-mark{position:relative;width:42px;height:42px;background:#fff;border:1px solid #e4e6ef;border-radius:13px;display:grid;place-items:center;color:#4338ca;overflow:hidden}.brand-mark svg{position:absolute;width:32px;height:32px;z-index:0}.brand-mark img{position:relative;z-index:1;background:#fff;object-fit:contain}.brand-sub{display:block;font-size:10px;letter-spacing:.35px;font-weight:600;color:#697386;margin-top:4px}.share{display:flex;align-items:center;gap:8px;border:1px solid #dce1e9;background:white;color:#29354a;border-radius:12px;padding:10px 16px;font-weight:700;font-size:13px;min-height:44px}.share svg{width:17px;height:17px}.layout{display:grid;grid-template-columns:minmax(0,350px) minmax(0,1fr);gap:28px;align-items:start;padding:35px 0 32px}.profile{background:#fff;border:1px solid #e2e6ee;border-radius:24px;overflow:hidden;box-shadow:0 10px 30px #17243b08;min-width:0}.hero{position:relative;padding:24px 25px 28px;background:linear-gradient(150deg,var(--tint),#fff 90%);overflow:hidden;border-bottom:1px solid #edf0f6}.hero::after{content:"";position:absolute;top:-96px;right:-83px;width:240px;height:240px;border:1px solid var(--accent);opacity:.10;border-radius:50%;box-shadow:0 0 0 26px var(--tint),0 0 0 27px var(--accent),0 0 0 51px var(--tint),0 0 0 52px var(--accent);pointer-events:none}.hero-top,.portrait,.hero h1,.subtitle,.card-title,.feature{position:relative;z-index:1}.hero-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:27px;gap:8px}.type{display:inline-flex;align-items:center;gap:6px;border-radius:9px;padding:7px 10px;background:#fff;color:var(--accent);font-size:11px;font-weight:800;letter-spacing:.2px;border:1px solid #ffffff;max-width:100%;overflow-wrap:anywhere}.type svg{width:15px;height:15px}.hero-mark{color:var(--accent);opacity:.55}.hero-mark svg{width:25px;height:25px}.portrait{width:104px;height:104px;background:var(--accent);color:white;border:5px solid #fff;border-radius:29px;display:grid;place-items:center;overflow:hidden;box-shadow:0 8px 20px #17243b16;margin-bottom:20px}.portrait span{font-size:31px;font-weight:800}.portrait span svg{width:46px;height:46px}.portrait img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:white}.hero h1{font-size:clamp(25px,3.2vw,34px);line-height:1.15;letter-spacing:-1.05px;font-weight:820;overflow-wrap:anywhere}.subtitle{color:#526079;font-size:14px;margin-top:9px;white-space:pre-wrap;overflow-wrap:anywhere}.card-title{color:#697386;font-size:12px;margin-top:8px;overflow-wrap:anywhere}.feature{display:flex;flex-direction:column;align-items:flex-start;gap:2px;background:#fff;border:1px solid #e3e7ef;padding:15px 17px;border-radius:13px;margin-top:20px}.feature span{font-size:11px;font-weight:750;text-transform:uppercase;letter-spacing:.55px;color:#606b7e}.feature strong{color:var(--accent);font-size:26px;font-weight:850;line-height:1.2;overflow-wrap:anywhere;max-width:100%}.quick{padding:23px 24px}.quick h2{font-size:12px;font-weight:750;letter-spacing:.2px;color:#657086;margin-bottom:13px}.actions{display:grid;grid-template-columns:minmax(0,1fr);gap:9px}.action{display:flex;align-items:center;gap:10px;min-height:49px;background:#fff;border:1px solid #e0e5ee;border-radius:12px;color:#26334a;padding:12px 13px;font-size:13px;font-weight:700;line-height:1.35;transition:background .16s,border-color .16s,transform .16s;min-width:0}.action svg{width:18px;height:18px;color:var(--accent)}.action span{flex:1;min-width:0;overflow-wrap:anywhere}.action svg:last-child{width:15px;height:15px;opacity:.65}.action.primary,.action.emergency{background:var(--accent);color:#fff;border-color:var(--accent)}.action.primary svg,.action.emergency svg{color:#fff}.hint{margin:0 24px 24px;padding:13px;background:var(--tint);color:var(--accent);border-radius:12px;font-size:12px;font-weight:650}.content{display:grid;gap:16px;min-width:0}.content-title{padding:0 2px 4px}.eyebrow{font-size:10px;font-weight:800;letter-spacing:1.25px;color:var(--accent)}.content-title h2{font-size:29px;font-weight:820;letter-spacing:-.8px;line-height:1.25;margin:3px 0 5px}.content-title p{font-size:13px;color:#667287}.panel{background:white;border:1px solid #e1e6ee;border-radius:19px;overflow:hidden;min-width:0;box-shadow:0 4px 14px #17243b05}.panel-head{display:flex;align-items:center;gap:11px;padding:19px 21px;border-bottom:1px solid #edf0f5}.panel-icon{display:grid;place-items:center;background:var(--tint);color:var(--accent);width:35px;height:35px;border-radius:10px;flex-shrink:0}.panel-icon svg{width:19px;height:19px}.panel-head h2{font-size:16px;font-weight:750;letter-spacing:-.25px;overflow-wrap:anywhere}.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));padding:4px 21px 9px;column-gap:22px}.field{padding:16px 0;border-bottom:1px solid #eef1f6;min-width:0}.field.wide{grid-column:1/-1}.field:last-child{border-bottom:0}.field dt,.nested dt{color:#617087;font-weight:700;font-size:11px;letter-spacing:.12px;margin-bottom:5px;overflow-wrap:anywhere}.field dd{font-size:14px;font-weight:600;white-space:pre-wrap;overflow-wrap:anywhere;min-width:0;line-height:1.6}.field dd a,.nested dd a{color:var(--accent);text-decoration:underline;text-decoration-color:#b8c3d8;text-underline-offset:3px;overflow-wrap:anywhere}.field dd a svg,.nested dd a svg{display:inline-block;width:13px;height:13px;vertical-align:middle;opacity:.8}.urgent{border-color:#f1c0c8}.urgent .panel-head{background:#fff9fa}.nested{display:grid;gap:9px;min-width:0;white-space:normal}.nested>div{min-width:0}.nested dd{font-size:13px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}.array{display:grid;gap:8px;white-space:normal}.array-item{background:#f7f8fb;border:1px solid #edf0f5;padding:11px;border-radius:9px;min-width:0;overflow-wrap:anywhere}.array-index{display:block;color:var(--accent);font-weight:800;font-size:11px;margin-bottom:5px}.copy{display:inline-flex;align-items:center;gap:4px;background:var(--tint);color:var(--accent);border:0;border-radius:7px;padding:7px 9px;margin:6px 0 0 8px;font-size:11px;font-weight:750;min-height:33px;vertical-align:middle}.copy svg{width:13px;height:13px}.inline-image{display:flex;flex-direction:column;gap:7px;width:fit-content;max-width:100%;text-decoration:none!important}.inline-image img{max-width:100%;max-height:260px;object-fit:contain;border-radius:12px;background:#f3f5f9;border:1px solid #e6eaf1}.inline-image span{font-size:12px}.menu-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;padding:18px}.menu-card{border:1px solid #e4e8ef;border-radius:15px;overflow:hidden;min-width:0;background:white}.menu-photo{aspect-ratio:16/10;display:grid;place-items:center;background:var(--tint);color:var(--accent);overflow:hidden}.menu-photo>svg{width:36px;height:36px;opacity:.6}.menu-photo a{display:block;width:100%;height:100%;min-height:0}.menu-photo img{width:100%;height:100%;object-fit:cover}.menu-body{padding:15px;display:grid;gap:9px;min-width:0;overflow-wrap:anywhere}.menu-body h3{font-size:16px;font-weight:750;line-height:1.4}.price{font-size:17px;line-height:1.4;font-weight:850;color:var(--accent)}.menu-other{padding:20px}.empty{padding:26px;color:#64748b}.empty h2{font-size:17px;color:#26334a;margin:8px 0}.footer{display:flex;align-items:center;justify-content:space-between;border-top:1px solid #e1e5ee;padding:21px 0 max(24px,env(safe-area-inset-bottom));font-size:12px;color:#6b778b;gap:10px}.footer strong{color:#343f59}.toast{position:fixed;bottom:24px;left:50%;transform:translate(-50%,16px);background:#182235;color:#fff;padding:12px 18px;border-radius:11px;font-size:13px;box-shadow:0 4px 20px #17243b30;opacity:0;pointer-events:none;transition:.2s;z-index:5;max-width:calc(100% - 24px);text-align:center}.toast.show{opacity:1;transform:translate(-50%,0)}.not-found{text-align:center;background:white;border:1px solid #e1e6ee;padding:50px 20px;margin:40px auto;border-radius:22px;max-width:480px}.not-found .panel-icon{margin:0 auto 18px;width:50px;height:50px}.not-found h1{font-size:27px;margin-bottom:8px}.not-found p{color:#667287}.broken-image{display:none!important}
@media(hover:hover){.action:not(.primary):not(.emergency):hover,.share:hover{border-color:var(--accent);background:var(--tint)}.action:hover{transform:translateY(-1px)}.action.primary:hover,.action.emergency:hover{filter:brightness(.92)}}
@media(max-width:900px){.shell{padding:0 24px}.layout{grid-template-columns:minmax(0,300px) minmax(0,1fr);gap:20px}.hero{padding:23px 20px}.quick{padding:20px}.fields{column-gap:15px}.menu-grid{grid-template-columns:1fr}}
@media(max-width:720px){.shell{padding:0 max(16px,env(safe-area-inset-left)) 0 max(16px,env(safe-area-inset-right));max-width:620px}.topbar{min-height:72px}.layout{display:flex;flex-direction:column;gap:22px;padding:20px 0 26px}.profile,.content{width:100%}.hero{padding:22px}.hero-top{margin-bottom:20px}.portrait{width:90px;height:90px;border-radius:24px;margin-bottom:15px}.hero h1{font-size:29px}.quick{padding:18px}.actions{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.action{padding:11px;font-size:12px}.action.primary,.action.emergency{grid-column:1/-1}.menu-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.content-title h2{font-size:25px}.footer{flex-wrap:wrap}.share{padding:9px 12px}.fields{padding-left:18px;padding-right:18px}.panel-head{padding:16px 18px}}
@media(max-width:400px){.shell{padding-left:12px;padding-right:12px}.hero{padding:18px}.brand{font-size:17px}.brand-mark{width:37px;height:37px}.share{gap:6px}.fields,.menu-grid{grid-template-columns:1fr}.fields{padding:2px 16px 6px}.field{padding:13px 0}.action{font-size:12px}.action svg:last-child{display:none}.panel-head{padding:15px 16px}.menu-grid{padding:14px}.footer{font-size:11px}}
@media(max-width:320px){.actions{grid-template-columns:1fr}.share span{display:none}.hero h1{font-size:25px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important;scroll-behavior:auto!important}}
@media print{body{background:white}.shell{padding:0}.topbar{min-height:56px}.layout{display:block;padding-top:16px}.profile{margin-bottom:20px}.share,.quick,.copy,.toast{display:none!important}.panel,.menu-card{break-inside:avoid;box-shadow:none}.hero::after{display:none}}
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
