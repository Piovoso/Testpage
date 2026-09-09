/* SELLER: ORDERS — The Orders tab: filtering, search, sorting, pagination, status pipeline actions, comments, quantity editing, and production progress. Master-detail layout: a compact list on the left, full ticket detail for whichever order is selected on the right. */

let orderStatusFilter = 'pending';
let orderSortDirection = 'desc';
let orderSearchTerm = '';
let editingOrderId = null;

async function ensureMaterialDemandLoaded(){
  if(materialDemandCache) return;
  materialDemandCache = await loadMaterialDemand();
  renderOrderDetail();
}

/* Order isn't ready until every material in it is — the estimate is
   whichever material finishes last, not a sum across different materials
   (they're usually different production lines/recipes, not one combined
   rate). totalDemand comes from the server: everyone currently in the
   queue needing that material, not just this order — matching the whole
   point of an "estimated wait" being queue-aware. */
function estimateOrderReady(order){
  if(!materialDemandCache) return null;
  let maxDays = 0;
  let unknown = false;
  const perMaterial = order.items.map(it => {
    const mat = materials.find(m => m.id === it.materialId);
    const stockpile = mat ? (Number(mat.stockpile) || 0) : 0;
    const rate = mat ? (Number(mat.productionPerDay) || 0) : 0;
    const totalDemand = materialDemandCache[it.materialId] || 0;
    const shortfall = Math.max(0, totalDemand - stockpile);
    let days = 0;
    if(shortfall > 0){
      if(rate > 0){
        days = shortfall / rate;
        if(days > maxDays) maxDays = days;
      }else{
        unknown = true;
      }
    }
    return { name: it.name, totalDemand, stockpile, rate, shortfall, days };
  });
  return { maxDays, unknown, perMaterial };
}

/* Renders the section built on estimateOrderReady() above. Shown for any
   active order (not delivered/denied), hidden while editing quantities
   since the numbers would be mid-change and misleading. */
