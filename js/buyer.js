/* BUYER — Order form rendering/totals, ticket status lookup, order submission, cooldown, and duplicate-order detection. */

const DRAFT_STORAGE_KEY = 'matorder:draftOrder';

function saveDraftOrder(){
  try{
    const items = {};
    document.querySelectorAll('#order-materials-body .qty-input').forEach(inp => {
      const qty = parseFloat(inp.value) || 0;
      if(qty > 0) items[inp.dataset.id] = qty;
    });
    const draft = {
      username: document.getElementById('order-username').value,
      customerName: document.getElementById('order-name').value,
      contact: document.getElementById('order-contact').value,
      note: document.getElementById('order-note').value,
      pickupLocation: document.getElementById('pickup-location-select').value,
      currency: document.getElementById('currency-select').value,
      items
    };
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  }catch(e){ /* localStorage unavailable — drafts just won't persist */ }
}

function loadDraftOrder(){
  let draft;
  try{
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if(!raw) return;
    draft = JSON.parse(raw);
  }catch(e){ return; }
  if(!draft) return;

  if(draft.username) document.getElementById('order-username').value = draft.username;
  if(draft.customerName) document.getElementById('order-name').value = draft.customerName;
  if(draft.contact) document.getElementById('order-contact').value = draft.contact;
  if(draft.note) document.getElementById('order-note').value = draft.note;
  if(draft.pickupLocation) document.getElementById('pickup-location-select').value = draft.pickupLocation;
  if(draft.currency) document.getElementById('currency-select').value = draft.currency;
  if(draft.items){
    Object.entries(draft.items).forEach(([materialId, qty]) => {
      const inp = document.querySelector(`#order-materials-body .qty-input[data-id="${materialId}"]`);
      if(inp) inp.value = qty;
    });
  }
  updateOrderTotals();
}

function clearDraftOrder(){
  try{ localStorage.removeItem(DRAFT_STORAGE_KEY); }catch(e){}
}

function clearOrderClick(){
  document.querySelectorAll('#order-materials-body .qty-input').forEach(i => i.value = 0);
  document.getElementById('order-username').value = '';
  document.getElementById('order-name').value = '';
  document.getElementById('order-contact').value = '';
  document.getElementById('order-note').value = '';
  document.getElementById('pickup-location-select').selectedIndex = 0;
  document.getElementById('currency-select').selectedIndex = 0;
  document.getElementById('requested-date-input').value = '';
  linkedPlans = [];
  renderLinkedPlans();
  clearDraftOrder();
  updateOrderTotals();
  updateRequestedDateMin();
}

