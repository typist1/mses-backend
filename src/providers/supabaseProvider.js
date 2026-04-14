import { supabase } from '../../supabase.js';

export default {
  async createUser({ uid, username, email, firstname, lastname }) {
    const { data, error } = await supabase
      .from('users')
      .insert({ firebase_uid: uid, username, email, firstname, lastname })
      .select('id, firebase_uid, username, email, firstname, lastname')
      .single();
    if (error) throw error;
    return { id: data.id, firebaseUid: data.firebase_uid, username: data.username, email: data.email };
  },

  async upsertUser({ uid, username, email, firstname, lastname }) {
    const { error } = await supabase
      .from('users')
      .upsert(
        { firebase_uid: uid, username, email, firstname, lastname },
        { onConflict: 'firebase_uid' }
      );
    if (error) throw error;
    return this.findByUid(uid);
  },

  async findByUid(uid) {
    const { data, error } = await supabase
      .from('users')
      .select('id, firebase_uid, username, email, firstname, lastname')
      .eq('firebase_uid', uid)
      .single();
    if (error) return null;
    return { ...data, firebaseUid: data.firebase_uid };
  },

  async getAll() {
    const { data, error } = await supabase
      .from('users')
      .select('username, email, firstname, lastname')
      .order('username', { ascending: true });
    if (error) throw error;
    return data;
  },
};
