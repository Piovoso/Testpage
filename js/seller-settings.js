/* SELLER: SETTINGS — Order intake toggle, buyer page notice, and site note banner. */

async function onOrdersOpenToggle(){
  const checkbox = document.getElementById('orders-open-toggle');
  const label = document.getElementById('orders-open-label');
  const toast = document.getElementById('orders-open-toast');
  const newValue = checkbox.checked;
  checkbox.disabled = true;
  try{
    await saveOrdersOpen(newValue);
    ordersOpen = newValue;
    label.textContent = ordersOpen ? 'Currently accepting new orders' : 'New orders are currently closed';
    renderOrderFormVisibility();
    setToastSuccess(toast, 'Saved.');
    setTimeout(() => toast.textContent = '', 2000);
  }catch(e){
    console.error('Order intake toggle failed:', e);
    checkbox.checked = !newValue;
    setToastError(toast, 'Could not save — check the browser console for details.');
  }finally{
    checkbox.disabled = false;
  }
}

async function saveNoticeClick(){
  const textarea = document.getElementById('notice-textarea');
  const toast = document.getElementById('notice-toast');
  try{
    await saveNotice(textarea.value);
    setToastSuccess(toast, 'Saved. Buyers will see this next time they load the page.');
    setTimeout(() => toast.textContent = '', 3000);
  }catch(e){
    console.error('Notice save failed:', e);
    setToastError(toast, 'Could not save notice — check the browser console for details.');
  }
}

async function loadNoticeIntoEditor(){
  const textarea = document.getElementById('notice-textarea');
  textarea.value = await loadNotice();
}

async function saveSiteNoteClick(){
  const input = document.getElementById('site-note-input');
  const toast = document.getElementById('site-note-toast');
  try{
    await saveSiteNote(input.value.trim());
    await renderSiteNoteBanner();
    setToastSuccess(toast, 'Saved.');
    setTimeout(() => toast.textContent = '', 3000);
  }catch(e){
    console.error('Site note save failed:', e);
    setToastError(toast, 'Could not save — check the browser console for details.');
  }
}

async function loadSiteNoteIntoEditor(){
  const input = document.getElementById('site-note-input');
  input.value = await loadSiteNote();
}

async function saveSiteTitleClick(){
  const input = document.getElementById('site-title-input');
  const toast = document.getElementById('site-title-toast');
  const val = input.value.trim();
  if(!val){
    setToastError(toast, 'Title cannot be empty.');
    return;
  }
  try{
    await saveSiteTitle(val);
    applySiteTitle(val);
    setToastSuccess(toast, 'Saved.');
    setTimeout(() => toast.textContent = '', 2000);
  }catch(e){
    console.error('Site title save failed:', e);
    setToastError(toast, e.message || 'Could not save.');
  }
}

function applySiteTitle(title){
  document.title = title;
  const heading = document.getElementById('site-title-heading');
  if(heading) heading.textContent = title;
}

async function loadSiteTitleIntoEditor(){
  const input = document.getElementById('site-title-input');
  const title = await loadSiteTitle();
  input.value = title;
  applySiteTitle(title);
}

async function saveAccentColorClick(){
  const input = document.getElementById('accent-color-input');
  const toast = document.getElementById('accent-color-toast');
  try{
    await saveAccentColor(input.value);
    applyAccentColor(input.value);
    setToastSuccess(toast, 'Saved.');
    setTimeout(() => toast.textContent = '', 2000);
  }catch(e){
    console.error('Accent color save failed:', e);
    setToastError(toast, e.message || 'Could not save.');
  }
}

async function resetAccentColorClick(){
  const toast = document.getElementById('accent-color-toast');
  try{
    await saveAccentColor(null);
    applyAccentColor(null);
    document.getElementById('accent-color-input').value = '#3fcdb8';
    setToastSuccess(toast, 'Reset to default.');
    setTimeout(() => toast.textContent = '', 2000);
  }catch(e){
    console.error('Accent color reset failed:', e);
    setToastError(toast, e.message || 'Could not save.');
  }
}

async function loadAccentColorIntoEditor(){
  const input = document.getElementById('accent-color-input');
  const color = await loadAccentColor();
  if(color){
    input.value = color;
    applyAccentColor(color);
  }
}

let xitActOrigin = '';

async function saveXitOriginClick(){
  const input = document.getElementById('xit-act-origin-input');
  const toast = document.getElementById('xit-origin-toast');
  const val = input.value.trim();
  try{
    await saveXitActOrigin(val);
    xitActOrigin = val;
    setToastSuccess(toast, 'Saved.');
    setTimeout(() => toast.textContent = '', 2000);
  }catch(e){
    console.error('XIT origin save failed:', e);
    setToastError(toast, e.message || 'Could not save.');
  }
}

async function loadXitOriginIntoEditor(){
  const input = document.getElementById('xit-act-origin-input');
  xitActOrigin = await loadXitActOrigin();
  input.value = xitActOrigin;
}

let contractDaysToFulfill = '7';

async function saveContractDaysClick(){
  const input = document.getElementById('contract-days-input');
  const toast = document.getElementById('contract-days-toast');
  const val = String(Math.max(1, parseInt(input.value) || 7));
  try{
    await saveContractDaysToFulfill(val);
    contractDaysToFulfill = val;
    input.value = val;
    setToastSuccess(toast, 'Saved.', 2000);
  }catch(e){
    console.error('Contract days save failed:', e);
    setToastError(toast, e.message || 'Could not save.');
  }
}

async function loadContractDaysIntoEditor(){
  const input = document.getElementById('contract-days-input');
  contractDaysToFulfill = await loadContractDaysToFulfill();
  input.value = contractDaysToFulfill;
}

async function saveAutoLogoutClick(){
  const input = document.getElementById('auto-logout-minutes-input');
  const toast = document.getElementById('auto-logout-toast');
  const val = Math.max(0, Math.min(1440, parseInt(input.value) || 0));
  try{
    await saveAutoLogoutMinutes(val);
    autoLogoutMinutes = val;
    input.value = val;
    resetInactivityTimer(); // apply the new duration immediately, not just on next login
    setToastSuccess(toast, 'Saved.', 2000);
  }catch(e){
    console.error('Auto-logout save failed:', e);
    setToastError(toast, e.message || 'Could not save.');
  }
}

async function loadAutoLogoutIntoEditor(){
  const input = document.getElementById('auto-logout-minutes-input');
  autoLogoutMinutes = await loadAutoLogoutMinutes();
  input.value = autoLogoutMinutes;
}

/* ---------- Tabs ---------- */
