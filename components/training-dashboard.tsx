'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Dumbbell,
  Gauge,
  MessageSquareText,
  RefreshCw,
  Settings2,
  Sparkles,
  Target,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DashboardData } from '@/lib/hevy';

const NAV_ITEMS = [
  { label: 'Today', icon: Activity, href: '#today' },
  { label: 'Progress', icon: BarChart3, href: '#progress' },
  { label: 'Coach', icon: MessageSquareText, href: '#coach' },
  { label: 'Profile', icon: Settings2, href: '#profile' },
];

function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function TrendChart({ data }: { data: DashboardData['trend'] }) {
  const width = 620;
  const height = 190;
  const pad = 24;
  const values = data.points.map((point) => point.value);
  const rawMin = values.length ? Math.min(...values) : 0;
  const rawMax = values.length ? Math.max(...values) : 1;
  const padding = Math.max((rawMax - rawMin) * 0.18, 1);
  const min = rawMin - padding;
  const max = rawMax + padding;
  const range = max - min;
  const points = data.points.map((point, index) => {
    const x =
      pad +
      (index / Math.max(data.points.length - 1, 1)) * (width - pad * 2);
    const y = height - pad - ((point.value - min) / range) * (height - pad * 2);
    return { ...point, x, y };
  });
  const path = points.map((point) => `${point.x},${point.y}`).join(' ');

  return (
    <div
      className="trend-chart"
      aria-label={`${data.exercise} estimated strength trend`}
    >
      <svg viewBox={`0 0 ${width} ${height}`} aria-labelledby="trend-title">
        <title id="trend-title">
          {`${data.exercise} estimated one-rep-max trend`}
        </title>
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--signal)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--signal)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((line) => (
          <line
            key={line}
            x1={pad}
            x2={width - pad}
            y1={pad + line * 45}
            y2={pad + line * 45}
            stroke="var(--line)"
            strokeWidth="1"
          />
        ))}
        {points.length > 1 && (
          <path
            d={`M ${points[0].x} ${height - pad} L ${path.replaceAll(',', ' ')} L ${points.at(-1)?.x} ${height - pad} Z`}
            fill="url(#trend-fill)"
          />
        )}
        <polyline
          points={path}
          fill="none"
          stroke="var(--signal-deep)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {points.map((point, index) => (
          <g key={`${point.date}-${index}`}>
            <circle
              cx={point.x}
              cy={point.y}
              r="5"
              fill="var(--panel)"
              stroke="var(--signal-deep)"
              strokeWidth="3"
            />
            <text x={point.x} y={height - 3} textAnchor="middle">
              {point.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export function TrainingDashboard({ data }: { data: DashboardData }) {
  const [duration, setDuration] = useState('40');
  const [focus, setFocus] = useState('upper');
  const [coachAnswer, setCoachAnswer] = useState(data.insights.plateau);
  const [planReady, setPlanReady] = useState(true);

  const plan = useMemo(() => {
    const limit = duration === '25' ? 3 : duration === '40' ? 4 : 6;
    const upperMuscles = [
      'Chest',
      'Upper Back',
      'Lats',
      'Shoulders',
      'Biceps',
      'Triceps',
    ];
    const filtered =
      focus === 'upper'
        ? data.exerciseOptions.filter((item) => upperMuscles.includes(item.muscle))
        : data.exerciseOptions;
    const options = filtered.length >= limit ? filtered : data.exerciseOptions;
    return options.slice(0, limit);
  }, [data.exerciseOptions, duration, focus]);

  const maxMuscleSets = Math.max(
    ...data.muscles.map((muscle) => muscle.sets),
    1,
  );

  useEffect(() => {
    type ModelContext = {
      registerTool: (
        tool: {
          name: string;
          title: string;
          description: string;
          inputSchema: object;
          annotations: {
            readOnlyHint: boolean;
            untrustedContentHint: boolean;
          };
          execute: (input: unknown) => Promise<unknown>;
        },
        options: { signal: AbortSignal },
      ) => void | Promise<void>;
    };

    const modelContext = (
      document as Document & { modelContext?: ModelContext }
    ).modelContext;
    if (!modelContext?.registerTool) return;

    const lifecycle = new AbortController();
    void Promise.resolve(
      modelContext.registerTool(
        {
          name: 'stage_workout_draft',
          title: 'Stage workout draft',
          description:
            'Configure and display a time-boxed workout draft from the connected Hevy history. This does not write anything to Hevy.',
          inputSchema: {
            type: 'object',
            properties: {
              duration_minutes: { type: 'integer', enum: [25, 40, 60] },
              focus: { type: 'string', enum: ['upper', 'full'] },
            },
            required: ['duration_minutes', 'focus'],
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint: false,
            untrustedContentHint: false,
          },
          async execute(input) {
            if (!input || typeof input !== 'object') {
              throw new Error('A draft configuration is required.');
            }
            const candidate = input as {
              duration_minutes?: number;
              focus?: string;
            };
            if (![25, 40, 60].includes(candidate.duration_minutes ?? 0)) {
              throw new Error('Duration must be 25, 40, or 60 minutes.');
            }
            if (!['upper', 'full'].includes(candidate.focus ?? '')) {
              throw new Error('Focus must be upper or full.');
            }

            setDuration(String(candidate.duration_minutes));
            setFocus(candidate.focus as 'upper' | 'full');
            setPlanReady(true);
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            );
            return {
              status: 'staged',
              duration_minutes: candidate.duration_minutes,
              focus: candidate.focus,
              writes_to_hevy: false,
            };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => undefined);

    return () => lifecycle.abort();
  }, []);

  return (
    <div className="app-shell">
      <aside className="side-rail">
        <a className="brand-mark" href="#today" aria-label="Hevy Coach home">
          <Dumbbell />
          <span>HC</span>
        </a>
        <nav aria-label="Primary navigation">
          {NAV_ITEMS.map((item, index) => (
            <a
              key={item.label}
              href={item.href}
              className={index === 0 ? 'active' : ''}
              title={item.label}
            >
              <item.icon />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
        <div className="rail-status" title={data.syncMessage}>
          <span className={data.connected ? 'status-dot live' : 'status-dot'} />
          <small>{data.connected ? 'Live' : 'Demo'}</small>
        </div>
      </aside>

      <main>
        <header className="topbar" id="today">
          <div>
            <p className="eyebrow">
              TRAINING INTELLIGENCE / {data.sourceLabel}
            </p>
            <h1>Good morning, {data.athleteName}.</h1>
          </div>
          <div className="sync-copy">
            <RefreshCw />
            <span>{data.syncMessage}</span>
          </div>
        </header>

        {!data.connected && (
          <section className="setup-banner" aria-label="Connection status">
            <div>
              <span className="setup-kicker">Connection pending</span>
              <strong>Your interface is ready for the Hevy key.</strong>
              <p>
                The visible numbers are clearly marked sample data until the
                server-side secret is added.
              </p>
            </div>
            <code>HEVY_API_KEY</code>
          </section>
        )}

        <section className="planner-grid">
          <div className="planner-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">NEXT BEST SESSION</p>
                <h2>Build today around real life.</h2>
              </div>
              <Sparkles className="signal-icon" />
            </div>

            <div className="planner-controls">
              <fieldset>
                <legend>Time available</legend>
                <div className="duration-group">
                  {['25', '40', '60'].map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={duration === option}
                      onClick={() => setDuration(option)}
                    >
                      {option} min
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="focus-field">
                <span>Focus</span>
                <Select
                  value={focus}
                  onValueChange={(value) => value && setFocus(value)}
                >
                  <SelectTrigger aria-label="Workout focus">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="upper">Upper body</SelectItem>
                    <SelectItem value="full">Full body</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="plan-list" aria-live="polite">
              {planReady &&
                plan.map((exercise, index) => (
                  <div className="plan-row" key={exercise.name}>
                    <span className="plan-index">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <div>
                      <strong>{exercise.name}</strong>
                      <small>
                        {exercise.muscle} · {exercise.note}
                      </small>
                    </div>
                    <span className="prescription">
                      {exercise.prescription}
                    </span>
                  </div>
                ))}
              {!planReady && (
                <div className="plan-empty">
                  Adjust time or focus, then generate a fresh draft.
                </div>
              )}
            </div>

            <div className="planner-actions">
              <Button
                className="primary-action"
                size="lg"
                onClick={() => setPlanReady(true)}
              >
                Generate draft <ArrowUpRight />
              </Button>
              <Button
                variant="ghost"
                size="lg"
                onClick={() => setPlanReady(false)}
              >
                Clear
              </Button>
              <span>Nothing is written to Hevy without approval.</span>
            </div>
          </div>

          <aside className="week-panel">
            <div className="panel-heading compact">
              <div>
                <p className="eyebrow">LAST 7 DAYS</p>
                <h2>Training distribution</h2>
              </div>
              <Gauge />
            </div>
            <div className="muscle-bars">
              {data.muscles.map((muscle) => (
                <div className="muscle-row" key={muscle.name}>
                  <div>
                    <span>{muscle.name}</span>
                    <strong>{muscle.sets}</strong>
                  </div>
                  <div className="bar-track">
                    <span
                      style={{
                        width: `${Math.max(
                          8,
                          (muscle.sets / maxMuscleSets) * 100,
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="week-note">
              <Target />
              <p>
                Distribution shows direct working sets, not a universal target.
              </p>
            </div>
          </aside>
        </section>

        <section className="metrics-grid" aria-label="Training summary">
          <StatCard
            label="Sessions / 30d"
            value={String(data.stats.sessions30d)}
            detail={`${data.stats.activeWeeks} active weeks`}
          />
          <StatCard
            label="Working sets / 7d"
            value={String(data.stats.workingSets7d)}
            detail="Warm-ups excluded"
          />
          <StatCard
            label="Training time / 30d"
            value={`${data.stats.hours30d}h`}
            detail="From session timestamps"
          />
          <StatCard
            label="Latest session"
            value={data.lastWorkout.split(' · ')[0]}
            detail={data.lastWorkout.split(' · ')[1] ?? '—'}
          />
        </section>

        <section className="analysis-grid" id="progress">
          <div className="trend-panel">
            <div className="panel-heading compact">
              <div>
                <p className="eyebrow">ESTIMATED STRENGTH</p>
                <h2>{data.trend.exercise}</h2>
              </div>
              <div
                className={`trend-change ${
                  data.trend.change < 0 ? 'negative' : ''
                }`}
              >
                {data.trend.change >= 0 ? '+' : ''}
                {data.trend.change}%
              </div>
            </div>
            <TrendChart data={data.trend} />
            <p className="chart-note">
              Epley estimate from comparable sets up to 15 reps. Use the
              direction, not the decimal, as the signal.
            </p>
          </div>

          <div className="history-panel">
            <div className="panel-heading compact">
              <div>
                <p className="eyebrow">RECENT</p>
                <h2>Workout history</h2>
              </div>
              <CalendarDays />
            </div>
            <div className="history-list">
              {data.recentWorkouts.map((workout) => (
                <div key={`${workout.title}-${workout.date}`}>
                  <span className="history-date">{workout.date}</span>
                  <div>
                    <strong>{workout.title}</strong>
                    <small>
                      {workout.exercises} exercises · {workout.workingSets}{' '}
                      working sets
                    </small>
                  </div>
                  <span className="history-duration">
                    <Clock3 /> {workout.duration}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="coach-panel" id="coach">
          <div className="coach-heading">
            <div>
              <p className="eyebrow">COACH / DATA-GROUNDED</p>
              <h2>Ask a better question of your history.</h2>
            </div>
            <MessageSquareText />
          </div>
          <div className="coach-layout">
            <div className="prompt-list">
              <button
                type="button"
                onClick={() => setCoachAnswer(data.insights.plateau)}
              >
                Why might I be plateauing? <ChevronRight />
              </button>
              <button
                type="button"
                onClick={() => setCoachAnswer(data.insights.return)}
              >
                Help me return after a break <ChevronRight />
              </button>
              <button
                type="button"
                onClick={() => setCoachAnswer(data.insights.progress)}
              >
                What should I progress next? <ChevronRight />
              </button>
            </div>
            <div className="coach-answer" aria-live="polite">
              <span>
                <Check /> Evidence first
              </span>
              <p>{coachAnswer}</p>
              <small>
                Training guidance is informational and cannot diagnose pain,
                injury or a medical condition.
              </small>
            </div>
          </div>
        </section>

        <footer id="profile">
          <span>HEVY COACH / PRIVATE WORKSPACE</span>
          <span>Analytics first. AI second. You approve every write.</span>
        </footer>
      </main>
    </div>
  );
}
