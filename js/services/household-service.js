import { supabase } from './supabase.js';
export async function getMyMembership() {
  // RLS permite a cada miembro consultar el listado completo del hogar.
  // Por eso NO debemos usar limit(1): podría devolver la fila del propietario
  // cuando inicia sesión otro miembro. Filtramos siempre por el usuario autenticado.
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const userId = userData?.user?.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from('family_members')
    .select('id, household_id, name, role, households(name)')
    .eq('auth_user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
export async function createHousehold(name, memberName) {
  const { data, error } = await supabase.rpc('create_household', { p_household_name: name, p_member_name: memberName });
  if (error) throw error;
  return data;
}
export async function addExistingUserToHousehold(householdId, email, memberName) {
  const { data, error } = await supabase.rpc('add_existing_user_to_household', {
    p_household_id: householdId,
    p_email: email,
    p_member_name: memberName,
  });
  if (error) throw error;
  return data;
}