function estimatedReadyHtml(order){
  const est = estimateOrderReady(order);
  if(!est){
    return `
      <div class="odc-section">
        <div class="odc-section-label">Estimated Ready</div>
        <div class="odc-estimate-headline odc-estimate-loading">Loading…</div>
      </div>
    `;
  }
  const { maxDays, unknown, perMaterial } = est;

  let headline;
  if(unknown){
    headline = `<span class="odc-estimate-unknown">Unknown — set a production rate for at least one material below to estimate this.</span>`;
  }else if(maxDays <= 0){
    headline = `<span class="odc-estimate-ready">Ready now — stockpile covers the current queue.</span>`;
  }else{
    const rounded = Math.ceil(maxDays * 10) / 10;
    headline = `<span class="odc-estimate-days">~${rounded} day${rounded !== 1 ? 's' : ''}</span>`;
  }

  const rows = perMaterial.map(pm => {
    let estText;
    if(pm.shortfall <= 0) estText = 'covered';
    else if(pm.rate <= 0) estText = 'no rate set';
    else estText = `~${Math.ceil(pm.days * 10) / 10}d`;
    return `
      <tr>
        <td>${escapeHtml(pm.name)}</td>
        <td class="num">${pm.totalDemand}</td>
        <td class="num">${pm.stockpile}</td>
        <td class="num">${pm.rate || '—'}</td>
        <td class="num">${estText}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="odc-section">
      <div class="odc-section-label">Estimated Ready</div>
      <div class="odc-estimate-headline">${headline}</div>
      <table class="odc-table odc-estimate-table">
        <thead><tr><th>Material</th><th class="num">Queue Needs</th><th class="num">Stockpile</th><th class="num">Rate/Day</th><th class="num">Est.</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="odc-estimate-note">"Queue Needs" is the total outstanding amount across every active order, not just this one — matches what's actually ahead of it.</div>
    </div>
  `;
}


let selectedOrderId = null;
let orderMenuOpen = false;
let ordersPageSize = 10;
let ordersCurrentPage = 1;
let ordersTotalCount = 0;

async function renderOrdersList(){
  const list = document.getElementById('orders-list');
  const subText = document.getElementById('orders-sub-text');
  const filterTabsEl = document.getElementById('order-filter-tabs');
  const isSearching = orderSearchTerm.trim().length > 0;
  let pageOrders;

  if(demoMode){
    let baseList;
    if(isSearching){
      const term = orderSearchTerm.trim().toLowerCase();
      baseList = orders.filter(o =>
        o.id.slice(-6).toLowerCase().includes(term) ||
        o.customerName.toLowerCase().includes(term) ||
        (o.username || '').toLowerCase().includes(term)
      );
    }else{
      baseList = orders.filter(o => o.status === orderStatusFilter);
    }
    const sorted = [...baseList].sort((a, b) => {
      const diff = new Date(b.createdAt) - new Date(a.createdAt);
      return orderSortDirection === 'desc' ? diff : -diff;
    });
    ordersTotalCount = sorted.length;
    const offset = (ordersCurrentPage - 1) * ordersPageSize;
    pageOrders = sorted.slice(offset, offset + ordersPageSize);

    ['pending', 'confirmed', 'production', 'delivered', 'denied'].forEach(s => {
      const tabBtn = document.querySelector(`#order-filter-tabs [data-status-filter="${s}"]`);
      if(tabBtn) tabBtn.classList.toggle('active', !isSearching && s === orderStatusFilter);
      const countEl = document.getElementById('filter-count-' + s);
      if(countEl) countEl.textContent = '(' + orders.filter(o => o.status === s).length + ')';
    });
  }else{
    showSpinner(list, 'Loading orders…');
    let result;
    try{
      result = await callListOrders('sellerList', {
        status: orderStatusFilter,
        search: orderSearchTerm.trim(),
        sort: orderSortDirection,
        limit: ordersPageSize,
        offset: (ordersCurrentPage - 1) * ordersPageSize
      });
    }catch(e){
      console.error('Could not load orders:', e);
      list.innerHTML = `<div class="empty-state">Could not load orders — check the browser console for details.</div>`;
      return;
    }
    pageOrders = (result.orders || []).map(dbToOrder);
    orders = pageOrders;
    ordersTotalCount = result.totalCount || 0;

    ['pending', 'confirmed', 'production', 'delivered', 'denied'].forEach(s => {
      const tabBtn = document.querySelector(`#order-filter-tabs [data-status-filter="${s}"]`);
      if(tabBtn) tabBtn.classList.toggle('active', !isSearching && s === orderStatusFilter);
      const countEl = document.getElementById('filter-count-' + s);
      if(countEl) countEl.textContent = '(' + (result.counts && result.counts[s] || 0) + ')';
    });
  }

  filterTabsEl.style.opacity = isSearching ? '0.45' : '1';
  subText.textContent = isSearching
    ? `Searching every order status for "${orderSearchTerm.trim()}".`
    : `Showing ${ordersPageSize} orders per page in the selected status.`;

  const totalPages = Math.max(1, Math.ceil(ordersTotalCount / ordersPageSize));

  // If a filter/search change left us on a page beyond what's actually
  // available, snap back to the last real page and refetch once, rather
  // than showing a confusing empty page when earlier pages have results.
  if(pageOrders.length === 0 && ordersTotalCount > 0 && ordersCurrentPage > totalPages){
    ordersCurrentPage = totalPages;
    return renderOrdersList();
  }

  if(pageOrders.length === 0){
    list.innerHTML = isSearching
      ? `<div class="empty-state">No orders match "${escapeHtml(orderSearchTerm.trim())}".</div>`
      : `<div class="empty-state">No ${STATUS_LABELS[orderStatusFilter]} orders.</div>`;
    selectedOrderId = null;
  }else{
    if(!pageOrders.some(o => o.id === selectedOrderId)){
      selectedOrderId = pageOrders[0].id;
    }
    list.innerHTML = pageOrders.map(order => buildOrderRowHtml(order)).join('');
    list.querySelectorAll('[data-select-order]').forEach(row => {
      row.addEventListener('click', () => {
        if(row.dataset.selectOrder === selectedOrderId) return;
        if(editingOrderId) delete pendingNewOrderItems[editingOrderId];
        selectedOrderId = row.dataset.selectOrder;
        editingOrderId = null;
        orderMenuOpen = false;
        list.querySelectorAll('.order-row').forEach(r => r.classList.toggle('selected', r.dataset.selectOrder === selectedOrderId));
        renderOrderDetail();
      });
    });
  }

  document.getElementById('orders-page-label').textContent = `Page ${ordersCurrentPage} of ${totalPages}`;
  document.getElementById('orders-prev-page-btn').disabled = ordersCurrentPage <= 1;
  document.getElementById('orders-next-page-btn').disabled = ordersCurrentPage >= totalPages;

  renderOrderDetail();
}

function buildOrderRowHtml(order){
  const dt = new Date(order.createdAt);
  const dateStr = dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' + dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const { percent } = calcOrderReadiness(order);
  const isSelected = order.id === selectedOrderId;
  return `
    <div class="order-row ${isSelected ? 'selected' : ''}" data-select-order="${order.id}">
      <div class="row-id">#${order.id.slice(-6).toUpperCase()}</div>
      <div class="row-company">${escapeHtml(order.username || '')} — ${escapeHtml(order.customerName)}</div>
      <div class="row-meta"><span>${escapeHtml(order.pickupLocation || '')}</span><span>${dateStr}</span></div>
      <div class="row-bottom">
        <span class="status-badge status-${order.status}">${STATUS_LABELS[order.status]}</span>
        <span class="row-progress">${Math.round(percent)}% ready</span>
      </div>
    </div>
  `;
}

function renderOrderDetail(){
  const panel = document.getElementById('order-detail-panel');
  const order = orders.find(o => o.id === selectedOrderId);
  if(!order){
    panel.innerHTML = `<div class="empty-state">Select an order from the list.</div>`;
    return;
  }

  const dt = new Date(order.createdAt);
  const dateStr = dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' + dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const cur = order.currency || 'NCC';

  if(!demoMode) ensureMaterialDemandLoaded(); // fire-and-forget; guarded, cheap after the first call

  let stampHtml = '';
  if(order.status === 'confirmed') stampHtml = '<div class="stamp">CONFIRMED</div>';
  if(order.status === 'production') stampHtml = '<div class="stamp stamp-production">IN PRODUCTION</div>';
  if(order.status === 'delivered') stampHtml = '<div class="stamp stamp-delivered">DELIVERED</div>';
  if(order.status === 'denied') stampHtml = '<div class="stamp stamp-denied">DENIED</div>';

  const statusClass = 'status-' + order.status;

  let statusBtns = '';
  if(order.status === 'pending'){
    statusBtns = `<button class="btn btn-primary btn-small" data-advance="${order.id}">Confirm Order</button><button class="btn btn-deny btn-small" data-deny="${order.id}">Deny / Cancel</button>`;
  }else if(order.status === 'delivered'){
    statusBtns = `<button class="btn btn-ghost btn-small" data-revert="${order.id}">Revert to Production</button>`;
  }else if(order.status === 'denied'){
    statusBtns = `<button class="btn btn-ghost btn-small" data-restore="${order.id}">Restore to Pending</button>`;
  }else{
    statusBtns = `<button class="btn btn-primary btn-small" data-advance="${order.id}">${NEXT_LABEL[order.status]}</button><button class="btn btn-ghost btn-small" data-revert="${order.id}">Back</button>`;
  }

  const isEditing = order.id === editingOrderId;
  const pendingNew = pendingNewOrderItems[order.id] || [];
  const itemsHtml = isEditing
    ? order.items.map(it => {
        const produced = Math.max(0, Math.min(it.qty, Number(it.producedQty) || 0));
        const pct = it.qty > 0 ? Math.round((produced / it.qty) * 100) : 0;
        const mat = materials.find(m => m.id === it.materialId);
        return `
        <tr>
          <td>${materialTickerChip(it.name, mat ? mat.category : null)}</td>
          <td class="num"><input type="number" min="0" step="1" value="${it.qty}" data-seller-qty="${order.id}:${it.materialId}" class="qty-input"></td>
          <td class="num">${money(it.price, cur)}</td>
          <td class="num" id="seller-sub-${order.id}-${it.materialId}">${money(it.subtotal, cur)}</td>
          <td class="num">${produced}</td>
          <td class="num">${pct}%</td>
        </tr>
      `;
      }).join('') + pendingNew.map(it => {
        const mat = materials.find(m => m.id === it.materialId);
        return `
        <tr class="odc-pending-row">
          <td>${materialTickerChip(it.name, mat ? mat.category : null)} <span class="odc-pending-tag">new</span></td>
          <td class="num"><input type="number" min="0" step="1" value="${it.qty}" data-seller-qty="${order.id}:${it.materialId}" class="qty-input"></td>
          <td class="num">${money(it.price, cur)}</td>
          <td class="num" id="seller-sub-${order.id}-${it.materialId}">${money(it.qty * it.price, cur)}</td>
          <td class="num">0</td>
          <td class="num">
            <button class="icon-btn" data-remove-pending="${order.id}:${it.materialId}" title="Remove">✕</button>
          </td>
        </tr>
      `;
      }).join('')
    : ticketRowsHtml(order, true);

  const addMaterialRowHtml = isEditing ? (() => {
    const usedIds = new Set([...order.items.map(i => i.materialId), ...pendingNew.map(i => i.materialId)]);
    const available = materials.filter(m => !usedIds.has(m.id));
    if(available.length === 0) return '';
    return `
      <div class="odc-add-material-row">
        <select id="add-material-select-${order.id}" class="odc-add-material-select">
          ${available.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('')}
        </select>
        <input type="number" min="1" step="1" value="1" id="add-material-qty-${order.id}" class="qty-input" style="width:70px;">
        <button class="btn btn-ghost btn-small" data-add-material="${order.id}">+ Add Material</button>
      </div>
    `;
  })() : '';

  let primaryBtn = '';
  let secondaryBtns = '';
  if(isEditing){
    primaryBtn = `<button class="btn btn-primary btn-small odc-primary-btn" data-save-edit="${order.id}">Save Changes</button>`;
    secondaryBtns = `<button class="btn btn-ghost btn-small" data-cancel-edit="${order.id}">Cancel Edit</button>`;
  }else if(order.status === 'pending'){
    primaryBtn = `<button class="btn btn-primary btn-small odc-primary-btn" data-advance="${order.id}">Confirm Order</button>`;
    secondaryBtns = `<button class="btn btn-deny btn-small" data-deny="${order.id}">Deny / Cancel</button>`;
  }else if(order.status === 'delivered'){
    primaryBtn = `<button class="btn btn-ghost btn-small odc-primary-btn" data-revert="${order.id}">Revert to Production</button>`;
  }else if(order.status === 'denied'){
    primaryBtn = `<button class="btn btn-ghost btn-small odc-primary-btn" data-restore="${order.id}">Restore to Pending</button>`;
  }else{
    primaryBtn = `<button class="btn btn-primary btn-small odc-primary-btn" data-advance="${order.id}">${NEXT_LABEL[order.status]}</button>`;
    secondaryBtns = `<button class="btn btn-ghost btn-small" data-revert="${order.id}">Back</button>`;
  }

  const menuHtml = isEditing ? '' : `
    <div class="dots-menu-wrap">
      <button class="btn btn-ghost btn-small dots-btn" data-toggle-menu="${order.id}">⋮</button>
      ${orderMenuOpen === order.id ? `
        <div class="dots-menu">
          <div class="dots-menu-item" data-edit-order="${order.id}">Edit Quantities</div>
          <div class="dots-menu-item" data-export-xit="${order.id}">Copy XIT ACT (Transfer)</div>
          <div class="dots-menu-item" data-export-xit-contract="${order.id}">Copy XIT ACT (Contract)</div>
          ${(order.status === 'delivered' || order.status === 'denied') ? `<div class="dots-menu-item danger" data-delete="${order.id}">Delete</div>` : ''}
        </div>
      ` : ''}
    </div>
  `;

  const { percent } = calcOrderReadiness(order);
  const pctRounded = Math.round(percent);

  panel.innerHTML = `
    <div class="ticket odc">
      <div class="odc-header">
        <div>
          <div class="odc-id-row">
            <span class="odc-id">#${order.id.slice(-6).toUpperCase()}</span>
            <span class="odc-status-inline"><span class="dot ${order.status}"></span>${STATUS_LABELS[order.status].toUpperCase()}</span>
          </div>
          ${order.username ? `<div class="odc-username">${escapeHtml(order.username)}</div>` : ''}
        </div>
        <div style="text-align:right;">
          <div class="odc-total" id="seller-edit-total-${order.id}">${money(order.total, cur)}</div>
          ${order.orderDiscountPercent > 0 ? `<div style="font-size:11px; color:var(--ink-soft); margin-top:2px;">${order.orderDiscountPercent}% order discount</div>` : ''}
        </div>
      </div>

      <div class="odc-section">
        <div class="odc-section-label">Customer / Pickup</div>
        <div class="odc-two-col">
          <div class="odc-value">${escapeHtml(order.customerName)}</div>
          <div class="odc-value">${escapeHtml(order.pickupLocation || '—')}</div>
        </div>
        ${order.contact ? `<div class="odc-subtext">Discord: ${escapeHtml(order.contact)}</div>` : ''}
      </div>

      <div class="odc-section">
        <div class="odc-section-label">Progress</div>
        <div class="odc-progress-row">
          <div class="progress-track"><div class="progress-fill" style="width:${pctRounded}%;"></div></div>
          <span class="odc-progress-pct">${pctRounded}%</span>
        </div>
      </div>

      ${physicalsBarHtml(order)}

      <div class="odc-section">
        <div class="odc-section-label">Materials</div>
        ${isEditing ? `
          <div class="edit-currency-pickup-row">
            <div>
              <label>Currency</label>
              <select data-edit-currency="${order.id}">
                ${currencyOptions.map(c => `<option value="${escapeAttr(c)}" ${c === order.currency ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label>Pickup Location</label>
              <select data-edit-pickup="${order.id}">
                ${pickupLocations.map(p => `<option value="${escapeAttr(p)}" ${p === order.pickupLocation ? 'selected' : ''}>${escapeHtml(p)}</option>`).join('')}
              </select>
            </div>
          </div>
        ` : ''}
        <table class="odc-table">
          <thead><tr><th>Material</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Subtotal</th><th class="num">Produced</th><th class="num">Ready</th></tr></thead>
          <tbody>${itemsHtml}</tbody>
        </table>
        ${addMaterialRowHtml}
        ${!isEditing ? `
          <div class="comment-actions" style="margin-top:8px;">
            <button class="btn btn-ghost btn-small" data-save-progress="${order.id}">Save Progress</button>
            <button class="btn btn-ghost btn-small" data-copy-csv="${order.id}" title="Copy as Ticker,Qty,Price CSV">Copy CSV</button>
            <span class="toast" id="progress-toast-${order.id}"></span>
            <span class="toast" id="copy-csv-toast-${order.id}"></span>
          </div>
        ` : ''}
      </div>

      ${(!isEditing && order.status !== 'delivered' && order.status !== 'denied') ? estimatedReadyHtml(order) : ''}

      ${!isEditing ? `
        <div class="odc-section">
          <div class="odc-section-label">Order Discount</div>
          <div class="comment-actions">
            <input type="number" min="0" max="100" step="1" value="${order.orderDiscountPercent || 0}" data-order-discount="${order.id}" class="qty-input" style="width:70px;">
            <span style="font-size:12px; color:var(--ink-soft);">% off the whole order total, on top of each material's own price</span>
            <span class="toast" id="order-discount-toast-${order.id}"></span>
          </div>
        </div>
      ` : ''}

      ${(order.sourcePlans && order.sourcePlans.length) ? `
        <div class="odc-section">
          <div class="odc-section-label">Source Bases</div>
          <div class="odc-pills">
            ${order.sourcePlans.map(p => `<a class="odc-pill" href="${escapeAttr(p.url)}" target="_blank" rel="noopener">${escapeHtml(p.planetId)} ↗</a>`).join('')}
          </div>
        </div>
      ` : ''}

      ${order.note ? `
        <div class="odc-section">
          <div class="odc-section-label">Customer Note</div>
          <div class="odc-note">"${escapeHtml(order.note)}"</div>
        </div>
      ` : ''}

      <div class="odc-section">
        <div class="odc-section-label">Reply to Customer</div>
        <textarea data-comment-input="${order.id}" placeholder="e.g. Backordered on rebar, ETA Friday.">${escapeHtml(order.sellerComment || '')}</textarea>
        <div class="comment-actions">
          <button class="btn btn-ghost btn-small" data-save-comment="${order.id}">Save Comment</button>
          <span class="toast" id="comment-toast-${order.id}"></span>
        </div>
      </div>

      <div class="odc-section">
        <div class="odc-section-label">Activity</div>
        ${latestActivityHtml(order)}
      </div>

      <div class="odc-actions">
        ${primaryBtn}
        <div class="odc-actions-secondary">
          ${secondaryBtns}
          ${menuHtml}
        </div>
      </div>
    </div>
  `;

  panel.querySelectorAll('[data-advance]').forEach(btn => {
    btn.addEventListener('click', () => setOrderStatus(btn.dataset.advance, NEXT_STATUS[order.status]));
  });
  panel.querySelectorAll('[data-deny]').forEach(btn => {
    btn.addEventListener('click', () => setOrderStatus(btn.dataset.deny, 'denied'));
  });
  panel.querySelectorAll('[data-revert]').forEach(btn => {
    btn.addEventListener('click', () => setOrderStatus(btn.dataset.revert, PREV_STATUS[order.status]));
  });
  panel.querySelectorAll('[data-restore]').forEach(btn => {
    btn.addEventListener('click', () => setOrderStatus(btn.dataset.restore, 'pending'));
  });
  panel.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); armDeleteButton(btn, () => deleteOrder(btn.dataset.delete)); });
  });
  panel.querySelectorAll('[data-save-comment]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.saveComment;
      const textarea = panel.querySelector(`[data-comment-input="${id}"]`);
      saveOrderComment(id, textarea.value);
    });
  });
  panel.querySelectorAll('[data-produced-input]').forEach(inp => {
    inp.addEventListener('input', () => recalcProducedProgress(order, inp));
  });
  panel.querySelectorAll('[data-save-progress]').forEach(btn => {
    btn.addEventListener('click', () => saveOrderProgress(order));
  });
  panel.querySelectorAll('[data-add-material]').forEach(btn => {
    btn.addEventListener('click', () => addPendingOrderMaterial(order));
  });
  panel.querySelectorAll('[data-remove-pending]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [orderId, materialId] = btn.dataset.removePending.split(':');
      const list = pendingNewOrderItems[orderId];
      if(list){
        pendingNewOrderItems[orderId] = list.filter(i => i.materialId !== materialId);
        if(pendingNewOrderItems[orderId].length === 0) delete pendingNewOrderItems[orderId];
      }
      renderOrderDetail();
    });
  });
  panel.querySelectorAll('[data-copy-csv]').forEach(btn => {
    btn.addEventListener('click', () => copyOrderCsv(order));
  });
  panel.querySelectorAll('[data-order-discount]').forEach(inp => {
    inp.addEventListener('input', () => scheduleOrderDiscountAutoSave(order));
  });
  panel.querySelectorAll('[data-toggle-menu]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      orderMenuOpen = orderMenuOpen === order.id ? false : order.id;
      renderOrderDetail();
    });
  });
  panel.querySelectorAll('[data-edit-order]').forEach(el => {
    el.addEventListener('click', () => { orderMenuOpen = false; toggleOrderEdit(el.dataset.editOrder); });
  });
  panel.querySelectorAll('[data-export-xit]').forEach(el => {
    el.addEventListener('click', () => { orderMenuOpen = false; renderOrderDetail(); exportXitActTransfer(order); });
  });
  panel.querySelectorAll('[data-export-xit-contract]').forEach(el => {
    el.addEventListener('click', () => { orderMenuOpen = false; renderOrderDetail(); exportXitActContract(order); });
  });
  panel.querySelectorAll('[data-cancel-edit]').forEach(btn => {
    btn.addEventListener('click', () => toggleOrderEdit(null));
  });
  panel.querySelectorAll('[data-seller-qty]').forEach(inp => {
    inp.addEventListener('input', () => recalcSellerEditTotal(order));
  });
  panel.querySelectorAll('[data-save-edit]').forEach(btn => {
    btn.addEventListener('click', () => saveSellerOrderEdit(order));
  });
  enhanceNumberInputsIn(panel, 'input.qty-input', 'stacked');
}

document.addEventListener('click', () => {
  if(orderMenuOpen){ orderMenuOpen = false; renderOrderDetail(); }
});

function goToOrdersPage(delta){
  ordersCurrentPage = Math.max(1, ordersCurrentPage + delta);
  renderOrdersList();
}

function setOrdersPageSize(size){
  ordersPageSize = size;
  ordersCurrentPage = 1;
  renderOrdersList();
}

function setOrderFilter(status){
  orderStatusFilter = status;
  orderSearchTerm = '';
  const searchInput = document.getElementById('order-search-input');
  if(searchInput) searchInput.value = '';
  ordersCurrentPage = 1;
  selectedOrderId = null;
  renderOrdersList();
}

function setOrderSort(direction){
  orderSortDirection = direction;
  ordersCurrentPage = 1;
  renderOrdersList();
}

function setOrderSearch(term){
  orderSearchTerm = term;
  ordersCurrentPage = 1;
  selectedOrderId = null;
  renderOrdersList();
}

const pendingNewOrderItems = {}; // orderId -> staged [{materialId, name, qty, price}] not yet saved

function toggleOrderEdit(id){
  const leavingId = editingOrderId;
  editingOrderId = (editingOrderId === id) ? null : id;
  if(leavingId && leavingId !== editingOrderId){
    delete pendingNewOrderItems[leavingId]; // discard any unsaved "add material" rows
  }
  renderOrderDetail();
}

function recalcSellerEditTotal(order){
  let total = 0;
  const allItems = [...order.items, ...(pendingNewOrderItems[order.id] || [])];
  allItems.forEach(it => {
    const inp = document.querySelector(`[data-seller-qty="${order.id}:${it.materialId}"]`);
    if(!inp) return;
    const qty = Math.max(0, parseFloat(inp.value) || 0);
    const subtotal = qty * it.price;
    total += subtotal;
    const cell = document.getElementById(`seller-sub-${order.id}-${it.materialId}`);
    if(cell) cell.textContent = money(subtotal, order.currency || 'NCC');
  });
  const totalEl = document.getElementById(`seller-edit-total-${order.id}`);
  if(totalEl) totalEl.textContent = money(total, order.currency || 'NCC');
}

/* Staging a new material onto an order being edited. Nothing is sent to
   the server here — it just adds a row to pendingNewOrderItems, which
   renderOrderDetail() displays alongside the real items, and
   saveSellerOrderEdit() merges in when the whole edit is actually saved.
   Cancelling the edit (toggleOrderEdit) discards it entirely. */
function addPendingOrderMaterial(order){
  const select = document.getElementById(`add-material-select-${order.id}`);
  const qtyInput = document.getElementById(`add-material-qty-${order.id}`);
  if(!select || !select.value) return;
  const mat = materials.find(m => m.id === select.value);
  if(!mat) return;
  const qty = Math.max(1, parseFloat(qtyInput.value) || 1);
  if(!pendingNewOrderItems[order.id]) pendingNewOrderItems[order.id] = [];
  pendingNewOrderItems[order.id].push({ materialId: mat.id, name: mat.name, qty, price: mat.price });
  renderOrderDetail();
}

async function saveSellerOrderEdit(order){
  const toast = document.getElementById(`seller-edit-toast-${order.id}`);
  const newItems = [];
  order.items.forEach(it => {
    const inp = document.querySelector(`[data-seller-qty="${order.id}:${it.materialId}"]`);
    const qty = inp ? Math.max(0, parseFloat(inp.value) || 0) : it.qty;
    if(qty > 0) newItems.push({ materialId: it.materialId, qty });
  });
  (pendingNewOrderItems[order.id] || []).forEach(it => {
    const inp = document.querySelector(`[data-seller-qty="${order.id}:${it.materialId}"]`);
    const qty = inp ? Math.max(0, parseFloat(inp.value) || 0) : it.qty;
    if(qty > 0) newItems.push({ materialId: it.materialId, qty });
  });
  if(newItems.length === 0){
    if(toast){
      setToastError(toast, 'Order must have at least one item — deny/cancel it instead.');
    }
    return;
  }
  const currencyInp = document.querySelector(`[data-edit-currency="${order.id}"]`);
  const pickupInp = document.querySelector(`[data-edit-pickup="${order.id}"]`);
  const newCurrency = currencyInp ? currencyInp.value : order.currency;
  const newPickup = pickupInp ? pickupInp.value : order.pickupLocation;
  try{
    const result = await callManageOrder('editQuantities', { id: order.id, items: newItems, currency: newCurrency, pickupLocation: newPickup });
    if(demoMode){
      const updated = newItems.map(ni => {
        const existing = order.items.find(it => it.materialId === ni.materialId);
        const producedQty = Math.min(ni.qty, Number(existing?.producedQty) || 0);
        return { materialId: ni.materialId, name: existing?.name || ni.materialId, qty: ni.qty, price: existing?.price || 0, subtotal: +(ni.qty * (existing?.price || 0)).toFixed(2), producedQty };
      });
      order.items = updated;
      const rawSum = updated.reduce((s, i) => s + i.subtotal, 0);
      const discount = Math.min(100, Math.max(0, Number(order.orderDiscountPercent) || 0));
      order.total = +(rawSum * (1 - discount / 100)).toFixed(2);
      order.currency = newCurrency;
      order.pickupLocation = newPickup;
    }else{
      order.items = result.items;
      order.total = result.total;
      order.currency = result.currency;
      order.pickupLocation = result.pickupLocation;
    }
    editingOrderId = null;
    delete pendingNewOrderItems[order.id];
    materialDemandCache = null; // quantities/materials changed — outstanding demand did too
    renderOrdersList();
    updatePendingBadge();
  }catch(e){
    console.error('Seller order edit failed:', e);
    if(toast){
      setToastError(toast, e.message || 'Could not save changes.');
    }
  }
}

async function setOrderStatus(id, status){
  const order = orders.find(o => o.id === id);
  if(!order || !status) return;
  try{
    await callManageOrder('setStatus', { id, newStatus: status });
    order.status = status;
    order.handledBy = sellerName;
    materialDemandCache = null; // this order's status just changed — its contribution to the queue may have too
    renderOrdersList();
    updatePendingBadge();
  }catch(e){
    console.error(e);
    const toast = document.getElementById('order-toast');
    if(toast){
      setToastError(toast, e.message || 'Could not update this order.');
    }
  }
}

async function saveOrderComment(id, text){
  const order = orders.find(o => o.id === id);
  if(!order) return;
  const toast = document.getElementById('comment-toast-' + id);
  try{
    await callManageOrder('saveComment', { id, comment: text.trim() });
    order.sellerComment = text.trim();
    if(toast){
      setToastSuccess(toast, 'Saved.', 2000);
    }
  }catch(e){
    console.error(e);
    if(toast){
      setToastError(toast, e.message || 'Could not save.');
    }
  }
}

function recalcProducedProgress(order, changedInput){
  const materialId = changedInput.dataset.producedInput.split(':')[1];
  const item = order.items.find(i => i.materialId === materialId);
  if(!item) return;
  let val = Math.max(0, parseFloat(changedInput.value) || 0);
  if(val > item.qty){ val = item.qty; changedInput.value = val; }
  item.producedQty = val;

  const row = changedInput.closest('tr');
  if(row){
    const pctCell = row.children[row.children.length - 1];
    const pct = item.qty > 0 ? Math.round((val / item.qty) * 100) : 0;
    if(pctCell) pctCell.textContent = pct + '%';
  }

  const ticket = changedInput.closest('.ticket');
  if(ticket){
    const { percent } = calcOrderReadiness(order);
    const pctRounded = Math.round(percent);
    const fill = ticket.querySelector('.progress-fill');
    const label = ticket.querySelector('.odc-progress-pct');
    if(fill) fill.style.width = pctRounded + '%';
    if(label) label.textContent = pctRounded + '%';
  }
}

async function saveOrderProgress(order){
  const toast = document.getElementById('progress-toast-' + order.id);
  const produced = {};
  order.items.forEach(it => {
    const inp = document.querySelector(`[data-produced-input="${order.id}:${it.materialId}"]`);
    produced[it.materialId] = inp ? Math.max(0, Math.min(it.qty, parseFloat(inp.value) || 0)) : (it.producedQty || 0);
  });
  try{
    const result = await callManageOrder('saveProduction', { id: order.id, produced });
    if(demoMode){
      order.items = order.items.map(it => {
        const raw = produced[it.materialId];
        if(raw === undefined) return it;
        return { ...it, producedQty: Math.max(0, Math.min(it.qty, raw)) };
      });
    }else{
      order.items = result.items;
    }
    if(toast){
      setToastSuccess(toast, 'Saved.', 2000);
    }
    materialDemandCache = null; // producedQty changed — outstanding demand did too
    // Keep the list row's mini progress % in sync without a full refetch.
    const row = document.querySelector(`[data-select-order="${order.id}"]`);
    if(row){
      const { percent } = calcOrderReadiness(order);
      const progEl = row.querySelector('.row-progress');
      if(progEl) progEl.textContent = Math.round(percent) + '% ready';
    }
  }catch(e){
    console.error('Save progress failed:', e);
    if(toast){
      setToastError(toast, e.message || 'Could not save.');
    }
  }
}

/* Two-step inline confirm: sandboxed artifact iframes block window.confirm(),
   so the first click arms the button and the second (within 4s) deletes. */
function armDeleteButton(btn, action){
  if(btn.dataset.armed === 'true'){
    if(action) action(); else deleteOrder(btn.dataset.delete);
    return;
  }
  btn.dataset.armed = 'true';
  const original = btn.textContent;
  btn.textContent = 'Click again to confirm';
  setTimeout(() => {
    if(btn.dataset.armed === 'true'){
      btn.dataset.armed = 'false';
      btn.textContent = original;
    }
  }, 4000);
}

async function deleteOrder(id){
  try{
    await callManageOrder('deleteOrder', { id });
    if(demoMode) orders = orders.filter(o => o.id !== id);
    if(selectedOrderId === id) selectedOrderId = null;
    renderOrdersList();
    updatePendingBadge();
  }catch(e){
    console.error(e);
  }
}

/* Exports a Refined PrUn "XIT ACT" action package — a JSON file that,
   imported into that extension's XIT ACT buffer in-game, sets up a ready-
   to-run in-game material transfer (MTRA) matching this order's items.
   Origin/destination are deliberately left as "Configure on Execution" —
   the extension's own sentinel for "let me pick this when I actually run
   it" — since a web app has no way of knowing anyone's real in-game
   storage IDs. Schema confirmed directly from refined-prun's own source
   (UserData.ActionPackageData in src/store/user-data.types.d.ts), not
   guessed — see the ACT.ts / MTRA_TRANSFER.ts action-step files, and the
   'Configure on Execution' constant in shared-types.ts. */
const XIT_ACT_CONFIGURE_ON_EXECUTION = 'Configure on Execution';

function buildXitActTransferPackage(order){
  const groupName = `Order ${order.id.slice(-6).toUpperCase()}`;
  const materials = {};
  order.items.forEach(it => {
    materials[String(it.name).toUpperCase()] = it.qty;
  });

  // Real-world testing showed "Configure on Execution" for BOTH origin and
  // destination doesn't actually work, even though it's technically valid
  // per the extension's own validation logic — only destination should be
  // left configurable. Origin needs to be your real saved storage name
  // (Seller Settings), falling back to the sentinel only if you haven't
  // set one yet.
  const origin = xitActOrigin && xitActOrigin.trim() ? xitActOrigin.trim() : XIT_ACT_CONFIGURE_ON_EXECUTION;

  return {
    global: { name: `${order.customerName} ${order.id.slice(-6).toUpperCase()} Transfer` },
    groups: [
      {
        materials,
        name: groupName,
        type: 'Manual'
      }
    ],
    actions: [
      {
        group: groupName,
        origin,
        dest: XIT_ACT_CONFIGURE_ON_EXECUTION,
        name: `Transfer materials for ${order.customerName}`,
        type: 'MTRA'
      }
    ]
  };
}

async function exportXitActTransfer(order){
  if(!xitActOrigin || !xitActOrigin.trim()){
    console.warn('No XIT ACT origin storage set (Seller Settings) — the copied package will use the "Configure on Execution" placeholder for origin too, which real-world testing showed does not reliably import.');
  }
  const pkg = buildXitActTransferPackage(order);
  // Compact, single line — matches exactly what refined-prun's own
  // downloadJson() produces by default (no pretty-print), and avoids the
  // multi-line-paste-mangling issue their "Paste JSON" field has.
  const jsonString = JSON.stringify(pkg);
  const toast = document.getElementById(`copy-csv-toast-${order.id}`);
  try{
    await navigator.clipboard.writeText(jsonString);
    if(toast) setToastSuccess(toast, 'Transfer JSON copied!', 2500);
  }catch(e){
    console.error('Copy failed:', e);
    if(toast) setToastError(toast, 'Could not copy — check browser permissions.');
  }
}

/* Same idea as the transfer export, but a "CONT Trade" action instead —
   sets up a selling contract in-game. Schema confirmed against a real
   working export, not guessed: unlike the transfer, contLocation and
   currency both come straight from the order itself (the buyer's chosen
   pickup location and currency), not a saved seller setting — those are
   genuinely order-specific here, not something we'd need you to configure
   once. daysToFulfill has no real order-derived equivalent, so it's a
   simple fixed default matching the confirmed working example. */
function buildXitActContractPackage(order){
  const groupName = `Order ${order.id.slice(-6).toUpperCase()}`;

  return {
    global: { name: `${order.customerName} ${order.id.slice(-6).toUpperCase()} Contract` },
    groups: [
      {
        name: groupName,
        type: 'Paste'
      }
    ],
    actions: [
      {
        group: groupName,
        contTradeType: 'SELLING',
        contLocation: order.pickupLocation || '',
        currency: order.currency || 'NCC',
        daysToFulfill: contractDaysToFulfill || '7',
        name: `Contract for ${order.customerName}`,
        type: 'CONT Trade'
      }
    ]
  };
}

/* Copies the order's items as plain CSV text — Ticker,Qty,Price per line,
   no header row. Same clipboard pattern as the buyer's "Copy Ticket #"
   (navigator.clipboard with a graceful fallback message if the browser
   blocks it). */
/* Order-level discount % — applied on top of each material's own price,
   to the order's whole total. Auto-saves the same debounced way the
   Materials tab's Discount % field does: wait ~700ms after the last
   keystroke, then persist. The server recomputes the real total from the
   order's own current items (never trusts a client-sent total), so this
   stays correct even if quantities changed since the page loaded. */
const orderDiscountAutoSaveTimers = {};

function scheduleOrderDiscountAutoSave(order){
  if(orderDiscountAutoSaveTimers[order.id]) clearTimeout(orderDiscountAutoSaveTimers[order.id]);
  orderDiscountAutoSaveTimers[order.id] = setTimeout(() => autoSaveOrderDiscount(order), 700);
}

async function autoSaveOrderDiscount(order){
  const inp = document.querySelector(`[data-order-discount="${order.id}"]`);
  const toast = document.getElementById(`order-discount-toast-${order.id}`);
  if(!inp) return;
  const discountPercent = Math.min(100, Math.max(0, parseFloat(inp.value) || 0));
  try{
    const result = await callManageOrder('updateOrderDiscount', { id: order.id, discountPercent });
    order.orderDiscountPercent = discountPercent;
    if(demoMode){
      const rawSum = order.items.reduce((s, i) => s + i.subtotal, 0);
      order.total = +(rawSum * (1 - discountPercent / 100)).toFixed(2);
    }else{
      order.total = result.total;
    }
    const totalEl = document.getElementById(`seller-edit-total-${order.id}`);
    if(totalEl) totalEl.textContent = money(order.total, order.currency || 'NCC');
    setToastSuccess(toast, 'Saved.', 1500);
    // Keep the compact list row's status/date visible but no total shown
    // there today, so nothing else needs refreshing after this.
  }catch(e){
    console.error('Order discount save failed:', e);
    setToastError(toast, e.message || 'Could not save.');
  }
}

async function copyOrderCsv(order){
  const toast = document.getElementById(`copy-csv-toast-${order.id}`);
  const lines = order.items.map(it => `${it.name},${it.qty},${it.price}`);
  const csv = lines.join('\n');
  try{
    await navigator.clipboard.writeText(csv);
    if(toast) setToastSuccess(toast, 'Copied!', 2000);
  }catch(e){
    console.error('Copy failed:', e);
    if(toast) setToastError(toast, 'Could not copy — select it manually.');
  }
}

async function exportXitActContract(order){
  const pkg = buildXitActContractPackage(order);
  const jsonString = JSON.stringify(pkg);
  const toast = document.getElementById(`copy-csv-toast-${order.id}`);
  try{
    await navigator.clipboard.writeText(jsonString);
    if(toast) setToastSuccess(toast, 'Contract JSON copied!', 2500);
  }catch(e){
    console.error('Copy failed:', e);
    if(toast) setToastError(toast, 'Could not copy — check browser permissions.');
  }
}
