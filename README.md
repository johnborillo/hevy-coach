# Hevy Coach

A private training-intelligence workspace for Hevy. Hevy remains the workout logger; this app adds progression analysis, weekly coaching reviews, athlete context, persistent conversations, and tailored program drafts.

## Product capabilities

- Synchronizes complete workout history and available exercise templates from Hevy into a private local training store.
- Tracks training frequency, load-volume, direct muscle-group sets, estimated 1RM trends, recent estimated PRs, and exercise-level progression.
- Classifies warm-ups, working sets, dropsets, failure sets, bodyweight/assisted work, and timed or distance efforts before calculating metrics.
- Audits a complete muscle taxonomy with direct and indirect sets, visible zero-volume muscles, and persistent custom-exercise mappings.
- Evaluates each exercise with robust rep, load, and RPE trends to label progression, detect stalls, and recommend the next action.
- Generates an automatic weekly review with wins, watch items, and next steps.
- Saves athlete profile details used to personalize recommendations.
- Saves coaching chats and generated programs in a private D1 database.
- Supports kilograms and pounds throughout the interface.
- Uses OpenRouter for generative coaching when configured, with a deterministic evidence engine as a fallback.

## Environment

Copy `.env.example` to `.env.local` and configure:

```text
HEVY_API_KEY=
OPENROUTER_API_KEY=
OPENROUTER_MODEL=z-ai/glm-5.3-flash
```

Secrets are read only by server routes. Never commit `.env.local` or place keys in browser code.

## Local development

```bash
npm install
npm run db:generate
npm run build
./node_modules/.bin/wrangler d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_charming_sheva_callister.sql
npm start
```

The generated migration is applied automatically by Sites during production publishing. Run each migration only once per local database.

## Verification

```bash
npm test
npm run typecheck
npm run build
```

The analysis suite uses deterministic 26-week novice, intermediate, and advanced
athlete fixtures. Derived metrics carry an analysis-engine version and source
coverage metadata so future calculation changes can be audited and re-derived.

Hevy workouts are stored twice: a raw JSON snapshot for faithful re-analysis and
normalized workout, set, and template rows for fast bounded queries. The typed
repository in `lib/hevy-repo.ts` owns writes to those tables. Dashboard reads stay
on the local store; the Hevy sync endpoint imports full history in resumable,
bounded chunks and then applies update/delete events. Chat and program requests
never poll Hevy directly. The header sync action refreshes stale data on demand.

## Safety boundaries

Estimated 1RM is treated as a trend signal, not a tested maximum. Coaching guidance is informational and does not diagnose injury or medical conditions. Programs remain drafts, and nothing is written back to Hevy without explicit approval.
