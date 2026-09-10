/* MAIN — Top-level tab switching and app bootstrap (init()). Must load last, after every other script. */

function showTab(name){
  document.getElementById('tab-order').classList.toggle('active', name === 'order');
  document.getElementById('tab-status').classList.toggle('active', name === 'status');
  document.getElementById('tab-seller').classList.toggle('active', name === 'seller');
  document.getElementById('view-order').classList.toggle('active', name === 'order');
  document.getElementById('view-status').classList.toggle('active', name === 'status');
  document.getElementById('view-seller').classList.toggle('active', name === 'seller');
  document.body.classList.toggle('seller-tab-active', name === 'seller');
  if(name === 'seller'){
    renderGateState();
    if(isAuthenticated){
      renderOrdersList();
    }
  }
}

function showSellerSubtab(name){
  document.getElementById('seller-subtab-orders').classList.toggle('active', name === 'orders');
  document.getElementById('seller-subtab-statistics').classList.toggle('active', name === 'statistics');
  document.getElementById('seller-subtab-materials').classList.toggle('active', name === 'materials');
  document.getElementById('seller-subtab-settings').classList.toggle('active', name === 'settings');
  document.getElementById('seller-subtab-access').classList.toggle('active', name === 'access');
  document.getElementById('seller-subview-orders').classList.toggle('active', name === 'orders');
  document.getElementById('seller-subview-statistics').classList.toggle('active', name === 'statistics');
  document.getElementById('seller-subview-materials').classList.toggle('active', name === 'materials');
  document.getElementById('seller-subview-settings').classList.toggle('active', name === 'settings');
  document.getElementById('seller-subview-access').classList.toggle('active', name === 'access');
  if(name === 'statistics') renderStatistics();
}

/* Wires an event listener the same as element.addEventListener(event,
   handler), but never throws if the element doesn't exist. A single
   missing element (e.g. index.html out of sync with a newer main.js after
   a partial deploy) used to throw and silently abort every wiring call
   after it in init() — meaning one missing button broke every other
   button on the page. This logs a clear warning instead and keeps going. */
function safeBind(id, event, handler){
  const el = document.getElementById(id);
  if(!el){
    console.warn(`safeBind: no element #${id} found — skipping its "${event}" handler. This usually means index.html and the JS files are out of sync (a partial deploy).`);
    return;
  }
  el.addEventListener(event, handler);
}