function renderOrderTable(){
  const body = document.getElementById('order-materials-body');
  body.innerHTML = '';
  materials.filter(m => m.showOnOrderList !== false && Number(m.price) > 0).forEach(m => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mat-name">${materialTickerChip(m.name, m.category)}</td>
      <td class="num"><input type="number" min="0" step="1" value="0" data-id="${m.id}" class="qty-input"></td>
      <td class="num" id="price-${m.id}">${money(m.price)}</td>
      <td class="num" id="sub-${m.id}">${money(0)}</td>
      <td class="num" id="weight-${m.id}">0.00</td>
      <td class="num" id="volume-${m.id}">0.00</td>
      <td class="num" id="wait-${m.id}">${materialWaitCellHtml(m.id, 0)}</td>
    `;
    body.appendChild(tr);
  });
  body.querySelectorAll('.qty-input').forEach(inp => {
    inp.addEventListener('input', () => {
      updateOrderTotals();
      saveDraftOrder();
      const waitCell = document.getElementById(`wait-${inp.dataset.id}`);
      if(waitCell) waitCell.innerHTML = materialWaitCellHtml(inp.dataset.id, Math.max(0, parseFloat(inp.value) || 0));
      updateRequestedDateMin();
    });
  });
  enhanceNumberInputsIn(body, 'input.qty-input', 'stacked');
  updateOrderTotals();
  updateRequestedDateMin();
  ensureBuyerMaterialQueueLoaded(); // fire-and-forget; guarded, cheap after the first call
}

/* Live minimum for the "Requested Arrival" date field — the earliest date
   that's actually realistic given the current queue, the buyer's own
   selected quantities, and each material's stockpile/production rate.
   Updates on every quantity change, same live-recompute pattern as the
   per-material "Est. Wait" column. A material with a real shortfall but
   no production rate set doesn't push the minimum out (can't quantify an
   unset rate), but the hint below the field says so plainly rather than
   implying false precision. */
function updateRequestedDateMin(){
  const input = document.getElementById('requested-date-input');
  const hint = document.getElementById('requested-date-hint');
  if(!input) return;

  let maxDays = 0;
  let unknown = false;
  let anySelected = false;
  document.querySelectorAll('#order-materials-body .qty-input').forEach(qtyInp => {
    const qty = Math.max(0, parseFloat(qtyInp.value) || 0);
    if(qty <= 0) return;
    anySelected = true;
    const est = estimateMaterialDays(qtyInp.dataset.id, null, qty);
    if(!est) return;
    if(est.unknown) unknown = true;
    if(est.days > maxDays) maxDays = est.days;
  });

  const minDate = new Date();
  minDate.setDate(minDate.getDate() + Math.ceil(maxDays));
  const minDateStr = minDate.toISOString().slice(0, 10);
  input.min = minDateStr;
  if(input.value && input.value < minDateStr){
    input.value = minDateStr; // their previous pick is no longer early enough — bump it forward
  }

  if(!hint) return;
  if(!anySelected){
    hint.textContent = '';
    hint.classList.remove('field-hint-warning');
  }else if(unknown){
    hint.textContent = 'Seller hasn\'t set a production rate for one or more of these materials yet — earliest date shown may not be accurate.';
    hint.classList.add('field-hint-warning');
  }else if(maxDays <= 0){
    hint.textContent = 'Earliest possible: today.';
    hint.classList.remove('field-hint-warning');
  }else{
    hint.textContent = `Earliest possible: ${minDateStr}, based on the current queue.`;
    hint.classList.remove('field-hint-warning');
  }
}

/* Compact "Est." cell for the order form — a plain number of days
   (materials.stockpile/productionPerDay are seller-entered, manual), a
   green "Ready" for anything already covered by stockpile, or a muted
   dash while the queue hasn't loaded yet or no rate is set to estimate
   from. currentQty is the buyer's own not-yet-submitted quantity for this
   material — included on top of the existing queue, since placing this
   order would add that much more demand, and updates live as they type. */
function materialWaitCellHtml(materialId, currentQty){
  const est = estimateMaterialDays(materialId, null, currentQty);
  if(!est) return '<span class="mat-wait-loading">—</span>';
  if(est.unknown) return '<span class="mat-wait-unknown">—</span>';
  if(est.days <= 0) return '<span class="mat-wait-ready">Ready</span>';
  const rounded = Math.ceil(est.days * 10) / 10;
  return `<span class="mat-wait-days">~${rounded}d</span>`;
}

async function ensureBuyerMaterialQueueLoaded(){
  if(materialQueueCache) return;
  materialQueueCache = await loadMaterialQueue();
  // Refresh estimates in place — NOT a full renderOrderTable(), which
  // would rebuild every row from scratch and wipe out any quantity the
  // buyer already started typing while this fetch was still in flight.
  document.querySelectorAll('#order-materials-body .qty-input').forEach(inp => {
    const waitCell = document.getElementById(`wait-${inp.dataset.id}`);
    if(waitCell) waitCell.innerHTML = materialWaitCellHtml(inp.dataset.id, Math.max(0, parseFloat(inp.value) || 0));
  });
  updateRequestedDateMin();
}


function updateOrderTotals(){
  let total = 0;
  let totalWeight = 0;
  let totalVolume = 0;
  document.querySelectorAll('#order-materials-body .qty-input').forEach(inp => {
    const id = inp.dataset.id;
    const mat = materials.find(m => m.id === id);
    const qty = Math.max(0, parseFloat(inp.value) || 0);
    const subtotal = qty * mat.price;
    const lineWeight = qty * (Number(mat.weight) || 0);
    const lineVolume = qty * (Number(mat.volume) || 0);
    total += subtotal;
    totalWeight += lineWeight;
    totalVolume += lineVolume;
    const priceCell = document.getElementById('price-' + id);
    if(priceCell) priceCell.textContent = money(mat.price);
    const cell = document.getElementById('sub-' + id);
    if(cell) cell.textContent = money(subtotal);
    const weightCell = document.getElementById('weight-' + id);
    if(weightCell) weightCell.textContent = lineWeight.toFixed(2);
    const volumeCell = document.getElementById('volume-' + id);
    if(volumeCell) volumeCell.textContent = lineVolume.toFixed(2);
  });
  document.getElementById('order-total-amount').textContent = money(total);
  document.getElementById('order-total-weight').textContent = totalWeight.toFixed(2) + ' t';
  document.getElementById('order-total-volume').textContent = totalVolume.toFixed(2) + ' m³';
}

function onCurrencyChange(){
  selectedCurrency = document.getElementById('currency-select').value;
  updateOrderTotals();
}

async function updatePendingBadge(){
  const el = document.getElementById('queued-orders-count');
  if(!el) return;
  try{
    const result = await callListOrders('pendingCount', {});
    el.textContent = result.count;
  }catch(e){
    console.error('Could not load pending count:', e);
  }
}

async function renderBuyerNotice(){
  const text = await loadNotice();
  const panel = document.getElementById('buyer-notice-panel');
  const body = document.getElementById('buyer-notice-text');
  if(text && text.trim()){
    body.textContent = text;
    panel.style.display = 'block';
  }else{
    panel.style.display = 'none';
  }
}

async function renderSiteNoteBanner(){
  const text = await loadSiteNote();
  const banner = document.getElementById('site-note-banner');
  const body = document.getElementById('site-note-text');
  if(text && text.trim()){
    body.textContent = text;
    banner.style.display = 'block';
  }else{
    banner.style.display = 'none';
  }
}

function renderOrderFormVisibility(){
  document.getElementById('order-form-panel').style.display = ordersOpen ? 'block' : 'none';
  document.getElementById('orders-closed-panel').style.display = ordersOpen ? 'none' : 'block';
}

/* Compact version of estimatedReadyHtml (seller-orders.js) for the buyer's
   own ticket — same underlying calculation, lighter styling to match the
   ticket's look, and no per-material breakdown table (buyers see that
   detail already, per material, on the order form itself before they
   submit — this is just "where does my placed order actually stand"). */
function buyerEstimatedReadyHtml(order){
  const est = estimateOrderReady(order);
  if(!est){
    return `<div class="buyer-estimate buyer-estimate-loading">Estimated ready: loading…</div>`;
  }
  const { maxDays, unknown } = est;
  if(unknown){
    return `<div class="buyer-estimate buyer-estimate-unknown">Estimated ready: not available yet for this order.</div>`;
  }
  if(maxDays <= 0){
    return `<div class="buyer-estimate buyer-estimate-ready">Estimated ready: materials already in stock.</div>`;
  }
  const rounded = Math.ceil(maxDays * 10) / 10;
  return `<div class="buyer-estimate buyer-estimate-days">Estimated ready: ~${rounded} day${rounded !== 1 ? 's' : ''}</div>`;
}

function buildBuyerTicketElement(order){
  const cur = order.currency || 'NCC';
  const ticket = document.createElement('div');
  ticket.className = 'ticket';
  const dt = new Date(order.createdAt);
  const dateStr = dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' + dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  let stampHtml = '';
  if(order.status === 'confirmed') stampHtml = '<div class="stamp">CONFIRMED</div>';
  if(order.status === 'production') stampHtml = '<div class="stamp stamp-production">IN PRODUCTION</div>';
  if(order.status === 'delivered') stampHtml = '<div class="stamp stamp-delivered">DELIVERED</div>';
  if(order.status === 'denied') stampHtml = '<div class="stamp stamp-denied">DENIED</div>';

  const isPending = order.status === 'pending';

  ticket.innerHTML = `
    ${stampHtml}
    <div class="ticket-head">
      <div>
        <div class="ticket-id">TICKET #${order.id.slice(-6).toUpperCase()}</div>
        <div class="ticket-customer">${escapeHtml(order.customerName.toUpperCase())}</div>
        ${order.username ? `<div class="ticket-note">User: ${escapeHtml(order.username)}</div>` : ''}
        ${order.pickupLocation ? `<div class="ticket-note">Pickup: ${escapeHtml(order.pickupLocation)}</div>` : ''}
        ${order.requestedDate ? `<div class="ticket-note">Requested arrival: ${escapeHtml(order.requestedDate)}</div>` : ''}
      </div>
      <div style="text-align:right;">
        <div class="ticket-date">${dateStr}</div>
        <div style="margin-top:8px;">
          <span class="status-badge status-${order.status}">${STATUS_LABELS[order.status]}</span>
        </div>
      </div>
    </div>
    ${orderTimelineHtml(order)}
    ${progressBadgeHtml(order)}
    ${physicalsBarHtml(order)}
    ${(order.status !== 'delivered' && order.status !== 'denied') ? buyerEstimatedReadyHtml(order) : ''}
    <div class="ticket-body">
      <table>
        <thead><tr><th>Material</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Subtotal</th><th class="num">Produced</th><th class="num">% Ready</th></tr></thead>
        <tbody>${ticketRowsHtml(order)}</tbody>
      </table>
      ${order.note ? `<div class="buyer-note-display"><span class="buyer-note-tag">Your note</span>${escapeHtml(order.note)}</div>` : ''}
      ${order.sellerComment ? `<div class="comment-display"><span class="comment-tag">Note from seller</span>${escapeHtml(order.sellerComment)}</div>` : ''}
    </div>
    <div class="ticket-foot">
      <div>
        <div class="ticket-total">${money(order.total, cur)}</div>
        ${order.orderDiscountPercent > 0 ? `<div style="font-size:11px; color:var(--ink-soft); margin-top:2px;">${order.orderDiscountPercent}% order discount applied</div>` : ''}
      </div>
      ${isPending ? `
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
          <button class="btn btn-deny btn-small" data-buyer-cancel="${order.id}">Cancel Order</button>
          <span class="toast" id="buyer-toast-${order.id}"></span>
        </div>` : ''}
    </div>
  `;

  if(isPending){
    const cancelBtn = ticket.querySelector(`[data-buyer-cancel="${order.id}"]`);
    cancelBtn.addEventListener('click', () => armDeleteButton(cancelBtn, () => cancelBuyerOrder(order)));
  }

  return ticket;
}

async function cancelBuyerOrder(order){
  const toast = document.getElementById(`buyer-toast-${order.id}`);
  try{
    await callManageOrder('buyerCancel', { id: order.id, companyCode: order.customerName });
    order.status = 'denied';
    const container = document.getElementById(`buyer-toast-${order.id}`)?.closest('.ticket')?.parentElement;
    if(container){
      container.innerHTML = '';
      container.appendChild(buildBuyerTicketElement(order));
    }
  }catch(e){
    console.error('Cancel failed:', e);
    if(toast){
      setToastError(toast, e.message || 'Could not cancel this order.');
    }
  }
}

async function checkOrderStatus(){
  const input = document.getElementById('status-check-input');
  const result = document.getElementById('status-check-result');
  const code = input.value.trim().toUpperCase();
  if(!code){
    result.innerHTML = '<div class="empty-state">Enter a ticket number above.</div>';
    return;
  }
  let data;
  showSpinner(result, 'Looking up ticket…');
  try{
    data = await callListOrders('lookupByTicket', { ticketCode: code });
  }catch(e){
    console.error('Ticket lookup failed:', e);
    result.innerHTML = '<div class="empty-state">Could not look that up right now — try again shortly.</div>';
    return;
  }
  updatePendingBadge();
  if(!data.order){
    result.innerHTML = '<div class="empty-state">No order found with that ticket number.</div>';
    return;
  }
  result.innerHTML = '';
  result.appendChild(buildBuyerTicketElement(dbToOrder(data.order)));
}

async function findOrdersByCompanyCode(){
  const input = document.getElementById('company-lookup-input');
  const result = document.getElementById('company-lookup-result');
  const code = input.value.trim();
  if(!code){
    result.innerHTML = '<div class="empty-state">Enter your company code above.</div>';
    return;
  }
  let matches;
  showSpinner(result, 'Looking up orders…');
  let data;
  try{
    data = await callListOrders('lookupByCompany', { companyCode: code });
  }catch(e){
    console.error('Company lookup failed:', e);
    result.innerHTML = '<div class="empty-state">Could not look that up right now — try again shortly.</div>';
    return;
  }
  matches = (data.orders || []).map(dbToOrder);
  updatePendingBadge();
  if(matches.length === 0){
    result.innerHTML = '<div class="empty-state">No orders found for that company code.</div>';
    return;
  }
  result.innerHTML = '';
  matches.forEach(order => result.appendChild(buildBuyerTicketElement(order)));
}

const ORDER_COOLDOWN_MS = 45000;
function getLastSubmitTime(){
  try{ return Number(localStorage.getItem('matorder:lastSubmitAt') || 0); }
  catch(e){ return 0; }
}
function setLastSubmitTime(){
  try{ localStorage.setItem('matorder:lastSubmitAt', String(Date.now())); }catch(e){}
}
let cooldownInterval = null;
function applyCooldownState(){
  const remaining = ORDER_COOLDOWN_MS - (Date.now() - getLastSubmitTime());
  const btn = document.getElementById('submit-order-btn');
  if(remaining > 0){
    startCooldownCountdown(remaining);
  }else{
    btn.disabled = false;
  }
}
function startCooldownCountdown(remainingMs){
  const btn = document.getElementById('submit-order-btn');
  const toast = document.getElementById('order-toast');
  btn.disabled = true;
  if(cooldownInterval) clearInterval(cooldownInterval);
  let remaining = Math.ceil(remainingMs / 1000);
  const tick = () => {
    if(remaining <= 0){
      btn.disabled = false;
      toast.textContent = '';
      clearInterval(cooldownInterval);
      cooldownInterval = null;
      return;
    }
    toast.style.color = 'var(--ink-soft)';
    toast.textContent = `You can submit another order in ${remaining}s`;
    remaining -= 1;
  };
  tick();
  cooldownInterval = setInterval(tick, 1000);
}

async function submitOrder(){
  if(!ordersOpen){
    const toast = document.getElementById('order-toast');
    setToastError(toast, 'New orders are currently closed.');
    return;
  }
  if(Date.now() - getLastSubmitTime() < ORDER_COOLDOWN_MS){
    applyCooldownState();
    return;
  }
  const items = [];
  document.querySelectorAll('#order-materials-body .qty-input').forEach(inp => {
    const qty = Math.max(0, parseFloat(inp.value) || 0);
    if(qty > 0){
      const mat = materials.find(m => m.id === inp.dataset.id);
      items.push({ materialId: mat.id, name: mat.name, qty, price: mat.price, subtotal: qty * mat.price, producedQty: 0 });
    }
  });
  const toast = document.getElementById('order-toast');
  if(items.length === 0){
    setToastError(toast, 'Add a quantity for at least one material.');
    return;
  }
  const usernameVal = document.getElementById('order-username').value.trim();
  const rawCompanyCode = document.getElementById('order-name').value.trim();
  const companyCode = rawCompanyCode.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4);
  if(!usernameVal){
    setToastError(toast, 'Enter your username.');
    return;
  }
  if(!companyCode){
    setToastError(toast, 'Enter your company code.');
    return;
  }
  const total = items.reduce((s,i) => s + i.subtotal, 0);
  const order = {
    id: uid('order'),
    username: usernameVal.slice(0, 128),
    customerName: companyCode,
    contact: document.getElementById('order-contact').value.trim(),
    note: document.getElementById('order-note').value.trim(),
    pickupLocation: document.getElementById('pickup-location-select').value,
    requestedDate: document.getElementById('requested-date-input').value || null,
    items,
    total,
    currency: selectedCurrency,
    status: 'pending',
    sellerComment: '',
    sourcePlans: linkedPlans.map(p => ({ url: p.url, planetId: p.planetId })),
    createdAt: new Date().toISOString()
  };

  if(!duplicateOverrideConfirmed){
    const dup = await findRecentDuplicateOrder(order);
    if(dup){
      showDuplicateWarning(dup, order);
      return;
    }
  }
  duplicateOverrideConfirmed = false;
  hideDuplicateWarning();
  await doActualSubmit(order);
}

let duplicateOverrideConfirmed = false;

async function findRecentDuplicateOrder(order){
  const materialIds = order.items.map(i => i.materialId);
  try{
    const data = await callListOrders('checkDuplicate', { companyCode: order.customerName, materialIds });
    return data.duplicate ? dbToOrder(data.duplicate) : null;
  }catch(e){
    console.error('Duplicate check failed:', e);
    return null; // don't block a real submission just because this check failed
  }
}

function showDuplicateWarning(dup, order){
  const wrap = document.getElementById('duplicate-warning');
  const dt = new Date(dup.createdAt);
  const secondsAgo = Math.max(1, Math.round((Date.now() - dt.getTime()) / 1000));
  const whenText = secondsAgo < 90 ? `${secondsAgo}s ago` : `${Math.round(secondsAgo / 60)}m ago`;
  document.getElementById('duplicate-warning-text').textContent =
    `You submitted a very similar order (ticket #${dup.id.slice(-6).toUpperCase()}) ${whenText}. Submit this one too?`;
  wrap.style.display = 'flex';
  document.getElementById('submit-order-btn').style.display = 'none';
}

function hideDuplicateWarning(){
  const wrap = document.getElementById('duplicate-warning');
  wrap.style.display = 'none';
  document.getElementById('submit-order-btn').style.display = 'inline-block';
}

async function doActualSubmit(order){
  const toast = document.getElementById('order-toast');
  const btn = document.getElementById('submit-order-btn');
  btn.disabled = true;

  // Turnstile is currently disabled (see index.html) — this stays empty,
  // and the submit-order function skips verification entirely as long as
  // TURNSTILE_SECRET_KEY isn't set on the backend. Re-enabling later just
  // means restoring the widget in index.html and setting that secret again.
  const turnstileToken = '';

  try{
    const inserted = await insertOrder(order, turnstileToken);
    setLastSubmitTime();
    showOrderConfirmation(inserted);
    document.querySelectorAll('#order-materials-body .qty-input').forEach(i => i.value = 0);
    document.getElementById('order-username').value = '';
    document.getElementById('order-name').value = '';
    document.getElementById('order-contact').value = '';
    document.getElementById('order-note').value = '';
    linkedPlans = [];
    renderLinkedPlans();
    clearDraftOrder();
    toast.textContent = '';
    updateOrderTotals();
    updatePendingBadge();
    applyCooldownState();
  }catch(e){
    setToastError(toast, e.message || 'Could not submit order — try again.');
    btn.disabled = false;
  }
}

function showOrderConfirmation(order){
  const cur = order.currency || 'NCC';
  const body = document.getElementById('order-confirmation-body');
  body.innerHTML = `
    <div class="ticket">
      <div class="ticket-head">
        <div>
          <div class="ticket-id">TICKET #${order.id.slice(-6).toUpperCase()}</div>
          <div class="ticket-customer">${escapeHtml(order.customerName.toUpperCase())}</div>
          ${order.username ? `<div class="ticket-note">User: ${escapeHtml(order.username)}</div>` : ''}
          ${order.pickupLocation ? `<div class="ticket-note">Pickup: ${escapeHtml(order.pickupLocation)}</div>` : ''}
          ${order.requestedDate ? `<div class="ticket-note">Requested arrival: ${escapeHtml(order.requestedDate)}</div>` : ''}
        </div>
        <div style="text-align:right;">
          <span class="status-badge status-pending">pending</span>
        </div>
      </div>
      ${orderTimelineHtml(order)}
      ${progressBadgeHtml(order)}
      ${physicalsBarHtml(order)}
      <div class="ticket-body">
        <table>
          <thead><tr><th>Material</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Subtotal</th><th class="num">Produced</th><th class="num">% Ready</th></tr></thead>
          <tbody>${ticketRowsHtml(order)}</tbody>
        </table>
        ${order.note ? `<div class="buyer-note-display"><span class="buyer-note-tag">Your note</span>${escapeHtml(order.note)}</div>` : ''}
      </div>
      <div class="ticket-foot">
        <div>
          <div class="ticket-total">${money(order.total, cur)}</div>
          ${order.orderDiscountPercent > 0 ? `<div style="font-size:11px; color:var(--ink-soft); margin-top:2px;">${order.orderDiscountPercent}% order discount applied</div>` : ''}
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <span class="toast" id="copy-ticket-toast"></span>
          <button class="btn btn-ghost btn-small" id="copy-ticket-btn">Copy Ticket #</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('copy-ticket-btn').addEventListener('click', () => copyTicketNumber(order.id.slice(-6).toUpperCase()));
  document.getElementById('order-form-panel').style.display = 'none';
  document.getElementById('order-confirmation-panel').style.display = 'block';
}

async function copyTicketNumber(ticketCode){
  const toast = document.getElementById('copy-ticket-toast');
  try{
    await navigator.clipboard.writeText(ticketCode);
    if(toast){
      setToastSuccess(toast, 'Copied to clipboard!', 2000);
    }
  }catch(e){
    console.error('Copy failed:', e);
    if(toast){
      setToastError(toast, 'Could not copy — select it manually.');
    }
  }
}

function returnToOrderForm(){
  document.getElementById('order-confirmation-panel').style.display = 'none';
  document.getElementById('order-form-panel').style.display = 'block';
  applyCooldownState();
}

/* ---------- Seller: materials manager ---------- */
