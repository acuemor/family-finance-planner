import { supabase } from './supabase.js';
export async function getMonthlyData(householdId, month) {
  const monthDate = `${month}-01`;
  const { error: prepareError } = await supabase.rpc('prepare_monthly_income_plan', { p_household_id: householdId, p_month: monthDate });
  if (prepareError) throw prepareError;
  const { error: budgetPrepareError } = await supabase.rpc('prepare_monthly_budget_plan', { p_household_id: householdId, p_month: monthDate });
  if (budgetPrepareError) throw budgetPrepareError;
  const [planResult, incomeResult, itemResult, accountResult, transactionResult, memberResult] = await Promise.all([
    supabase.from('monthly_plans').select('*').eq('household_id', householdId).eq('month', monthDate).maybeSingle(),
    supabase.from('monthly_plan_incomes').select('*').eq('household_id', householdId).eq('month', monthDate).order('created_at'),
    supabase.from('monthly_plan_items').select('*').eq('household_id', householdId).eq('month', monthDate).order('created_at'),
    supabase.from('accounts').select('*').eq('household_id', householdId).eq('is_active', true).order('name'),
    supabase.from('account_transactions').select('*').eq('household_id', householdId).order('transaction_date', { ascending: false }),
    supabase.from('family_members').select('id, name, role').eq('household_id', householdId).order('created_at'),
  ]);
  for (const result of [planResult, incomeResult, itemResult, accountResult, transactionResult, memberResult]) if (result.error) throw result.error;
  return { plan: planResult.data, incomes: incomeResult.data || [], items: itemResult.data || [], accounts: accountResult.data || [], transactions: transactionResult.data || [], members: memberResult.data || [] };
}
export async function addMonthlyIncome(householdId, month, description, memberName, amount) {
  const { data: plan, error: planError } = await ensurePlan(householdId, month);
  if (planError) throw planError;
  const { error } = await supabase.from('monthly_plan_incomes').insert({ household_id: householdId, monthly_plan_id: plan.id, month: `${month}-01`, description, member_name: memberName, planned_amount: amount });
  if (error) throw error;
}
export async function addMonthlyItem(householdId, month, name, itemType, amount, destinationAccountId = null) {
  const { data: plan, error: planError } = await ensurePlan(householdId, month);
  if (planError) throw planError;
  const { error } = await supabase.from('monthly_plan_items').insert({ household_id: householdId, monthly_plan_id: plan.id, month: `${month}-01`, name, item_type: itemType, planned_amount: amount, destination_account_id: destinationAccountId || null });
  if (error) throw error;
}
export async function addMonthlyItems(householdId, month, items) {
  if (!Array.isArray(items) || items.length === 0) return;
  const { data: plan, error: planError } = await ensurePlan(householdId, month);
  if (planError) throw planError;
  const rows = items.map(item => ({
    household_id: householdId,
    monthly_plan_id: plan.id,
    month: `${month}-01`,
    name: item.name,
    item_type: item.itemType,
    planned_amount: item.amount,
    destination_account_id: item.destinationAccountId || null,
  }));
  const { error } = await supabase.from('monthly_plan_items').insert(rows);
  if (error) throw error;
}
async function ensurePlan(householdId, month) {
  const monthDate = `${month}-01`;
  const { error: prepareError } = await supabase.rpc('prepare_monthly_income_plan', { p_household_id: householdId, p_month: monthDate });
  if (prepareError) throw prepareError;
  const { data, error } = await supabase.from('monthly_plans').select('id, status').eq('household_id', householdId).eq('month', monthDate).single();
  if (error) throw error;
  if (data.status === 'closed') throw new Error('Este mes está cerrado y no admite modificaciones.');
  return { data, error: null };
}
export async function addAccount(householdId, name, accountType, ownerMemberId, initialBalance) {
  const { error } = await supabase.from('accounts').insert({
    household_id: householdId,
    name,
    account_type: accountType,
    owner_member_id: accountType === 'individual' ? ownerMemberId : null,
    initial_balance: initialBalance,
  });
  if (error) throw error;
}
export async function addAccountTransaction(householdId, accountId, transactionType, description, amount, transactionDate) {
  const { error } = await supabase.from('account_transactions').insert({
    household_id: householdId, account_id: accountId, transaction_type: transactionType,
    description, amount, transaction_date: transactionDate,
  });
  if (error) throw error;
}

