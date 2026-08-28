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
    toast.style.color = '#3fcf8e';
    toast.textContent = 'Saved.';
    setTimeout(() => toast.textContent = '', 2000);
  }catch(e){
    console.error('Order intake toggle failed:', e);
    checkbox.checked = !newValue;
    toast.style.color = '#f2765a';
    toast.textContent = 'Could not save — check the browser console for details.';
  }finally{
    checkbox.disabled = false;
  }
}

async function saveNoticeClick(){
  const textarea = document.getElementById('notice-textarea');
  const toast = document.getElementById('notice-toast');
  try{
    await saveNotice(textarea.value);
    toast.style.color = '#3fcf8e';
    toast.textContent = 'Saved. Buyers will see this next time they load the page.';
    setTimeout(() => toast.textContent = '', 3000);
  }catch(e){
    console.error('Notice save failed:', e);
    toast.style.color = '#f2765a';
    toast.textContent = 'Could not save notice — check the browser console for details.';
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
    toast.style.color = '#3fcf8e';
    toast.textContent = 'Saved.';
    setTimeout(() => toast.textContent = '', 3000);
  }catch(e){
    console.error('Site note save failed:', e);
    toast.style.color = '#f2765a';
    toast.textContent = 'Could not save — check the browser console for details.';
  }
}

async function loadSiteNoteIntoEditor(){
  const input = document.getElementById('site-note-input');
  input.value = await loadSiteNote();
}

/* ---------- Tabs ---------- */
