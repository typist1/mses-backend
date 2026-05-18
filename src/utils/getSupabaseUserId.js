import { supabase } from '../../supabase.js';

export async function getSupabaseUserId(firebaseUid) {
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('firebase_uid', firebaseUid)
    .single();
  if (error || !data) throw new Error('User not found in database');
  return data.id;
}
