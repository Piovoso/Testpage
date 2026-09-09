/* SELLER: ACCESS — Login/logout, admin vs employee roles and permissions, and account
   management. Real authentication now — see auth.js. This file only handles the UI
   flow and talks to auth.js's functions; it never sees a password except the one the
   person just typed into the form in front of them. */

function renderGateState(){
  document.getElementById('seller-gate').style.display = isAuthenticated ? 'none' : 'block';
  document.getElementById('seller-dashboard-content').style.display = isAuthenticated ? 'block' : 'none';
}

function applyGateCopy(){
  const heading = document.getElementById('gate-heading');
  const sub = document.getElementById('gate-sub');
  const nameInput = document.getElementById('gate-name-input');
  const submitBtn = document.getElementById('gate-submit-btn');
  if(adminAccountExists){
    heading.textContent = 'Seller Login';
    sub.textContent = 'Enter your username and password to view and manage orders.';
    nameInput.placeholder = '';
    submitBtn.textContent = 'Unlock';
  }else{
    heading.textContent = 'Set Up Admin Account';
    sub.textContent = 'No admin account exists yet. Choose a username and password for it now — this only happens once.';
    nameInput.placeholder = 'Choose a username';
    submitBtn.textContent = 'Create Admin Account';
  }
}

async function attemptUnlock(){
  const nameInput = document.getElementById('gate-name-input');
  const passwordInput = document.getElementById('gate-password-input');
  const err = document.getElementById('gate-error');
  const typedName = nameInput.value.trim();
  const typedPassword = passwordInput.value;

  if(!typedName || !typedPassword){
    err.textContent = 'Enter a username and password.';
    return;
  }

  err.textContent = '';

  if(!adminAccountExists){
    try{
      await callManageAccount('create', { name: typedName, password: typedPassword, role: 'admin' });
    }catch(e){
      err.textContent = e.message || 'Could not create the admin account.';
      return;
    }
    adminAccountExists = true;
  }

  const signedIn = await authSignIn(typedName, typedPassword);
  if(!signedIn){
    err.textContent = 'Incorrect username or password.';
    return;
  }

  const profile = await authFetchOwnProfile();
  if(!profile){
    err.textContent = 'Signed in, but could not load your account details. Try again.';
    authSession = null;
    return;
  }

  try{ localStorage.setItem('matorder:sellerName', typedName); }catch(e){}
  passwordInput.value = '';
  await applyLoggedInState(profile);
}

async function applyLoggedInState(profile){
  isAuthenticated = true;
  sellerRole = profile.role;
  sellerName = profile.name;
  permissions = profile.role === 'admin'
    ? { orders: true, statistics: true, materials: true, settings: true, access: true }
    : {
        orders: profile.allow_orders,
        statistics: profile.allow_statistics,
        materials: profile.allow_materials,
        settings: profile.allow_settings,
        access: false
      };

  resetInactivityTimer();
  renderGateState();
  applyRoleVisibility();
  renderOrdersList();
  renderMaterialsManager();
  renderPickupOptionsEditor();
  renderCurrencyOptionsEditor();
  await loadAccountsList();
  renderEmployeesList();
  loadAdminAccountIntoEditor();
  updatePendingBadge();
  await loadNoticeIntoEditor();
  await loadSiteNoteIntoEditor();
  await loadSiteTitleIntoEditor();
  await loadAccentColorIntoEditor();
  await loadXitOriginIntoEditor();
  await loadContractDaysIntoEditor();
  await loadAutoLogoutIntoEditor();
  document.getElementById('orders-open-toggle').checked = ordersOpen;
  document.getElementById('orders-open-label').textContent = ordersOpen ? 'Currently accepting new orders' : 'New orders are currently closed';
}

/* Called once at page load — if a valid session is sitting in localStorage
   (from a previous visit), this signs the seller back in silently instead
   of making them re-type their username and password every time the page
   reloads. */
async function trySilentSessionRestore(){
  const restored = await authRestoreSession();
  if(!restored) return;
  const profile = await authFetchOwnProfile();
  if(!profile){
    authSession = null;
    return;
  }
  await applyLoggedInState(profile);
}

function applyRoleVisibility(){
  const isAdmin = sellerRole === 'admin';
  const readonlyNote = document.getElementById('materials-readonly-note');
  const editActions = document.getElementById('materials-edit-actions');
  const editToggleBtn = document.getElementById('materials-edit-toggle-btn');
  if(readonlyNote) readonlyNote.style.display = isAdmin ? 'none' : 'block';
  if(editActions) editActions.style.display = isAdmin ? 'flex' : 'none';
  if(editToggleBtn) editToggleBtn.style.display = isAdmin ? 'inline-block' : 'none';

  document.getElementById('signed-in-label').textContent = `Signed in as ${sellerName} (${sellerRole})`;

  const tabMap = {
    orders: 'seller-subtab-orders',
    statistics: 'seller-subtab-statistics',
    materials: 'seller-subtab-materials',
    settings: 'seller-subtab-settings',
    access: 'seller-subtab-access'
  };
  let firstAllowed = null;
  Object.entries(tabMap).forEach(([key, id]) => {
    const btn = document.getElementById(id);
    const allowed = !!permissions[key];
    btn.style.display = allowed ? 'inline-block' : 'none';
    if(allowed && !firstAllowed) firstAllowed = key;
  });

  const currentActive = document.querySelector('.seller-subview.active');
  const currentName = currentActive ? currentActive.id.replace('seller-subview-', '') : null;
  if(!currentName || !permissions[currentName]){
    showSellerSubtab(firstAllowed || 'orders');
  }
}

