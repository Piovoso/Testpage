/* SELLER: STATISTICS — Orders-by-status counts and the Money Waiting currency table. */

async function renderStatistics(){
  const statusGrid = document.getElementById('status-stats-grid');
  if(!statusGrid) return;

  let statusCounts, currencyTotals;
  if(demoMode){
    statusCounts = {};
    ['pending', 'confirmed', 'production', 'delivered', 'denied'].forEach(s => {
      statusCounts[s] = orders.filter(o => o.status === s).length;
    });
    currencyTotals = {};
    const moneyStatuses = ['pending', 'confirmed', 'production', 'delivered'];
    orders.forEach(o => {
      if(!moneyStatuses.includes(o.status)) return;
      const cur = o.currency || 'NCC';
      if(!currencyTotals[cur]) currencyTotals[cur] = { pending: 0, confirmed: 0, production: 0, delivered: 0 };
      currencyTotals[cur][o.status] += o.total;
    });
  }else{
    try{
      const result = await callListOrders('sellerStats', {});
      statusCounts = result.statusCounts;
      currencyTotals = result.currencyTotals;
    }catch(e){
      console.error('Could not load statistics:', e);
      statusGrid.innerHTML = '<div class="empty-state">Could not load statistics — check the browser console for details.</div>';
      return;
    }
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
