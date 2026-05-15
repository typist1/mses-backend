import { supabase } from '../../supabase.js';

const RATE_LIMIT = 20;

export function buildScoreBreakdown(skillsArray) {
  const required = skillsArray.filter((s) => s.importance === 0);
  const recommended = skillsArray.filter((s) => s.importance === 1);
  const strongRequired = required.filter((s) => s.fit_score >= 3).length;
  const weakRecommended = recommended.filter((s) => s.fit_score <= 2).length;
  return `Strong on ${strongRequired}/${required.length} required skills, needs work on ${weakRecommended}/${recommended.length} recommended skills`;
}

export async function checkRateLimit(userId) {
  const now = new Date();
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();

  const { count, error } = await supabase
    .from('analyses')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', since);

  if (error) throw error;
  return { allowed: count < RATE_LIMIT, used: count, limit: RATE_LIMIT };
}
