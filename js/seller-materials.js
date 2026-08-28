/* SELLER: MATERIALS — Manage Materials & Prices editor, plus the admin-editable Pickup Location and Currency dropdown lists. */

function renderMaterialsManager(){
  const wrap = document.getElementById('materials-manager');
  const isAdmin = sellerRole === 'admin';
  wrap.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'mat-manager-row mat-manager-header';
  header.innerHTML = `
    <div></div>
    <div>Name</div>
    <div>Price</div>
    <div>Production/Day</div>
    <div></div>
  `;
  wrap.appendChild(header);

  materials.forEach((m, i) => {
    const row = document.createElement('div');
    row.className = 'mat-manager-row';
    row.innerHTML = `
      <div class="move-btns">
        <button class="icon-btn" data-move-up="${m.id}" title="Move up" ${(i === 0 || !isAdmin) ? 'disabled' : ''}>▲</button>
        <button class="icon-btn" data-move-down="${m.id}" title="Move down" ${(i === materials.length - 1 || !isAdmin) ? 'disabled' : ''}>▼</button>
      </div>
      <input type="text" value="${escapeAttr(m.name)}" data-id="${m.id}" data-field="name" ${isAdmin ? '' : 'disabled'}>
      <input type="number" class="price" step="0.01" min="0" value="${m.price}" data-id="${m.id}" data-field="price" ${isAdmin ? '' : 'disabled'}>
      <input type="number" class="price" step="0.01" min="0" value="${m.productionPerDay || 0}" data-id="${m.id}" data-field="productionPerDay" ${isAdmin ? '' : 'disabled'}>
      <button class="icon-btn" data-remove="${m.id}" title="Remove" ${isAdmin ? '' : 'disabled'}>✕</button>
    `;
    wrap.appendChild(row);
  });
  wrap.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', e => {
      const id = e.target.dataset.id;
      const field = e.target.dataset.field;
      const mat = materials.find(m => m.id === id);
      if(!mat) return;
      mat[field] = (field === 'price' || field === 'productionPerDay') ? (parseFloat(e.target.value) || 0) : e.target.value;
    });
  });
  wrap.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      removedMaterialIds.push(btn.dataset.remove);
      materials = materials.filter(m => m.id !== btn.dataset.remove);
      renderMaterialsManager();
    });
  });
  wrap.querySelectorAll('[data-move-up]').forEach(btn => {
    btn.addEventListener('click', () => moveMaterial(btn.dataset.moveUp, -1));
  });
  wrap.querySelectorAll('[data-move-down]').forEach(btn => {
    btn.addEventListener('click', () => moveMaterial(btn.dataset.moveDown, 1));
  });
}

function moveMaterial(id, direction){
  const index = materials.findIndex(m => m.id === id);
  if(index === -1) return;
  const newIndex = index + direction;
  if(newIndex < 0 || newIndex >= materials.length) return;
  const [item] = materials.splice(index, 1);
  materials.splice(newIndex, 0, item);
  renderMaterialsManager();
}

async function addMaterial(){
  if(sellerRole !== 'admin') return;
  materials.push({ id: uid('m'), name: 'New Material', price: 0, weight: 0, volume: 0, productionPerDay: 0 });
  renderMaterialsManager();
}

async function saveMaterialsClick(){
  const toast = document.getElementById('materials-toast');
  if(sellerRole !== 'admin'){
    toast.style.color = '#f2765a';
    toast.textContent = 'Only admins can save materials.';
    return;
  }
  try{
    const payload = materials.map(m => ({ id: m.id, name: m.name, price: m.price, productionPerDay: m.productionPerDay || 0, weight: m.weight || 0, volume: m.volume || 0 }));
    await callManageShopSettings('saveMaterials', { materials: payload, removedIds: removedMaterialIds });
    removedMaterialIds = [];
    renderOrderTable();
    toast.style.color = '#3fcf8e';
    toast.textContent = 'Saved.';
    setTimeout(() => toast.textContent = '', 2000);
  }catch(e){
    console.error('Save materials failed:', e);
    toast.style.color = '#f2765a';
    toast.textContent = e.message || 'Could not save.';
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
  if(sellerRole !== 'admin'){
    toast.style.color = '#f2765a';
    toast.textContent = 'Only admins can do this.';
    return;
  }
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
      if(!needsWeight && !needsVolume) return;
      const fioMat = fioMap.get(String(mat.name).toUpperCase());
      if(!fioMat) return;
      let touched = false;
      if(needsWeight && fioMat.Weight){ mat.weight = Number(fioMat.Weight); touched = true; }
      if(needsVolume && fioMat.Volume){ mat.volume = Number(fioMat.Volume); touched = true; }
      if(touched){
        updatedCount++;
        updates.push({ id: mat.id, weight: mat.weight, volume: mat.volume });
      }
    });

    if(updatedCount === 0){
      toast.style.color = '#85999f';
      toast.textContent = 'Nothing to update — every material already has a weight and volume, or none matched a FIO ticker.';
      return;
    }

    // Only ever sends id/weight/volume — never touches price, name, or
    // anything else, regardless of what else is in the local materials array.
    await callManageShopSettings('updateMaterialPhysicals', { updates });
    renderMaterialsManager();
    renderOrderTable();
    toast.style.color = '#3fcf8e';
    toast.textContent = `Updated and saved ${updatedCount} material${updatedCount !== 1 ? 's' : ''} from FIO.`;
    setTimeout(() => toast.textContent = '', 3500);
  }catch(e){
    console.error('FIO weight sync failed:', e);
    toast.style.color = '#f2765a';
    toast.textContent = e.message || 'Could not fetch from FIO — check the browser console for details.';
  }finally{
    btn.disabled = false;
    btn.textContent = originalLabel;
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
  if(sellerRole !== 'admin'){
    toast.style.color = '#f2765a';
    toast.textContent = 'Only admins can save this.';
    return;
  }
  const list = isPickup ? pickupLocations : currencyOptions;
  const cleaned = [...new Set(list.map(v => v.trim()).filter(v => v.length > 0))];
  if(cleaned.length === 0){
    toast.style.color = '#f2765a';
    toast.textContent = 'The list needs at least one option.';
    return;
  }
  try{
    await saveDropdownList(listType, cleaned);
    if(isPickup){ pickupLocations = cleaned; renderPickupOptionsEditor(); }
    else{ currencyOptions = cleaned; renderCurrencyOptionsEditor(); }
    populateBuyerSelects();
    toast.style.color = '#3fcf8e';
    toast.textContent = 'Saved.';
    setTimeout(() => toast.textContent = '', 2000);
  }catch(e){
    console.error('Save option list failed:', e);
    toast.style.color = '#f2765a';
    toast.textContent = 'Could not save.';
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

/* ---------- Status pipeline helpers ---------- */
