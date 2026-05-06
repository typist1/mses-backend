import express from 'express';
import { supabase } from '../../supabase.js';
import authMiddleware from '../middleware/authMiddleware.js';
import {
  truncateInputs,
  preflightResume,
  sanitizeJD,
  parseResume,
  gapAnalysis,
  generateSuggestions,
  PROMPT_VERSION,
} from '../services/llmService.js';
import {
  buildScoreBreakdown,
  checkRateLimit,
  jaccardSimilarity,
} from '../services/analysisUtils.js';

const router = express.Router();

async function getSupabaseUserId(firebaseUid) {
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('firebase_uid', firebaseUid)
    .single();
  if (error || !data) throw new Error('User not found in database');
  return data.id;
}

function isNonEnglish(text) {
  const nonAscii = (text.match(/[^\x00-\x7F]/g) || []).length;
  return nonAscii / text.length > 0.3;
}

// POST /analyze
router.post('/', authMiddleware, async (req, res) => {
  const { resumeText, jdText, resumeId, resumeTextEdited } = req.body;

  if (!resumeText || !jdText) {
    return res.status(400).json({ error: 'resumeText and jdText are required' });
  }

  let userId;
  try {
    userId = await getSupabaseUserId(req.user.uid);
  } catch {
    return res.status(401).json({ error: 'User not found' });
  }

  // Rate limit
  let rateCheck;
  try {
    rateCheck = await checkRateLimit(userId);
  } catch {
    return res.status(500).json({ error: 'Failed to check rate limit' });
  }
  if (!rateCheck.allowed) {
    return res.status(429).json({
      error: `Analysis limit reached. You've used ${rateCheck.used}/${rateCheck.limit} analyses today. Try again tomorrow.`,
    });
  }

  // JD length guard
  const JD_CHAR_LIMIT = 20000;
  if (jdText.length > JD_CHAR_LIMIT) {
    return res.status(400).json({ error: `Job description is too long (${jdText.length.toLocaleString()} characters). Please trim it to under ${JD_CHAR_LIMIT.toLocaleString()} characters and try again.` });
  }

  // Short resume guard
  if (resumeText.trim().length < 200) {
    return res.status(400).json({
      error: "We couldn't extract enough text from your file. Make sure it's not a scanned image or password-protected.",
    });
  }

  // Non-English guard
  if (isNonEnglish(resumeText)) {
    return res.status(400).json({ error: 'English-only resumes are supported at this time.' });
  }

  // Truncate resume if needed
  const truncated = truncateInputs(resumeText, jdText);
  const flags = {
    truncated_resume: truncated.truncated_resume,
    sparse_jd: false,
  };

  // Pre-flight + JD sanitize (independent — run in parallel)
  let preflight, jdResult;
  try {
    [preflight, jdResult] = await Promise.all([
      preflightResume(truncated.resumeText),
      sanitizeJD(truncated.jdText),
    ]);
  } catch (e) {
    console.error('Validation error:', e.message, e.code);
    if (e.code === 'JSON_PARSE_FAILED') return res.status(500).json({ error: 'Validation failed. Please try again.' });
    return res.status(500).json({ error: 'Failed to validate inputs' });
  }
  if (!preflight.is_resume) {
    return res.status(400).json({ error: preflight.rejection_reason || 'The uploaded document does not appear to be a resume.' });
  }
  if (!jdResult.is_valid_job_description) {
    return res.status(400).json({ error: jdResult.rejection_reason || 'The provided text does not appear to be a valid job description.' });
  }

  const cleanedJd = jdResult.cleaned_jd || truncated.jdText;
  if (cleanedJd.length < 300) flags.sparse_jd = true;

  // Phase 1: parse resume (use cached parse unless text changed significantly)
  let parsedResume;
  let resumeConflict = false;
  if (resumeId) {
    const { data: resumeRow } = await supabase
      .from('resumes')
      .select('parsed_resume, resume_text')
      .eq('id', resumeId)
      .eq('user_id', userId)
      .single();

    if (!resumeRow) {
      return res.status(400).json({ error: 'Invalid resumeId' });
    }

    let useCache = !!resumeRow?.parsed_resume;
    if (useCache && resumeTextEdited && resumeRow.resume_text) {
      const similarity = jaccardSimilarity(resumeRow.resume_text, truncated.resumeText);
      if (similarity < 0.85) {
        useCache = false;
        resumeConflict = true;
      }
    }

    if (useCache) {
      parsedResume = resumeRow.parsed_resume;
    } else {
      try {
        parsedResume = await parseResume(truncated.resumeText);
      } catch (e) {
        if (e.code === 'JSON_PARSE_FAILED') return res.status(500).json({ error: 'Resume parsing failed. Please try again.' });
        return res.status(500).json({ error: 'Failed to parse resume' });
      }
      if (!resumeConflict) {
        await supabase.from('resumes').update({ parsed_resume: parsedResume }).eq('id', resumeId);
      }
    }
  } else {
    try {
      parsedResume = await parseResume(truncated.resumeText);
    } catch (e) {
      if (e.code === 'JSON_PARSE_FAILED') return res.status(500).json({ error: 'Resume parsing failed. Please try again.' });
      return res.status(500).json({ error: 'Failed to parse resume' });
    }
  }

  // Phase 2: gap analysis
  let gapResult;
  try {
    gapResult = await gapAnalysis(parsedResume, cleanedJd);
  } catch (e) {
    if (e.code === 'JSON_PARSE_FAILED') return res.status(500).json({ error: 'Gap analysis failed. Please try again.' });
    return res.status(500).json({ error: 'Failed to run gap analysis' });
  }
  if ((gapResult.skills || []).length < 5) flags.sparse_jd = true;

  // Phase 3: generate suggestions
  let suggestionsResult;
  try {
    suggestionsResult = await generateSuggestions(parsedResume, gapResult, jdResult.job_title);
  } catch (e) {
    if (e.code === 'JSON_PARSE_FAILED') return res.status(500).json({ error: 'Resume optimization failed. Please try again.' });
    return res.status(500).json({ error: 'Failed to generate suggestions' });
  }

  const changeLog = suggestionsResult.suggestions || [];

  const scoreBreakdown = buildScoreBreakdown(gapResult.skills || []);
  const overallFitScore = gapResult.overall_fit_score;

  // Persist
  const { data: inserted, error: dbError } = await supabase
    .from('analyses')
    .insert({
      user_id: userId,
      resume_id: resumeId || null,
      job_title: jdResult.job_title,
      company: jdResult.company,
      overall_fit_score: overallFitScore,
      parsed_resume: parsedResume,
      gap_analysis: gapResult,
      optimized_resume: null,
      change_log: changeLog,
      flags: { ...flags, resume_conflict: resumeConflict },
      prompt_version: PROMPT_VERSION,
    })
    .select()
    .single();

  if (dbError) {
    console.error('Error saving analysis:', dbError.message);
    return res.status(500).json({ error: 'Failed to save analysis' });
  }

  return res.status(200).json({
    id: inserted.id,
    overall_fit_score: overallFitScore,
    score_breakdown: scoreBreakdown,
    job_title: jdResult.job_title,
    company: jdResult.company,
    parsed_resume: parsedResume,
    gap_analysis: gapResult,
    change_log: changeLog,
    flags: { ...flags, resume_conflict: resumeConflict },
    prompt_version: PROMPT_VERSION,
    created_at: inserted.created_at,
  });
});

// GET /analyze — list analyses for current user
router.get('/', authMiddleware, async (req, res) => {
  let userId;
  try {
    userId = await getSupabaseUserId(req.user.uid);
  } catch {
    return res.status(401).json({ error: 'User not found' });
  }

  let query = supabase
    .from('analyses')
    .select('id, job_title, company, overall_fit_score, created_at, resume_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (req.query.resumeId) {
    query = query.eq('resume_id', req.query.resumeId);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: 'Failed to fetch analyses' });

  return res.json({ analyses: data });
});

// GET /analyze/:id — fetch single analysis
router.get('/:id', authMiddleware, async (req, res) => {
  let userId;
  try {
    userId = await getSupabaseUserId(req.user.uid);
  } catch {
    return res.status(401).json({ error: 'User not found' });
  }

  const { data, error } = await supabase
    .from('analyses')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', userId)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Analysis not found' });

  return res.json(data);
});

export default router;
