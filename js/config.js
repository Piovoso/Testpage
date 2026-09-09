/* CONFIG — Supabase credentials, constants, and all shared global state variables. */

let materials = [];
let orders = [];
let materialQueueCache = null; // ordered (oldest first) [{id, items:[{materialId, remaining}]}] — shared between buyer and seller views
let removedMaterialIds = [];
let isAuthenticated = false;
let sellerRole = null; // 'admin' | 'employee'
let sellerName = '';
let accounts = []; // cached list of accounts, populated via the manage-account Edge Function (admin only)
let permissions = { orders: true, statistics: true, materials: true, settings: true, access: false };
let selectedCurrency = 'NCC';
let ordersOpen = true;
let demoMode = false;
let currencyOptions = ['NCC', 'ICA', 'CIS', 'AIC'];
let pickupLocations = ['Moria', 'Hortus', 'Benten'];

// Real Supabase Auth session for the signed-in seller (admin or employee).
// null when signed out. accessToken is sent as the Authorization header
// on requests that need to prove who's asking (reading your own profile,
// calling the manage-account Edge Function).
let authSession = null; // { accessToken, refreshToken, expiresAt, userId }
let adminAccountExists = true; // updated at startup; false triggers the "set up admin" flow

/* ---------- Supabase client ----------
   Talks directly to your Supabase project's REST API (PostgREST),
   so every visitor — any device, any browser — reads and writes the
   same shared data. The anon/publishable key below is meant to be
   used client-side; access is governed by the Row Level Security
   policies on the tables, not by keeping this key secret. */
const SUPABASE_URL = 'https://icaokwuwflyyueykhwym.supabase.co';
const SUPABASE_KEY = 'sb_publishable_nz1jLDIC_rOgrmLGMtF_9w_qlz0PSQf';


