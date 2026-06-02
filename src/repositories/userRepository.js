import provider from '../providers/supabaseProvider.js';

const userRepository = {
  createUser: (userData) => provider.createUser(userData),
  findByUid: (uid) => provider.findByUid(uid),
  upsertUser: (userData) => provider.upsertUser(userData),
};

export default userRepository;
