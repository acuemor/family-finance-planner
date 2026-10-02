import { supabase, isSupabaseConfigured } from './services/supabase.js';
import { getMyMembership, createHousehold, addExistingUserToHousehold } from './services/household-service.js';
import { getMonthlyData, addMonthlyItem, addAccount, addAccountTransaction, deleteRow, getIncomeTemplates, addIncomeTemplate, setIncomeTemplateActive, updateMonthlyIncome, updateIncomeTemplate, addExtraordinaryIncome, getBudgetTemplates, addBudgetTemplate, updateBudgetTemplate, setBudgetTemplateActive, updateMonthlyItem, addBudgetExpense, deleteBudgetTemplate, addMonthlyItems } from './services/monthly-service.js';
import { formatCurrency } from './utils/currency.js';

const $ = id => document.getElementById(id);
const views = ['auth-view', 'setup-view', 'app-view'];
let authMode = 'login';
let session = null;
let membership = null;
let currentMonth = new Date().toISOString().slice(0, 7);
let monthlyData = { incomes: [], items: [], accounts: [], transactions: [], members: [] };
let incomeTemplates = [];
let budgetTemplates = [];

function showView(id) { views.forEach(view => $(view).classList.toggle('hidden', view !== id)); }
function message(id, text, isError = true) { const el = $(id); el.textContent = text; el.style.color = isError ? 'var(--red)' : 'var(--green)'; }
function notify(text) { const toast = $('toast'); toast.textContent = text; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2600); }
function setAuthMode(mode) {
  authMode = mode;
  $('login-tab').classList.toggle('active', mode === 'login'); $('signup-tab').classList.toggle('active', mode === 'signup');
  $('login-tab').setAttribute('aria-selected', String(mode === 'login')); $('signup-tab').setAttribute('aria-selected', String(mode === 'signup'));
  $('auth-submit').textContent = mode === 'login' ? 'Entrar' : 'Crear cuenta'; $('password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  message('auth-message', '');
}
async function refreshSession() {
  const { data } = await supabase.auth.getSession(); session = data.session;
  // Ocultar por defecto hasta conocer el rol del usuario autenticado.
  document.querySelector('.nav-link[data-section="members"]')?.classList.add('hidden');
  $('logout-button').classList.toggle('hidden', !session); $('user-email').textContent = session?.user?.email || '';
  if (!session) { showView('auth-view'); return; }
  try { membership = await getMyMembership(); if (membership) { $('household-label').textContent = membership.households?.name || 'VUESTRO HOGAR'; showView('app-view'); await loadMonth(); } else showView('setup-view'); }
  catch (error) { showView('auth-view'); message('auth-message', friendlyError(error)); }
}
function friendlyError(error) { return error?.message || 'Ha ocurrido un error. Inténtalo de nuevo.'; }
function monthLabel(month) { return new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(new Date(`${month}-02T12:00:00`)); }
async function loadMonth() {
  $('month-picker').value = currentMonth; $('welcome-title').textContent = `Resumen · ${monthLabel(currentMonth)}`;
  try { monthlyData = await getMonthlyData(membership.household_id, currentMonth); incomeTemplates = await getIncomeTemplates(membership.household_id); budgetTemplates = await getBudgetTemplates(membership.household_id); renderDashboard(); renderIncomes(); renderIncomeTemplates(); renderMembers(); renderBudget(); renderBudgetTemplates(); renderAccounts(); renderTransactions(); populateAccountSelectors(); renderUnassignedAllocation(); renderPersonalSavingsDistribution(); }
  catch (error) { message('dashboard-message', `No se han podido cargar los datos: ${friendlyError(error)}`); }
}
function renderDashboard() {
  const incomeCents = monthlyData.incomes.reduce((sum, row) => sum + Math.round(Number(row.planned_amount) * 100), 0);
  const allocatedCents = monthlyData.items.reduce((sum, row) => sum + Math.round(Number(row.planned_amount) * 100), 0);
  const remaining = incomeCents - allocatedCents;
  $('total-income').textContent = formatCurrency(incomeCents / 100); $('total-allocated').textContent = formatCurrency(allocatedCents / 100); $('total-remaining').textContent = formatCurrency(remaining / 100);
  $('total-remaining').style.color = remaining < 0 ? 'var(--red)' : '';
  const grouped = monthlyData.items.reduce((acc, row) => { acc[row.item_type] = (acc[row.item_type] || 0) + Number(row.planned_amount); return acc; }, {});
  const labels = { fixed_expense: 'Gastos fijos', variable_expense: 'Gastos variables', sinking_fund: 'Fondos acumulativos', common_saving: 'Ahorro común', individual_saving: 'Ahorro individual', additional_allocation: 'Asignaciones adicionales' };
  const entries = Object.entries(grouped);
  $('allocation-list').innerHTML = entries.length ? entries.map(([type, amount]) => `<div class="allocation-row"><strong>${labels[type] || type}</strong><span>${formatCurrency(amount)}</span><div class="allocation-track"><span style="width:${incomeCents ? Math.min(100, amount / (incomeCents / 100) * 100) : 0}%"></span></div></div>`).join('') : '<p class="empty-state">Crea tus primeras partidas para ver aquí el reparto.</p>';
  message('dashboard-message', remaining < 0 ? `Atención: habéis asignado ${formatCurrency(Math.abs(remaining) / 100)} más de los ingresos previstos.` : '', remaining < 0);
}
function renderIncomes() {
  $('income-list').innerHTML = monthlyData.incomes.length ? monthlyData.incomes.map(row => `<div class="data-row"><div><strong>${escapeHtml(row.description)}</strong><small>${escapeHtml(row.member_name || 'Miembro')} · ${row.income_type === 'extraordinary' ? 'Ingreso extraordinario' : 'Ingreso habitual'} · importe de este mes editable</small></div><strong>${formatCurrency(row.planned_amount)} <button class="delete-button" data-edit-income="${row.id}" data-amount="${row.planned_amount}">Ajustar</button> <button class="delete-button" data-delete="monthly_plan_incomes" data-id="${row.id}">Eliminar</button></strong></div>`).join('') : '<p class="empty-state">Todavía no hay ingresos para este mes. Crea un ingreso habitual para que se copie a este y a los próximos meses.</p>';
}
function renderIncomeTemplates() {
  const memberNames = new Map(monthlyData.members.map(member => [member.id, member.name]));
  $('income-template-list').innerHTML = incomeTemplates.length ? incomeTemplates.map(row => `
    <div class="data-row"><div><strong>${escapeHtml(row.description)}</strong><small>${escapeHtml(memberNames.get(row.member_id) || 'Miembro')} · Desde ${escapeHtml(row.start_month.slice(0, 7))}${row.end_month ? ` · Hasta ${escapeHtml(row.end_month.slice(0, 7))}` : ''}</small></div>
    <div class="template-actions"><strong>${formatCurrency(row.default_amount)} / mes</strong><button class="delete-button" data-edit-template="${row.id}" data-amount="${row.default_amount}">Editar</button><button class="delete-button" data-toggle-template="${row.id}" data-active="${row.is_active}">${row.is_active ? 'Desactivar' : 'Activar'}</button></div></div>`).join('') : '<p class="empty-state">Todavía no hay ingresos habituales configurados.</p>';
  const memberOptions = monthlyData.members.map(member => `<option value="${member.id}">${escapeHtml(member.name)}</option>`).join('');
  $('income-member').innerHTML = memberOptions;
  $('extraordinary-income-member').innerHTML = memberOptions;
}
function renderMembers() {
  const isOwner = membership?.role === 'owner';
  $('member-list').innerHTML = monthlyData.members.map(member => `<div class="data-row"><div><strong>${escapeHtml(member.name)}</strong><small>${member.role === 'owner' ? 'Administrador del hogar' : 'Miembro'}</small></div><span class="member-status">Activo</span></div>`).join('');
  $('member-form').classList.toggle('hidden', !isOwner);
  const membersNav = document.querySelector('.nav-link[data-section="members"]');
  if (membersNav) membersNav.classList.toggle('hidden', !isOwner);
  if (!isOwner && document.querySelector('.nav-link[data-section="members"]')?.classList.contains('active')) {
    showSection('dashboard');
  }
}

function renderBudget() {
  const labels = { fixed_expense: 'Gasto fijo', variable_expense: 'Gasto variable', sinking_fund: 'Fondo acumulativo', common_saving: 'Ahorro común', individual_saving: 'Ahorro individual', additional_allocation: 'Asignación adicional' };
  const accounts = new Map(monthlyData.accounts.map(account => [account.id, account.name]));
  $('budget-list').innerHTML = monthlyData.items.length ? monthlyData.items.map(row => {
    const fundInfo = row.item_type === 'sinking_fund' && row.target_amount ? ` · Objetivo ${formatCurrency(row.target_amount)}${row.target_date ? ` antes del ${row.target_date}` : ''}` : '';
    const accountInfo = row.destination_account_id ? ` · ${escapeHtml(accounts.get(row.destination_account_id) || 'Cuenta')}` : ' · Sin cuenta asignada';
    const isExpense = ['fixed_expense', 'variable_expense'].includes(row.item_type);
    const actual = Number(row.actual_amount || 0);
    const progress = isExpense ? ` · Real: ${formatCurrency(actual)} · ${actual > Number(row.planned_amount) ? `Exceso ${formatCurrency(actual - Number(row.planned_amount))}` : `Restan ${formatCurrency(Number(row.planned_amount) - actual)}`}` : '';
    const expenseAction = isExpense ? `<button class="delete-button" data-link-expense="${row.id}">Registrar gasto</button>` : '';
    return `<div class="data-row"><div><strong>${escapeHtml(row.name)}</strong><small>${labels[row.item_type] || row.item_type}${accountInfo}${fundInfo}${progress}</small></div><strong>${formatCurrency(row.planned_amount)} <button class="delete-button" data-edit-budget-item="${row.id}" data-amount="${row.planned_amount}">Ajustar</button> ${expenseAction}<button class="delete-button" data-delete="monthly_plan_items" data-id="${row.id}">Eliminar</button></strong></div>`;
  }).join('') : '<p class="empty-state">Todavía no hay partidas en el presupuesto.</p>';
}
function renderBudgetTemplates() {
  const labels = { fixed_expense: 'Gasto fijo', variable_expense: 'Gasto variable', sinking_fund: 'Fondo acumulativo', common_saving: 'Ahorro común', individual_saving: 'Ahorro individual', additional_allocation: 'Asignación adicional' };
  const accounts = new Map(monthlyData.accounts.map(account => [account.id, account.name]));
  $('budget-template-list').innerHTML = budgetTemplates.length ? budgetTemplates.map(row => {
    const fundInfo = row.item_type === 'sinking_fund' && row.target_amount ? ` · Objetivo ${formatCurrency(row.target_amount)}${row.target_date ? ` · Vence ${row.target_date}` : ''}` : '';
    const accountInfo = row.destination_account_id ? ` · ${escapeHtml(accounts.get(row.destination_account_id) || 'Cuenta')}` : '';
    return `<div class="data-row"><div><strong>${escapeHtml(row.name)}</strong><small>${labels[row.item_type] || row.item_type}${accountInfo}${fundInfo} · Desde ${row.start_month.slice(0,7)}</small></div><div class="template-actions"><strong>${formatCurrency(row.default_amount)} / mes</strong><button class="delete-button" data-edit-budget-template="${row.id}" data-amount="${row.default_amount}">Editar</button><button class="delete-button" data-toggle-budget-template="${row.id}" data-active="${row.is_active}">${row.is_active ? 'Desactivar' : 'Activar'}</button><button class="delete-button" data-delete-budget-template="${row.id}" data-name="${escapeHtml(row.name)}">Eliminar</button></div></div>`;
  }).join('') : '<p class="empty-state">Todavía no hay partidas habituales configuradas.</p>';
  const options = `<option value="">Sin asignar</option>` + monthlyData.accounts.map(account => `<option value="${account.id}">${escapeHtml(account.name)}</option>`).join('');
  $('template-item-account').innerHTML = options;
  $('item-account').innerHTML = options;
}
function getAccountBalance(account) {
  const movements = monthlyData.transactions.filter(row => row.account_id === account.id);
  const movementCents = movements.reduce((sum, row) => {
    const amount = Math.round(Number(row.amount) * 100);
    if (row.transaction_type === 'income' || row.transaction_type === 'transfer_in') return sum + amount;
    if (row.transaction_type === 'expense' || row.transaction_type === 'transfer_out') return sum - amount;
    return sum;
  }, 0);
  return Math.round(Number(account.initial_balance || 0) * 100) + movementCents;
}
function renderAccounts() {
  const memberNames = new Map(monthlyData.members.map(member => [member.id, member.name]));
  $('account-list').innerHTML = monthlyData.accounts.length ? monthlyData.accounts.map(row => {
    const owner = row.account_type === 'common' ? 'Cuenta común' : `Cuenta individual · ${escapeHtml(memberNames.get(row.owner_member_id) || 'Titular')}`;
    return `<div class="account-card"><div><strong>${escapeHtml(row.name)}</strong><small>${owner} · Saldo inicial: ${formatCurrency(row.initial_balance)}</small></div><div class="account-balance"><small>Saldo actual</small><strong>${formatCurrency(getAccountBalance(row) / 100)}</strong></div></div>`;
  }).join('') : '<p class="empty-state">Añade las cuentas que utilizaréis como destino del dinero.</p>';
}
function populateAccountSelectors() {
  const ownerSelect = $('account-owner');
  ownerSelect.innerHTML = monthlyData.members.map(member => `<option value="${member.id}">${escapeHtml(member.name)}</option>`).join('');
  const individual = $('account-type').value === 'individual';
  $('account-owner-field').classList.toggle('hidden', !individual);
  ownerSelect.required = individual;
  const options = monthlyData.accounts.map(account => `<option value="${account.id}">${escapeHtml(account.name)}</option>`).join('');
  $('transaction-account').innerHTML = options || '<option value="">Primero crea una cuenta</option>';
  const expenseItems = monthlyData.items.filter(item => ['fixed_expense', 'variable_expense'].includes(item.item_type));
  $('transaction-budget-item').innerHTML = '<option value="">Sin vincular</option>' + expenseItems.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
  const budgetOptions = '<option value="">Sin asignar</option>' + options;
  $('template-item-account').innerHTML = budgetOptions;
  $('item-account').innerHTML = budgetOptions;
  $('unassigned-account').innerHTML = '<option value="">Selecciona una cuenta</option>' + options;
  $('transaction-account').disabled = monthlyData.accounts.length === 0;
  $('transaction-form').querySelector('button[type="submit"]').disabled = monthlyData.accounts.length === 0;
}
function getUnassignedCents() {
  const incomeCents = monthlyData.incomes.reduce((sum, row) => sum + Math.round(Number(row.planned_amount) * 100), 0);
  const allocatedCents = monthlyData.items.reduce((sum, row) => sum + Math.round(Number(row.planned_amount) * 100), 0);
  return incomeCents - allocatedCents;
}
function renderUnassignedAllocation() {
  const availableCents = getUnassignedCents();
  $('unassigned-amount').textContent = formatCurrency(availableCents / 100);
  $('unassigned-amount').style.color = availableCents < 0 ? 'var(--red)' : 'var(--green)';
  $('unassigned-allocation-amount').max = Math.max(0, availableCents / 100).toFixed(2);
  $('unassigned-allocation-submit').disabled = availableCents <= 0 || monthlyData.accounts.length === 0 || monthlyData.plan?.status === 'closed';
  $('unassigned-account').disabled = monthlyData.accounts.length === 0 || monthlyData.plan?.status === 'closed';
  $('unassigned-allocation-message').textContent = monthlyData.plan?.status === 'closed'
    ? 'Este mes está cerrado y no admite nuevas asignaciones.'
    : monthlyData.accounts.length === 0 ? 'Primero crea al menos una cuenta en la sección Cuentas.'
      : availableCents < 0 ? 'Hay un exceso de asignación. Reduce alguna partida antes de asignar más.'
        : availableCents === 0 ? 'No queda dinero disponible para asignar.' : '';
}
function getPersonalSavingsDistribution() {
  const regularIncome = monthlyData.incomes.filter(row => row.income_type === 'regular');
  const incomeByMember = new Map(monthlyData.members.map(member => [member.id, 0]));
  regularIncome.forEach(row => {
    if (row.member_id && incomeByMember.has(row.member_id)) {
      incomeByMember.set(row.member_id, incomeByMember.get(row.member_id) + Math.round(Number(row.planned_amount) * 100));
    }
  });
  const totalIncomeCents = [...incomeByMember.values()].reduce((sum, value) => sum + value, 0);
  const availableCents = Math.max(0, getUnassignedCents());
  if (!totalIncomeCents) return { totalIncomeCents, availableCents, rows: [] };

  const rows = monthlyData.members.map(member => {
    const incomeCents = incomeByMember.get(member.id) || 0;
    const numerator = availableCents * incomeCents;
    return { member, incomeCents, amountCents: Math.floor(numerator / totalIncomeCents), remainder: numerator % totalIncomeCents };
  });
  let centsLeft = availableCents - rows.reduce((sum, row) => sum + row.amountCents, 0);
  [...rows].sort((a, b) => b.remainder - a.remainder).slice(0, centsLeft).forEach(row => { row.amountCents += 1; });
  return { totalIncomeCents, availableCents, rows };
}
function renderPersonalSavingsDistribution() {
  const { totalIncomeCents, availableCents, rows } = getPersonalSavingsDistribution();
  const container = $('personal-savings-distribution');
  const submit = $('personal-savings-submit');
  if (!totalIncomeCents) {
    container.innerHTML = '<p class="empty-state">Añade los ingresos habituales de cada persona para calcular el reparto proporcional. Los ingresos extraordinarios no se utilizan para este cálculo.</p>';
    submit.disabled = true;
    return;
  }
  const percent = new Intl.NumberFormat('es-ES', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  container.innerHTML = rows.map(({ member, incomeCents, amountCents }) => {
    const accounts = monthlyData.accounts.filter(account => account.account_type === 'individual' && account.owner_member_id === member.id);
    const accountOptions = accounts.map(account => `<option value="${account.id}">${escapeHtml(account.name)}</option>`).join('');
    const accountControl = accounts.length
      ? `<label class="personal-savings-account-label">Cuenta de ahorro<select id="personal-savings-account-${member.id}" data-personal-savings-account="${member.id}">${accountOptions}</select></label>`
      : '<small class="personal-savings-warning">No hay una cuenta individual activa para esta persona.</small>';
    return `<div class="personal-savings-row"><div class="personal-savings-person"><strong>${escapeHtml(member.name)}</strong><small>Aporta ${formatCurrency(incomeCents / 100)} · ${percent.format(incomeCents / totalIncomeCents)}</small></div><strong class="personal-savings-amount">${formatCurrency(amountCents / 100)}</strong>${accountControl}</div>`;
  }).join('');
  const missingAccount = rows.some(row => row.amountCents > 0 && !monthlyData.accounts.some(account => account.account_type === 'individual' && account.owner_member_id === row.member.id));
  submit.disabled = availableCents <= 0 || monthlyData.plan?.status === 'closed' || missingAccount;
  $('personal-savings-message').textContent = monthlyData.plan?.status === 'closed'
    ? 'Este mes está cerrado y no admite nuevas asignaciones.'
    : availableCents <= 0 ? 'No hay remanente positivo que repartir.'
      : missingAccount ? 'Crea una cuenta individual para cada persona que vaya a recibir ahorro.' : '';
}

function renderTransactions() {
  const recent = monthlyData.transactions.slice(0, 8);
  $('transaction-list').innerHTML = recent.length ? `<div class="subsection-heading"><h3>Últimos movimientos</h3></div>${recent.map(row => {
    const account = monthlyData.accounts.find(item => item.id === row.account_id);
    const isIncome = row.transaction_type === 'income' || row.transaction_type === 'transfer_in';
    return `<div class="data-row"><div><strong>${escapeHtml(row.description)}</strong><small>${escapeHtml(account?.name || 'Cuenta')} · ${escapeHtml(row.transaction_date)}</small></div><strong class="${isIncome ? 'amount-positive' : 'amount-negative'}">${isIncome ? '+' : '−'}${formatCurrency(row.amount)}</strong></div>`;
  }).join('')}` : '<p class="empty-state">Todavía no hay movimientos registrados.</p>';
}
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function showSection(section) {
  // La sección de miembros es exclusiva del administrador. La autorización real
  // también se valida en Supabase; esta comprobación evita mostrarla en la UI.
  if (section === 'members' && membership?.role !== 'owner') section = 'dashboard';
  ['dashboard', 'incomes', 'budget', 'accounts', 'members'].forEach(name => { $(`${name}-section`).classList.toggle('hidden', name !== section); });
  document.querySelectorAll('.nav-link').forEach(link => link.classList.toggle('active', link.dataset.section === section));
}

$('login-tab').addEventListener('click', () => setAuthMode('login'));
$('signup-tab').addEventListener('click', () => setAuthMode('signup'));
$('auth-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!supabase) return;
  const email = $('email').value.trim(); const password = $('password').value;
  $('auth-submit').disabled = true;
  try {
    if (authMode === 'login') { const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) throw error; }
    else { const { data, error } = await supabase.auth.signUp({ email, password }); if (error) throw error; if (!data.session) { message('auth-message', 'Cuenta creada. Revisa tu correo para confirmar el registro.', false); return; } }
    await refreshSession();
  } catch (error) { message('auth-message', friendlyError(error)); }
  finally { $('auth-submit').disabled = false; }
});
$('logout-button').addEventListener('click', async () => { await supabase.auth.signOut(); membership = null; await refreshSession(); });
$('household-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try { await createHousehold($('household-name').value.trim(), $('member-name').value.trim()); await refreshSession(); }
  catch (error) { message('setup-message', friendlyError(error)); }
  finally { button.disabled = false; }
});
$('month-picker').addEventListener('change', async event => { if (event.target.value) { currentMonth = event.target.value; await loadMonth(); } });
document.querySelectorAll('.nav-link').forEach(link => link.addEventListener('click', event => { event.preventDefault(); showSection(link.dataset.section); history.replaceState(null, '', link.getAttribute('href')); }));
$('extraordinary-income-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try {
    await addExtraordinaryIncome(membership.household_id, currentMonth, $('extraordinary-income-member').value, $('extraordinary-income-description').value.trim(), Number($('extraordinary-income-amount').value));
    event.target.reset(); await loadMonth(); message('income-message', 'Ingreso extraordinario añadido únicamente a este mes.', false);
  } catch (error) { message('income-message', friendlyError(error)); } finally { button.disabled = false; }
});
$('income-template-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try {
    await addIncomeTemplate(membership.household_id, $('income-member').value, $('income-description').value.trim(), Number($('income-amount').value), currentMonth);
    event.target.reset(); await loadMonth(); message('income-message', 'Ingreso habitual guardado. Se ha incorporado al mes actual y se copiará a los siguientes.', false);
  } catch (error) { message('income-message', friendlyError(error)); } finally { button.disabled = false; }
});
$('member-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (membership?.role !== 'owner') { message('member-message', 'Solo el administrador puede añadir miembros.'); return; }
  const button = event.submitter; button.disabled = true;
  try {
    await addExistingUserToHousehold(membership.household_id, $('member-email').value.trim(), $('member-display-name').value.trim());
    event.target.reset(); await loadMonth(); message('member-message', 'Miembro incorporado correctamente al hogar.', false);
  } catch (error) { message('member-message', friendlyError(error)); } finally { button.disabled = false; }
});
$('budget-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try { await addMonthlyItem(membership.household_id, currentMonth, $('item-name').value.trim(), $('item-type').value, Number($('item-amount').value), $('item-account').value); event.target.reset(); await loadMonth(); message('budget-message', 'Partida añadida únicamente a este mes.', false); }
  catch (error) { message('budget-message', friendlyError(error)); } finally { button.disabled = false; }
});
$('unassigned-allocation-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('unassigned-allocation-submit');
  button.disabled = true;
  try {
    const amount = Number($('unassigned-allocation-amount').value);
    const amountCents = Math.round(amount * 100);
    const availableCents = getUnassignedCents();
    const accountId = $('unassigned-account').value;
    const account = monthlyData.accounts.find(row => row.id === accountId);
    if (!account) throw new Error('Selecciona una cuenta de destino.');
    if (!Number.isFinite(amount) || amountCents <= 0) throw new Error('Introduce un importe mayor que cero.');
    if (amountCents > availableCents) throw new Error(`El importe supera el dinero disponible (${formatCurrency(availableCents / 100)}).`);
    await addMonthlyItem(membership.household_id, currentMonth, `Remanente asignado a ${account.name}`, 'additional_allocation', amountCents / 100, account.id);
    event.target.reset();
    await loadMonth();
    message('unassigned-allocation-message', 'Importe asignado al presupuesto. No se ha creado ningún movimiento bancario.', false);
  } catch (error) {
    message('unassigned-allocation-message', friendlyError(error));
  } finally {
    button.disabled = getUnassignedCents() <= 0 || monthlyData.accounts.length === 0 || monthlyData.plan?.status === 'closed';
  }
});

