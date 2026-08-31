/* SELLER: MATERIALS — Manage Materials & Prices editor (with FIO weight/volume
   and CX price sync), plus the admin-editable Pickup Location and Currency
   dropdown lists. */

const CX_EXCHANGES = ['AI1', 'CI1', 'CI2', 'NC1', 'NC2', 'IC1'];
let defaultCxExchange = 'NC1';
let materialsSelectedForCxUpdate = new Set(); // ephemeral — resets each page load
let draggedMaterialId = null;

let materialsEditMode = false;

function renderMaterialsManager(){
  const wrap = document.getElementById('materials-manager');
  const isAdmin = sellerRole === 'admin';
  const addBtn = document.getElementById('add-material-btn');
  if(addBtn) addBtn.style.display = (isAdmin && materialsEditMode) ? 'inline-block' : 'none';
  wrap.innerHTML = '';
  wrap.classList.toggle('edit-mode', materialsEditMode);

  const header = document.createElement('div');
  header.className = 'mat-manager-row mat-manager-header';
  header.innerHTML = materialsEditMode ? `
    <div></div>
    <div>Ticker</div>
    <div title="Included in the next 'Update CX Prices' run">Update?</div>
    <div>Discount %</div>
    <div>My Price</div>
    <div>CX Price</div>
    <div>Weight</div>
    <div>Volume</div>
    <div title="Visible to buyers on the order form">Show on List</div>
    <div></div>
  ` : `
    <div>Ticker</div>
    <div title="Included in the next 'Update CX Prices' run">Update?</div>
    <div>Discount %</div>
    <div>My Price</div>
    <div>CX Price</div>
    <div>Weight</div>
    <div>Volume</div>
    <div title="Visible to buyers on the order form">Show on List</div>
  `;
  wrap.appendChild(header);

  materials.forEach((m) => {
    const row = document.createElement('div');
    row.className = 'mat-manager-row';
    row.draggable = isAdmin && materialsEditMode;
    row.dataset.matId = m.id;
    const isChecked = materialsSelectedForCxUpdate.has(m.id);
    const tickerCell = materialsEditMode
      ? `<input type="text" value="${escapeAttr(m.name)}" data-id="${m.id}" data-field="name" ${isAdmin ? '' : 'disabled'}>`
      : `<div class="mat-ticker-display">${materialTickerChip(m.name, m.category)}</div>`;
    row.innerHTML = `
      ${materialsEditMode ? `<div class="drag-handle" title="${isAdmin ? 'Drag to reorder' : ''}">${isAdmin ? '⠿' : ''}</div>` : ''}
      ${tickerCell}
      <input type="checkbox" data-id="${m.id}" data-field="cxUpdateSelected" ${isChecked ? 'checked' : ''} ${isAdmin ? '' : 'disabled'}>
      <input type="number" class="price" step="1" min="0" max="100" value="${m.discountPercent || 0}" data-id="${m.id}" data-field="discountPercent" ${isAdmin ? '' : 'disabled'}>
      <input type="number" class="price" step="0.01" min="0" value="${m.price}" data-id="${m.id}" data-field="price" ${isAdmin ? '' : 'disabled'}>
      <div class="cx-price-display">${m.cxPrice === null || m.cxPrice === undefined ? '—' : formatAmount(m.cxPrice)}</div>
      <div class="cx-price-display">${(m.weight || 0).toFixed(2)}</div>
      <div class="cx-price-display">${(m.volume || 0).toFixed(2)}</div>
      <input type="checkbox" data-id="${m.id}" data-field="showOnOrderList" ${m.showOnOrderList !== false ? 'checked' : ''} ${isAdmin ? '' : 'disabled'}>
      ${materialsEditMode ? `<button class="icon-btn" data-remove="${m.id}" title="Remove" ${isAdmin ? '' : 'disabled'}>✕</button>` : ''}
    `;
    wrap.appendChild(row);
  });

  wrap.querySelectorAll('input[type="text"], input[type="number"]').forEach(inp => {
    inp.addEventListener('input', e => {
      const id = e.target.dataset.id;
      const field = e.target.dataset.field;
      const mat = materials.find(m => m.id === id);
      if(!mat) return;
      mat[field] = (field === 'name') ? e.target.value : (parseFloat(e.target.value) || 0);
      if(field === 'discountPercent' || field === 'price'){
        scheduleAutoSavePricing(id);
      }
    });
  });
  wrap.querySelectorAll('input[data-field="cxUpdateSelected"]').forEach(cb => {
    cb.addEventListener('change', () => {
      if(cb.checked) materialsSelectedForCxUpdate.add(cb.dataset.id);
      else materialsSelectedForCxUpdate.delete(cb.dataset.id);
    });
  });
  wrap.querySelectorAll('input[data-field="showOnOrderList"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const mat = materials.find(m => m.id === cb.dataset.id);
      if(mat) mat.showOnOrderList = cb.checked;
      autoSaveMaterialPricing(cb.dataset.id);
    });
  });
  wrap.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      removedMaterialIds.push(btn.dataset.remove);
      materials = materials.filter(m => m.id !== btn.dataset.remove);
      materialsSelectedForCxUpdate.delete(btn.dataset.remove);
      renderMaterialsManager();
    });
  });

  if(isAdmin && materialsEditMode){
    wrap.querySelectorAll('.mat-manager-row:not(.mat-manager-header)').forEach(row => {
      row.addEventListener('dragstart', () => { draggedMaterialId = row.dataset.matId; row.classList.add('dragging'); });
      row.addEventListener('dragend', () => { row.classList.remove('dragging'); draggedMaterialId = null; });
      row.addEventListener('dragover', (e) => e.preventDefault());
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        if(!draggedMaterialId || draggedMaterialId === row.dataset.matId) return;
        const fromIdx = materials.findIndex(m => m.id === draggedMaterialId);
        const toIdx = materials.findIndex(m => m.id === row.dataset.matId);
        if(fromIdx === -1 || toIdx === -1) return;
        const [item] = materials.splice(fromIdx, 1);
        materials.splice(toIdx, 0, item);
        renderMaterialsManager();
      });
    });
  }

  // Discount % gets the flanking −/+ stepper (Option B). Price is
  // deliberately left untouched — no enhancement is applied to it at all.
  enhanceNumberInputsIn(wrap, 'input[data-field="discountPercent"]', 'flanking');
}

