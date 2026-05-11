# Backend — CLAUDE.md

## Stack
Express 5 · Node.js ESM (`"type": "module"`) · Firebase Admin SDK · Supabase JS client · Anthropic SDK

## Routes
| Mount | File | Purpose |
|-------|------|---------|
| `/auth` | `src/routes/authRoutes.js` | Firebase auth endpoints |
| `/resumes` | `src/routes/resumeRoutes.js` | Resume CRUD, file upload, parse, version management |
| `/analyze` | `src/routes/analysisRoutes.js` | Main LLM pipeline (full analysis) |
| `/file` | `src/routes/pdfRoutes.js` | PDF file ops |
| `/health` | `src/server.js` | Health check |

## Key Files
| File | Purpose |
|------|---------|
| `src/services/llmService.js` | All LLM calls: preflightResume, sanitizeJD, parseResume, gapAnalysis, generateSuggestions |
| `src/services/analysisUtils.js` | buildScoreBreakdown, checkRateLimit (daily per user), jaccardSimilarity |
| `src/middleware/authMiddleware.js` | Verifies Firebase JWT → sets `req.user.uid` |
| `src/assets/MSESCourses.js` | Minified MSES course list injected into gapAnalysis prompt |
| `supabase.js` | Supabase client (uses `SUPABASE_SERVICE_ROLE_KEY`) |
| `src/config/database.js` | Postgres pool for direct DB access |

## Auth Pattern
Every protected route: Firebase token → `authMiddleware` → `getSupabaseUserId(req.user.uid)` → Supabase query

## LLM Details
- Model: `claude-3-5-haiku-20241022` via Anthropic SDK
- Retries once on JSON parse failure (sends raw response back asking for clean JSON)
- Resume truncated to 10,000 chars (70% head / 30% tail split) if longer
- Max 20 skills in gap analysis output

## Analysis Caching
Parsed resume cached in `resumes.parsed_resume`. Before re-parsing: Jaccard similarity check vs `resumes.resume_text`. If similarity < 0.85, re-parse and set `resume_conflict = true` in flags.

## Env Vars Required
```
CLAUDE_API_KEY                  # Anthropic
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
DATABASE_URL                    # Supabase Postgres connection string
PORT=5050
NODE_ENV
FRONTEND_URL                    # Production frontend (CORS)
FRONTEND_URL_DEV                # Dev frontend (CORS)
FIREBASE_SERVICE_ACCOUNT_JSON   # Firebase Admin SDK service account JSON string
```

## Dev
```bash
npm start    # nodemon src/server.js, port 5050
```