$('personal-savings-submit').addEventListener('click', async () => {
  const button = $('personal-savings-submit');
  button.disabled = true;
  try {
    const { totalIncomeCents, availableCents, rows } = getPersonalSavingsDistribution();
    if (!totalIncomeCents || availableCents <= 0 || monthlyData.plan?.status === 'closed') throw new Error('No hay un remanente disponible para repartir en este mes.');
    const items = rows.filter(row => row.amountCents > 0).map(row => {
      const accountId = $(`personal-savings-account-${row.member.id}`)?.value;
      const account = monthlyData.accounts.find(candidate => candidate.id === accountId && candidate.account_type === 'individual' && candidate.owner_member_id === row.member.id);
      if (!account) throw new Error(`Selecciona una cuenta individual de ${row.member.name}.`);
      return { name: `Ahorro personal · ${row.member.name}`, itemType: 'individual_saving', amount: row.amountCents / 100, destinationAccountId: account.id };
    });
    await addMonthlyItems(membership.household_id, currentMonth, items);
    await loadMonth();
    message('personal-savings-message', 'Ahorro personal asignado proporcionalmente según las nóminas. No se ha creado ningún movimiento bancario.', false);
  } catch (error) {
    message('personal-savings-message', friendlyError(error));
    renderPersonalSavingsDistribution();
  } finally {
    button.disabled = getUnassignedCents() <= 0 || monthlyData.plan?.status === 'closed';
  }
});

