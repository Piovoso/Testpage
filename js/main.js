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

  document.getElementById('tab-order').addEventListener('click', () => showTab('order'));
  document.getElementById('theme-toggle-btn').addEventListener('click', toggleTheme);
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
  document.getElementById('tab-status').addEventListener('click', () => showTab('status'));
  document.getElementById('tab-seller').addEventListener('click', () => showTab('seller'));
  document.getElementById('submit-order-btn').addEventListener('click', submitOrder);
  document.getElementById('clear-order-btn').addEventListener('click', clearOrderClick);
  ['order-username', 'order-name', 'order-contact', 'order-note'].forEach(id => {
    document.getElementById(id).addEventListener('input', saveDraftOrder);
  });
  ['pickup-location-select', 'currency-select'].forEach(id => {
    document.getElementById(id).addEventListener('change', saveDraftOrder);
  });
  document.getElementById('duplicate-submit-anyway-btn').addEventListener('click', () => {
    duplicateOverrideConfirmed = true;
    submitOrder();
  });
  document.getElementById('duplicate-cancel-btn').addEventListener('click', () => {
    duplicateOverrideConfirmed = false;
    hideDuplicateWarning();
  });
  document.getElementById('prun-add-link-btn').addEventListener('click', addPrunLink);
  document.getElementById('prun-link-input').addEventListener('keydown', e => {
    if(e.key === 'Enter') addPrunLink();
  });
  document.getElementById('add-material-btn').addEventListener('click', addMaterial);
  document.getElementById('add-pickup-option-btn').addEventListener('click', addPickupOption);
  document.getElementById('save-pickup-options-btn').addEventListener('click', () => saveOptionListClick('pickup'));
  document.getElementById('add-currency-option-btn').addEventListener('click', addCurrencyOption);
  document.getElementById('save-currency-options-btn').addEventListener('click', () => saveOptionListClick('currency'));
  document.getElementById('update-fio-weights-btn').addEventListener('click', updateWeightsFromFio);
  document.getElementById('update-cx-prices-btn').addEventListener('click', updateCxPricesClick);
  document.getElementById('materials-edit-toggle-btn').addEventListener('click', toggleMaterialsEditMode);
  document.getElementById('save-prices-btn').addEventListener('click', savePricesClick);
  document.getElementById('materials-tools-menu-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = document.getElementById('materials-tools-menu');
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  });
  document.addEventListener('click', () => {
    const menu = document.getElementById('materials-tools-menu');
    if(menu) menu.style.display = 'none';
  });
  document.getElementById('save-cx-exchange-btn').addEventListener('click', saveDefaultCxExchangeClick);
  document.getElementById('gate-submit-btn').addEventListener('click', attemptUnlock);
  document.getElementById('gate-password-input').addEventListener('keydown', e => {
    if(e.key === 'Enter') attemptUnlock();
  });
  document.getElementById('gate-name-input').addEventListener('keydown', e => {
    if(e.key === 'Enter') attemptUnlock();
  });
  document.getElementById('change-admin-username-btn').addEventListener('click', changeAdminUsername);
  document.getElementById('change-admin-password-btn').addEventListener('click', changeAdminPassword);
  document.getElementById('add-employee-btn').addEventListener('click', addEmployeeClick);
  document.getElementById('logout-btn').addEventListener('click', logout);
  document.getElementById('currency-select').addEventListener('change', onCurrencyChange);
  document.getElementById('order-name').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4);
  });
  document.getElementById('save-notice-btn').addEventListener('click', saveNoticeClick);
  document.getElementById('save-site-note-btn').addEventListener('click', saveSiteNoteClick);
  document.getElementById('save-site-title-btn').addEventListener('click', saveSiteTitleClick);
  document.getElementById('save-accent-color-btn').addEventListener('click', saveAccentColorClick);
  document.getElementById('save-xit-origin-btn').addEventListener('click', saveXitOriginClick);
  document.getElementById('save-contract-days-btn').addEventListener('click', saveContractDaysClick);
  document.getElementById('save-auto-logout-btn').addEventListener('click', saveAutoLogoutClick);
  document.getElementById('stay-logged-in-btn').addEventListener('click', stayLoggedInClick);
  document.getElementById('reset-accent-color-btn').addEventListener('click', resetAccentColorClick);
  document.getElementById('orders-open-toggle').addEventListener('change', onOrdersOpenToggle);
  document.getElementById('connection-retry-btn').addEventListener('click', () => location.reload());
  document.getElementById('status-check-btn').addEventListener('click', checkOrderStatus);
  document.getElementById('status-check-input').addEventListener('keydown', e => {
    if(e.key === 'Enter') checkOrderStatus();
  });
  document.getElementById('company-lookup-btn').addEventListener('click', findOrdersByCompanyCode);
  document.getElementById('company-lookup-input').addEventListener('keydown', e => {
    if(e.key === 'Enter') findOrdersByCompanyCode();
  });
  document.getElementById('order-filter-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-status-filter]');
    if(btn) setOrderFilter(btn.dataset.statusFilter);
  });
  document.getElementById('order-sort-select').addEventListener('change', (e) => setOrderSort(e.target.value));
  document.getElementById('orders-prev-page-btn').addEventListener('click', () => goToOrdersPage(-1));
  document.getElementById('orders-next-page-btn').addEventListener('click', () => goToOrdersPage(1));
  document.getElementById('orders-page-size').addEventListener('change', (e) => setOrdersPageSize(Number(e.target.value)));
  document.getElementById('order-search-input').addEventListener('input', (e) => setOrderSearch(e.target.value));
  document.getElementById('seller-subtab-orders').addEventListener('click', () => showSellerSubtab('orders'));
  document.getElementById('seller-subtab-statistics').addEventListener('click', () => showSellerSubtab('statistics'));
  document.getElementById('seller-subtab-materials').addEventListener('click', () => showSellerSubtab('materials'));
  document.getElementById('seller-subtab-settings').addEventListener('click', () => showSellerSubtab('settings'));
  document.getElementById('seller-subtab-access').addEventListener('click', () => showSellerSubtab('access'));
  document.getElementById('place-another-btn').addEventListener('click', returnToOrderForm);
  applyCooldownState();
}
init();
