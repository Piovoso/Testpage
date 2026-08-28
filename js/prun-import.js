/* PRUN IMPORT — Lets a buyer paste PRUNplanner base plan links to auto-fill order quantities.
   Adapted from the material/construction-cost calculation in raylu/prun-ccc (github.com/raylu/prun-ccc),
   translated from its TypeScript/Lit source into plain JS and reworked to:
     - filter against this store's actual Materials list instead of a hardcoded price whitelist
     - sum totals across multiple pasted base links instead of replacing on each add
     - persist the linked plans + their parsed totals onto the order when submitted */

let linkedPlans = []; // { id, url, planetId, label, materials: {ticker: qty}, missing: {ticker: qty} }
let prunBuildingsCache = null;
const prunPlanetCache = {};

async function fetchPrunBuildings(){
  if(prunBuildingsCache) return prunBuildingsCache;
  const res = await fetch('https://api.prunplanner.org/data/buildings/');
  if(!res.ok) throw new Error('Could not load PRUNplanner building data.');
  const rows = await res.json();
  const map = new Map();
  rows.forEach(b => map.set(b.building_ticker, b));
  prunBuildingsCache = map;
  return map;
}

async function fetchPrunPlanet(planetId){
  if(prunPlanetCache[planetId]) return prunPlanetCache[planetId];
  const res = await fetch(`https://api.prunplanner.org/data/planet/${encodeURIComponent(planetId)}/`);
  if(!res.ok) throw new Error('Could not load planet data for this plan.');
  const planet = await res.json();
  prunPlanetCache[planetId] = planet;
  return planet;
}

async function fetchPrunPlan(planUrl){
  const url = new URL(planUrl);
  if(url.hostname !== 'prunplanner.org'){
    throw new Error('That doesn\u2019t look like a prunplanner.org link.');
  }
  url.hostname = 'api.prunplanner.org';
  url.pathname = `planning${url.pathname}/`;
  const res = await fetch(url.toString());
  if(!res.ok) throw new Error('Could not load that plan — check the link and try again.');
  return res.json();
}

/* Expands a building's fixed material costs plus environment-dependent
   extras (concrete/AEF, insulation, pressure seals, gravity anchors),
   matching the game's actual construction rules. */
function* expandBuildingMats(building, planet){
  for(const mat of building.costs) yield mat;

  if(planet.surface) yield { material_ticker: 'MCG', material_amount: building.area_cost * 4 };
  else yield { material_ticker: 'AEF', material_amount: Math.ceil(building.area_cost / 3) };

  if(planet.gravity > 2.5) yield { material_ticker: 'BL', material_amount: 1 };
  else if(planet.gravity < 0.25) yield { material_ticker: 'MGC', material_amount: 1 };

  if(planet.pressure > 2) yield { material_ticker: 'HSE', material_amount: 1 };
  else if(planet.pressure < 0.25) yield { material_ticker: 'SEA', material_amount: building.area_cost };

  if(planet.temperature < -25) yield { material_ticker: 'INS', material_amount: building.area_cost * 10 };
  else if(planet.temperature > 75) yield { material_ticker: 'TSH', material_amount: 1 };
}

/* Computes the full raw material requirement for one plan: the baseline
   Core Module cost, every building × its count, and every infrastructure
   item × its count — each expanded through expandBuildingMats(). */
function computePlanMaterials(plan, buildings, planet){
  const totals = {}; // ticker -> qty, everything the plan needs
  const add = (ticker, amount) => { totals[ticker] = (totals[ticker] || 0) + amount; };

  const cm = buildings.get('CM');
  if(cm){
    for(const mat of expandBuildingMats(cm, planet)) add(mat.material_ticker, mat.material_amount);
  }

  (plan.plan_details.plan_data.buildings || []).forEach(b => {
    const building = buildings.get(b.name);
    if(!building) return;
    for(const mat of expandBuildingMats(building, planet)) add(mat.material_ticker, b.amount * mat.material_amount);
  });

  (plan.plan_details.plan_data.infrastructure || []).forEach(infra => {
    if(!infra.amount) return;
    const building = buildings.get(infra.building);
    if(!building) return;
    for(const mat of expandBuildingMats(building, planet)) add(mat.material_ticker, infra.amount * mat.material_amount);
  });

  return totals;
}

/* Splits a plan's raw totals into what this store actually carries
   (matched against the Materials list by ticker) vs. everything else. */
