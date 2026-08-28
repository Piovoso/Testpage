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
function hideSpinner(containerEl){
  if(!containerEl) return;
  const overlay = containerEl.querySelector('.spinner-overlay');
  if(overlay) overlay.remove();
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
    return `
    <tr>
      <td>${escapeHtml(it.name)}</td>
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
