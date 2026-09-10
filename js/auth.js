/* AUTH — Real Supabase Auth sessions and the manage-account Edge Function client.
   This replaces the old plaintext `accounts` table entirely. Login goes through
   Supabase's own hashed-password system; account creation/renaming/permission
   changes/password changes/deletion all go through the manage-account Edge
   Function, which is the only thing on earth allowed to touch that data. */

const AUTH_STORAGE_KEY = 'matorder:refreshToken';

function usernameToEmail(name){
  return `${name.trim().toLowerCase()}@accounts.internal`;
}

async function authSignIn(username, password){
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: usernameToEmail(username), password })
  });
  if(!res.ok) return false;
  const data = await res.json();
  authSession = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
    userId: data.user.id
  };
  try{ localStorage.setItem(AUTH_STORAGE_KEY, data.refresh_token); }catch(e){}
  return true;
}

async function authRestoreSession(){
  let refreshToken;
  try{ refreshToken = localStorage.getItem(AUTH_STORAGE_KEY); }catch(e){ return false; }
  if(!refreshToken) return false;

  try{
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken })
    });
    if(!res.ok){
      try{ localStorage.removeItem(AUTH_STORAGE_KEY); }catch(e){}
      return false;
    }
    const data = await res.json();
    authSession = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in * 1000),
      userId: data.user.id
    };
    try{ localStorage.setItem(AUTH_STORAGE_KEY, data.refresh_token); }catch(e){}
    return true;
  }catch(e){
    console.error('Session restore failed:', e);
    return false;
  }
}

async function authSignOut(){
  if(authSession){
    try{
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${authSession.accessToken}` }
      });
    }catch(e){ /* best effort — clear local state regardless */ }
  }
  authSession = null;
  try{ localStorage.removeItem(AUTH_STORAGE_KEY); }catch(e){}
}

/* Reads the signed-in user's own profile row. RLS only allows a user to
   read their own row (auth.uid() = id), so this requires their access
   token, not the app's shared anon key. */
async function authFetchOwnProfile(){
  if(!authSession) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=*&id=eq.${authSession.userId}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${authSession.accessToken}` }
  });
  if(!res.ok) return null;
  const rows = await res.json();
  return rows && rows[0] ? rows[0] : null;
}

/* Generic caller for every Edge Function this app uses. */
async function callEdgeFunction(functionName, action, payload){
  const bearer = authSession ? authSession.accessToken : SUPABASE_KEY;
  let res;
  try{
    res = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action, ...payload })
    });
  }catch(e){
    showConnectionError();
    throw e;
  }
  const data = await res.json().catch(() => ({}));
  if(!res.ok || !data.ok){
    if(res.status >= 500) showConnectionError();
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  hideConnectionError();
  return data;
}

async function callManageAccount(action, payload){
  return callEdgeFunction('manage-account', action, payload);
}

/* Every seller-side order mutation (status changes, comments, quantity
   edits, production progress, deletion) and the buyer's self-cancel all
   go through this one function now — see manage-order/index.ts. Seller
   actions need a real session (sent as the bearer token); buyerCancel
   works without one, since buyers never log in, but requires proving
   you know the order's id AND its company code. */
async function callManageOrder(action, payload){
  return callEdgeFunction('manage-order', action, payload);
}

/* Every order READ now goes through this — the seller's filtered/sorted/
   paginated list, stats, and the buyer's scoped ticket/company/duplicate
   lookups. Nothing loads the whole orders table into the browser anymore. */
async function callListOrders(action, payload){
  return callEdgeFunction('list-orders', action, payload);
}

/* Materials/prices, the Currency and Pickup Location lists, the buyer
   notice, the site note, and the order-intake toggle all save through
   this now — see manage-shop-settings/index.ts. */
async function callManageShopSettings(action, payload){
  return callEdgeFunction('manage-shop-settings', action, payload);
}

async function checkAdminExists(){
  try{
    const data = await callManageAccount('hasAdmin', {});
    adminAccountExists = !!data.hasAdmin;
  }catch(e){
    console.error('Could not check admin status:', e);
    // Assume an admin exists rather than risk showing the bootstrap
    // form (which would offer to create a NEW admin) on a transient
    // network error.
    adminAccountExists = true;
  }
}