async function logout(){
  await authSignOut();
  isAuthenticated = false;
  sellerRole = null;
  sellerName = '';
  accounts = [];
  permissions = { orders: true, statistics: true, materials: true, settings: true, access: false };
  stopInactivityTracking();
  renderGateState();
}

/* Auto-logout on inactivity. autoLogoutMinutes (0 = disabled) is a seller
   setting loaded at startup. A warning banner with a live countdown
   appears 60 seconds before the actual logout, so nobody gets silently
   kicked out mid-task — "Stay Logged In" just restarts the whole timer. */
let autoLogoutMinutes = 20;
let inactivityTimer = null;
let inactivityWarningTimer = null;
let inactivityCountdownInterval = null;
let lastActivityResetAt = 0;
const AUTO_LOGOUT_WARNING_SECONDS = 60;

function resetInactivityTimer(){
  clearTimeout(inactivityTimer);
  clearTimeout(inactivityWarningTimer);
  hideInactivityWarning();
  if(!isAuthenticated || !autoLogoutMinutes) return;

  const totalMs = autoLogoutMinutes * 60 * 1000;
  const warnAfterMs = Math.max(0, totalMs - AUTO_LOGOUT_WARNING_SECONDS * 1000);
  inactivityWarningTimer = setTimeout(showInactivityWarning, warnAfterMs);
  inactivityTimer = setTimeout(() => { logout(); }, totalMs);
}

function showInactivityWarning(){
  const banner = document.getElementById('auto-logout-warning');
  if(!banner) return;
  banner.style.display = 'flex';
  let secondsLeft = AUTO_LOGOUT_WARNING_SECONDS;
  const countEl = document.getElementById('auto-logout-countdown');
  if(countEl) countEl.textContent = secondsLeft;
  clearInterval(inactivityCountdownInterval);
  inactivityCountdownInterval = setInterval(() => {
    secondsLeft--;
    if(countEl) countEl.textContent = Math.max(0, secondsLeft);
    if(secondsLeft <= 0) clearInterval(inactivityCountdownInterval);
  }, 1000);
}

function hideInactivityWarning(){
  const banner = document.getElementById('auto-logout-warning');
  if(banner) banner.style.display = 'none';
  clearInterval(inactivityCountdownInterval);
}

function stayLoggedInClick(){
  resetInactivityTimer();
}

function stopInactivityTracking(){
  clearTimeout(inactivityTimer);
  clearTimeout(inactivityWarningTimer);
  clearInterval(inactivityCountdownInterval);
  hideInactivityWarning();
}

/* Lightweight throttle — real activity (typing, clicking, scrolling) is
   frequent enough that resetting two setTimeout calls on every single
   mousemove would be wasteful. Once every 5s of continuous activity is
   plenty to keep the session alive. */
function onUserActivity(){
  if(!isAuthenticated) return;
  const now = Date.now();
  if(now - lastActivityResetAt < 5000) return;
  lastActivityResetAt = now;
  resetInactivityTimer();
}
['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt => {
  document.addEventListener(evt, onUserActivity, { passive: true });
});

function loadAdminAccountIntoEditor(){
  const nameInput = document.getElementById('new-admin-username-input');
  if(nameInput) nameInput.placeholder = sellerRole === 'admin' ? `Current: ${sellerName}` : 'New admin username';
}

async function changeAdminUsername(){
  const input = document.getElementById('new-admin-username-input');
  const toast = document.getElementById('password-toast');
  const val = input.value.trim();
  if(val.length < 3){
    setToastError(toast, 'Use at least 3 characters.');
    return;
  }
  try{
    await callManageAccount('rename', { id: authSession.userId, newName: val });
    sellerName = val;
    try{ localStorage.setItem('matorder:sellerName', val); }catch(e){}
    input.value = '';
    loadAdminAccountIntoEditor();
    applyRoleVisibility();
    setToastSuccess(toast, 'Admin username updated.');
    setTimeout(() => toast.textContent = '', 3000);
  }catch(e){
    console.error('Username save failed:', e);
    setToastError(toast, e.message || 'Could not update username.');
  }
}

