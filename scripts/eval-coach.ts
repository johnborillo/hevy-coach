import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { analyzeWorkoutHistory } from '../lib/hevy';
import { askCoach } from '../lib/openrouter';
import {
  DEFAULT_COACH_MODEL,
  isCoachModelId,
  type CoachModelId,
} from '../lib/coach-options';
import type { AthleteProfile, ChatMessage } from '../lib/storage';
import { ATHLETE_FIXTURES } from '../tests/fixtures/athletes';

type GoldenQuestion = {
  id: string;
  category: string;
  question: string;
  checks: string[];
};

type EvalRow = {
  fixture: string;
  model: string;
  questionId: string;
  category: string;
  answer: string | null;
  servedModel: string | null;
  refusal: boolean;
  passes: number;
  validation: string;
  issueCounts: Array<{ kind: string; severity: string; count: number }>;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  error?: string;
};

const profile: AthleteProfile = {
  displayName: 'Eval Athlete',
  biologicalSex: 'prefer_not_to_say',
  age: 30,
  heightCm: 180,
  weightKg: 82,
  weightUnit: 'lb',
  heightUnit: 'imperial',
  experience: 'intermediate',
  primaryGoal: 'Build muscle and strength',
  targetDate: '',
  daysPerWeek: 4,
  minutesPerSession: 60,
  equipment: 'Full gym',
  limitations: '',
  preferences: '',
  phase: 'maintain',
  phaseStartedAt: '2026-08-31',
  dailyCalories: null,
  proteinGrams: null,
  sleepHoursTypical: 7,
  dropsetWeight: 0.5,
  loadIncrements: { barbell: 2.5, dumbbell: 2, machine: 5, cable: 2.5 },
  timezone: 'UTC',
};

function option(name: string) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : (process.argv[index + 1] ?? null);
}

function percentile(values: number[], fraction: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[
      Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))
    ] ?? 0
  );
}

function summaryMarkdown(rows: EvalRow[]) {
  const models = [...new Set(rows.map((row) => row.model))];
  const lines = [
    '# Coach evaluation summary',
    '',
    '| Model | Questions | Refusal rate | Unverified rate | p50 latency (ms) | p95 latency (ms) | Mean cost |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const model of models) {
    const selected = rows.filter((row) => row.model === model);
    const latencies = selected.map((row) => row.latencyMs);
    const refusals = selected.filter((row) => row.refusal).length;
    const unverified = selected.filter(
      (row) => row.validation === 'unverified',
    ).length;
    const meanCost =
      selected.reduce((sum, row) => sum + row.cost, 0) /
      Math.max(1, selected.length);
    lines.push(
      `| ${model} | ${selected.length} | ${((refusals / selected.length) * 100).toFixed(1)}% | ${((unverified / selected.length) * 100).toFixed(1)}% | ${percentile(latencies, 0.5)} | ${percentile(latencies, 0.95)} | $${meanCost.toFixed(6)} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function installDryRunFetch() {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        id: 'eval-dry-run',
        model: DEFAULT_COACH_MODEL,
        provider: 'dry-run',
        choices: [
          {
            finish_reason: 'stop',
            message: { content: 'Dry-run coaching response.' },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 4,
          total_tokens: 14,
          cost: 0,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) {
    process.env.OPENROUTER_API_KEY = 'eval-dry-run';
    installDryRunFetch();
  } else if (!process.env.OPENROUTER_API_KEY) {
    throw new Error(
      'OPENROUTER_API_KEY is required. Re-run with --dry-run for a mocked evaluation.',
    );
  }
  const requestedModels = (option('--models') ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const models: CoachModelId[] = (
    requestedModels.length ? requestedModels : [DEFAULT_COACH_MODEL]
  ).filter(isCoachModelId);
  if (!models.length)
    throw new Error('No supported models were supplied to --models.');
  const fixtureNames = (option('--fixtures') ?? 'novice,intermediate,advanced')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const questions = JSON.parse(
    await readFile(resolve('evals/coach-golden.json'), 'utf8'),
  ) as GoldenQuestion[];
  const rows: EvalRow[] = [];
  for (const fixtureName of fixtureNames) {
    const fixture = ATHLETE_FIXTURES[fixtureName];
    if (!fixture) throw new Error(`Unknown fixture: ${fixtureName}`);
    const dashboard = analyzeWorkoutHistory(
      fixture.workouts,
      fixture.templates,
      fixture.athleteName,
      fixture.now,
      [],
      [],
      fixture.plannedDaysPerWeek,
      profile.phase,
      null,
      profile.timezone,
    );
    for (const model of models) {
      for (const question of questions) {
        const history: ChatMessage[] = [
          {
            id: `eval-${fixtureName}-${question.id}`,
            conversationId: 'eval',
            role: 'user',
            content: question.question,
            model: null,
            createdAt: fixture.now.toISOString(),
          },
        ];
        const startedAt = Date.now();
        try {
          const result = await askCoach(
            `eval-${fixtureName}`,
            profile,
            dashboard,
            history,
            { model },
            { searchNotes: async () => [], now: () => fixture.now },
          );
          const telemetry = result?.telemetry;
          const completions = telemetry?.completions ?? [];
          rows.push({
            fixture: fixtureName,
            model,
            questionId: question.id,
            category: question.category,
            answer: result?.content ?? null,
            servedModel: result?.model ?? null,
            refusal: Boolean(telemetry?.refusalDetected),
            passes: telemetry?.passes ?? 0,
            validation: telemetry?.validationOutcome ?? 'n/a',
            issueCounts: telemetry?.issues ?? [],
            latencyMs: Date.now() - startedAt,
            promptTokens: completions.reduce(
              (sum, item) => sum + (item.completion?.promptTokens ?? 0),
              0,
            ),
            completionTokens: completions.reduce(
              (sum, item) => sum + (item.completion?.completionTokens ?? 0),
              0,
            ),
            cost: completions.reduce(
              (sum, item) => sum + (item.completion?.cost ?? 0),
              0,
            ),
          });
        } catch (error) {
          rows.push({
            fixture: fixtureName,
            model,
            questionId: question.id,
            category: question.category,
            answer: null,
            servedModel: null,
            refusal: false,
            passes: 0,
            validation: 'error',
            issueCounts: [],
            latencyMs: Date.now() - startedAt,
            promptTokens: 0,
            completionTokens: 0,
            cost: 0,
            error:
              error instanceof Error
                ? error.message.slice(0, 600)
                : 'Unknown evaluation error',
          });
        }
      }
    }
  }
  const requestedOut = option('--out');
  const outPath = resolve(
    requestedOut ??
      `evals/results/${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(
    outPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2)}\n`,
  );
  await writeFile(outPath.replace(/\.json$/i, '.md'), summaryMarkdown(rows));
  console.log(`Evaluation written to ${outPath}`);
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Evaluation failed');
  process.exitCode = 1;
});