async function init(){
  initTheme();
  applySiteTitle(await loadSiteTitle());
  applyAccentColor(await loadAccentColor());
  await loadMaterials();
  await loadDropdownOptions();
  renderOrderTable();
  renderMaterialsManager();
  renderPickupOptionsEditor();
  renderCurrencyOptionsEditor();
  populateBuyerSelects();
  defaultCxExchange = await loadDefaultCxExchange();
  xitActOrigin = await loadXitActOrigin();
  contractDaysToFulfill = await loadContractDaysToFulfill();
  autoLogoutMinutes = await loadAutoLogoutMinutes();
  renderCxExchangeSelector();
  loadDraftOrder();
  await checkAdminExists();
  applyGateCopy();
  renderGateState();
  updatePendingBadge();
  await renderBuyerNotice();
  await renderSiteNoteBanner();
  ordersOpen = await loadOrdersOpen();
  renderOrderFormVisibility();
  try{
    const savedName = localStorage.getItem('matorder:sellerName');
    if(savedName) document.getElementById('gate-name-input').value = savedName;
  }catch(e){}
  await trySilentSessionRestore();

  safeBind('tab-order', 'click', () => showTab('order'));
  safeBind('theme-toggle-btn', 'click', toggleTheme);
  enhanceNumberInput(document.getElementById('contract-days-input'), 'stacked');
  enhanceNumberInput(document.getElementById('auto-logout-minutes-input'), 'stacked');
  document.querySelectorAll('[data-acc-toggle]').forEach(row => {
    row.addEventListener('click', () => {
      // .acc-desc is usually the toggle row's own next sibling, but where
      // the row sits inside a wrapper alongside other controls (e.g. the
      // Materials panel's ⋮ menu + Edit button share its header row),
      // it's the wrapper's next sibling instead.
      let desc = row.nextElementSibling;
      if(!desc || !desc.classList.contains('acc-desc')){
        const wrapper = row.parentElement;
        desc = wrapper ? wrapper.nextElementSibling : null;
      }
      if(!desc || !desc.classList.contains('acc-desc')) return;
      const isOpen = desc.classList.toggle('open');
      const caret = row.querySelector('.acc-caret');
      if(caret) caret.classList.toggle('open', isOpen);
    });
  });
  safeBind('tab-status', 'click', () => showTab('status'));
  safeBind('tab-seller', 'click', () => showTab('seller'));
  safeBind('submit-order-btn', 'click', submitOrder);
  safeBind('clear-order-btn', 'click', clearOrderClick);
  ['order-username', 'order-name', 'order-contact', 'order-note'].forEach(id => {
    document.getElementById(id).addEventListener('input', saveDraftOrder);
  });
  ['pickup-location-select', 'currency-select'].forEach(id => {
    document.getElementById(id).addEventListener('change', saveDraftOrder);
  });
  safeBind('duplicate-submit-anyway-btn', 'click', () => {
    duplicateOverrideConfirmed = true;
    submitOrder();
  });
  safeBind('duplicate-cancel-btn', 'click', () => {
    duplicateOverrideConfirmed = false;
    hideDuplicateWarning();
  });
  safeBind('prun-add-link-btn', 'click', addPrunLink);
  safeBind('prun-link-input', 'keydown', e => {
    if(e.key === 'Enter') addPrunLink();
  });
  safeBind('add-material-btn', 'click', addMaterial);
  safeBind('add-pickup-option-btn', 'click', addPickupOption);
  safeBind('save-pickup-options-btn', 'click', () => saveOptionListClick('pickup'));
  safeBind('add-currency-option-btn', 'click', addCurrencyOption);
  safeBind('save-currency-options-btn', 'click', () => saveOptionListClick('currency'));
  safeBind('update-fio-weights-btn', 'click', updateWeightsFromFio);
  safeBind('update-cx-prices-btn', 'click', updateCxPricesClick);
  safeBind('materials-edit-toggle-btn', 'click', toggleMaterialsEditMode);
  safeBind('save-prices-btn', 'click', savePricesClick);
  safeBind('materials-tools-menu-btn', 'click', (e) => {
    e.stopPropagation();
    const menu = document.getElementById('materials-tools-menu');
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  });
  document.addEventListener('click', () => {
    const menu = document.getElementById('materials-tools-menu');
    if(menu) menu.style.display = 'none';
  });
  safeBind('save-cx-exchange-btn', 'click', saveDefaultCxExchangeClick);
  safeBind('gate-submit-btn', 'click', attemptUnlock);
  safeBind('gate-password-input', 'keydown', e => {
    if(e.key === 'Enter') attemptUnlock();
  });
  safeBind('gate-name-input', 'keydown', e => {
    if(e.key === 'Enter') attemptUnlock();
  });
  safeBind('change-admin-username-btn', 'click', changeAdminUsername);
  safeBind('change-admin-password-btn', 'click', changeAdminPassword);
  safeBind('add-employee-btn', 'click', addEmployeeClick);
  safeBind('logout-btn', 'click', logout);
  safeBind('currency-select', 'change', onCurrencyChange);
  safeBind('order-name', 'input', (e) => {
    e.target.value = e.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4);
  });
  safeBind('save-notice-btn', 'click', saveNoticeClick);
  safeBind('save-site-note-btn', 'click', saveSiteNoteClick);
  safeBind('save-site-title-btn', 'click', saveSiteTitleClick);
  safeBind('save-accent-color-btn', 'click', saveAccentColorClick);
  safeBind('save-xit-origin-btn', 'click', saveXitOriginClick);
  safeBind('save-contract-days-btn', 'click', saveContractDaysClick);
  safeBind('save-auto-logout-btn', 'click', saveAutoLogoutClick);
  safeBind('stay-logged-in-btn', 'click', stayLoggedInClick);
  safeBind('reset-accent-color-btn', 'click', resetAccentColorClick);
  safeBind('orders-open-toggle', 'change', onOrdersOpenToggle);
  safeBind('connection-retry-btn', 'click', () => location.reload());
  safeBind('status-check-btn', 'click', checkOrderStatus);
  safeBind('status-check-input', 'keydown', e => {
    if(e.key === 'Enter') checkOrderStatus();
  });
  safeBind('company-lookup-btn', 'click', findOrdersByCompanyCode);
  safeBind('company-lookup-input', 'keydown', e => {
    if(e.key === 'Enter') findOrdersByCompanyCode();
  });
  safeBind('order-filter-tabs', 'click', (e) => {
    const btn = e.target.closest('[data-status-filter]');
    if(btn) setOrderFilter(btn.dataset.statusFilter);
  });
  safeBind('order-sort-select', 'change', (e) => setOrderSort(e.target.value));
  safeBind('orders-prev-page-btn', 'click', () => goToOrdersPage(-1));
  safeBind('orders-next-page-btn', 'click', () => goToOrdersPage(1));
  safeBind('orders-page-size', 'change', (e) => setOrdersPageSize(Number(e.target.value)));
  safeBind('order-search-input', 'input', (e) => setOrderSearch(e.target.value));
  safeBind('seller-subtab-orders', 'click', () => showSellerSubtab('orders'));
  safeBind('seller-subtab-statistics', 'click', () => showSellerSubtab('statistics'));
  safeBind('seller-subtab-materials', 'click', () => showSellerSubtab('materials'));
  safeBind('seller-subtab-settings', 'click', () => showSellerSubtab('settings'));
  safeBind('seller-subtab-access', 'click', () => showSellerSubtab('access'));
  safeBind('place-another-btn', 'click', returnToOrderForm);
  applyCooldownState();
}
init();