export async function addBudgetExpense(householdId, itemId, accountId, description, amount, transactionDate) {
  const { error } = await supabase.rpc('register_budget_expense', {
    p_household_id: householdId, p_item_id: itemId, p_account_id: accountId,
    p_description: description, p_amount: amount, p_transaction_date: transactionDate,
  });
  if (error) throw error;
}
export async function deleteRow(table, id) {
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw error;
}

export async function getIncomeTemplates(householdId) {
  const { data, error } = await supabase.from('income_templates')
    .select('id, member_id, description, default_amount, start_month, end_month, is_active')
    .eq('household_id', householdId).order('created_at');
  if (error) throw error;
  return data || [];
}

export async function addIncomeTemplate(householdId, memberId, description, amount, startMonth) {
  const { error } = await supabase.from('income_templates').insert({
    household_id: householdId, member_id: memberId, description,
    default_amount: amount, start_month: `${startMonth}-01`, is_active: true,
  });
  if (error) throw error;
}

export async function updateIncomeTemplate(id, amount) {
  const { error } = await supabase.from('income_templates').update({ default_amount: amount }).eq('id', id);
  if (error) throw error;
}

export async function addExtraordinaryIncome(householdId, month, memberId, description, amount) {
  const { data: plan } = await ensurePlan(householdId, month);
  const member = (await supabase.from('family_members').select('name').eq('id', memberId).eq('household_id', householdId).single());
  if (member.error) throw member.error;
  const { error } = await supabase.from('monthly_plan_incomes').insert({
    household_id: householdId, monthly_plan_id: plan.id, month: `${month}-01`,
    description, member_name: member.data.name, member_id: memberId,
    planned_amount: amount, income_type: 'extraordinary',
  });
  if (error) throw error;
}

export async function setIncomeTemplateActive(id, isActive) {
  const { error } = await supabase.from('income_templates').update({ is_active: isActive }).eq('id', id);
  if (error) throw error;
}

export async function updateMonthlyIncome(id, amount) {
  const { error } = await supabase.from('monthly_plan_incomes').update({ planned_amount: amount }).eq('id', id);
  if (error) throw error;
}

export async function getBudgetTemplates(householdId) {
  const { data, error } = await supabase.from('budget_templates')
    .select('id, name, item_type, default_amount, destination_account_id, target_amount, target_date, start_month, end_month, is_active')
    .eq('household_id', householdId).order('created_at');
  if (error) throw error;
  return data || [];
}

export async function addBudgetTemplate(householdId, month, values) {
  const { error } = await supabase.from('budget_templates').insert({
    household_id: householdId, name: values.name, item_type: values.itemType,
    default_amount: values.amount, destination_account_id: values.accountId || null,
    target_amount: values.targetAmount || null, target_date: values.targetDate || null,
    start_month: `${month}-01`, is_active: true,
  });
  if (error) throw error;
  const { error: prepareError } = await supabase.rpc('prepare_monthly_budget_plan', { p_household_id: householdId, p_month: `${month}-01` });
  if (prepareError) throw prepareError;
}

export async function updateBudgetTemplate(id, amount) {
  const { error } = await supabase.from('budget_templates').update({ default_amount: amount }).eq('id', id);
  if (error) throw error;
}

export async function setBudgetTemplateActive(id, isActive) {
  const { error } = await supabase.from('budget_templates').update({ is_active: isActive }).eq('id', id);
  if (error) throw error;
}

export async function deleteBudgetTemplate(id) {
  const { error } = await supabase.rpc('delete_budget_template', { p_template_id: id });
  if (error) throw error;
}

export async function updateMonthlyItem(id, amount) {
  const { error } = await supabase.from('monthly_plan_items').update({ planned_amount: amount }).eq('id', id);
  if (error) throw error;
}