/* This one button does double duty: click it while viewing to enter Edit
   mode (reveals drag/rename/remove/add). Click it again while editing and
   it saves everything (same as the old separate Save Changes button did)
   and closes Edit mode, going back to the compact view. */
/* Structural changes (add/remove/reorder/rename) go through Edit +
   Save Changes, same as before — Edit is just a plain view toggle now,
   it doesn't save anything by itself. */
/* Entering Edit reveals the structural controls (drag/rename/remove/add).
   Pressing the same button again to leave Edit saves whatever structural
   changes you made and closes it — one button, no separate "Save Changes"
   click needed. This is independent of the Discount/Price/Show-on-list
   auto-save below, which keeps working the same regardless of whether
   you're in Edit mode or not. */
async function toggleMaterialsEditMode(){
  const btn = document.getElementById('materials-edit-toggle-btn');
  if(!materialsEditMode){
    materialsEditMode = true;
    btn.textContent = 'Done';
    renderMaterialsManager();
    return;
  }
  await saveMaterialsClick();
  materialsEditMode = false;
  btn.textContent = 'Edit';
  renderMaterialsManager();
}

/* Discount %, Price, and Show on List auto-save independently of Edit
   mode — no button needed. Number fields debounce briefly so a save
   isn't fired on every single keystroke; the checkbox saves immediately
   since it's already a single discrete change. This never touches name/
   weight/volume/order, so it can't collide with a structural edit that
   might be in progress at the same time. */
const pricingAutoSaveTimers = {};

function scheduleAutoSavePricing(materialId){
  if(pricingAutoSaveTimers[materialId]) clearTimeout(pricingAutoSaveTimers[materialId]);
  pricingAutoSaveTimers[materialId] = setTimeout(() => autoSaveMaterialPricing(materialId), 700);
}

