/* API — All communication with Supabase (PostgREST). Load/save functions for materials, orders, employees, settings, and the sbFetch wrapper with connection-error detection. */

function showConnectionError(){
  const banner = document.getElementById('connection-error-banner');
  if(banner) banner.style.display = 'flex';
}
function hideConnectionError(){
  const banner = document.getElementById('connection-error-banner');
  if(banner) banner.style.display = 'none';
}

async function sbFetch(path, options = {}){
  if(demoMode) return null;
  let res;
  try{
    res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method: options.method || 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        ...(options.prefer ? { 'Prefer': options.prefer } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });
  }catch(e){
    // Network-level failure — offline, DNS, CORS, project paused and unreachable, etc.
    showConnectionError();
    throw e;
  }
  if(!res.ok){
    showConnectionError();
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  hideConnectionError();
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function dbToOrder(row){
  return {
    id: row.id,
    username: row.username || '',
    customerName: row.customer_name,
    contact: row.contact || '',
    note: row.note || '',
    pickupLocation: row.pickup_location || '',
    items: row.items,
    total: Number(row.total),
    currency: row.currency || 'NCC',
    status: row.status,
    sellerComment: row.seller_comment || '',
    handledBy: row.handled_by || '',
    sourcePlans: row.source_plans || [],
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at || null,
    productionAt: row.production_at || null,
    deliveredAt: row.delivered_at || null,
    deniedAt: row.denied_at || null,
    orderDiscountPercent: Number(row.order_discount_percent) || 0
  };
}

async function loadMaterials(){
  if(demoMode) return;
  try{
    const rows = await sbFetch('materials?select=*&order=sort_order.asc');
    materials = (rows || []).map(r => ({
      id: r.id,
      name: r.name,
      price: Number(r.price),
      weight: Number(r.weight) || 0,
      volume: Number(r.volume) || 0,
      discountPercent: Number(r.discount_percent) || 0,
      showOnOrderList: r.show_on_order_list !== false,
      cxPrice: (r.cx_price === null || r.cx_price === undefined) ? null : Number(r.cx_price),
      category: r.category || null,
      stockpile: Number(r.stockpile) || 0,
      productionPerDay: Number(r.production_per_day) || 0
    }));
  }catch(e){
    // Deliberately NOT resetting `materials` to [] here — a failed request
    // (e.g. Supabase paused, network drop) should not look identical to
    // "there are genuinely zero materials." Keep whatever was last
    // successfully loaded; the connection-error banner (see sbFetch)
    // already tells the user something's actually wrong.
    console.error(e);
  }
}

/* There is no more loadOrders() here. Every order read — the seller's
   filtered/sorted/paginated list, stats, and the buyer's ticket/company/
   duplicate lookups — goes through callListOrders() in auth.js, which
   only ever returns exactly what that one request needs. Nothing loads
   the whole orders table into the browser anymore. */

async function loadDropdownOptions(){
  if(demoMode) return;
  try{
    const rows = await sbFetch('dropdown_options?select=*&order=list_type.asc,sort_order.asc');
    const pickups = (rows || []).filter(r => r.list_type === 'pickup').map(r => r.value);
    const currencies = (rows || []).filter(r => r.list_type === 'currency').map(r => r.value);
    if(pickups.length) pickupLocations = pickups;
    if(currencies.length) currencyOptions = currencies;
  }catch(e){
    console.error(e);
  }
}

async function saveDropdownList(listType, values){
  await callManageShopSettings('saveDropdownList', { listType, values });
}

/* Order creation no longer inserts into the table directly — the
   submit-order Edge Function is the only thing allowed to do that now.
   It recalculates every price/subtotal/total itself from the real
   materials table, so whatever's sent for those fields here is only
   used for the client's own optimistic display; the server never
   trusts it. */
async function insertOrder(order, turnstileToken){
  if(demoMode){
    // No real materials table to price against here — just accept the
    // order's own numbers as-is and add it to the local demo list,
    // matching what the rest of demo mode already does everywhere else.
    const fakeOrder = { ...order, id: uid('demo_ord'), status: 'pending', sellerComment: '', handledBy: '', createdAt: new Date().toISOString() };
    orders.unshift(fakeOrder);
    return fakeOrder;
  }
  const res = await fetch(`${SUPABASE_URL}/functions/v1/submit-order`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: order.username,
      customerName: order.customerName,
      contact: order.contact,
      note: order.note,
      pickupLocation: order.pickupLocation,
      items: order.items.map(i => ({ materialId: i.materialId, qty: i.qty })),
      currency: order.currency,
      sourcePlans: order.sourcePlans || [],
      turnstileToken
    })
  }).catch(e => { showConnectionError(); throw e; });

  const data = await res.json().catch(() => ({}));
  if(!res.ok || !data.ok){
    if(res.status >= 500) showConnectionError();
    throw new Error(data.error || `Could not submit order (${res.status})`);
  }
  hideConnectionError();
  return dbToOrder(data.order);
}

