/* DEMO — Local-only sample data for previewing the app without touching Supabase. */

const DEMO_MATERIALS = [
  { id: 'demo-rat', name: 'RAT', price: 3.20, weight: 0, volume: 0, productionPerDay: 0 },
  { id: 'demo-dw', name: 'DW', price: 1.85, weight: 0, volume: 0, productionPerDay: 0 },
  { id: 'demo-ove', name: 'OVE', price: 2.40, weight: 0, volume: 0, productionPerDay: 0 },
  { id: 'demo-h2o', name: 'H2O', price: 0.45, weight: 0, volume: 0, productionPerDay: 0 },
  { id: 'demo-fe', name: 'FE', price: 6.10, weight: 0, volume: 0, productionPerDay: 0 },
  { id: 'demo-c', name: 'C', price: 2.75, weight: 0, volume: 0, productionPerDay: 0 },
  { id: 'demo-al', name: 'AL', price: 8.90, weight: 0, volume: 0, productionPerDay: 0 },
  { id: 'demo-si', name: 'SI', price: 5.30, weight: 0, volume: 0, productionPerDay: 0 },
  { id: 'demo-lst', name: 'LST', price: 4.15, weight: 0, volume: 0, productionPerDay: 0 },
  { id: 'demo-hal', name: 'HAL', price: 22.60, weight: 0, volume: 0, productionPerDay: 0 },
];

function buildDemoOrders(){
  const mat = (id, qty, producedQty) => {
    const m = DEMO_MATERIALS.find(x => x.id === id);
    return { materialId: m.id, name: m.name, qty, price: m.price, subtotal: +(m.price * qty).toFixed(2), producedQty: producedQty || 0 };
  };
  const withTotal = (items) => items.reduce((s, i) => s + i.subtotal, 0);
  const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

  const templates = [
    { id: 'demo_ord_1', username: 'jordan', customerName: 'ABC', contact: 'nova#4471', pickupLocation: 'Moria', note: 'Need it before the next haul.', currency: 'NCC', status: 'pending', sellerComment: '', handledBy: '', createdAt: hoursAgo(1), items: [mat('demo-rat', 40), mat('demo-dw', 60)] },
    { id: 'demo_ord_2', username: 'ferro', customerName: 'XLR', contact: 'ferro#0192', pickupLocation: 'Hortus', note: '', currency: 'ICA', status: 'confirmed', sellerComment: 'Confirmed, queued for next batch.', handledBy: 'Kovus', createdAt: hoursAgo(5), items: [mat('demo-fe', 200), mat('demo-si', 80)] },
    { id: 'demo_ord_3', username: 'orbit', customerName: 'ZQP', contact: 'orbit#7712', pickupLocation: 'Benten', note: 'Leave at dock 3.', currency: 'NCC', status: 'production', sellerComment: 'On the line now, ETA 2 days.', handledBy: 'Saganaki', createdAt: hoursAgo(20), items: [mat('demo-al', 150, 90), mat('demo-lst', 60, 60), mat('demo-hal', 12, 4)] },
    { id: 'demo_ord_4', username: 'wren', customerName: 'JNX', contact: 'wren#3305', pickupLocation: 'Moria', note: '', currency: 'CIS', status: 'delivered', sellerComment: 'Delivered on schedule.', handledBy: 'Kovus', createdAt: hoursAgo(72), items: [mat('demo-c', 90, 90), mat('demo-h2o', 300, 300)] },
    { id: 'demo_ord_5', username: 'kestrel', customerName: 'VTR', contact: 'kestrel#8890', pickupLocation: 'Hortus', note: 'Second attempt, first was lost.', currency: 'AIC', status: 'denied', sellerComment: 'Duplicate of demo_ord_4, cancelled.', handledBy: 'Saganaki', createdAt: hoursAgo(96), items: [mat('demo-ove', 500)] },
    { id: 'demo_ord_6', username: 'tessel', customerName: 'GRV', contact: 'tessel#0007', pickupLocation: 'Benten', note: '', currency: 'NCC', status: 'pending', sellerComment: '', handledBy: '', createdAt: hoursAgo(0.2), items: [mat('demo-hal', 25), mat('demo-fe', 40)] },
  ];

  return templates.map(t => ({ ...t, total: withTotal(t.items) }));
}

function loadDemoData(){
  demoMode = true;
  removedMaterialIds = [];
  materials = DEMO_MATERIALS.map(m => ({ ...m }));
  orders = buildDemoOrders();
  pickupLocations = ['Moria', 'Hortus', 'Benten'];
  currencyOptions = ['NCC', 'ICA', 'CIS', 'AIC'];
  renderOrderTable();
  renderMaterialsManager();
  renderPickupOptionsEditor();
  renderCurrencyOptionsEditor();
  populateBuyerSelects();
  renderOrdersList();
  updatePendingBadge();
  document.getElementById('demo-mode-banner').style.display = 'flex';
}

function exitDemoMode(){
  location.reload();
}