async function autoSaveMaterialPricing(materialId){
  const mat = materials.find(m => m.id === materialId);
  if(!mat || sellerRole !== 'admin') return;
  const toast = document.getElementById('materials-toast');
  try{
    await callManageShopSettings('updateMaterialPricing', {
      id: mat.id,
      discountPercent: mat.discountPercent || 0,
      price: mat.price,
      showOnOrderList: mat.showOnOrderList !== false
    });
    renderOrderTable(); // keep the buyer-facing preview in sync with the new price
    if(toast){
      setToastSuccess(toast, 'Saved.', 1500);
    }
  }catch(e){
    console.error('Auto-save failed:', e);
    if(toast){
      setToastError(toast, e.message || 'Could not save.');
    }
  }
}

async function addMaterial(){
  if(sellerRole !== 'admin') return;
  materials.push({ id: uid('m'), name: 'New Material', price: 0, weight: 0, volume: 0, discountPercent: 0, showOnOrderList: true, cxPrice: null, category: null });
  renderMaterialsManager();
}

async function saveMaterialsClick(){
  const toast = document.getElementById('materials-toast');
  if(!requireAdmin(toast, 'Only admins can save materials.')) return;
  try{
    const payload = materials.map(m => ({
      id: m.id, name: m.name, price: m.price, weight: m.weight || 0, volume: m.volume || 0,
      discountPercent: m.discountPercent || 0, showOnOrderList: m.showOnOrderList !== false, cxPrice: m.cxPrice,
      category: m.category || null
    }));
    await callManageShopSettings('saveMaterials', { materials: payload, removedIds: removedMaterialIds });
    removedMaterialIds = [];
    renderOrderTable();
    setToastSuccess(toast, 'Saved.');
    setTimeout(() => toast.textContent = '', 2000);
  }catch(e){
    console.error('Save materials failed:', e);
    setToastError(toast, e.message || 'Could not save.');
  }
}

/* Pulls real weight/volume data from FIO (rest.fnar.net — public game data,
   no login required) and fills in any material that's currently missing
   either value, matched by ticker against your material names. Only runs
   when you click the button — nothing here happens automatically. Fills
   gaps only; a weight/volume you've already set by hand is never
   overwritten. Saves straight to the database once done, same as clicking
   Save Changes. */