async function changeAdminPassword(){
  const input = document.getElementById('new-admin-password-input');
  const currentInput = document.getElementById('current-admin-password-input');
  const toast = document.getElementById('password-toast');
  const val = input.value.trim();
  const currentVal = currentInput.value;
  if(!currentVal){
    setToastError(toast, 'Enter your current password to confirm.');
    return;
  }
  if(val.length < 4){
    setToastError(toast, 'Use at least 4 characters.');
    return;
  }
  try{
    await callManageAccount('changePassword', { id: authSession.userId, newPassword: val, currentPassword: currentVal });
    input.value = '';
    currentInput.value = '';
    setToastSuccess(toast, 'Admin password updated.');
    setTimeout(() => toast.textContent = '', 2500);
  }catch(e){
    console.error('Password save failed:', e);
    setToastError(toast, e.message || 'Could not update password.');
  }
}

/* Populates the shared `accounts` array from the manage-account Edge
   Function (admin only — this silently returns nothing for employees,
   who never see the Access tab anyway). */
async function loadAccountsList(){
  if(sellerRole !== 'admin') return;
  try{
    const data = await callManageAccount('list', {});
    accounts = (data.accounts || []).map(row => ({
      id: row.id,
      name: row.name,
      role: row.role,
      allowOrders: !!row.allow_orders,
      allowStatistics: !!row.allow_statistics,
      allowMaterials: !!row.allow_materials,
      allowSettings: !!row.allow_settings
    }));
  }catch(e){
    console.error('Could not load accounts:', e);
  }
}

function renderEmployeesList(){
  const wrap = document.getElementById('employees-list');
  if(!wrap) return;
  const employeeAccounts = accounts.filter(a => a.role === 'employee');
  if(employeeAccounts.length === 0){
    wrap.innerHTML = '<div class="empty-state">No employees yet. Add one below.</div>';
    return;
  }
  wrap.innerHTML = '';
  employeeAccounts.forEach(emp => {
    const row = document.createElement('div');
    row.className = 'employee-row';
    row.innerHTML = `
      <div class="employee-name">${escapeHtml(emp.name)}</div>
      <div class="employee-perms">
        <label><input type="checkbox" data-emp-perm="${emp.id}:allowOrders" ${emp.allowOrders ? 'checked' : ''}> Orders</label>
        <label><input type="checkbox" data-emp-perm="${emp.id}:allowStatistics" ${emp.allowStatistics ? 'checked' : ''}> Statistics</label>
        <label><input type="checkbox" data-emp-perm="${emp.id}:allowMaterials" ${emp.allowMaterials ? 'checked' : ''}> Materials</label>
        <label><input type="checkbox" data-emp-perm="${emp.id}:allowSettings" ${emp.allowSettings ? 'checked' : ''}> Settings</label>
      </div>
      <button class="btn btn-delete btn-small" data-remove-employee="${emp.id}">Remove</button>
    `;
    wrap.appendChild(row);
  });

  const fieldMap = {
    allowOrders: 'allow_orders',
    allowStatistics: 'allow_statistics',
    allowMaterials: 'allow_materials',
    allowSettings: 'allow_settings'
  };
  wrap.querySelectorAll('[data-emp-perm]').forEach(cb => {
    cb.addEventListener('change', async () => {
      const [id, field] = cb.dataset.empPerm.split(':');
      cb.disabled = true;
      try{
        await callManageAccount('updatePermission', { id, field: fieldMap[field], value: cb.checked });
        const acc = accounts.find(a => a.id === id);
        if(acc) acc[field] = cb.checked;
      }catch(e){
        console.error('Permission update failed:', e);
        cb.checked = !cb.checked;
      }finally{
        cb.disabled = false;
      }
    });
  });
  wrap.querySelectorAll('[data-remove-employee]').forEach(btn => {
    btn.addEventListener('click', () => armDeleteButton(btn, () => removeEmployeeClick(btn.dataset.removeEmployee)));
  });
}

async function removeEmployeeClick(id){
  const acc = accounts.find(a => a.id === id);
  if(acc && acc.role === 'admin') return; // safety net — never delete an admin account from this list
  try{
    await callManageAccount('delete', { id });
    accounts = accounts.filter(a => a.id !== id);
    renderEmployeesList();
  }catch(e){
    console.error('Employee delete failed:', e);
  }
}

async function addEmployeeClick(){
  const nameInput = document.getElementById('new-employee-name-input');
  const passwordInput = document.getElementById('new-employee-password-input');
  const toast = document.getElementById('employees-toast');
  const name = nameInput.value.trim();
  const password = passwordInput.value.trim();
  if(!name || password.length < 4){
    setToastError(toast, 'Enter a name and a password of at least 4 characters.');
    return;
  }
  try{
    await callManageAccount('create', { name, password, role: 'employee' });
    nameInput.value = '';
    passwordInput.value = '';
    await loadAccountsList();
    renderEmployeesList();
    setToastSuccess(toast, 'Employee added.');
    setTimeout(() => toast.textContent = '', 2500);
  }catch(e){
    console.error('Add employee failed:', e);
    setToastError(toast, e.message || 'Could not add employee.');
  }
}
