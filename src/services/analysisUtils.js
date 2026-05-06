import { supabase } from '../../supabase.js';

const RATE_LIMIT = 3;

export function jaccardSimilarity(a, b) {
  const setA = new Set(a.toLowerCase().split(/\s+/));
  const setB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = [...setA].filter(w => setB.has(w)).length;
  return intersection / (setA.size + setB.size - intersection);
}

export function buildScoreBreakdown(skillsArray) {
  const required = skillsArray.filter((s) => s.importance === 0);
  const recommended = skillsArray.filter((s) => s.importance === 1);
  const strongRequired = required.filter((s) => s.fit_score >= 4).length;
  const weakRecommended = recommended.filter((s) => s.fit_score < 4).length;
  return `Strong on ${strongRequired}/${required.length} required skills, needs work on ${weakRecommended}/${recommended.length} recommended skills`;
}

export async function checkRateLimit(userId) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('analyses')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', since);

  if (error) throw error;
  return { allowed: count < RATE_LIMIT, used: count, limit: RATE_LIMIT };
}
