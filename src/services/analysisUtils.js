import { supabase } from '../../supabase.js';

const RATE_LIMIT = 10;

export function buildScoreBreakdown(skillsArray) {
  const required = skillsArray.filter((s) => s.importance === 0);
  const recommended = skillsArray.filter((s) => s.importance === 1);
  const strongRequired = required.filter((s) => s.fit_score >= 4).length;
  const weakRecommended = recommended.filter((s) => s.fit_score < 4).length;
  return `Strong on ${strongRequired}/${required.length} required skills, needs work on ${weakRecommended}/${recommended.length} recommended skills`;
}

export async function checkRateLimit(userId) {
  const { count, error } = await supabase
    .from('analyses')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', since);

  if (error) throw error;
  return { allowed: count < RATE_LIMIT, used: count, limit: RATE_LIMIT };
}
