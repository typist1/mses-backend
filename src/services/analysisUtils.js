import { supabase } from '../../supabase.js';

const RATE_LIMIT = 3;

export function checkFabricatedNumerics(originalBullets, rewrittenBullets) {
  const numRegex = /\$?[\d,]+(?:\.\d+)?%?/g;
  const flagged = [];
  const len = Math.max(originalBullets.length, rewrittenBullets.length);

  for (let i = 0; i < len; i++) {
    const original = originalBullets[i] || '';
    const rewritten = rewrittenBullets[i] || '';
    const originalNums = new Set(original.match(numRegex) || []);
    const rewrittenNums = rewritten.match(numRegex) || [];
    const fabricated = rewrittenNums.filter((n) => !originalNums.has(n));
    if (fabricated.length > 0) {
      flagged.push({ index: i, bullet: rewritten, fabricated_values: fabricated });
    }
  }
  return flagged;
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