function splitAgainstCatalog(totals){
  const matched = {};
  const missing = {};
  Object.entries(totals).forEach(([ticker, qty]) => {
    const mat = materials.find(m => m.name.toUpperCase() === ticker.toUpperCase());
    if(mat) matched[ticker.toUpperCase()] = (matched[ticker.toUpperCase()] || 0) + qty;
    else missing[ticker] = (missing[ticker] || 0) + qty;
  });
  return { matched, missing };
}

async function addPrunLink(){
  const input = document.getElementById('prun-link-input');
  const errorEl = document.getElementById('prun-import-error');
  const addBtn = document.getElementById('prun-add-link-btn');
  const rawUrl = input.value.trim();
  errorEl.textContent = '';

  if(!rawUrl){
    errorEl.textContent = 'Paste a PRUNplanner plan link first.';
    return;
  }
  if(linkedPlans.some(p => p.url === rawUrl)){
    errorEl.textContent = 'That base is already added.';
    return;
  }

  addBtn.disabled = true;
  addBtn.textContent = 'Loading...';
  try{
    const plan = await fetchPrunPlan(rawUrl);
    const planetId = plan.plan_details.planet_natural_id;
    const [buildings, planet] = await Promise.all([fetchPrunBuildings(), fetchPrunPlanet(planetId)]);
    const totals = computePlanMaterials(plan, buildings, planet);
    const { matched, missing } = splitAgainstCatalog(totals);

    linkedPlans.push({
      id: uid('plan'),
      url: rawUrl,
      planetId,
      label: planetId,
      materials: matched,
      missing
    });

    input.value = '';
    renderLinkedPlans();
    applyImportedQuantities();
  }catch(e){
    console.error('PRUNplanner import failed:', e);
    errorEl.textContent = e.message || 'Could not read that plan.';
  }finally{
    addBtn.disabled = false;
    addBtn.textContent = 'Add Base';
  }
}

function removePrunLink(id){
  linkedPlans = linkedPlans.filter(p => p.id !== id);
  renderLinkedPlans();
  applyImportedQuantities();
}

function renderLinkedPlans(){
  const wrap = document.getElementById('prun-linked-bases-list');
  const missingNote = document.getElementById('prun-missing-note');

  if(linkedPlans.length === 0){
    wrap.innerHTML = '';
  }else{
    wrap.innerHTML = linkedPlans.map(p => {
      const itemCount = Object.keys(p.materials).length;
      return `
        <div class="prun-linked-base">
          <div class="prun-linked-base-info"><strong>${escapeHtml(p.label)}</strong> — ${itemCount} material${itemCount !== 1 ? 's' : ''} matched</div>
          <button class="btn btn-ghost btn-small" data-remove-plan="${p.id}">Remove</button>
        </div>
      `;
    }).join('');
    wrap.querySelectorAll('[data-remove-plan]').forEach(btn => {
      btn.addEventListener('click', () => removePrunLink(btn.dataset.removePlan));
    });
  }

  const allMissing = {};
  linkedPlans.forEach(p => {
    Object.entries(p.missing).forEach(([ticker, qty]) => {
      allMissing[ticker] = (allMissing[ticker] || 0) + qty;
    });
  });
  const missingEntries = Object.entries(allMissing);
  if(missingEntries.length){
    missingNote.style.display = 'block';
    missingNote.textContent = missingEntries.map(([t, q]) => `${Math.round(q)} ${t}`).join(', ') + ' — not something we carry, so left out.';
  }else{
    missingNote.style.display = 'none';
    missingNote.textContent = '';
  }
}

/* Sums matched materials across every linked plan and fills the
   matching Qty fields in the order table. Fields for materials with
   no imported total are left exactly as the buyer set them. */
function applyImportedQuantities(){
  const aggregate = {};
  linkedPlans.forEach(p => {
    Object.entries(p.materials).forEach(([ticker, qty]) => {
      aggregate[ticker] = (aggregate[ticker] || 0) + qty;
    });
  });

  materials.forEach(mat => {
    const ticker = mat.name.toUpperCase();
    if(!(ticker in aggregate)) return;
    const inp = document.querySelector(`.qty-input[data-id="${mat.id}"]`);
    if(inp) inp.value = Math.round(aggregate[ticker]);
  });

  updateOrderTotals();
}