$('budget-template-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try {
    const type = $('template-item-type').value;
    const targetAmount = $('fund-target-amount').value ? Number($('fund-target-amount').value) : null;
    const targetDate = $('fund-target-date').value || null;
    if (type === 'sinking_fund' && (!targetAmount || !targetDate)) throw new Error('Para un fondo acumulativo indica el objetivo y la fecha de vencimiento.');
    await addBudgetTemplate(membership.household_id, currentMonth, { name: $('template-item-name').value.trim(), itemType: type, amount: Number($('template-item-amount').value), accountId: $('template-item-account').value, targetAmount, targetDate });
    event.target.reset(); toggleFundFields(); await loadMonth(); message('budget-message', 'Plantilla guardada y añadida al mes actual. Se copiará a los meses nuevos.', false);
  } catch (error) { message('budget-message', friendlyError(error)); } finally { button.disabled = false; }
});
function toggleFundFields() {
  const isFund = $('template-item-type').value === 'sinking_fund';
  $('fund-target-field').classList.toggle('hidden', !isFund); $('fund-date-field').classList.toggle('hidden', !isFund);
  $('fund-target-amount').required = isFund; $('fund-target-date').required = isFund;
}
$('template-item-type').addEventListener('change', toggleFundFields);
$('account-type').addEventListener('change', populateAccountSelectors);
$('account-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try {
    const accountType = $('account-type').value;
    const ownerId = accountType === 'individual' ? $('account-owner').value : null;
    await addAccount(membership.household_id, $('account-name').value.trim(), accountType, ownerId, Number($('account-initial-balance').value));
    event.target.reset(); $('account-initial-balance').value = '0'; populateAccountSelectors(); await loadMonth(); message('account-message', 'Cuenta añadida.', false);
  } catch (error) { message('account-message', friendlyError(error)); } finally { button.disabled = false; }
});
$('transaction-date').value = new Date().toLocaleDateString('en-CA');
$('transaction-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try {
    const linkedItemId = $('transaction-budget-item').value;
    const type = $('transaction-type').value;
    const description = $('transaction-description').value.trim();
    const amount = Number($('transaction-amount').value);
    const date = $('transaction-date').value;
    if (linkedItemId && type !== 'expense') throw new Error('Solo puedes vincular una partida presupuestada a un gasto.');
    if (linkedItemId) await addBudgetExpense(membership.household_id, linkedItemId, $('transaction-account').value, description, amount, date);
    else await addAccountTransaction(membership.household_id, $('transaction-account').value, type, description, amount, date);
    event.target.reset(); $('transaction-date').value = new Date().toLocaleDateString('en-CA'); await loadMonth(); message('account-message', linkedItemId ? 'Gasto registrado, cuenta actualizada y presupuesto recalculado.' : 'Movimiento registrado y saldo actualizado.', false);
  } catch (error) { message('account-message', friendlyError(error)); } finally { button.disabled = false; }
});
document.addEventListener('click', async event => {
  const editIncome = event.target.closest('[data-edit-income]');
  if (editIncome) {
    const next = prompt('Nuevo importe previsto para este mes (€):', editIncome.dataset.amount);
    if (next === null) return;
    const amount = Number(next.replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) { notify('Introduce un importe mayor que cero.'); return; }
    try { await updateMonthlyIncome(editIncome.dataset.editIncome, amount); await loadMonth(); notify('Importe del mes actualizado. La plantilla habitual no cambia.'); }
    catch (error) { notify(friendlyError(error)); }
    return;
  }
  const editTemplate = event.target.closest('[data-edit-template]');
  if (editTemplate) {
    const next = prompt('Nuevo importe mensual habitual (€):', editTemplate.dataset.amount);
    if (next === null) return;
    const amount = Number(next.replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) { notify('Introduce un importe mayor que cero.'); return; }
    try { await updateIncomeTemplate(editTemplate.dataset.editTemplate, amount); await loadMonth(); notify('Importe habitual actualizado. Los meses ya generados no cambian.'); }
    catch (error) { notify(friendlyError(error)); }
    return;
  }
  const toggleTemplate = event.target.closest('[data-toggle-template]');
  if (toggleTemplate) {
    try { await setIncomeTemplateActive(toggleTemplate.dataset.toggleTemplate, toggleTemplate.dataset.active !== 'true'); await loadMonth(); notify('Plantilla actualizada. Los meses ya generados no se modifican.'); }
    catch (error) { notify(friendlyError(error)); }
    return;
  }
  const editBudgetItem = event.target.closest('[data-edit-budget-item]');
  if (editBudgetItem) {
    const next = prompt('Nuevo importe previsto para esta partida (€):', editBudgetItem.dataset.amount);
    if (next === null) return;
    const amount = Number(next.replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) { notify('Introduce un importe mayor que cero.'); return; }
    try { await updateMonthlyItem(editBudgetItem.dataset.editBudgetItem, amount); await loadMonth(); notify('Importe ajustado únicamente para este mes.'); }
    catch (error) { notify(friendlyError(error)); }
    return;
  }
  const editBudgetTemplate = event.target.closest('[data-edit-budget-template]');
  if (editBudgetTemplate) {
    const next = prompt('Nueva aportación mensual habitual (€):', editBudgetTemplate.dataset.amount);
    if (next === null) return;
    const amount = Number(next.replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) { notify('Introduce un importe mayor que cero.'); return; }
    try { await updateBudgetTemplate(editBudgetTemplate.dataset.editBudgetTemplate, amount); await loadMonth(); notify('Plantilla actualizada. Los meses ya generados no cambian.'); }
    catch (error) { notify(friendlyError(error)); }
    return;
  }
  const deleteBudgetTemplateButton = event.target.closest('[data-delete-budget-template]');
  if (deleteBudgetTemplateButton) {
    const name = deleteBudgetTemplateButton.dataset.name;
    if (!confirm(`¿Eliminar definitivamente la plantilla habitual «${name}»? Las partidas ya copiadas a meses anteriores o actuales se conservarán.`)) return;
    try { await deleteBudgetTemplate(deleteBudgetTemplateButton.dataset.deleteBudgetTemplate); await loadMonth(); notify('Plantilla eliminada. Las partidas mensuales existentes se mantienen.'); }
    catch (error) { notify(friendlyError(error)); }
    return;
  }
  const linkExpenseButton = event.target.closest('[data-link-expense]');
  if (linkExpenseButton) {
    $('transaction-type').value = 'expense';
    $('transaction-budget-item').value = linkExpenseButton.dataset.linkExpense;
    const today = new Date().toLocaleDateString('en-CA');
    $('transaction-date').value = today.startsWith(currentMonth) ? today : `${currentMonth}-01`;
    showSection('accounts');
    $('transaction-description').focus();
    notify('Completa los datos del gasto; quedará vinculado a esta partida.');
    return;
  }
  const toggleBudgetTemplate = event.target.closest('[data-toggle-budget-template]');
  if (toggleBudgetTemplate) {
    try { await setBudgetTemplateActive(toggleBudgetTemplate.dataset.toggleBudgetTemplate, toggleBudgetTemplate.dataset.active !== 'true'); await loadMonth(); notify('Plantilla actualizada; los meses existentes se conservan.'); }
    catch (error) { notify(friendlyError(error)); }
    return;
  }
  const button = event.target.closest('[data-delete]'); if (!button) return;
  if (!confirm('¿Quieres eliminar este elemento de la planificación?')) return;
  try { await deleteRow(button.dataset.delete, button.dataset.id); await loadMonth(); notify('Elemento eliminado.'); }
  catch (error) { notify(friendlyError(error)); }
});

if (!isSupabaseConfigured) {
  showView('auth-view'); message('auth-message', 'Antes de entrar, configura la URL y la clave pública de Supabase en supabase-config.js.');
} else {
  supabase.auth.onAuthStateChange(() => { queueMicrotask(() => refreshSession()); });
  refreshSession();
}