/* Account management (create/list/rename/permissions/password/delete) now
   lives in auth.js, calling the manage-account Edge Function instead of
   this table directly — see that file for why. */

async function loadNotice(){
  try{
    const rows = await sbFetch('app_settings?select=buyer_notice&id=eq.1');
    return rows && rows[0] ? (rows[0].buyer_notice || '') : '';
  }catch(e){
    console.error(e);
    return '';
  }
}
async function saveNotice(text){
  await callManageShopSettings('saveNotice', { text });
}

async function loadSiteNote(){
  try{
    const rows = await sbFetch('app_settings?select=site_note&id=eq.1');
    return rows && rows[0] ? (rows[0].site_note || '') : '';
  }catch(e){
    console.error(e);
    return '';
  }
}
async function saveSiteNote(text){
  await callManageShopSettings('saveSiteNote', { text });
}

async function loadOrdersOpen(){
  try{
    const rows = await sbFetch('app_settings?select=orders_open&id=eq.1');
    return rows && rows[0] && rows[0].orders_open !== null ? !!rows[0].orders_open : true;
  }catch(e){
    console.error(e);
    return true;
  }
}
async function saveOrdersOpen(isOpen){
  await callManageShopSettings('saveOrdersOpen', { isOpen });
}

async function loadSiteTitle(){
  try{
    const rows = await sbFetch('app_settings?select=site_title&id=eq.1');
    return rows && rows[0] && rows[0].site_title ? rows[0].site_title : 'Lotol Materials Co.';
  }catch(e){
    console.error(e);
    return 'Lotol Materials Co.';
  }
}
async function saveSiteTitle(title){
  await callManageShopSettings('saveSiteTitle', { title });
}

async function loadAccentColor(){
  try{
    const rows = await sbFetch('app_settings?select=accent_color&id=eq.1');
    return rows && rows[0] ? (rows[0].accent_color || null) : null;
  }catch(e){
    console.error(e);
    return null;
  }
}
async function saveAccentColor(color){
  await callManageShopSettings('saveAccentColor', { color });
}

async function loadDefaultCxExchange(){
  try{
    const rows = await sbFetch('app_settings?select=default_cx_exchange&id=eq.1');
    return rows && rows[0] && rows[0].default_cx_exchange ? rows[0].default_cx_exchange : 'NC1';
  }catch(e){
    console.error(e);
    return 'NC1';
  }
}

async function loadXitActOrigin(){
  try{
    const rows = await sbFetch('app_settings?select=xit_act_origin&id=eq.1');
    return rows && rows[0] ? (rows[0].xit_act_origin || '') : '';
  }catch(e){
    console.error(e);
    return '';
  }
}
async function saveXitActOrigin(origin){
  await callManageShopSettings('saveXitActOrigin', { origin });
}

async function loadContractDaysToFulfill(){
  try{
    const rows = await sbFetch('app_settings?select=contract_days_to_fulfill&id=eq.1');
    return rows && rows[0] && rows[0].contract_days_to_fulfill ? rows[0].contract_days_to_fulfill : '7';
  }catch(e){
    console.error(e);
    return '7';
  }
}
async function saveContractDaysToFulfill(days){
  await callManageShopSettings('saveContractDaysToFulfill', { days });
}

async function saveMaterialProduction(id, stockpile, productionPerDay){
  await callManageShopSettings('updateMaterialProduction', { id, stockpile, productionPerDay });
}

async function loadMaterialQueue(){
  try{
    const result = await callListOrders('materialQueue', {});
    return result.queue || [];
  }catch(e){
    console.error('Material queue load failed:', e);
    return [];
  }
}

async function loadAutoLogoutMinutes(){
  try{
    const rows = await sbFetch('app_settings?select=auto_logout_minutes&id=eq.1');
    return rows && rows[0] && rows[0].auto_logout_minutes !== null ? Number(rows[0].auto_logout_minutes) : 20;
  }catch(e){
    console.error(e);
    return 20;
  }
}
async function saveAutoLogoutMinutes(minutes){
  await callManageShopSettings('saveAutoLogoutMinutes', { minutes });
}

async function saveDefaultCxExchange(exchange){
  await callManageShopSettings('saveDefaultCxExchange', { exchange });
}

/* ---------- Order view ---------- */