async function updateWeightsFromFio(){
  const toast = document.getElementById('materials-toast');
  const btn = document.getElementById('update-fio-weights-btn');
  if(!requireAdmin(toast, 'Only admins can do this.')) return;
  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = 'Fetching from FIO…';
  try{
    const res = await fetch('https://rest.fnar.net/material/allmaterials');
    if(!res.ok) throw new Error(`FIO request failed (${res.status}).`);
    const fioMaterials = await res.json();
    const fioMap = new Map();
    (fioMaterials || []).forEach(m => { if(m && m.Ticker) fioMap.set(String(m.Ticker).toUpperCase(), m); });

    let updatedCount = 0;
    const updates = [];
    materials.forEach(mat => {
      const needsWeight = !mat.weight;
      const needsVolume = !mat.volume;
      const needsCategory = !mat.category;
      if(!needsWeight && !needsVolume && !needsCategory) return;
      const fioMat = fioMap.get(String(mat.name).toUpperCase());
      if(!fioMat) return;
      let touched = false;
      if(needsWeight && fioMat.Weight){ mat.weight = Number(fioMat.Weight); touched = true; }
      if(needsVolume && fioMat.Volume){ mat.volume = Number(fioMat.Volume); touched = true; }
      if(needsCategory && fioMat.CategoryName){ mat.category = String(fioMat.CategoryName).toLowerCase(); touched = true; }
      if(touched){
        updatedCount++;
        updates.push({ id: mat.id, weight: mat.weight, volume: mat.volume, category: mat.category });
      }
    });

    if(updatedCount === 0){
      toast.style.color = 'var(--ink-soft)';
      toast.textContent = 'Nothing to update — every material already has weight, volume, and category, or none matched a FIO ticker.';
      return;
    }

    await callManageShopSettings('updateMaterialPhysicals', { updates });
    renderMaterialsManager();
    renderOrderTable();
    setToastSuccess(toast, `Updated and saved ${updatedCount} material${updatedCount !== 1 ? 's' : ''} from FIO.`);
    setTimeout(() => toast.textContent = '', 3500);
  }catch(e){
    console.error('FIO weight sync failed:', e);
    setToastError(toast, e.message || 'Could not fetch from FIO — check the browser console for details.');
  }finally{
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

/* Parses FIO's public CX price CSV (rest.fnar.net/csv/prices — no login
   required). Columns are named "{EXCHANGE}-AskPrice" / "{EXCHANGE}-BidPrice"
   etc., so this builds a name->column-index map from the header row rather
   than hardcoding positions. */
function parsePricesCsv(text){
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  if(lines.length === 0) return { header: {}, rows: new Map() };
  const headerCols = lines[0].split(',');
  const header = {};
  headerCols.forEach((h, i) => { header[h] = i; });
  const rows = new Map();
  for(let i = 1; i < lines.length; i++){
    const cols = lines[i].split(',');
    const ticker = cols[header['Ticker']];
    if(ticker) rows.set(ticker.toUpperCase(), cols);
  }
  return { header, rows };
}

function getCxPriceForTicker(parsed, ticker, exchange){
  const cols = parsed.rows.get(String(ticker).toUpperCase());
  if(!cols) return null;
  const askIdx = parsed.header[`${exchange}-AskPrice`];
  const bidIdx = parsed.header[`${exchange}-BidPrice`];
  const ask = askIdx !== undefined ? parseFloat(cols[askIdx]) : NaN;
  const bid = bidIdx !== undefined ? parseFloat(cols[bidIdx]) : NaN;
  const validAsk = !isNaN(ask);
  const validBid = !isNaN(bid);
  if(validAsk && validBid) return (ask + bid) / 2;
  if(validAsk) return ask;
  if(validBid) return bid;
  return null;
}

/* Fetches FIO's live CX prices and updates ONLY the materials you've
   checked "Update?" for — everything else is left completely alone.
   For each checked material: CX Price = average of that exchange's
   Ask and Bid price (or whichever one exists, if only one does), and
   My Price is recalculated from CX Price and that material's Discount %.
   Saves straight to the database once done. */
async function updateCxPricesClick(){
  const toast = document.getElementById('materials-toast');
  const btn = document.getElementById('update-cx-prices-btn');
  if(!requireAdmin(toast, 'Only admins can do this.')) return;
  const selectedIds = materials.filter(m => materialsSelectedForCxUpdate.has(m.id));
  if(selectedIds.length === 0){
    toast.style.color = 'var(--ink-soft)';
    toast.textContent = 'Check "Update?" on at least one material first.';
    return;
  }

  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = 'Fetching from FIO…';
  try{
    const res = await fetch('https://rest.fnar.net/csv/prices');
    if(!res.ok) throw new Error(`FIO request failed (${res.status}).`);
    const text = await res.text();
    const parsed = parsePricesCsv(text);

    let updatedCount = 0;
    let noDataCount = 0;
    selectedIds.forEach(mat => {
      const cxPrice = getCxPriceForTicker(parsed, mat.name, defaultCxExchange);
      if(cxPrice === null){ noDataCount++; return; }
      mat.cxPrice = +cxPrice.toFixed(2);
      const discount = Math.min(100, Math.max(0, Number(mat.discountPercent) || 0));
      mat.price = +(mat.cxPrice * (1 - discount / 100)).toFixed(2);
      updatedCount++;
    });

    renderMaterialsManager();
    if(updatedCount > 0){
      await saveMaterialsClick();
    }
    toast.style.color = updatedCount > 0 ? 'var(--ok)' : 'var(--rust)';
    toast.textContent = `Updated ${updatedCount} material${updatedCount !== 1 ? 's' : ''} from ${defaultCxExchange}` +
      (noDataCount > 0 ? `. ${noDataCount} had no current CX data on that exchange.` : '.');
    setTimeout(() => toast.textContent = '', 4500);
  }catch(e){
    console.error('CX price sync failed:', e);
    setToastError(toast, e.message || 'Could not fetch from FIO — check the browser console for details.');
  }finally{
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

function renderCxExchangeSelector(){
  const sel = document.getElementById('default-cx-exchange-select');
  if(!sel) return;
  sel.innerHTML = CX_EXCHANGES.map(ex => `<option value="${ex}" ${ex === defaultCxExchange ? 'selected' : ''}>${ex}</option>`).join('');
}

async function saveDefaultCxExchangeClick(){
  const toast = document.getElementById('cx-exchange-toast');
  const sel = document.getElementById('default-cx-exchange-select');
  if(sellerRole !== 'admin' && !permissions.settings){
    setToastError(toast, 'Only admins or employees with Settings access can change this.');
    return;
  }
  try{
    await saveDefaultCxExchange(sel.value);
    defaultCxExchange = sel.value;
    setToastSuccess(toast, 'Saved.');
    setTimeout(() => toast.textContent = '', 2000);
  }catch(e){
    console.error('Save default CX exchange failed:', e);
    setToastError(toast, e.message || 'Could not save.');
  }
}

/* ---------- Seller: pickup locations & currencies (admin-editable dropdown lists) ---------- */
function renderOptionListEditor(containerId, list){
  const wrap = document.getElementById(containerId);
  const isAdmin = sellerRole === 'admin';
  wrap.innerHTML = '';
  list.forEach((val, i) => {
    const row = document.createElement('div');
    row.className = 'option-row';
    row.innerHTML = `
      <input type="text" value="${escapeAttr(val)}" ${isAdmin ? '' : 'disabled'}>
      <button class="icon-btn" title="Remove" ${isAdmin ? '' : 'disabled'}>✕</button>
    `;
    const input = row.querySelector('input');
    const removeBtn = row.querySelector('button');
    input.addEventListener('input', () => { list[i] = input.value; });
    removeBtn.addEventListener('click', () => {
      list.splice(i, 1);
      renderOptionListEditor(containerId, list);
    });
    wrap.appendChild(row);
  });
}

function renderPickupOptionsEditor(){ renderOptionListEditor('pickup-options-list', pickupLocations); }
function renderCurrencyOptionsEditor(){ renderOptionListEditor('currency-options-list', currencyOptions); }

function addPickupOption(){
  if(sellerRole !== 'admin') return;
  pickupLocations.push('');
  renderPickupOptionsEditor();
}
function addCurrencyOption(){
  if(sellerRole !== 'admin') return;
  currencyOptions.push('');
  renderCurrencyOptionsEditor();
}

async function saveOptionListClick(listType){
  const isPickup = listType === 'pickup';
  const toastId = isPickup ? 'pickup-options-toast' : 'currency-options-toast';
  const toast = document.getElementById(toastId);
  if(!requireAdmin(toast, 'Only admins can save this.')) return;
  const list = isPickup ? pickupLocations : currencyOptions;
  const cleaned = [...new Set(list.map(v => v.trim()).filter(v => v.length > 0))];
  if(cleaned.length === 0){
    setToastError(toast, 'The list needs at least one option.');
    return;
  }
  try{
    await saveDropdownList(listType, cleaned);
    if(isPickup){ pickupLocations = cleaned; renderPickupOptionsEditor(); }
    else{ currencyOptions = cleaned; renderCurrencyOptionsEditor(); }
    populateBuyerSelects();
    setToastSuccess(toast, 'Saved.');
    setTimeout(() => toast.textContent = '', 2000);
  }catch(e){
    console.error('Save option list failed:', e);
    setToastError(toast, 'Could not save.');
  }
}

function populateBuyerSelects(){
  const curSel = document.getElementById('currency-select');
  const prevCur = curSel.value;
  curSel.innerHTML = currencyOptions.map(c => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
  curSel.value = currencyOptions.includes(prevCur) ? prevCur : (currencyOptions[0] || '');
  selectedCurrency = curSel.value;
  updateOrderTotals();

  const pickupSel = document.getElementById('pickup-location-select');
  const prevPickup = pickupSel.value;
  pickupSel.innerHTML = pickupLocations.map(p => `<option value="${escapeAttr(p)}">${escapeHtml(p)}</option>`).join('');
  pickupSel.value = pickupLocations.includes(prevPickup) ? prevPickup : (pickupLocations[0] || '');
}
