/* SELLER: ORDERS — The Orders tab: filtering, search, sorting, pagination, status pipeline actions, comments, quantity editing, and production progress. Master-detail layout: a compact list on the left, full ticket detail for whichever order is selected on the right. */

let orderStatusFilter = 'pending';
let orderSortDirection = 'desc';
let orderSearchTerm = '';
let editingOrderId = null;
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
  const itemsHtml = isEditing
    ? order.items.map(it => {
        const produced = Math.max(0, Math.min(it.qty, Number(it.producedQty) || 0));
        const pct = it.qty > 0 ? Math.round((produced / it.qty) * 100) : 0;
        return `
        <tr>
          <td>${escapeHtml(it.name)}</td>
          <td class="num"><input type="number" min="0" step="1" value="${it.qty}" data-seller-qty="${order.id}:${it.materialId}" class="qty-input"></td>
          <td class="num">${money(it.price, cur)}</td>
          <td class="num" id="seller-sub-${order.id}-${it.materialId}">${money(it.subtotal, cur)}</td>
          <td class="num">${produced}</td>
          <td class="num">${pct}%</td>
        </tr>
      `;
      }).join('')
    : ticketRowsHtml(order, sellerRole === 'admin' || sellerRole === 'employee');

  let footRight;
  if(isEditing){
    footRight = `
      <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
        <div style="display:flex; gap:8px;">
          <button class="btn btn-primary btn-small" data-save-edit="${order.id}">Save Changes</button>
          <button class="btn btn-ghost btn-small" data-cancel-edit="${order.id}">Cancel Edit</button>
        </div>
        <span class="toast" id="seller-edit-toast-${order.id}"></span>
      </div>
    `;
  }else{
    footRight = `
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        ${statusBtns}
        <div class="dots-menu-wrap">
          <button class="btn btn-ghost btn-small dots-btn" data-toggle-menu="${order.id}">⋮</button>
          ${orderMenuOpen === order.id ? `
            <div class="dots-menu">
              <div class="dots-menu-item" data-edit-order="${order.id}">Edit Quantities</div>
              ${(order.status === 'delivered' || order.status === 'denied') ? `<div class="dots-menu-item danger" data-delete="${order.id}">Delete</div>` : ''}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  panel.innerHTML = `
    <div class="ticket">
      ${stampHtml}
      <div class="ticket-head">
        <div>
          <div class="ticket-id">TICKET #${order.id.slice(-6).toUpperCase()}</div>
          <div class="ticket-customer">${escapeHtml(order.customerName)}</div>
          ${order.username ? `<div class="ticket-note">User: ${escapeHtml(order.username)}</div>` : ''}
          ${order.contact ? `<div class="ticket-note">Discord: ${escapeHtml(order.contact)}</div>` : ''}
          ${order.pickupLocation ? `<div class="ticket-note">Pickup: ${escapeHtml(order.pickupLocation)}</div>` : ''}
          ${order.note ? `<div class="ticket-note">"${escapeHtml(order.note)}"</div>` : ''}
          ${(order.sourcePlans && order.sourcePlans.length) ? `<div class="ticket-note">From ${order.sourcePlans.length} base${order.sourcePlans.length !== 1 ? 's' : ''}: ${order.sourcePlans.map(p => `<a href="${escapeAttr(p.url)}" target="_blank" rel="noopener" style="color:var(--accent);">${escapeHtml(p.planetId)}</a>`).join(', ')}</div>` : ''}
        </div>
        <div style="text-align:right;">
          <div class="ticket-date">${dateStr}</div>
          <div style="margin-top:8px;"><span class="status-badge ${statusClass}">${STATUS_LABELS[order.status]}</span></div>
          ${order.handledBy ? `<div class="ticket-date" style="margin-top:6px;">Handled by: ${escapeHtml(order.handledBy)}</div>` : ''}
        </div>
      </div>
      ${progressBadgeHtml(order)}
      ${physicalsBarHtml(order)}
      <div class="ticket-body">
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
        <table>
          <thead><tr><th>Material</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Subtotal</th><th class="num">Produced</th><th class="num">% Ready</th></tr></thead>
          <tbody>${itemsHtml}</tbody>
        </table>
        ${!isEditing ? `
          <div class="comment-box">
            <label>Production progress</label>
            <div class="comment-actions">
              <button class="btn btn-ghost btn-small" data-save-progress="${order.id}">Save Progress</button>
              <span class="toast" id="progress-toast-${order.id}"></span>
            </div>
          </div>
        ` : ''}
        <div class="comment-box">
          <label>Comment for buyer (visible on their status check)</label>
          <textarea data-comment-input="${order.id}" placeholder="e.g. Backordered on rebar, ETA Friday.">${escapeHtml(order.sellerComment || '')}</textarea>
          <div class="comment-actions">
            <button class="btn btn-ghost btn-small" data-save-comment="${order.id}">Save Comment</button>
            <span class="toast" id="comment-toast-${order.id}"></span>
          </div>
        </div>
      </div>
      <div class="ticket-foot">
        <div class="ticket-total" id="seller-edit-total-${order.id}">${money(order.total, cur)}</div>
        ${footRight}
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

function toggleOrderEdit(id){
  editingOrderId = (editingOrderId === id) ? null : id;
  renderOrderDetail();
}

function recalcSellerEditTotal(order){
  let total = 0;
  order.items.forEach(it => {
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

async function saveSellerOrderEdit(order){
  const toast = document.getElementById(`seller-edit-toast-${order.id}`);
  const newItems = [];
  order.items.forEach(it => {
    const inp = document.querySelector(`[data-seller-qty="${order.id}:${it.materialId}"]`);
    const qty = inp ? Math.max(0, parseFloat(inp.value) || 0) : it.qty;
    if(qty > 0) newItems.push({ materialId: it.materialId, qty });
  });
  if(newItems.length === 0){
    if(toast){
      toast.style.color = 'var(--rust)';
      toast.textContent = 'Order must have at least one item — deny/cancel it instead.';
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
      order.total = +updated.reduce((s, i) => s + i.subtotal, 0).toFixed(2);
      order.currency = newCurrency;
      order.pickupLocation = newPickup;
    }else{
      order.items = result.items;
      order.total = result.total;
      order.currency = result.currency;
      order.pickupLocation = result.pickupLocation;
    }
    editingOrderId = null;
    renderOrdersList();
    updatePendingBadge();
  }catch(e){
    console.error('Seller order edit failed:', e);
    if(toast){
      toast.style.color = 'var(--rust)';
      toast.textContent = e.message || 'Could not save changes.';
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
    renderOrdersList();
    updatePendingBadge();
  }catch(e){
    console.error(e);
    const toast = document.getElementById('order-toast');
    if(toast){
      toast.style.color = 'var(--rust)';
      toast.textContent = e.message || 'Could not update this order.';
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
      toast.style.color = 'var(--ok)';
      toast.textContent = 'Saved.';
      setTimeout(() => { if(toast) toast.textContent = ''; }, 2000);
    }
  }catch(e){
    console.error(e);
    if(toast){
      toast.style.color = 'var(--rust)';
      toast.textContent = e.message || 'Could not save.';
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
    const label = ticket.querySelector('.progress-label');
    if(fill) fill.style.width = pctRounded + '%';
    if(label) label.textContent = pctRounded + '% ready';
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
      toast.style.color = 'var(--ok)';
      toast.textContent = 'Saved.';
      setTimeout(() => { if(toast) toast.textContent = ''; }, 2000);
    }
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
      toast.style.color = 'var(--rust)';
      toast.textContent = e.message || 'Could not save.';
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
