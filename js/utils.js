/* UTILS — Pure formatting/rendering helpers used across buyer and seller code: money formatting, HTML escaping, order status labels, readiness % and weight/volume calculations, and the shared ticket-row renderer. */

function formatAmount(n){
  const num = Number(n || 0);
  const fixed = num.toFixed(2);
  const negative = fixed.startsWith('-');
  const [intPart, decPart] = (negative ? fixed.slice(1) : fixed).split('.');
  const spacedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (negative ? '-' : '') + spacedInt + '.' + decPart;
}
function money(n, currency){
  return formatAmount(n) + ' ' + (currency || selectedCurrency);
}
function uid(prefix){
  if(typeof crypto !== 'undefined' && crypto.randomUUID){
    return prefix + '_' + crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID (very old browsers,
  // or non-secure contexts) — still uses the CSPRNG when available, only
  // falls all the way back to Math.random() if crypto itself is missing.
  if(typeof crypto !== 'undefined' && crypto.getRandomValues){
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return prefix + '_' + hex;
  }
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

/* Wraps a native number input with a custom stepper UI (hides the native
   spinner arrows), matching the app's theme. mode: 'stacked' = up/down
   arrows with a divider (used everywhere quantities are entered), or
   'flanking' = minus/plus buttons on either side (used for Discount %
   specifically). Re-dispatches a real 'input' event on every click, so
   whatever listener is already wired to that field (recalculating totals,
   readiness %, etc.) keeps working completely unchanged. Call this AFTER
   wiring the field's normal listeners, and after it's already in the DOM. */
function enhanceNumberInput(input, mode){
  if(!input || input.dataset.stepperEnhanced) return;
  input.dataset.stepperEnhanced = 'true';
  const step = parseFloat(input.step) || 1;
  const hasMin = input.min !== '';
  const hasMax = input.max !== '';
  const min = hasMin ? parseFloat(input.min) : -Infinity;
  const max = hasMax ? parseFloat(input.max) : Infinity;

  const bump = (delta) => {
    if(input.disabled) return;
    const current = parseFloat(input.value) || 0;
    let next = current + delta;
    if(next < min) next = min;
    if(next > max) next = max;
    input.value = next;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const wrapper = document.createElement('div');
  input.parentNode.insertBefore(wrapper, input);

  if(mode === 'flanking'){
    wrapper.className = 'stepper-flanking';
    const minusBtn = document.createElement('button');
    minusBtn.type = 'button'; minusBtn.className = 'stepper-btn'; minusBtn.textContent = '−';
    minusBtn.addEventListener('click', () => bump(-step));
    const plusBtn = document.createElement('button');
    plusBtn.type = 'button'; plusBtn.className = 'stepper-btn'; plusBtn.textContent = '+';
    plusBtn.addEventListener('click', () => bump(step));
    wrapper.appendChild(minusBtn);
    wrapper.appendChild(input);
    wrapper.appendChild(plusBtn);
  }else{
    wrapper.className = 'stepper-stacked';
    const arrowsWrap = document.createElement('div');
    arrowsWrap.className = 'stepper-arrows';
    const upBtn = document.createElement('button');
    upBtn.type = 'button'; upBtn.textContent = '▲';
    upBtn.addEventListener('click', () => bump(step));
    const downBtn = document.createElement('button');
    downBtn.type = 'button'; downBtn.textContent = '▼';
    downBtn.addEventListener('click', () => bump(-step));
    arrowsWrap.appendChild(upBtn);
    arrowsWrap.appendChild(downBtn);
    wrapper.appendChild(input);
    wrapper.appendChild(arrowsWrap);
  }
}

function enhanceNumberInputsIn(containerEl, selector, mode){
  if(!containerEl) return;
  containerEl.querySelectorAll(selector).forEach(inp => enhanceNumberInput(inp, mode));
}

let customAccentColor = null;

function hexToRgba(hex, alpha){
  const clean = String(hex || '').replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) || 0;
  const g = parseInt(clean.substring(2, 4), 16) || 0;
  const b = parseInt(clean.substring(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}

/* Overrides the theme's default teal with a custom accent color, applied
   on top of whichever theme (light/dark) is currently active — recomputes
   the "dim" tint too, since that needs a different alpha per theme to stay
   readable. Pass null to go back to the theme's own default. */
function applyAccentColor(hex){
  customAccentColor = hex || null;
  const root = document.documentElement;
  if(!hex){
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-dim');
    return;
  }
  const isLight = root.classList.contains('light-mode');
  root.style.setProperty('--accent', hex);
  root.style.setProperty('--accent-dim', hexToRgba(hex, isLight ? 0.10 : 0.14));
}

/* Light/dark theme toggle. The actual color values live entirely in CSS
   (html.light-mode overrides the same custom properties dark mode sets on
   :root) — this just flips the class, keeps color-scheme in sync so native
   controls (checkboxes, etc.) match, updates the toggle button's icon, and
   remembers the choice. A tiny inline script in <head> applies the saved
   choice before first paint, so there's no flash of the wrong theme. */
function applyTheme(mode){
  document.documentElement.classList.toggle('light-mode', mode === 'light');
  document.documentElement.style.colorScheme = mode;
  const btn = document.getElementById('theme-toggle-btn');
  if(btn) btn.textContent = mode === 'light' ? '☀️' : '🌙';
  try{ localStorage.setItem('matorder:theme', mode); }catch(e){}
  if(customAccentColor) applyAccentColor(customAccentColor); // recompute --accent-dim for the new theme
}

function toggleTheme(){
  const isLight = document.documentElement.classList.contains('light-mode');
  applyTheme(isLight ? 'dark' : 'light');
}

function initTheme(){
  let saved = 'dark';
  try{ saved = localStorage.getItem('matorder:theme') || 'dark'; }catch(e){}
  applyTheme(saved);
}

/* Spinner overlay: dims whatever's already in a container and shows a
   spinner over it while a fetch is in flight. containerEl keeps its old
   content underneath (dimmed/blurred) until you overwrite it yourself. */
function showSpinner(containerEl, label){
  if(!containerEl) return;
  containerEl.classList.add('spinner-overlay-wrap');
  const old = containerEl.querySelector('.spinner-overlay');
  if(old) old.remove();
  Array.from(containerEl.children).forEach(c => c.classList.add('dim-behind'));
  const overlay = document.createElement('div');
  overlay.className = 'spinner-overlay';
  overlay.innerHTML = `<div class="spinner"></div><div class="spinner-label">${label || 'Loading…'}</div>`;
  containerEl.appendChild(overlay);
}

/* Every toast across the app follows the same two-line shape (set a color,
   set the text) repeated dozens of times with copy-pasted styling. These
   two helpers replace that — setToastError for failures, setToastSuccess
   for confirmations, with an optional auto-clear delay for the latter
   (most success toasts fade themselves after ~2s). */
function setToastError(el, message){
  if(!el) return;
  el.style.color = 'var(--rust)';
  el.textContent = message;
}
function setToastSuccess(el, message, autoClearMs){
  if(!el) return;
  el.style.color = 'var(--ok)';
  el.textContent = message;
  if(autoClearMs){
    setTimeout(() => { if(el) el.textContent = ''; }, autoClearMs);
  }
}

/* The "admin only" guard-with-error-toast shape repeated across the
   seller-side editors. Note this is deliberately NOT used for checks with
   a different rule (e.g. "admin OR an employee with Settings access") —
   those aren't duplication, they're a genuinely different authorization
   rule and stay written out explicitly. */
function requireAdmin(toastEl, message){
  if(sellerRole === 'admin') return true;
  if(toastEl) setToastError(toastEl, message);
  return false;
}

/* Material category → color palette, extracted from a real reference
   chart (pixel-sampled colors, not guessed) and cross-checked against
   Refined PrUn's own source where possible — 5 of these are exact
   confirmed matches (agricultural products, consumables basic/luxury,
   liquids, plastics); the rest are best-effort from the same chart.
   Category itself comes from FIO's real per-material data once synced
   ("Update Weight/Volume from FIO" also captures it now), not guessed. */
const MATERIAL_CATEGORY_COLORS = {
  "agricultural products": "#003900",
  "consumables (basic)": "#bd3461",
  "consumables (luxury)": "#6b0003",
  "liquids": "#66a5d6",
  "plastics": "#7f2568",
  "food": "#a82d2c",
  "metals": "#361d4f",
  "minerals": "#9c744c",
  "ship engines": "#9d2d03",
  "electronic devices": "#132266",
  "chemicals": "#2f5371",
  "electronic parts": "#591796",
  "construction prefabs": "#1c5fd7",
  "electronic systems": "#5f32bb",
  "gases": "#036c6e",
  "ores": "#575c66",
  "ship parts": "#9c5703",
  "elements": "#441017",
  "construction materials": "#805123",
  "software systems": "#10103c",
  "software components": "#5bb05b",
  "unit prefabs": "#1a432c"
};
const MATERIAL_CATEGORY_DEFAULT_COLOR = "#3d4a4d"; // neutral gray for anything uncategorized

/* Renders a material ticker as a small colored chip, matching the
   category-color convention from Refined PrUn. Falls back to a neutral
   gray chip if the material has no category set yet (e.g. added before
   an FIO sync, or FIO doesn't recognize the ticker). */
/* Sums outstanding need for one material across the active-order queue —
   everyone, if uptoOrderId is omitted (used for a not-yet-placed order,
   which would join at the back of the line), or only orders at-or-before
   a given order's own position (used for an order that's already placed,
   so it doesn't count orders behind it in line). Returns null if the
   queue hasn't loaded yet. */
function cumulativeMaterialDemand(materialId, uptoOrderId){
  if(!materialQueueCache) return null;
  let sum = 0;
  for(const o of materialQueueCache){
    const item = o.items.find(it => it.materialId === materialId);
    if(item) sum += item.remaining;
    if(uptoOrderId && o.id === uptoOrderId) break;
  }
  return sum;
}

/* Per-material estimated wait, shared by the buyer's order form and the
   seller's order detail card. uptoOrderId scopes the queue to a specific
   order's position (omit for a hypothetical new order); extraQty adds an
   amount on top — e.g. the buyer's own not-yet-submitted quantity — before
   comparing against that material's stockpile and production rate (both
   seller-entered, manually). Returns null if the queue hasn't loaded yet. */
function estimateMaterialDays(materialId, uptoOrderId, extraQty){
  const cumulative = cumulativeMaterialDemand(materialId, uptoOrderId);
  if(cumulative === null) return null;
  const totalDemand = cumulative + (extraQty || 0);
  const mat = materials.find(m => m.id === materialId);
  const stockpile = mat ? (Number(mat.stockpile) || 0) : 0;
  const rate = mat ? (Number(mat.productionPerDay) || 0) : 0;
  const shortfall = Math.max(0, totalDemand - stockpile);
  let days = 0;
  let unknown = false;
  if(shortfall > 0){
    if(rate > 0) days = shortfall / rate;
    else unknown = true;
  }
  return { totalDemand, stockpile, rate, shortfall, days, unknown };
}

function materialTickerChip(name, category){
  const key = (category || '').toLowerCase().trim();
  const color = MATERIAL_CATEGORY_COLORS[key] || MATERIAL_CATEGORY_DEFAULT_COLOR;
  return `<span class="mat-ticker-chip" style="background:${color};">${escapeHtml(name)}</span>`;
}

const STATUS_LABELS = {
  pending: 'pending',
  confirmed: 'confirmed',
  production: 'production started',
  delivered: 'delivered',
  denied: 'denied'
};
const NEXT_STATUS = {
  pending: 'confirmed',
  confirmed: 'production',
  production: 'delivered'
};
const NEXT_LABEL = {
  pending: 'Confirm Order',
  confirmed: 'Start Production',
  production: 'Mark Delivered'
};
const PREV_STATUS = {
  confirmed: 'pending',
  production: 'confirmed',
  delivered: 'production'
};

function calcOrderReadiness(order){
  let totalOrdered = 0;
  let totalProduced = 0;
  order.items.forEach(it => {
    const produced = Math.max(0, Math.min(it.qty, Number(it.producedQty) || 0));
    totalOrdered += it.qty;
    totalProduced += produced;
  });
  const percent = totalOrdered > 0 ? (totalProduced / totalOrdered) * 100 : 0;
  return { percent, totalOrdered, totalProduced };
}

function progressBadgeHtml(order){
  const { percent } = calcOrderReadiness(order);
  const pct = Math.round(percent);
  return `
    <div class="progress-line">
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%;"></div></div>
      <span class="progress-label">${pct}% ready</span>
    </div>
  `;
}

function calcOrderPhysicals(order){
  let totalWeight = 0;
  let totalVolume = 0;
  order.items.forEach(it => {
    const mat = materials.find(m => m.id === it.materialId);
    if(mat){
      totalWeight += it.qty * (Number(mat.weight) || 0);
      totalVolume += it.qty * (Number(mat.volume) || 0);
    }
  });
  return { totalWeight, totalVolume };
}

function physicalsBarHtml(order){
  const { totalWeight, totalVolume } = calcOrderPhysicals(order);
  return `
    <div class="physicals-line">
      <span class="physicals-item"><span class="physicals-label">Weight</span> <span class="physicals-value">${totalWeight.toFixed(2)} t</span></span>
      <span class="physicals-item"><span class="physicals-label">Volume</span> <span class="physicals-value">${totalVolume.toFixed(2)} m³</span></span>
    </div>
  `;
}

function formatTimelineDate(iso){
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/* Buyer-facing vertical progress tracker: Order placed -> Confirmed ->
   In production -> Ready/Delivered, with a distinct terminal branch for
   a denied/cancelled order. */
/* Compact single-line version of the above, for the seller's order detail
   card — shows just the current stage, not the full history. The buyer-
   facing views still use the full orderTimelineHtml() timeline. */
function latestActivityHtml(order){
  if(order.status === 'denied'){
    const time = order.deniedAt ? `<span class="odc-activity-time">· ${formatTimelineDate(order.deniedAt)}</span>` : '';
    return `<div class="odc-latest-activity"><span class="dot denied"></span>Order cancelled${time}</div>`;
  }
  const stages = [
    { status: 'pending', label: 'Order placed', time: order.createdAt },
    { status: 'confirmed', label: 'Order confirmed', time: order.confirmedAt },
    { status: 'production', label: 'Production started', time: order.productionAt },
    { status: 'delivered', label: 'Delivered', time: order.deliveredAt }
  ];
  const current = stages.find(s => s.status === order.status) || stages[0];
  const time = current.time ? `<span class="odc-activity-time">· ${formatTimelineDate(current.time)}</span>` : '';
  return `<div class="odc-latest-activity"><span class="dot ${order.status}"></span>${current.label}${time}</div>`;
}

function orderTimelineHtml(order){
  if(order.status === 'denied'){
    return `
      <div class="order-timeline">
        <div class="timeline-step done">
          <div class="timeline-marker">✓</div>
          <div class="timeline-content">
            <div class="timeline-label">Order placed</div>
            <div class="timeline-time">${formatTimelineDate(order.createdAt)}</div>
          </div>
        </div>
        <div class="timeline-step denied">
          <div class="timeline-marker">✕</div>
          <div class="timeline-content">
            <div class="timeline-label">Order cancelled</div>
            ${order.deniedAt ? `<div class="timeline-time">${formatTimelineDate(order.deniedAt)}</div>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  const stages = [
    { label: 'Order placed', time: order.createdAt },
    { label: 'Order confirmed', time: order.confirmedAt },
    { label: 'In production', time: order.productionAt },
    { label: 'Ready / Delivered', time: order.deliveredAt }
  ];
  const statusIndex = { pending: 0, confirmed: 1, production: 2, delivered: 3 }[order.status] ?? 0;

  return `
    <div class="order-timeline">
      ${stages.map((s, i) => {
        let cls, marker, showTime;
        if(order.status === 'delivered' && i === 3){ cls = 'done'; marker = '✓'; showTime = true; }
        else if(i < statusIndex){ cls = 'done'; marker = '✓'; showTime = true; }
        else if(i === statusIndex){ cls = 'current'; marker = '●'; showTime = true; }
        else{ cls = 'upcoming'; marker = '○'; showTime = false; }
        return `
          <div class="timeline-step ${cls}">
            <div class="timeline-marker">${marker}</div>
            <div class="timeline-content">
              <div class="timeline-label">${s.label}</div>
              ${showTime && s.time ? `<div class="timeline-time">${formatTimelineDate(s.time)}</div>` : ''}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function ticketRowsHtml(order, editableProduced){
  const cur = order.currency || 'NCC';
  return order.items.map(it => {
    const produced = Math.max(0, Math.min(it.qty, Number(it.producedQty) || 0));
    const pct = it.qty > 0 ? Math.round((produced / it.qty) * 100) : 0;
    const producedCell = editableProduced
      ? `<input type="number" min="0" max="${it.qty}" step="1" value="${produced}" data-produced-input="${order.id}:${it.materialId}" class="qty-input">`
      : `${produced}`;
    const mat = materials.find(m => m.id === it.materialId);
    return `
    <tr>
      <td>${materialTickerChip(it.name, mat ? mat.category : null)}</td>
      <td class="num">${it.qty}</td>
      <td class="num">${money(it.price, cur)}</td>
      <td class="num">${money(it.subtotal, cur)}</td>
      <td class="num">${producedCell}</td>
      <td class="num">${pct}%</td>
    </tr>
  `;
  }).join('');
}

/* ---------- Seller: orders list ---------- */
function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}
function escapeAttr(str){
  return escapeHtml(str).replace(/"/g, '&quot;');
}

/* ---------- Init ---------- */
