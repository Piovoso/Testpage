/* SELLER: STATISTICS — Orders-by-status counts and the Money Waiting currency table. */

async function renderStatistics(){
  const statusGrid = document.getElementById('status-stats-grid');
  if(!statusGrid) return;

  const queueGrid = document.getElementById('queue-length-stat');
  if(queueGrid){
    await ensureMaterialQueueLoaded();
    const perMaterialTotals = {};
    (materialQueueCache || []).forEach(o => {
      o.items.forEach(it => {
        perMaterialTotals[it.materialId] = (perMaterialTotals[it.materialId] || 0) + it.remaining;
      });
    });
    const rows = Object.entries(perMaterialTotals)
      .filter(([, qty]) => qty > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([materialId, qty]) => {
        const mat = materials.find(m => m.id === materialId);
        const est = estimateMaterialDays(materialId, null, 0);
        const estText = !est ? '—' : est.unknown ? 'no rate set' : (est.days <= 0 ? 'covered' : `~${Math.ceil(est.days * 10) / 10}d`);
        return `
          <tr>
            <td>${materialTickerChip(mat ? mat.name : materialId, mat ? mat.category : null)}</td>
            <td class="num">${qty}</td>
            <td class="num">${mat ? (mat.stockpile || 0) : 0}</td>
            <td class="num">${mat ? (mat.productionPerDay || 0) : 0}</td>
            <td class="num">${estText}</td>
          </tr>
        `;
      }).join('');
    queueGrid.innerHTML = rows ? `
      <table class="odc-table">
        <thead><tr><th>Material</th><th class="num">Queue Qty</th><th class="num">Stockpile</th><th class="num">Rate/Day</th><th class="num">Est.</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    ` : `<div class="empty-state">Nothing currently queued.</div>`;
  }

  let statusCounts, currencyTotals;
  try{
    const result = await callListOrders('sellerStats', {});
    statusCounts = result.statusCounts;
    currencyTotals = result.currencyTotals;
  }catch(e){
    console.error('Could not load statistics:', e);
    statusGrid.innerHTML = '<div class="empty-state">Could not load statistics — check the browser console for details.</div>';
    return;
  }

  const statusOrder = ['pending', 'confirmed', 'production', 'delivered', 'denied'];
  statusGrid.innerHTML = statusOrder.map(status => {
    const count = (statusCounts && statusCounts[status]) || 0;
    return `
      <div class="stat-card">
        <div class="stat-value">${count}</div>
        <div class="stat-label">${STATUS_LABELS[status]}</div>
      </div>
    `;
  }).join('');

  const sums = currencyTotals || {};
  const allCurrencies = [...currencyOptions];
  Object.keys(sums).forEach(c => { if(!allCurrencies.includes(c)) allCurrencies.push(c); });

  const body = document.getElementById('currency-stats-body');
  body.innerHTML = allCurrencies.map(cur => {
    const s = sums[cur] || { pending: 0, confirmed: 0, production: 0, delivered: 0 };
    const rowTotal = s.pending + s.confirmed + s.production + s.delivered;
    return `
      <tr>
        <td>${cur}</td>
        <td>${formatAmount(s.pending)}</td>
        <td>${formatAmount(s.confirmed)}</td>
        <td>${formatAmount(s.production)}</td>
        <td>${formatAmount(s.delivered)}</td>
        <td class="stats-total">${formatAmount(rowTotal)}</td>
      </tr>
    `;
  }).join('');
}

/* ---------- Seller password gate ---------- */
