'use client';

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  CalendarDays,
  Check,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  Clock3,
  Dumbbell,
  Flame,
  Gauge,
  CircleHelp,
  Medal,
  MessageSquareText,
  Pin,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  Trophy,
} from 'lucide-react';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Button } from '@/components/ui/button';
import {
  CoachMessage,
  CoachSourcePanel,
  type CoachSource,
} from '@/components/coach-message';
import { ProgramEditor } from '@/components/program-editor';
import { WorkoutCalendar } from '@/components/workout-calendar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DashboardData, MuscleWindow } from '@/lib/hevy';
import {
  COACHES,
  COACH_MODELS,
  DEFAULT_COACH_ID,
  DEFAULT_COACH_MODEL,
  isCoachModelId,
  type CoachId,
  type CoachModelId,
} from '@/lib/coach-options';
import { MUSCLES, muscleLabel, type Muscle } from '@/lib/muscles';
import { formatEffort, formatRepRange } from '@/lib/program-v2';
import type {
  AthleteProfile,
  ChatMessage,
  ConversationSummary,
  TrainingProgram,
  WeightUnit,
} from '@/lib/storage';
import type {
  TrainingBlock,
  TrainingBlockKind,
} from '@/lib/training-block-repo';

type View = 'today' | 'progress' | 'history' | 'coach' | 'program' | 'profile';
type LedgerSortKey =
  | 'exercise'
  | 'sessions'
  | 'sets'
  | 'volume'
  | 'bestE1rm'
  | 'trend';
type SortDirection = 'asc' | 'desc';

type NextSessionPayload = {
  session: {
    dayIndex: number;
    day: TrainingProgram['days'][number];
    exercises: Array<{
      name: string;
      load: string | null;
      reps: string;
      sets: number;
      effort: string;
      rationale: string;
    }>;
  };
};

type RoutinePreview = {
  dayIndex: number;
  payload: unknown;
  confirmationToken: string;
  expiresAt: string;
};

const NAV_ITEMS = [
  { id: 'today' as const, label: 'Today', icon: Activity },
  { id: 'progress' as const, label: 'Progress', icon: BarChart3 },
  { id: 'history' as const, label: 'History', icon: CalendarDays },
  { id: 'coach' as const, label: 'Coach', icon: MessageSquareText },
  { id: 'program' as const, label: 'Program', icon: ClipboardList },
  { id: 'profile' as const, label: 'Athlete', icon: Settings2 },
];

const EMPTY_PROFILE: AthleteProfile = {
  displayName: 'Athlete',
  biologicalSex: 'prefer_not_to_say',
  age: null,
  heightCm: null,
  weightKg: null,
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
  phaseStartedAt: '',
  dailyCalories: null,
  proteinGrams: null,
  sleepHoursTypical: null,
  dropsetWeight: 0.5,
  loadIncrements: { barbell: 2.5, dumbbell: 2, machine: 5, cable: 2.5 },
  timezone: 'UTC',
};

const STARTERS = [
  'Build me a 40-minute upper session based on this week.',
  'Why might my main lifts be plateauing?',
  'Give me my weekly coaching review.',
  'How should I return after three weeks off?',
];

const COMMON_TIMEZONES = [
  'UTC',
  'America/Toronto',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Asia/Tokyo',
  'Australia/Sydney',
];

function browserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function coachFor(coachId?: CoachId | null) {
  return COACHES.find((coach) => coach.id === coachId) ?? COACHES[0];
}

const PROGRESS_HELP = {
  workingSets:
    'Working and failure sets logged in the most recent 7 days. Warm-ups are excluded and dropsets count as half a set so the total better reflects training stimulus.',
  primaryLiftTrend:
    'The change from the first to the latest estimated one-rep max across up to eight logged sessions for the exercise selected below. Use it as a direction-of-travel signal, not a tested max.',
  recentEstimatedPrs:
    'How many verified personal-record signals appear on the board below, up to five. The board waits for five prior sessions and then tracks the best comparable signal for each exercise or variation slot.',
  trainingFrequency:
    'Your logged Hevy sessions from the past 30 days converted to an average number of workouts per week.',
  estimatedStrength:
    'An estimated one-rep max (e1RM) calculated with the Epley formula from compound sets of 1–8 reps. Isolation, dropset, assisted, timed, and distance work is excluded to keep the signal meaningful.',
  estimatedPrBoard:
    'Up to five real personal records from the past 30 days. A record is only shown after five prior sessions for that exercise or variation slot, and can be an estimated one-rep max, load at a rep range, or reps at a repeatable load.',
  muscleDistribution:
    'Working sets are assigned to a detailed muscle map. Primary muscles count as direct sets; secondary muscles count as half an indirect set. Zero-volume muscles stay visible, and the comparison uses the preceding window of the same length.',
  exercisePerformance:
    'A movement-by-movement summary of your synchronized Hevy history: sessions, non-warm-up sets, load-volume, best e1RM, and e1RM change across up to six recent comparable sessions.',
  variationSlots:
    'A variation slot joins movements that train the same muscle with the same movement pattern, such as barbell, dumbbell, and machine presses. Use one when you intentionally rotate comparable exercises and want one progression and PR history. Do not group movements with different target muscles or patterns. Suggested groupings are a starting point—review the exercises before selecting Group.',
  balanceSignals:
    'Each ratio badge reads your 4-week average direct sets as “first group ÷ second group · reference range.” For example, 1 · 0.7–1.4 means equal push and pull work, within the reference range. A one-sided range such as 1.4 · 0.5+ means the ratio is 1.4 and the minimum reference is 0.5. “No data” means the second group has no sets, so a ratio cannot be calculated; “0 sets” means none were logged for that muscle. Use these as prompts to review your program, not mandatory targets.',
};

const PROFILE_HELP = {
  phase:
    'Your current nutrition and training context. Cut means losing weight, maintain means holding weight, lean gain or gain means intentionally gaining, and recomp means aiming to add muscle while body weight stays roughly stable.',
  phaseStart:
    'The date this phase began. It helps the coach compare body-weight and training trends over the correct time period.',
  calories:
    'Your usual daily calorie target. Optional; it gives nutrition context but is not treated as a perfectly measured intake.',
  protein:
    'Your usual daily protein target in grams. Optional; it helps the coach put recovery and muscle-gain advice in context.',
  sleep:
    'Your typical nightly sleep, not a one-night score. The coach uses it as recovery context when interpreting fatigue and performance.',
  dropsetWeight:
    'How much one dropset counts toward training volume. The default 0.5 means two dropsets count like one standard working set in volume summaries.',
  timezone:
    'Used to place workouts, weeks, phase dates, and reviews on your local calendar.',
  loadIncrement:
    'The smallest weight increase you can realistically make on each equipment type. For example, enter 5 lb if the next available barbell jump is 5 lb. The coach uses this to avoid recommending loads your gym cannot provide.',
};

type ApiError = { error?: string };

async function readJson<T>(response: Response) {
  return response.json() as Promise<T>;
}

function toDisplayWeight(value: number, unit: WeightUnit) {
  return unit === 'kg' ? value : value * 2.20462;
}

function weight(value: number, unit: WeightUnit, digits = 1) {
  return `${toDisplayWeight(value, unit).toLocaleString(undefined, { maximumFractionDigits: digits })} ${unit}`;
}

function formatWeight(value: number, unit: WeightUnit) {
  return weight(value, unit, 1);
}

function formatShortDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
      }).format(date)
    : value;
}

function reviewRange(weekStart: string) {
  const start = new Date(weekStart);
  if (!Number.isFinite(start.getTime())) return weekStart;
  const end = new Date(start.getTime() + 6 * 86_400_000);
  return `${formatShortDate(start.toISOString())}–${formatShortDate(end.toISOString())}`;
}

function volume(value: number, unit: WeightUnit) {
  const converted = toDisplayWeight(value, unit);
  return converted >= 1000
    ? `${(converted / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k ${unit}`
    : `${Math.round(converted).toLocaleString()} ${unit}`;
}

function imperialHeight(heightCm: number | null) {
  if (!heightCm) return { feet: '', inches: '' };
  const totalInches = Math.round(heightCm / 2.54);
  return {
    feet: String(Math.floor(totalInches / 12)),
    inches: String(totalInches % 12),
  };
}

function heightFromImperial(feet: string, inches: string) {
  if (!feet && !inches) return null;
  const totalInches = (Number(feet) || 0) * 12 + (Number(inches) || 0);
  return totalInches > 0 ? Math.round(totalInches * 2.54 * 100) / 100 : null;
}

function delta(value: number) {
  return `${value >= 0 ? '+' : ''}${value}%`;
}

const PROGRESSION_LABELS = {
  progressing: 'Progressing',
  holding: 'Holding',
  stalled: 'Stalled',
  regressing: 'Regressing',
  insufficient_data: 'Learning',
  variable_load: 'Variable load',
} as const;

const RECOMMENDATION_LABELS = {
  add_load: 'Add load',
  add_reps: 'Add reps',
  hold: 'Hold steady',
  reduce_load: 'Reduce load',
  reduce_volume: 'Reduce volume',
  swap_or_rotate: 'Swap or rotate',
  log_rpe: 'Log RPE',
  none: 'No action yet',
} as const;

function progressionTone(
  status: DashboardData['exerciseStats'][number]['progressionStatus'],
) {
  if (status === 'progressing') return 'good' as const;
  if (status === 'stalled' || status === 'regressing') return 'warn' as const;
  return 'neutral' as const;
}

const BAND_LABELS = {
  zero: 'Zero',
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  very_high: 'Very high',
} as const;

function auditTone(band: keyof typeof BAND_LABELS) {
  if (band === 'zero' || band === 'low') return 'warn' as const;
  if (band === 'very_high') return 'neutral' as const;
  return 'good' as const;
}

function MiniSparkline({
  values,
  color = 'var(--signal-deep)',
}: {
  values: number[];
  color?: string;
}) {
  if (values.length < 2)
    return <span className="sparkline-empty">Not enough data</span>;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={values.map((value, index) => ({ index, value }))}>
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          dot={{ r: 2, fill: color, strokeWidth: 0 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function orderConversations(items: ConversationSummary[]) {
  return [...items].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

function SortableHeading({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
}: {
  label: string;
  sortKey: LedgerSortKey;
  activeKey: LedgerSortKey;
  direction: SortDirection;
  onSort: (key: LedgerSortKey) => void;
}) {
  const active = activeKey === sortKey;
  const Icon = active
    ? direction === 'asc'
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;

  return (
    <th
      aria-sort={
        active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'
      }
    >
      <button type="button" onClick={() => onSort(sortKey)}>
        {label} <Icon aria-hidden="true" />
      </button>
    </th>
  );
}

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  help,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Activity;
  help?: string;
}) {
  return (
    <article className="metric-card">
      <div className="metric-label">
        <span className="metric-label-copy">
          <span>{label}</span>
          {help && <InfoTooltip title={label}>{help}</InfoTooltip>}
        </span>
        <Icon />
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function InfoTooltip({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger
        className="info-tooltip-trigger"
        aria-label={`Explain ${title}`}
        closeOnClick={false}
      >
        <CircleHelp aria-hidden="true" />
      </BaseTooltip.Trigger>
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner
          className="info-tooltip-positioner"
          sideOffset={9}
          collisionPadding={12}
        >
          <BaseTooltip.Popup className="info-tooltip-popup">
            <strong>{title}</strong>
            <span>{children}</span>
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

function StatusPill({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'good' | 'warn' | 'neutral';
}) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

function EmptyMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-message">
      <Dumbbell />
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

export function TrainingDashboard({ data }: { data: DashboardData }) {
  const [view, setView] = useState<View>('today');
  const [selectedCoachModel, setSelectedCoachModel] =
    useState<CoachModelId>(DEFAULT_COACH_MODEL);
  const [reviewExpanded, setReviewExpanded] = useState(false);
  const [selectedTrend, setSelectedTrend] = useState(
    data.strengthTrends[0]?.exercise ?? data.trend.exercise,
  );
  const [profile, setProfile] = useState<AthleteProfile>(EMPTY_PROFILE);
  const [profileState, setProfileState] = useState('Save athlete profile');
  const [bodyWeightState, setBodyWeightState] = useState('');
  const [bodyWeightSummary, setBodyWeightSummary] = useState(
    data.bodyWeightTrend ?? {
      average7d: null,
      slopeKgPerWeek: null,
      latest: null,
    },
  );
  const [trainingBlocks, setTrainingBlocks] = useState<TrainingBlock[]>([]);
  const [blockDraft, setBlockDraft] = useState({
    name: '',
    kind: 'accumulation' as TrainingBlockKind,
    startsAt: new Date().toISOString().slice(0, 10),
    endsAt: '',
  });
  const [blockState, setBlockState] = useState('');
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversation, setActiveConversation] = useState<string | null>(
    null,
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState('');
  const [animatingMessageId, setAnimatingMessageId] = useState<string | null>(
    null,
  );
  const [coachSource, setCoachSource] = useState<CoachSource | null>(null);
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);
  const [historyDate, setHistoryDate] = useState<string | null>(null);
  const [muscleWindow, setMuscleWindow] = useState<MuscleWindow>('7');
  const [ledgerSort, setLedgerSort] = useState<{
    key: LedgerSortKey;
    direction: SortDirection;
  }>({ key: 'sessions', direction: 'desc' });
  const [expandedProgression, setExpandedProgression] = useState<string | null>(
    null,
  );
  const [programs, setPrograms] = useState<TrainingProgram[]>([]);
  const [activeProgram, setActiveProgram] = useState<TrainingProgram | null>(
    null,
  );
  const [programBusy, setProgramBusy] = useState(false);
  const [programError, setProgramError] = useState('');
  const [programActionBusy, setProgramActionBusy] = useState(false);
  const [programActionError, setProgramActionError] = useState('');
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [muscleMappingBusy, setMuscleMappingBusy] = useState<string | null>(
    null,
  );
  const [muscleMappingError, setMuscleMappingError] = useState('');
  const [slotMutationBusy, setSlotMutationBusy] = useState(false);
  const [slotMutationError, setSlotMutationError] = useState('');
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [slotNameDraft, setSlotNameDraft] = useState('');
  const [muscleMappingDrafts, setMuscleMappingDrafts] = useState<
    Record<string, Muscle>
  >(() =>
    Object.fromEntries(
      data.unmappedExercises.map((exercise) => [exercise.id, 'other']),
    ),
  );
  const [editingProgramId, setEditingProgramId] = useState<string | null>(null);
  const [adjustingProgramId, setAdjustingProgramId] = useState<string | null>(
    null,
  );
  const [programAdjustment, setProgramAdjustment] = useState('');
  const [nextSession, setNextSession] = useState<
    NextSessionPayload['session'] | null
  >(null);
  const [nextSessionBusy, setNextSessionBusy] = useState(false);
  const [routinePreview, setRoutinePreview] = useState<RoutinePreview | null>(
    null,
  );
  const [routineBusy, setRoutineBusy] = useState(false);
  const [routineError, setRoutineError] = useState('');
  const [programForm, setProgramForm] = useState({
    goal: 'Build muscle and strength',
    durationWeeks: 8,
    daysPerWeek: 4,
    minutesPerSession: 60,
    preferences: '',
  });
  const chatEnd = useRef<HTMLDivElement>(null);
  const sourceCloseTimer = useRef<number | null>(null);
  const unit = profile.weightUnit;
  const profileHeight = imperialHeight(profile.heightCm);
  const selectedCoach = COACHES[0];

  function chooseCoachModel(model: CoachModelId) {
    setSelectedCoachModel(model);
    try {
      window.localStorage.setItem('hevy-coach.model', model);
    } catch {
      // The choice still works for this session when storage is unavailable.
    }
  }

  const selectedStrength =
    data.strengthTrends.find((item) => item.exercise === selectedTrend) ??
    data.strengthTrends[0];
  const displayTrend = (selectedStrength?.points ?? data.trend.points).map(
    (point) => ({ ...point, displayValue: toDisplayWeight(point.value, unit) }),
  );
  const workload = data.workloadWeeks.map((week) => ({
    ...week,
    displayVolume: Math.round(toDisplayWeight(week.volumeKg, unit)),
  }));
  const alphabetizedStrengthTrends = useMemo(
    () =>
      [...data.strengthTrends].sort((a, b) =>
        a.exercise.localeCompare(b.exercise, undefined, {
          sensitivity: 'base',
        }),
      ),
    [data.strengthTrends],
  );
  const muscleDistribution = data.muscleWindows[muscleWindow];
  const maxMuscleSets = Math.max(
    ...muscleDistribution.map((muscle) => muscle.sets + muscle.indirectSets),
    1,
  );
  const sortedExerciseStats = useMemo(() => {
    const valueFor = (
      exercise: DashboardData['exerciseStats'][number],
      key: LedgerSortKey,
    ) => {
      switch (key) {
        case 'exercise':
          return exercise.exercise;
        case 'sessions':
          return exercise.sessions;
        case 'sets':
          return exercise.workingSets;
        case 'volume':
          return exercise.volumeKg;
        case 'bestE1rm':
          return exercise.bestE1rmKg;
        case 'trend':
          return exercise.change;
      }
    };

    return [...data.exerciseStats].sort((a, b) => {
      const aValue = valueFor(a, ledgerSort.key);
      const bValue = valueFor(b, ledgerSort.key);
      const comparison =
        typeof aValue === 'string' && typeof bValue === 'string'
          ? aValue.localeCompare(bValue, undefined, { sensitivity: 'base' })
          : Number(aValue) - Number(bValue);
      const directed =
        ledgerSort.direction === 'asc' ? comparison : -comparison;
      return (
        directed ||
        a.exercise.localeCompare(b.exercise, undefined, { sensitivity: 'base' })
      );
    });
  }, [data.exerciseStats, ledgerSort]);

  function changeLedgerSort(key: LedgerSortKey) {
    setLedgerSort((current) => ({
      key,
      direction:
        current.key === key
          ? current.direction === 'asc'
            ? 'desc'
            : 'asc'
          : key === 'exercise'
            ? 'asc'
            : 'desc',
    }));
  }

  async function syncNow() {
    setSyncBusy(true);
    setSyncError('');
    try {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const response = await fetch('/api/hevy/sync', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ force: attempt === 0 }),
        });
        const result = await readJson<{
          error?: string;
          status?: 'syncing' | 'current';
        }>(response);
        if (!response.ok) {
          throw new Error(result.error || 'Hevy sync failed.');
        }
        if (result.status === 'current') {
          window.location.reload();
          return;
        }
      }
      throw new Error('The history import needs another sync pass.');
    } catch (error) {
      setSyncError(
        error instanceof Error ? error.message : 'Hevy sync failed.',
      );
    } finally {
      setSyncBusy(false);
    }
  }

  async function saveMuscleMapping(exerciseTemplateId: string) {
    setMuscleMappingBusy(exerciseTemplateId);
    setMuscleMappingError('');
    try {
      const response = await fetch('/api/muscle-overrides', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          exerciseTemplateId,
          primaryMuscle: muscleMappingDrafts[exerciseTemplateId] ?? 'other',
          secondaryMuscles: [],
        }),
      });
      const result = await readJson<ApiError>(response);
      if (!response.ok) {
        throw new Error(result.error || 'Muscle mapping could not be saved.');
      }
      window.location.reload();
    } catch (error) {
      setMuscleMappingError(
        error instanceof Error
          ? error.message
          : 'Muscle mapping could not be saved.',
      );
    } finally {
      setMuscleMappingBusy(null);
    }
  }

  async function createSuggestedSlot(
    suggestion: DashboardData['slotSuggestions'][number],
  ) {
    setSlotMutationBusy(true);
    setSlotMutationError('');
    try {
      const response = await fetch('/api/exercise-slots', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: suggestion.name,
          primaryMuscle: suggestion.primaryMuscle,
          pattern: suggestion.pattern,
          templateIds: suggestion.templateIds,
        }),
      });
      const result = await readJson<ApiError>(response);
      if (!response.ok)
        throw new Error(result.error || 'Slot could not be created.');
      window.location.reload();
    } catch (error) {
      setSlotMutationError(
        error instanceof Error ? error.message : 'Slot could not be created.',
      );
    } finally {
      setSlotMutationBusy(false);
    }
  }

  async function assignExerciseSlot(
    exerciseTemplateId: string,
    slotId: string | null,
  ) {
    setSlotMutationBusy(true);
    setSlotMutationError('');
    try {
      const response = await fetch('/api/exercise-slots', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slotId: slotId ?? data.exerciseSlots[0]?.id ?? '',
          templateId: exerciseTemplateId,
          assigned: Boolean(slotId),
        }),
      });
      const result = await readJson<ApiError>(response);
      if (!response.ok)
        throw new Error(result.error || 'Slot assignment failed.');
      window.location.reload();
    } catch (error) {
      setSlotMutationError(
        error instanceof Error ? error.message : 'Slot assignment failed.',
      );
    } finally {
      setSlotMutationBusy(false);
    }
  }

  async function renameExerciseSlot(slotId: string) {
    const name = slotNameDraft.trim();
    if (!name) return;
    setSlotMutationBusy(true);
    setSlotMutationError('');
    try {
      const response = await fetch('/api/exercise-slots', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slotId, name }),
      });
      const result = await readJson<ApiError>(response);
      if (!response.ok)
        throw new Error(result.error || 'Slot name could not be saved.');
      window.location.reload();
    } catch (error) {
      setSlotMutationError(
        error instanceof Error
          ? error.message
          : 'Slot name could not be saved.',
      );
    } finally {
      setSlotMutationBusy(false);
    }
  }

  async function removeExerciseSlot(slotId: string) {
    setSlotMutationBusy(true);
    setSlotMutationError('');
    try {
      const response = await fetch('/api/exercise-slots', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slotId }),
      });
      const result = await readJson<ApiError>(response);
      if (!response.ok)
        throw new Error(result.error || 'Slot could not be deleted.');
      window.location.reload();
    } catch (error) {
      setSlotMutationError(
        error instanceof Error ? error.message : 'Slot could not be deleted.',
      );
    } finally {
      setSlotMutationBusy(false);
    }
  }

  function changeCoachSource(source: CoachSource | null) {
    if (sourceCloseTimer.current !== null) {
      window.clearTimeout(sourceCloseTimer.current);
      sourceCloseTimer.current = null;
    }

    if (source) {
      setCoachSource(source);
      setSourcePanelOpen(true);
      return;
    }

    setSourcePanelOpen(false);
    sourceCloseTimer.current = window.setTimeout(() => {
      setCoachSource(null);
      sourceCloseTimer.current = null;
    }, 280);
  }

  useEffect(
    () => () => {
      if (sourceCloseTimer.current !== null) {
        window.clearTimeout(sourceCloseTimer.current);
      }
    },
    [],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const savedModel = window.localStorage.getItem('hevy-coach.model');
        if (isCoachModelId(savedModel)) setSelectedCoachModel(savedModel);
      } catch {
        // Defaults remain available when browser storage is blocked.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    void Promise.all([
      fetch('/api/profile').then((response) =>
        response.ok ? readJson<{ profile: AthleteProfile }>(response) : null,
      ),
      fetch('/api/conversations').then((response) =>
        response.ok
          ? readJson<{ conversations: ConversationSummary[] }>(response)
          : null,
      ),
      fetch('/api/programs').then((response) =>
        response.ok
          ? readJson<{ programs: TrainingProgram[] }>(response)
          : null,
      ),
      fetch('/api/body-weights').then((response) =>
        response.ok
          ? readJson<{
              summary: {
                average7d: number | null;
                slopeKgPerWeek: number | null;
                latest: number | null;
              };
            }>(response)
          : null,
      ),
      fetch('/api/training-blocks').then((response) =>
        response.ok ? readJson<{ blocks: TrainingBlock[] }>(response) : null,
      ),
    ]).then(
      ([
        profilePayload,
        conversationPayload,
        programPayload,
        bodyWeightPayload,
        trainingBlockPayload,
      ]) => {
        if (profilePayload?.profile) {
          const detectedTimeZone = browserTimeZone();
          const looksUnsaved =
            profilePayload.profile.timezone === 'UTC' &&
            profilePayload.profile.displayName === 'Athlete' &&
            profilePayload.profile.age === null &&
            profilePayload.profile.heightCm === null &&
            profilePayload.profile.weightKg === null;
          setProfile({
            ...profilePayload.profile,
            timezone: looksUnsaved
              ? detectedTimeZone
              : profilePayload.profile.timezone,
          });
          setProgramForm((current) => ({
            ...current,
            goal: profilePayload.profile.primaryGoal,
            daysPerWeek: profilePayload.profile.daysPerWeek,
            minutesPerSession: profilePayload.profile.minutesPerSession,
          }));
        }
        if (conversationPayload?.conversations)
          setConversations(
            orderConversations(conversationPayload.conversations),
          );
        if (programPayload?.programs) {
          setPrograms(programPayload.programs);
          setActiveProgram(programPayload.programs[0] ?? null);
        }
        if (bodyWeightPayload?.summary)
          setBodyWeightSummary(bodyWeightPayload.summary);
        if (trainingBlockPayload?.blocks)
          setTrainingBlocks(trainingBlockPayload.blocks);
      },
    );
  }, []);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, chatBusy]);

  useEffect(() => {
    if (!activeProgram) return;
    let cancelled = false;
    fetch(`/api/next-session?programId=${encodeURIComponent(activeProgram.id)}`)
      .then((response) =>
        response.ok ? readJson<NextSessionPayload>(response) : null,
      )
      .then((payload) => {
        if (!cancelled) setNextSession(payload?.session ?? null);
      })
      .catch(() => {
        if (!cancelled) setNextSession(null);
      })
      .finally(() => {
        if (!cancelled) setNextSessionBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProgram]);

  useEffect(() => {
    type ModelContext = {
      registerTool: (
        tool: {
          name: string;
          title: string;
          description: string;
          inputSchema: object;
          annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
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
          name: 'open_coach_with_question',
          title: 'Open coach with question',
          description:
            'Open the private coaching workspace and stage a question grounded in Hevy history. The athlete still chooses whether to send it.',
          inputSchema: {
            type: 'object',
            properties: {
              question: { type: 'string', minLength: 1, maxLength: 500 },
            },
            required: ['question'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          async execute(input) {
            const question =
              typeof input === 'object' && input && 'question' in input
                ? String((input as { question: unknown }).question).slice(
                    0,
                    500,
                  )
                : '';
            if (!question) throw new Error('A question is required.');
            setView('coach');
            setChatInput(question);
            return { status: 'staged', sent: false, question };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  async function createChat() {
    setChatError('');
    const response = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const payload = await readJson<
      { conversation: ConversationSummary } & ApiError
    >(response);
    if (!response.ok)
      return setChatError(payload.error || 'Could not create a chat.');
    setConversations((current) =>
      orderConversations([payload.conversation, ...current]),
    );
    setActiveConversation(payload.conversation.id);
    setMessages([]);
    setAnimatingMessageId(null);
    changeCoachSource(null);
  }

  async function openChat(id: string) {
    setActiveConversation(id);
    setChatError('');
    setAnimatingMessageId(null);
    changeCoachSource(null);
    const response = await fetch(
      `/api/messages?conversationId=${encodeURIComponent(id)}`,
    );
    const payload = await readJson<{ messages: ChatMessage[] } & ApiError>(
      response,
    );
    if (response.ok) setMessages(payload.messages);
    else setChatError(payload.error || 'Could not load this chat.');
  }

  async function deleteChat(id: string) {
    if (!window.confirm('Delete this coaching chat permanently?')) return;
    const response = await fetch(
      `/api/conversations?id=${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
    if (!response.ok) return setChatError('Could not delete this chat.');
    setConversations((current) => current.filter((item) => item.id !== id));
    if (activeConversation === id) {
      setActiveConversation(null);
      setMessages([]);
      setAnimatingMessageId(null);
      changeCoachSource(null);
    }
  }

  async function toggleConversationPin(conversation: ConversationSummary) {
    const pinned = !conversation.pinned;
    const previous = conversations;
    setChatError('');
    setConversations((current) =>
      orderConversations(
        current.map((item) =>
          item.id === conversation.id ? { ...item, pinned } : item,
        ),
      ),
    );

    const response = await fetch('/api/conversations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: conversation.id, pinned }),
    });
    if (!response.ok) {
      setConversations(previous);
      setChatError('Could not update the chat pin.');
    }
  }

  async function sendMessage(event?: SyntheticEvent<HTMLFormElement>) {
    event?.preventDefault();
    const content = chatInput.trim();
    if (!content || chatBusy) return;
    let conversationId = activeConversation;
    if (!conversationId) {
      const response = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const payload = await readJson<
        { conversation: ConversationSummary } & ApiError
      >(response);
      if (!response.ok)
        return setChatError(payload.error || 'Could not create a chat.');
      conversationId = payload.conversation.id;
      setActiveConversation(conversationId);
      setConversations((current) =>
        orderConversations([payload.conversation, ...current]),
      );
    }
    setChatInput('');
    setChatBusy(true);
    setChatError('');
    if (!conversationId) return;
    const resolvedConversationId = conversationId;
    const optimistic: ChatMessage = {
      id: crypto.randomUUID(),
      conversationId: resolvedConversationId,
      role: 'user',
      content,
      model: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);
    try {
      const response = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: resolvedConversationId,
          message: content,
          coachId: DEFAULT_COACH_ID,
          model: selectedCoachModel,
        }),
      });
      const payload = await readJson<
        { userMessage: ChatMessage; assistantMessage: ChatMessage } & ApiError
      >(response);
      if (!response.ok)
        throw new Error(payload.error || 'The coach could not answer.');
      setMessages((current) => [...current, payload.assistantMessage]);
      setAnimatingMessageId(payload.assistantMessage.id);
      const refreshed = await fetch('/api/conversations').then((result) =>
        readJson<{ conversations: ConversationSummary[] }>(result),
      );
      if (refreshed.conversations)
        setConversations(orderConversations(refreshed.conversations));
    } catch (error) {
      setChatError(
        error instanceof Error ? error.message : 'The coach could not answer.',
      );
    } finally {
      setChatBusy(false);
    }
  }

  async function saveAthlete(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileState('Saving…');
    const response = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
    });
    const payload = await readJson<{ profile: AthleteProfile } & ApiError>(
      response,
    );
    if (response.ok) {
      setProfile(payload.profile);
      if (payload.profile.weightKg != null) {
        const bodyWeightResponse = await fetch('/api/body-weights', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ weightKg: payload.profile.weightKg }),
        });
        if (bodyWeightResponse.ok) {
          setBodyWeightState('Weight history updated');
          const bodyWeightPayload = await fetch('/api/body-weights').then(
            (result) =>
              readJson<{
                summary: {
                  average7d: number | null;
                  slopeKgPerWeek: number | null;
                  latest: number | null;
                };
              }>(result),
          );
          if (bodyWeightPayload.summary)
            setBodyWeightSummary(bodyWeightPayload.summary);
          window.setTimeout(() => setBodyWeightState(''), 1800);
        }
      }
      setProfileState('Saved');
      window.setTimeout(() => setProfileState('Save athlete profile'), 1600);
    } else setProfileState(payload.error || 'Try again');
  }

  async function createTrainingBlock(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setBlockState('Saving…');
    try {
      const response = await fetch('/api/training-blocks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(blockDraft),
      });
      const payload = await readJson<{ block?: TrainingBlock; error?: string }>(
        response,
      );
      if (!response.ok || !payload.block) {
        throw new Error(payload.error || 'Training block could not be saved.');
      }
      setTrainingBlocks((current) => [payload.block!, ...current]);
      setBlockDraft((current) => ({ ...current, name: '', endsAt: '' }));
      setBlockState('Saved');
      window.setTimeout(() => setBlockState(''), 1600);
    } catch (error) {
      setBlockState(error instanceof Error ? error.message : 'Try again');
    }
  }

  async function removeTrainingBlock(id: string) {
    setBlockState('Removing…');
    try {
      const response = await fetch('/api/training-blocks', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const payload = await readJson<{ error?: string }>(response);
      if (!response.ok)
        throw new Error(payload.error || 'Block could not be deleted.');
      setTrainingBlocks((current) =>
        current.filter((block) => block.id !== id),
      );
      setBlockState('Removed');
      window.setTimeout(() => setBlockState(''), 1200);
    } catch (error) {
      setBlockState(error instanceof Error ? error.message : 'Try again');
    }
  }

  async function generateProgram(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setProgramBusy(true);
    setProgramError('');
    try {
      const response = await fetch('/api/programs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(programForm),
      });
      const payload = await readJson<{ program: TrainingProgram } & ApiError>(
        response,
      );
      if (!response.ok)
        throw new Error(payload.error || 'Program generation failed.');
      setPrograms((current) => [payload.program, ...current]);
      setActiveProgram(payload.program);
      setEditingProgramId(null);
      setAdjustingProgramId(null);
      setProgramAdjustment('');
    } catch (error) {
      setProgramError(
        error instanceof Error ? error.message : 'Program generation failed.',
      );
    } finally {
      setProgramBusy(false);
    }
  }

  function selectProgram(program: TrainingProgram) {
    setActiveProgram(program);
    setNextSession(null);
    setEditingProgramId(null);
    setAdjustingProgramId(null);
    setProgramAdjustment('');
    setProgramActionError('');
  }

  function replaceProgram(program: TrainingProgram) {
    setPrograms((current) =>
      current.map((item) => (item.id === program.id ? program : item)),
    );
    setActiveProgram(program);
    setNextSession(null);
  }

  async function saveProgramEdits(
    edits: Omit<TrainingProgram, 'id' | 'createdAt'>,
  ) {
    if (!activeProgram) return;
    setProgramActionBusy(true);
    setProgramActionError('');
    try {
      const response = await fetch('/api/programs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: activeProgram.id, program: edits }),
      });
      const payload = await readJson<{ program: TrainingProgram } & ApiError>(
        response,
      );
      if (!response.ok)
        throw new Error(payload.error || 'The program could not be saved.');
      replaceProgram(payload.program);
      setEditingProgramId(null);
    } catch (error) {
      setProgramActionError(
        error instanceof Error
          ? error.message
          : 'The program could not be saved.',
      );
    } finally {
      setProgramActionBusy(false);
    }
  }

  async function adjustProgram() {
    if (!activeProgram || !programAdjustment.trim() || programActionBusy)
      return;
    setProgramActionBusy(true);
    setProgramActionError('');
    try {
      const response = await fetch('/api/programs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: activeProgram.id,
          adjustment: programAdjustment.trim(),
        }),
      });
      const payload = await readJson<{ program: TrainingProgram } & ApiError>(
        response,
      );
      if (!response.ok)
        throw new Error(
          payload.error || 'Rowan could not adjust this program.',
        );
      replaceProgram(payload.program);
      setProgramAdjustment('');
      setAdjustingProgramId(null);
    } catch (error) {
      setProgramActionError(
        error instanceof Error
          ? error.message
          : 'Rowan could not adjust this program.',
      );
    } finally {
      setProgramActionBusy(false);
    }
  }

  async function removeProgram(program: TrainingProgram) {
    if (!window.confirm(`Delete “${program.title}” permanently?`)) return;
    setProgramActionBusy(true);
    setProgramActionError('');
    try {
      const response = await fetch(
        `/api/programs?id=${encodeURIComponent(program.id)}`,
        { method: 'DELETE' },
      );
      const payload = await readJson<ApiError>(response);
      if (!response.ok)
        throw new Error(payload.error || 'The program could not be deleted.');
      const remaining = programs.filter((item) => item.id !== program.id);
      setPrograms(remaining);
      setActiveProgram(remaining[0] ?? null);
      setNextSession(null);
      setEditingProgramId(null);
      setAdjustingProgramId(null);
      setProgramAdjustment('');
    } catch (error) {
      setProgramActionError(
        error instanceof Error
          ? error.message
          : 'The program could not be deleted.',
      );
    } finally {
      setProgramActionBusy(false);
    }
  }

  async function previewRoutine(dayIndex: number) {
    if (!activeProgram || routineBusy) return;
    setRoutineBusy(true);
    setRoutineError('');
    try {
      const response = await fetch('/api/hevy/routines/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ programId: activeProgram.id, dayIndex }),
      });
      const payload = await readJson<{
        payload?: unknown;
        confirmationToken?: string;
        expiresAt?: string;
        error?: string;
      }>(response);
      if (!response.ok || !payload.confirmationToken || !payload.expiresAt) {
        throw new Error(
          payload.error || 'This day cannot be prepared for Hevy yet.',
        );
      }
      setRoutinePreview({
        dayIndex,
        payload: payload.payload,
        confirmationToken: payload.confirmationToken,
        expiresAt: payload.expiresAt,
      });
    } catch (error) {
      setRoutineError(
        error instanceof Error ? error.message : 'Routine preview failed.',
      );
    } finally {
      setRoutineBusy(false);
    }
  }

  async function confirmRoutineWrite() {
    if (!activeProgram || !routinePreview || routineBusy) return;
    setRoutineBusy(true);
    setRoutineError('');
    try {
      const response = await fetch('/api/hevy/routines', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          programId: activeProgram.id,
          dayIndex: routinePreview.dayIndex,
          confirmationToken: routinePreview.confirmationToken,
        }),
      });
      const payload = await readJson<{
        program?: TrainingProgram;
        error?: string;
      }>(response);
      if (!response.ok || !payload.program) {
        throw new Error(payload.error || 'Hevy could not save this routine.');
      }
      replaceProgram(payload.program);
      setRoutinePreview(null);
    } catch (error) {
      setRoutineError(
        error instanceof Error
          ? error.message
          : 'Hevy could not save this routine.',
      );
    } finally {
      setRoutineBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="side-rail">
        <button
          className="brand-mark"
          type="button"
          onClick={() => setView('today')}
          aria-label="Hevy Coach home"
        >
          <Dumbbell />
          <span>HC</span>
        </button>
        <nav aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={view === item.id ? 'active' : ''}
              onClick={() => setView(item.id)}
              title={item.label}
            >
              <item.icon />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="rail-status" title={data.syncMessage}>
          <span className={data.connected ? 'status-dot live' : 'status-dot'} />
          <small>{data.connected ? 'Live' : 'Demo'}</small>
        </div>
      </aside>

      <main className={view === 'coach' ? 'coach-main' : ''}>
        <header className="topbar">
          <div>
            <p className="eyebrow">
              HEVY COACH /{' '}
              {NAV_ITEMS.find((item) => item.id === view)?.label.toUpperCase()}
            </p>
            <h1>
              {view === 'today'
                ? `Ready, ${profile.displayName === 'Athlete' ? data.athleteName : profile.displayName}.`
                : view === 'progress'
                  ? 'Read the adaptation.'
                  : view === 'history'
                    ? 'Your training log.'
                    : view === 'coach'
                      ? `Coach ${selectedCoach.name}.`
                      : view === 'program'
                        ? 'Build the next block.'
                        : 'Athlete context.'}
            </h1>
          </div>
          <div className="topbar-actions">
            <button
              className="sync-copy sync-copy-button"
              type="button"
              onClick={syncNow}
              disabled={syncBusy}
              title={syncError || 'Synchronize your Hevy history'}
            >
              <RefreshCw className={syncBusy ? 'spinning' : ''} />
              <span>
                {syncBusy
                  ? 'Syncing Hevy history…'
                  : syncError || data.syncMessage}
              </span>
            </button>
          </div>
        </header>

        {!data.connected && (
          <section className="setup-banner">
            <div>
              <span className="setup-kicker">Connection needs attention</span>
              <strong>
                {data.sourceLabel === 'Sample workspace'
                  ? 'Showing sample training data.'
                  : 'Your training store is waiting for a verified sync.'}
              </strong>
              <p>{data.syncMessage}</p>
            </div>
            {data.sourceLabel === 'Sample workspace' ? (
              <code>HEVY_API_KEY</code>
            ) : (
              <button
                className="setup-sync-button"
                type="button"
                onClick={syncNow}
                disabled={syncBusy}
              >
                <RefreshCw className={syncBusy ? 'spinning' : ''} />
                {syncBusy ? 'SYNCING…' : syncError || 'SYNC HEVY'}
              </button>
            )}
          </section>
        )}

        {view === 'today' && (
          <>
            <section className="today-review-grid">
              <article className="review-panel today-review-panel">
                <div className="panel-heading compact">
                  <div>
                    <p className="eyebrow">
                      WEEKLY REVIEW /{' '}
                      {data.weeklyReviewV2
                        ? reviewRange(data.weeklyReviewV2.weekStart)
                        : data.weeklyReview.label}
                    </p>
                    <h2>The coach’s read</h2>
                  </div>
                  <Medal />
                </div>
                {data.weeklyReviewV2?.narrative && (
                  <p className="review-narrative">
                    {data.weeklyReviewV2.narrative}
                  </p>
                )}
                <div className="review-sections">
                  {data.weeklyReviewV2 ? (
                    <>
                      <div>
                        <span className="review-label good">
                          <Check /> Wins
                        </span>
                        {data.weeklyReviewV2.wins.length ? (
                          data.weeklyReviewV2.wins
                            .slice(0, reviewExpanded ? undefined : 4)
                            .map((item) => <p key={item.id}>{item.headline}</p>)
                        ) : (
                          <p>No new wins were verified in this window.</p>
                        )}
                      </div>
                      <div>
                        <span className="review-label warn">
                          <CircleAlert /> Watch
                        </span>
                        {data.weeklyReviewV2.watch.length ? (
                          data.weeklyReviewV2.watch
                            .slice(0, reviewExpanded ? undefined : 4)
                            .map((item) => <p key={item.id}>{item.headline}</p>)
                        ) : (
                          <p>No watch items were raised by the evidence.</p>
                        )}
                      </div>
                      <div>
                        <span className="review-label">
                          <Target /> Next week
                        </span>
                        {data.weeklyReviewV2.act.length ? (
                          data.weeklyReviewV2.act
                            .slice(0, reviewExpanded ? undefined : 4)
                            .map((item) => (
                              <p key={item.id}>
                                {item.recommendation || item.headline}
                              </p>
                            ))
                        ) : (
                          <p>
                            Keep the current exposures consistent and reassess
                            after another week.
                          </p>
                        )}
                        {data.weeklyReviewV2.carriedOver.length > 0 && (
                          <small className="review-carried-over">
                            {data.weeklyReviewV2.carriedOver.length} watch item
                            {data.weeklyReviewV2.carriedOver.length === 1
                              ? ''
                              : 's'}{' '}
                            carried over
                          </small>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <span className="review-label good">
                          <Check /> Wins
                        </span>
                        {data.weeklyReview.wins
                          .slice(0, reviewExpanded ? undefined : 4)
                          .map((item) => (
                            <p key={item}>{item}</p>
                          ))}
                      </div>
                      <div>
                        <span className="review-label warn">
                          <CircleAlert /> Watch
                        </span>
                        {data.weeklyReview.watch
                          .slice(0, reviewExpanded ? undefined : 4)
                          .map((item) => (
                            <p key={item}>{item}</p>
                          ))}
                      </div>
                      <div>
                        <span className="review-label">
                          <Target /> Next week
                        </span>
                        {data.weeklyReview.nextSteps
                          .slice(0, reviewExpanded ? undefined : 4)
                          .map((item) => (
                            <p key={item}>{item}</p>
                          ))}
                      </div>
                    </>
                  )}
                </div>
                {(data.weeklyReviewV2
                  ? data.weeklyReviewV2.wins.length > 4 ||
                    data.weeklyReviewV2.watch.length > 4 ||
                    data.weeklyReviewV2.act.length > 4
                  : data.weeklyReview.wins.length > 4 ||
                    data.weeklyReview.watch.length > 4 ||
                    data.weeklyReview.nextSteps.length > 4) && (
                  <button
                    className="review-toggle"
                    type="button"
                    aria-expanded={reviewExpanded}
                    onClick={() => setReviewExpanded((expanded) => !expanded)}
                  >
                    {reviewExpanded
                      ? 'Show summary'
                      : `Show all ${
                          data.weeklyReviewV2
                            ? data.weeklyReviewV2.wins.length +
                              data.weeklyReviewV2.watch.length +
                              data.weeklyReviewV2.act.length
                            : data.weeklyReview.wins.length +
                              data.weeklyReview.watch.length +
                              data.weeklyReview.nextSteps.length
                        } details`}
                  </button>
                )}
                {data.weeklyReviewV2 && (
                  <div className="review-summary-line">
                    {data.weeklyReviewV2.summary.sessions} /{' '}
                    {data.weeklyReviewV2.summary.planned} planned sessions ·{' '}
                    {data.weeklyReviewV2.summary.directSets} direct working sets
                    · {data.weeklyReviewV2.summary.prs} verified PR signals
                  </div>
                )}
              </article>
            </section>

            <section className="metrics-grid" aria-label="Training summary">
              <StatCard
                label="Sessions / 30d"
                value={String(data.stats.sessions30d)}
                detail={`${data.stats.activeWeeks}/8 recent weeks active`}
                icon={CalendarDays}
              />
              <StatCard
                label="Load-volume / 30d"
                value={volume(data.stats.totalVolume30dKg, unit)}
                detail={`${delta(data.stats.volumeChangePercent)} week over week`}
                icon={TrendingUp}
              />
              <StatCard
                label="Average session"
                value={`${data.stats.avgSessionMinutes} min`}
                detail={`${data.stats.hours30d} hours total`}
                icon={Clock3}
              />
              <StatCard
                label="Training adherence"
                value={`${data.stats.adherencePct}%`}
                detail={`${data.stats.plannedSessionsPerWeek} sessions/week planned`}
                icon={Flame}
              />
            </section>

            <section className="today-lower-grid">
              <article className="workload-panel">
                <div className="panel-heading compact">
                  <div>
                    <p className="eyebrow">8-WEEK LOAD-VOLUME</p>
                    <h2>Work performed</h2>
                  </div>
                  <StatusPill
                    tone={data.stats.volumeChangePercent >= 0 ? 'good' : 'warn'}
                  >
                    {delta(data.stats.volumeChangePercent)}
                  </StatusPill>
                </div>
                <div className="chart-large">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={workload}>
                      <CartesianGrid vertical={false} stroke="var(--line)" />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis hide />
                      <ChartTooltip
                        formatter={(value) => [
                          `${Number(value).toLocaleString()} ${unit}`,
                          'Load-volume',
                        ]}
                        cursor={{ fill: 'rgba(17,21,15,.04)' }}
                      />
                      <Bar
                        dataKey="displayVolume"
                        fill="var(--panel-dark)"
                        radius={[5, 5, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </article>
              <article className="history-panel">
                <div className="panel-heading compact">
                  <div>
                    <p className="eyebrow">RECENT LOG</p>
                    <h2>Workout history</h2>
                  </div>
                  <CalendarDays />
                </div>
                <div className="history-list">
                  {data.recentWorkouts.slice(0, 5).map((workout) => (
                    <div key={`${workout.title}-${workout.date}`}>
                      <span className="history-date">{workout.date}</span>
                      <div>
                        <strong>{workout.title}</strong>
                        <small>
                          {workout.workingSets} sets ·{' '}
                          {volume(workout.volumeKg, unit)}
                        </small>
                      </div>
                      <span className="history-duration">
                        <Clock3 />
                        {workout.duration}
                      </span>
                    </div>
                  ))}
                </div>
              </article>
            </section>
          </>
        )}

        {view === 'progress' && (
          <BaseTooltip.Provider delay={250} closeDelay={80}>
            <section className="metrics-grid progress-metrics">
              <StatCard
                label="Working sets / 7D"
                value={String(data.stats.workingSets7d)}
                detail="Warm-ups excluded"
                icon={Gauge}
                help={PROGRESS_HELP.workingSets}
              />
              <StatCard
                label="Primary lift trend"
                value={delta(selectedStrength?.change ?? data.trend.change)}
                detail={selectedStrength?.exercise ?? data.trend.exercise}
                icon={TrendingUp}
                help={PROGRESS_HELP.primaryLiftTrend}
              />
              <StatCard
                label="Recent PRs"
                value={String(data.records.length)}
                detail="Verified signals · last 30 days"
                icon={Trophy}
                help={PROGRESS_HELP.recentEstimatedPrs}
              />
              <StatCard
                label="Training frequency"
                value={`${data.stats.sessions30d / 4.3 >= 1 ? (data.stats.sessions30d / 4.3).toFixed(1) : data.stats.sessions30d}×`}
                detail="Average sessions per week"
                icon={Activity}
                help={PROGRESS_HELP.trainingFrequency}
              />
            </section>
            <section className="progress-grid">
              <article className="trend-panel wide">
                <div className="panel-heading compact">
                  <div>
                    <p className="eyebrow">ESTIMATED STRENGTH</p>
                    <div className="panel-title-row">
                      <h2>
                        {selectedStrength?.exercise ?? data.trend.exercise}
                      </h2>
                      <InfoTooltip title="Estimated strength">
                        {PROGRESS_HELP.estimatedStrength}
                      </InfoTooltip>
                    </div>
                  </div>
                  <Select
                    value={selectedTrend}
                    onValueChange={(value) => value && setSelectedTrend(value)}
                  >
                    <SelectTrigger className="exercise-picker">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {alphabetizedStrengthTrends.map((item) => (
                        <SelectItem key={item.exercise} value={item.exercise}>
                          {item.exercise}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="chart-large strength-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={displayTrend}>
                      <defs>
                        <linearGradient
                          id="strengthFill"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="var(--signal)"
                            stopOpacity={0.6}
                          />
                          <stop
                            offset="100%"
                            stopColor="var(--signal)"
                            stopOpacity={0.02}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="var(--line)" />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis domain={['dataMin - 2', 'dataMax + 2']} hide />
                      <ChartTooltip
                        formatter={(value) => [
                          `${Number(value).toFixed(1)} ${unit}`,
                          'Estimated 1RM',
                        ]}
                      />
                      <Area
                        type="monotone"
                        dataKey="displayValue"
                        stroke="var(--signal-deep)"
                        strokeWidth={3}
                        dot={{
                          r: 3,
                          fill: 'var(--signal-deep)',
                          strokeWidth: 0,
                        }}
                        fill="url(#strengthFill)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <p className="chart-note">
                  Epley estimate from eligible compound sets of 8 reps or fewer.
                  Use the direction as a signal, not the decimal as a tested
                  max.
                </p>
              </article>
              <article className="pr-panel">
                <div className="panel-heading compact">
                  <div>
                    <p className="eyebrow">RECENT SIGNALS</p>
                    <div className="panel-title-row">
                      <h2>Estimated PR board</h2>
                      <InfoTooltip title="Estimated PR board">
                        {PROGRESS_HELP.estimatedPrBoard}
                      </InfoTooltip>
                    </div>
                  </div>
                  <Trophy />
                </div>
                {data.records.length ? (
                  <div className="record-list">
                    {data.records.map((record, index) => (
                      <div key={record.exercise}>
                        <span>{index + 1}</span>
                        <div>
                          <strong>{record.exercise}</strong>
                          <small>
                            {record.kind === 'reps_at_load'
                              ? `${record.reps} reps @ ${weight(record.weightKg, unit)} · ${record.date}`
                              : `${weight(record.weightKg, unit)} × ${record.reps} · ${record.date}`}
                          </small>
                        </div>
                        <b>
                          {record.kind === 'e1rm'
                            ? `${weight(record.valueKg, unit)} e1RM`
                            : record.kind === 'load_at_reps'
                              ? `${weight(record.valueKg, unit)} load PR`
                              : `${record.reps} rep PR`}
                        </b>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyMessage
                    title="No recent PR signal"
                    body="Repeat comparable weighted sets to establish a trend."
                  />
                )}
              </article>
            </section>
            <section className="distribution-grid">
              <article className="muscle-panel">
                <div className="panel-heading compact">
                  <div>
                    <p className="eyebrow">
                      MUSCLE DISTRIBUTION / {muscleWindow}D
                    </p>
                    <div className="panel-title-row">
                      <h2>Direct working sets</h2>
                      <InfoTooltip title="Muscle distribution">
                        {PROGRESS_HELP.muscleDistribution}
                      </InfoTooltip>
                    </div>
                  </div>
                  <div
                    className="muscle-window-picker"
                    aria-label="Muscle distribution date range"
                  >
                    {(['7', '14', '30'] as MuscleWindow[]).map((range) => (
                      <button
                        type="button"
                        key={range}
                        aria-pressed={muscleWindow === range}
                        onClick={() => setMuscleWindow(range)}
                      >
                        {range}D
                      </button>
                    ))}
                  </div>
                </div>
                <div className="muscle-bars">
                  {muscleDistribution.map((muscle) => (
                    <div
                      className={`muscle-row muscle-${muscle.bandLabel}`}
                      key={muscle.key}
                    >
                      <div>
                        <span>
                          {muscle.name}
                          <StatusPill tone={auditTone(muscle.bandLabel)}>
                            {BAND_LABELS[muscle.bandLabel]}
                          </StatusPill>
                        </span>
                        <span>
                          <strong>
                            {Math.round(muscle.sets * 10) / 10} direct
                          </strong>
                          <small>
                            {muscle.indirectSets > 0
                              ? ` · ${Math.round(muscle.indirectSets * 10) / 10} indirect`
                              : ''}
                            {' · '}
                            {muscle.sets - muscle.previousSets >= 0 ? '+' : ''}
                            {Math.round(
                              (muscle.sets - muscle.previousSets) * 10,
                            ) / 10}{' '}
                            vs prior {muscleWindow}d · {muscle.sessionsHit}{' '}
                            sessions · {muscle.fourWeekAvgDirect} 4w avg
                          </small>
                        </span>
                      </div>
                      <div className="bar-track muscle-stack">
                        <span
                          className="direct"
                          style={{
                            width: `${(muscle.sets / maxMuscleSets) * 100}%`,
                          }}
                        />
                        <span
                          className="indirect"
                          style={{
                            width: `${(muscle.indirectSets / maxMuscleSets) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                {data.unmappedExercises.length > 0 && (
                  <div className="muscle-mapping-card">
                    <div>
                      <strong>Map custom exercises</strong>
                      <p>
                        Choose the primary muscle so these sets are counted in
                        the right place.
                      </p>
                    </div>
                    {data.unmappedExercises.map((exercise) => (
                      <div className="muscle-mapping-row" key={exercise.id}>
                        <span>{exercise.title}</span>
                        <Select
                          value={muscleMappingDrafts[exercise.id] ?? 'other'}
                          onValueChange={(value) => {
                            if (!value) return;
                            setMuscleMappingDrafts((current) => ({
                              ...current,
                              [exercise.id]: value as Muscle,
                            }));
                          }}
                        >
                          <SelectTrigger
                            aria-label={`Primary muscle for ${exercise.title}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {MUSCLES.map((muscle) => (
                              <SelectItem key={muscle} value={muscle}>
                                {muscleLabel(muscle)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void saveMuscleMapping(exercise.id)}
                          disabled={muscleMappingBusy !== null}
                        >
                          {muscleMappingBusy === exercise.id
                            ? 'Saving…'
                            : 'Save'}
                        </Button>
                      </div>
                    ))}
                    {muscleMappingError && (
                      <p className="form-error">{muscleMappingError}</p>
                    )}
                  </div>
                )}
              </article>
              <article className="exercise-table-panel">
                <div className="panel-heading compact">
                  <div>
                    <p className="eyebrow">MOVEMENT LEDGER</p>
                    <div className="panel-title-row">
                      <h2>Exercise performance</h2>
                      <InfoTooltip title="Exercise performance">
                        {PROGRESS_HELP.exercisePerformance}
                      </InfoTooltip>
                    </div>
                  </div>
                  <Dumbbell />
                </div>
                {(data.exerciseSlots.length > 0 ||
                  data.slotSuggestions.length > 0) && (
                  <div className="slot-manager">
                    <div className="slot-manager-heading">
                      <div>
                        <p className="eyebrow">VARIATION SLOTS</p>
                        <div className="panel-title-row">
                          <strong>Keep rotated movements together.</strong>
                          <InfoTooltip title="Variation slots">
                            {PROGRESS_HELP.variationSlots}
                          </InfoTooltip>
                        </div>
                        <small>
                          Group comparable exercises to keep one progression
                          history when equipment or variations change.
                        </small>
                      </div>
                      <Dumbbell aria-hidden="true" />
                    </div>
                    {data.exerciseSlots.map((slot) => (
                      <div className="slot-row" key={slot.id}>
                        {editingSlotId === slot.id ? (
                          <input
                            value={slotNameDraft}
                            aria-label={`Rename ${slot.name}`}
                            onChange={(event) =>
                              setSlotNameDraft(event.target.value)
                            }
                          />
                        ) : (
                          <div>
                            <strong>{slot.name}</strong>
                            <small>
                              {slot.templateIds.length || 'No'} movement
                              {slot.templateIds.length === 1 ? '' : 's'} grouped
                            </small>
                          </div>
                        )}
                        <div>
                          {editingSlotId === slot.id ? (
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => void renameExerciseSlot(slot.id)}
                              disabled={slotMutationBusy}
                            >
                              Save
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setEditingSlotId(slot.id);
                                setSlotNameDraft(slot.name);
                              }}
                              disabled={slotMutationBusy}
                            >
                              Rename
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => void removeExerciseSlot(slot.id)}
                            disabled={slotMutationBusy}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    ))}
                    {data.slotSuggestions.length > 0 && (
                      <div className="slot-suggestions">
                        <span>Suggested groupings</span>
                        {data.slotSuggestions.slice(0, 4).map((suggestion) => (
                          <div key={suggestion.key}>
                            <div>
                              <strong>{suggestion.name}</strong>
                              <small>
                                {suggestion.exerciseTitles.join(' · ')}
                              </small>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() =>
                                void createSuggestedSlot(suggestion)
                              }
                              disabled={slotMutationBusy}
                            >
                              Group
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                    {slotMutationError && (
                      <p className="form-error">{slotMutationError}</p>
                    )}
                  </div>
                )}
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <SortableHeading
                          label="Exercise"
                          sortKey="exercise"
                          activeKey={ledgerSort.key}
                          direction={ledgerSort.direction}
                          onSort={changeLedgerSort}
                        />
                        <SortableHeading
                          label="Sessions"
                          sortKey="sessions"
                          activeKey={ledgerSort.key}
                          direction={ledgerSort.direction}
                          onSort={changeLedgerSort}
                        />
                        <SortableHeading
                          label="Sets"
                          sortKey="sets"
                          activeKey={ledgerSort.key}
                          direction={ledgerSort.direction}
                          onSort={changeLedgerSort}
                        />
                        <SortableHeading
                          label="Volume"
                          sortKey="volume"
                          activeKey={ledgerSort.key}
                          direction={ledgerSort.direction}
                          onSort={changeLedgerSort}
                        />
                        <SortableHeading
                          label="Best e1RM"
                          sortKey="bestE1rm"
                          activeKey={ledgerSort.key}
                          direction={ledgerSort.direction}
                          onSort={changeLedgerSort}
                        />
                        <SortableHeading
                          label="Progression"
                          sortKey="trend"
                          activeKey={ledgerSort.key}
                          direction={ledgerSort.direction}
                          onSort={changeLedgerSort}
                        />
                      </tr>
                    </thead>
                    <tbody>
                      {sortedExerciseStats.map((exercise) => {
                        const expanded =
                          expandedProgression === exercise.exerciseTemplateId;
                        return (
                          <Fragment key={exercise.exerciseTemplateId}>
                            <tr>
                              <td>
                                <strong>{exercise.exercise}</strong>
                                <small>{exercise.muscle}</small>
                                {data.exerciseSlots.length > 0 && (
                                  <Select
                                    value={exercise.slotId ?? 'none'}
                                    onValueChange={(value) => {
                                      if (!value) return;
                                      void assignExerciseSlot(
                                        exercise.exerciseTemplateId,
                                        value === 'none' ? null : value,
                                      );
                                    }}
                                  >
                                    <SelectTrigger
                                      className="ledger-slot-picker"
                                      aria-label={`Variation slot for ${exercise.exercise}`}
                                    >
                                      <SelectValue placeholder="No slot" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="none">
                                        No slot
                                      </SelectItem>
                                      {data.exerciseSlots.map((slot) => (
                                        <SelectItem
                                          key={slot.id}
                                          value={slot.id}
                                        >
                                          {slot.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                )}
                              </td>
                              <td>{exercise.sessions}</td>
                              <td>{exercise.workingSets}</td>
                              <td>{volume(exercise.volumeKg, unit)}</td>
                              <td>
                                {exercise.bestE1rmKg
                                  ? weight(exercise.bestE1rmKg, unit)
                                  : '—'}
                              </td>
                              <td className="progression-cell">
                                <button
                                  type="button"
                                  aria-label={`${expanded ? 'Hide' : 'Show'} progression evidence for ${exercise.exercise}`}
                                  aria-expanded={expanded}
                                  onClick={() =>
                                    setExpandedProgression(
                                      expanded
                                        ? null
                                        : exercise.exerciseTemplateId,
                                    )
                                  }
                                >
                                  <StatusPill
                                    tone={progressionTone(
                                      exercise.progressionStatus,
                                    )}
                                  >
                                    {
                                      PROGRESSION_LABELS[
                                        exercise.progressionStatus
                                      ]
                                    }
                                  </StatusPill>
                                  <small>
                                    {
                                      RECOMMENDATION_LABELS[
                                        exercise.progressionRecommendation
                                      ]
                                    }
                                  </small>
                                  <ChevronRight aria-hidden="true" />
                                </button>
                              </td>
                            </tr>
                            {expanded && (
                              <tr className="progression-detail-row">
                                <td
                                  colSpan={6}
                                  aria-label={`${exercise.exercise} progression evidence`}
                                >
                                  <div className="progression-detail">
                                    <div className="progression-copy">
                                      <span>
                                        {
                                          RECOMMENDATION_LABELS[
                                            exercise.progressionRecommendation
                                          ]
                                        }
                                      </span>
                                      <strong>
                                        {exercise.progressionRationale}
                                      </strong>
                                      <small>
                                        {exercise.modalLoadKg
                                          ? `Modal load ${weight(exercise.modalLoadKg, unit)}`
                                          : 'No stable modal load'}
                                        {exercise.targetRepRange
                                          ? ` · inferred range ${exercise.targetRepRange[0]}–${exercise.targetRepRange[1]} reps`
                                          : ''}
                                        {exercise.change
                                          ? ` · robust slope ${delta(exercise.change)} per session`
                                          : ''}
                                      </small>
                                    </div>
                                    <div className="progression-sparkline">
                                      <span>
                                        {exercise.performanceMetric ===
                                        'trend_e1rm'
                                          ? 'Trend e1RM'
                                          : 'Best set (kg × reps)'}
                                      </span>
                                      <div>
                                        <MiniSparkline
                                          values={exercise.performanceIndex}
                                        />
                                      </div>
                                    </div>
                                    <div className="progression-sparkline">
                                      <span>Last-set RPE</span>
                                      <div>
                                        <MiniSparkline
                                          values={exercise.lastSetRpe}
                                          color="#a85c08"
                                        />
                                      </div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </article>
            </section>
            <section className="audit-grid" aria-label="Training audit">
              <article className="audit-panel">
                <div className="panel-heading compact">
                  <div>
                    <p className="eyebrow">4-WEEK BALANCE</p>
                    <div className="panel-title-row">
                      <h2>Where the work is going</h2>
                      <InfoTooltip title="Balance signals">
                        {PROGRESS_HELP.balanceSignals}
                      </InfoTooltip>
                    </div>
                  </div>
                </div>
                <div className="balance-list">
                  {data.balance.map((signal) => (
                    <div className="balance-row" key={signal.key}>
                      <div>
                        <strong>{signal.label}</strong>
                        <small>{signal.explanation}</small>
                      </div>
                      <StatusPill
                        tone={
                          signal.status === 'watch'
                            ? 'warn'
                            : signal.status === 'no_data'
                              ? 'neutral'
                              : 'good'
                        }
                      >
                        {signal.key === 'calves'
                          ? `${signal.value ?? 0} sets`
                          : signal.value == null
                            ? 'No data'
                            : `${signal.value} · ${signal.typicalRange}`}
                      </StatusPill>
                    </div>
                  ))}
                </div>
              </article>
              <article className="audit-panel">
                <div className="panel-heading compact">
                  <div>
                    <p className="eyebrow">PLANNED VS ACTUAL</p>
                    <div className="panel-title-row">
                      <h2>Training adherence</h2>
                      <InfoTooltip title="Training adherence">
                        Actual logged sessions divided by the sessions per week
                        in your athlete profile. Weeks cap at 100% when you
                        train above plan.
                      </InfoTooltip>
                    </div>
                  </div>
                  <StatusPill
                    tone={data.stats.adherencePct >= 80 ? 'good' : 'warn'}
                  >
                    {data.stats.adherencePct}% average
                  </StatusPill>
                </div>
                <div className="adherence-list">
                  {data.adherenceWeeks.map((week) => (
                    <div className="adherence-row" key={week.weekStart}>
                      <div>
                        <strong>{week.label}</strong>
                        <small>
                          {week.actualSessions}/{week.plannedSessions} sessions
                        </small>
                      </div>
                      <div className="adherence-track">
                        <span style={{ width: `${week.adherencePct}%` }} />
                      </div>
                      <b>{week.adherencePct}%</b>
                    </div>
                  ))}
                </div>
              </article>
            </section>
          </BaseTooltip.Provider>
        )}

        {view === 'history' && (
          <WorkoutCalendar
            key={historyDate ?? 'latest-workout'}
            workouts={data.calendarWorkouts}
            unit={unit}
            initialDate={historyDate}
            onSelectedDateChange={setHistoryDate}
          />
        )}

        {view === 'coach' && (
          <section
            className={`chat-workspace${sourcePanelOpen ? ' source-open' : ''}`}
          >
            <aside className="chat-sidebar">
              <Button className="new-chat" onClick={createChat}>
                <Plus /> New chat
              </Button>
              <div className="coach-preferences">
                <label>
                  <span>OpenRouter model</span>
                  <select
                    value={selectedCoachModel}
                    onChange={(event) => {
                      if (isCoachModelId(event.target.value)) {
                        chooseCoachModel(event.target.value);
                      }
                    }}
                  >
                    {COACH_MODELS.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                </label>
                <small title={selectedCoach.description}>
                  {selectedCoach.description}
                </small>
              </div>
              <div className="chat-history-label">Recent chats</div>
              <div className="conversation-list">
                {conversations.map((conversation) => (
                  <div
                    className={[
                      'conversation-row',
                      activeConversation === conversation.id ? 'active' : '',
                      conversation.pinned ? 'pinned' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    key={conversation.id}
                  >
                    <button
                      type="button"
                      onClick={() => openChat(conversation.id)}
                    >
                      <strong>{conversation.title}</strong>
                      <small>{conversation.preview || 'No messages yet'}</small>
                    </button>
                    <div className="conversation-actions">
                      <button
                        type="button"
                        className={`pin-chat${conversation.pinned ? ' active' : ''}`}
                        onClick={() => toggleConversationPin(conversation)}
                        aria-label={`${conversation.pinned ? 'Unpin' : 'Pin'} ${conversation.title}`}
                        title={conversation.pinned ? 'Unpin chat' : 'Pin chat'}
                      >
                        <Pin />
                      </button>
                      <button
                        type="button"
                        className="delete-chat"
                        onClick={() => deleteChat(conversation.id)}
                        aria-label={`Delete ${conversation.title}`}
                        title="Delete chat"
                      >
                        <Trash2 />
                      </button>
                    </div>
                  </div>
                ))}
                {!conversations.length && (
                  <p className="no-history">
                    Your private coaching conversations will appear here.
                  </p>
                )}
              </div>
              <div className="coach-identity">
                <span>{selectedCoach.initials}</span>
                <div>
                  <strong>{selectedCoach.name}</strong>
                  <small>{selectedCoach.specialty} coach</small>
                </div>
              </div>
            </aside>
            <div className="chat-stage">
              <div className="chat-messages">
                {messages.length ? (
                  messages.map((message) => (
                    <article
                      key={message.id}
                      className={`message ${message.role}`}
                    >
                      <div className="message-avatar">
                        {message.role === 'assistant'
                          ? coachFor(message.coachId).initials
                          : profile.displayName.slice(0, 1).toUpperCase()}
                      </div>
                      <div>
                        <div className="message-meta">
                          <strong>
                            {message.role === 'assistant'
                              ? `Coach ${coachFor(message.coachId).name}`
                              : 'You'}
                          </strong>
                          {message.model && <span>{message.model}</span>}
                        </div>
                        {message.role === 'assistant' ? (
                          <CoachMessage
                            content={message.content}
                            fallbackReason={message.fallbackReason}
                            animate={message.id === animatingMessageId}
                            activeSource={coachSource}
                            onSourceChange={changeCoachSource}
                            onComplete={() =>
                              setAnimatingMessageId((current) =>
                                current === message.id ? null : current,
                              )
                            }
                          />
                        ) : (
                          <p>{message.content}</p>
                        )}
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="coach-welcome">
                    <div className="coach-monogram">
                      {selectedCoach.initials}
                    </div>
                    <p className="eyebrow">PRIVATE COACH / HEVY-GROUNDED</p>
                    <h2>What are we solving today?</h2>
                    <p>
                      {selectedCoach.name} reads your profile, recent sessions,
                      workload, and strength trends before answering, with an
                      emphasis on {selectedCoach.specialty.toLowerCase()}.
                    </p>
                    <div className="starter-grid">
                      {STARTERS.map((starter) => (
                        <button
                          type="button"
                          key={starter}
                          onClick={() => setChatInput(starter)}
                        >
                          {starter}
                          <ChevronRight />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {chatBusy && (
                  <article className="message assistant">
                    <div className="message-avatar">
                      {selectedCoach.initials}
                    </div>
                    <div>
                      <div className="message-meta">
                        <strong>Coach {selectedCoach.name}</strong>
                        <span>reading your training history</span>
                      </div>
                      <div className="thinking">
                        <i />
                        <i />
                        <i />
                      </div>
                    </div>
                  </article>
                )}
                <div ref={chatEnd} />
              </div>
              <form className="chat-composer" onSubmit={sendMessage}>
                <textarea
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  placeholder="Ask about a lift, plan, plateau, or this week…"
                  rows={2}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                />
                <button
                  type="submit"
                  disabled={!chatInput.trim() || chatBusy}
                  aria-label="Send message"
                >
                  <Send />
                </button>
                <small>
                  Grounded in Hevy and your athlete profile. Informational—not
                  medical advice.
                </small>
                {chatError && <p className="form-error">{chatError}</p>}
              </form>
            </div>
            <div className="coach-source-drawer">
              {coachSource && (
                <CoachSourcePanel
                  source={coachSource}
                  data={data}
                  unit={unit}
                  onClose={() => changeCoachSource(null)}
                  onOpenWorkout={(date) => {
                    changeCoachSource(null);
                    setHistoryDate(date);
                    setView('history');
                  }}
                />
              )}
            </div>
          </section>
        )}

        {view === 'program' && (
          <section className="program-layout">
            <aside className="program-builder">
              <div>
                <p className="eyebrow">PROGRAM BUILDER</p>
                <h2>Turn constraints into a block.</h2>
                <p className="section-copy">
                  The coach uses your goals, availability, profile, and familiar
                  Hevy movements.
                </p>
              </div>
              <form onSubmit={generateProgram}>
                <label>
                  <span>Primary outcome</span>
                  <textarea
                    rows={3}
                    value={programForm.goal}
                    onChange={(event) =>
                      setProgramForm({
                        ...programForm,
                        goal: event.target.value,
                      })
                    }
                  />
                </label>
                <div className="form-pair">
                  <label>
                    <span>Duration</span>
                    <select
                      value={programForm.durationWeeks}
                      onChange={(event) =>
                        setProgramForm({
                          ...programForm,
                          durationWeeks: Number(event.target.value),
                        })
                      }
                    >
                      {[4, 6, 8, 10, 12, 16].map((value) => (
                        <option value={value} key={value}>
                          {value} weeks
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Days / week</span>
                    <select
                      value={programForm.daysPerWeek}
                      onChange={(event) =>
                        setProgramForm({
                          ...programForm,
                          daysPerWeek: Number(event.target.value),
                        })
                      }
                    >
                      {[2, 3, 4, 5, 6].map((value) => (
                        <option value={value} key={value}>
                          {value} days
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  <span>Session length</span>
                  <select
                    value={programForm.minutesPerSession}
                    onChange={(event) =>
                      setProgramForm({
                        ...programForm,
                        minutesPerSession: Number(event.target.value),
                      })
                    }
                  >
                    {[30, 40, 45, 60, 75, 90].map((value) => (
                      <option value={value} key={value}>
                        {value} minutes
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Block-specific notes</span>
                  <textarea
                    rows={4}
                    placeholder="Priority muscles, exercises to include or avoid, schedule constraints…"
                    value={programForm.preferences}
                    onChange={(event) =>
                      setProgramForm({
                        ...programForm,
                        preferences: event.target.value,
                      })
                    }
                  />
                </label>
                <Button type="submit" disabled={programBusy}>
                  {programBusy ? 'Building your block…' : 'Generate program'}{' '}
                  <Sparkles />
                </Button>
                {programError && <p className="form-error">{programError}</p>}
              </form>
              <div className="saved-programs">
                <span>Saved programs</span>
                {programs.map((program) => (
                  <button
                    type="button"
                    key={program.id}
                    onClick={() => selectProgram(program)}
                    className={activeProgram?.id === program.id ? 'active' : ''}
                  >
                    <strong>{program.title}</strong>
                    <small>
                      {program.daysPerWeek} days · {program.durationWeeks} weeks
                    </small>
                  </button>
                ))}
              </div>
            </aside>
            <div className="program-document">
              {activeProgram ? (
                editingProgramId === activeProgram.id ? (
                  <ProgramEditor
                    key={activeProgram.id}
                    program={activeProgram}
                    weightUnit={unit}
                    templateOptions={data.exerciseStats.map((exercise) => ({
                      id: exercise.exerciseTemplateId,
                      title: exercise.exercise,
                      slotId: exercise.slotId,
                    }))}
                    busy={programActionBusy}
                    onCancel={() => setEditingProgramId(null)}
                    onSave={saveProgramEdits}
                  />
                ) : (
                  <>
                    <header>
                      <div>
                        <p className="eyebrow">
                          ACTIVE DRAFT / {activeProgram.durationWeeks} WEEKS
                        </p>
                        <h2>{activeProgram.title}</h2>
                        <p>{activeProgram.overview}</p>
                      </div>
                      <div className="program-document-actions">
                        <StatusPill>
                          {activeProgram.daysPerWeek} days ·{' '}
                          {activeProgram.minutesPerSession} min
                        </StatusPill>
                        <div className="program-action-buttons">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setProgramActionError('');
                              setEditingProgramId(activeProgram.id);
                              setAdjustingProgramId(null);
                            }}
                            disabled={programActionBusy}
                          >
                            Edit workouts
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setProgramActionError('');
                              setAdjustingProgramId((current) =>
                                current === activeProgram.id
                                  ? null
                                  : activeProgram.id,
                              );
                              setProgramAdjustment('');
                            }}
                            disabled={programActionBusy}
                          >
                            <Sparkles />
                            Ask Rowan
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={() => void removeProgram(activeProgram)}
                            disabled={programActionBusy}
                          >
                            <Trash2 />
                            Delete
                          </Button>
                        </div>
                      </div>
                    </header>
                    {adjustingProgramId === activeProgram.id && (
                      <form
                        className="program-adjustment"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void adjustProgram();
                        }}
                      >
                        <label>
                          <span>Tell Rowan what to change</span>
                          <textarea
                            rows={3}
                            value={programAdjustment}
                            onChange={(event) =>
                              setProgramAdjustment(event.target.value)
                            }
                            placeholder="e.g. Replace barbell squats with a knee-friendly quad movement and keep each session under 45 minutes."
                          />
                        </label>
                        <div>
                          <Button
                            type="submit"
                            size="sm"
                            disabled={
                              programActionBusy || !programAdjustment.trim()
                            }
                          >
                            {programActionBusy
                              ? 'Rowan is revising…'
                              : 'Apply adjustment'}
                            <Sparkles />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setAdjustingProgramId(null)}
                            disabled={programActionBusy}
                          >
                            Cancel
                          </Button>
                        </div>
                      </form>
                    )}
                    {programActionError && (
                      <p className="form-error program-action-error">
                        {programActionError}
                      </p>
                    )}
                    {routineError && (
                      <p className="form-error program-action-error">
                        {routineError}
                      </p>
                    )}
                    {nextSession && (
                      <section className="next-session-card">
                        <div>
                          <p className="eyebrow">NEXT SESSION</p>
                          <h3>{nextSession.day.title}</h3>
                          <p>{nextSession.day.focus}</p>
                        </div>
                        <div className="next-session-list">
                          {nextSession.exercises.map((exercise) => (
                            <div key={`${exercise.name}-${exercise.sets}`}>
                              <strong>{exercise.name}</strong>
                              <span>
                                {exercise.sets} × {exercise.reps}
                                {exercise.load
                                  ? ` @ ${exercise.load}`
                                  : ''} ·{' '}
                                {exercise.effort}
                              </span>
                            </div>
                          ))}
                        </div>
                        <small>
                          {nextSessionBusy
                            ? 'Refreshing progression…'
                            : 'Loads are resolved from the saved starting load and current progression state.'}
                        </small>
                      </section>
                    )}
                    {routinePreview && (
                      <section className="routine-preview-card">
                        <div>
                          <p className="eyebrow">HEVY ROUTINE PREVIEW</p>
                          <h3>Review before writing</h3>
                          <p>
                            This is the exact routine payload Hevy will receive.
                            Nothing has been written yet.
                          </p>
                        </div>
                        <pre>
                          {JSON.stringify(routinePreview.payload, null, 2)}
                        </pre>
                        <div className="routine-preview-actions">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void confirmRoutineWrite()}
                            disabled={routineBusy}
                          >
                            {routineBusy
                              ? 'Writing…'
                              : 'Confirm & write to Hevy'}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setRoutinePreview(null)}
                            disabled={routineBusy}
                          >
                            Cancel
                          </Button>
                          <small>
                            Preview expires{' '}
                            {new Date(
                              routinePreview.expiresAt,
                            ).toLocaleTimeString()}
                          </small>
                        </div>
                      </section>
                    )}
                    <div className="program-principles">
                      <div>
                        <span>Progression</span>
                        <p>{activeProgram.progression}</p>
                      </div>
                      <div>
                        <span>Deload</span>
                        <p>{activeProgram.deload}</p>
                      </div>
                    </div>
                    <div className="training-days">
                      {activeProgram.days.map((day) => (
                        <article key={`${activeProgram.id}-${day.day}`}>
                          <div className="day-heading">
                            <span>DAY {String(day.day).padStart(2, '0')}</span>
                            <div>
                              <h3>{day.title}</h3>
                              <p>{day.focus}</p>
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => void previewRoutine(day.day - 1)}
                              disabled={
                                routineBusy ||
                                day.exercises.some(
                                  (exercise) => !exercise.exerciseTemplateId,
                                )
                              }
                            >
                              {day.hevyRoutineId
                                ? 'Update in Hevy'
                                : 'Preview Hevy routine'}
                            </Button>
                          </div>
                          <div className="day-exercises">
                            {day.exercises.map((exercise, index) => (
                              <div key={`${exercise.name}-${index}`}>
                                <span>{index + 1}</span>
                                <div>
                                  <strong>{exercise.name}</strong>
                                  <small>
                                    {exercise.note}{' '}
                                    {exercise.startingLoadKg != null
                                      ? `Starts at ${formatWeight(exercise.startingLoadKg, unit)} · `
                                      : ''}
                                    {exercise.progression.rule.replaceAll(
                                      '_',
                                      ' ',
                                    )}
                                  </small>
                                </div>
                                <b>
                                  {exercise.sets} ×{' '}
                                  {formatRepRange(exercise.repRange)}
                                </b>
                                <em>
                                  {formatEffort(exercise.effort)} ·{' '}
                                  {exercise.restSeconds}s
                                </em>
                              </div>
                            ))}
                          </div>
                        </article>
                      ))}
                    </div>
                    <p className="draft-note">
                      This is a planning draft. Review exercise suitability and
                      technique before training; nothing has been written to
                      Hevy.
                    </p>
                  </>
                )
              ) : (
                <EmptyMessage
                  title="No program yet"
                  body="Set the block constraints and generate your first tailored program."
                />
              )}
            </div>
          </section>
        )}

        {view === 'profile' && (
          <section className="profile-layout">
            <article className="profile-intro">
              <p className="eyebrow">COACHING CONTEXT</p>
              <h2>Enough biology to personalize. Nothing ornamental.</h2>
              <p>
                The coach uses these details to adjust exercise selection,
                recovery expectations, weekly structure, and practical
                recommendations. Biological sex is optional and never used as a
                shortcut for ability.
              </p>
              <div className="profile-summary">
                <div>
                  <span>Primary goal</span>
                  <strong>{profile.primaryGoal}</strong>
                </div>
                <div>
                  <span>Training structure</span>
                  <strong>
                    {profile.daysPerWeek} days · {profile.minutesPerSession} min
                  </strong>
                </div>
                <div>
                  <span>Experience</span>
                  <strong>{profile.experience}</strong>
                </div>
                <div>
                  <span>Measurements</span>
                  <strong>
                    {profile.weightUnit.toUpperCase()} ·{' '}
                    {profile.heightUnit === 'imperial' ? 'ft / in' : 'cm'}
                  </strong>
                </div>
              </div>
            </article>
            <form className="profile-form" onSubmit={saveAthlete}>
              <div className="form-section">
                <div>
                  <span>01</span>
                  <h3>Basics</h3>
                </div>
                <div className="form-grid">
                  <label>
                    <span>Name</span>
                    <input
                      value={profile.displayName}
                      onChange={(event) =>
                        setProfile({
                          ...profile,
                          displayName: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>
                      Biological sex <small>optional</small>
                    </span>
                    <select
                      value={profile.biologicalSex}
                      onChange={(event) =>
                        setProfile({
                          ...profile,
                          biologicalSex: event.target.value,
                        })
                      }
                    >
                      <option value="prefer_not_to_say">
                        Prefer not to say
                      </option>
                      <option value="female">Female</option>
                      <option value="male">Male</option>
                      <option value="intersex">Intersex</option>
                    </select>
                  </label>
                  <label>
                    <span>Weight display</span>
                    <select
                      value={profile.weightUnit}
                      onChange={(event) =>
                        setProfile({
                          ...profile,
                          weightUnit: event.target.value as WeightUnit,
                        })
                      }
                    >
                      <option value="lb">Pounds (lb)</option>
                      <option value="kg">Kilograms (kg)</option>
                    </select>
                  </label>
                  <label>
                    <span>Height display</span>
                    <select
                      value={profile.heightUnit}
                      onChange={(event) =>
                        setProfile({
                          ...profile,
                          heightUnit:
                            event.target.value === 'metric'
                              ? 'metric'
                              : 'imperial',
                        })
                      }
                    >
                      <option value="imperial">Feet & inches</option>
                      <option value="metric">Centimetres (cm)</option>
                    </select>
                  </label>
                  <label>
                    <span>Age</span>
                    <input
                      type="number"
                      min="13"
                      max="100"
                      value={profile.age ?? ''}
                      onChange={(event) =>
                        setProfile({
                          ...profile,
                          age: event.target.value
                            ? Number(event.target.value)
                            : null,
                        })
                      }
                    />
                  </label>
                  {profile.heightUnit === 'metric' ? (
                    <label>
                      <span>Height (cm)</span>
                      <input
                        type="number"
                        min="100"
                        max="250"
                        step="0.1"
                        value={profile.heightCm ?? ''}
                        onChange={(event) =>
                          setProfile({
                            ...profile,
                            heightCm: event.target.value
                              ? Number(event.target.value)
                              : null,
                          })
                        }
                      />
                    </label>
                  ) : (
                    <div className="profile-field">
                      <span>Height (ft / in)</span>
                      <div className="height-inputs">
                        <div>
                          <input
                            type="number"
                            min="3"
                            max="8"
                            inputMode="numeric"
                            aria-label="Height in feet"
                            value={profileHeight.feet}
                            onChange={(event) =>
                              setProfile({
                                ...profile,
                                heightCm: heightFromImperial(
                                  event.target.value,
                                  profileHeight.inches,
                                ),
                              })
                            }
                          />
                          <span>ft</span>
                        </div>
                        <div>
                          <input
                            type="number"
                            min="0"
                            max="11"
                            inputMode="numeric"
                            aria-label="Height in inches"
                            value={profileHeight.inches}
                            onChange={(event) =>
                              setProfile({
                                ...profile,
                                heightCm: heightFromImperial(
                                  profileHeight.feet,
                                  event.target.value,
                                ),
                              })
                            }
                          />
                          <span>in</span>
                        </div>
                      </div>
                    </div>
                  )}
                  <label>
                    <span>Body weight ({unit})</span>
                    <input
                      type="number"
                      min={unit === 'lb' ? 66 : 30}
                      max={unit === 'lb' ? 772 : 350}
                      step="0.1"
                      value={
                        profile.weightKg
                          ? Math.round(
                              toDisplayWeight(profile.weightKg, unit) * 10,
                            ) / 10
                          : ''
                      }
                      onChange={(event) =>
                        setProfile({
                          ...profile,
                          weightKg: event.target.value
                            ? Number(event.target.value) /
                              (unit === 'lb' ? 2.20462 : 1)
                            : null,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Experience</span>
                    <select
                      value={profile.experience}
                      onChange={(event) =>
                        setProfile({
                          ...profile,
                          experience: event.target.value,
                        })
                      }
                    >
                      <option value="beginner">Beginner</option>
                      <option value="intermediate">Intermediate</option>
                      <option value="advanced">Advanced</option>
                    </select>
                  </label>
                </div>
              </div>
              <div className="form-section">
                <div>
                  <span>02</span>
                  <h3>Outcome & schedule</h3>
                </div>
                <div className="form-grid">
                  <label className="span-two">
                    <span>Primary goal</span>
                    <textarea
                      rows={3}
                      value={profile.primaryGoal}
                      onChange={(event) =>
                        setProfile({
                          ...profile,
                          primaryGoal: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Target date</span>
                    <input
                      type="date"
                      value={profile.targetDate}
                      onChange={(event) =>
                        setProfile({
                          ...profile,
                          targetDate: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Days / week</span>
                    <input
                      type="number"
                      min="1"
                      max="7"
                      value={profile.daysPerWeek}
                      onChange={(event) =>
                        setProfile({
                          ...profile,
                          daysPerWeek: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Minutes / session</span>
                    <input
                      type="number"
                      min="20"
                      max="180"
                      value={profile.minutesPerSession}
                      onChange={(event) =>
                        setProfile({
                          ...profile,
                          minutesPerSession: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Equipment</span>
                    <input
                      value={profile.equipment}
                      onChange={(event) =>
                        setProfile({
                          ...profile,
                          equipment: event.target.value,
                        })
                      }
                    />
                  </label>
                </div>
              </div>
              <div className="form-section">
                <div>
                  <span>03</span>
                  <h3>Phase & recovery</h3>
                </div>
                <div className="form-grid">
                  <label>
                    <span className="form-label-with-help">
                      Training phase
                      <InfoTooltip title="Training phase">
                        {PROFILE_HELP.phase}
                      </InfoTooltip>
                    </span>
                    <select
                      value={profile.phase}
                      onChange={(event) =>
                        setProfile({
                          ...profile,
                          phase: event.target.value as AthleteProfile['phase'],
                        })
                      }
                    >
                      <option value="cut">Cut</option>
                      <option value="maintain">Maintain</option>
                      <option value="lean_gain">Lean gain</option>
                      <option value="gain">Gain</option>
                      <option value="recomp">Recomp</option>
                    </select>
                  </label>
                  <label>
                    <span className="form-label-with-help">
                      Phase start
                      <InfoTooltip title="Phase start">
                        {PROFILE_HELP.phaseStart}
                      </InfoTooltip>
                    </span>
                    <input
                      type="date"
                      value={profile.phaseStartedAt}
                      onChange={(event) =>
                        setProfile({
                          ...profile,
                          phaseStartedAt: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span className="form-label-with-help">
                      Daily calories <small>optional</small>
                      <InfoTooltip title="Daily calories">
                        {PROFILE_HELP.calories}
                      </InfoTooltip>
                    </span>
                    <input
                      type="number"
                      min="500"
                      max="20000"
                      value={profile.dailyCalories ?? ''}
                      onChange={(event) =>
                        setProfile({
                          ...profile,
                          dailyCalories: event.target.value
                            ? Number(event.target.value)
                            : null,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span className="form-label-with-help">
                      Protein (g) <small>optional</small>
                      <InfoTooltip title="Protein target">
                        {PROFILE_HELP.protein}
                      </InfoTooltip>
                    </span>
                    <input
                      type="number"
                      min="20"
                      max="500"
                      value={profile.proteinGrams ?? ''}
                      onChange={(event) =>
                        setProfile({
                          ...profile,
                          proteinGrams: event.target.value
                            ? Number(event.target.value)
                            : null,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span className="form-label-with-help">
                      Typical sleep (hours)
                      <InfoTooltip title="Typical sleep">
                        {PROFILE_HELP.sleep}
                      </InfoTooltip>
                    </span>
                    <input
                      type="number"
                      min="0"
                      max="24"
                      step="0.1"
                      value={profile.sleepHoursTypical ?? ''}
                      onChange={(event) =>
                        setProfile({
                          ...profile,
                          sleepHoursTypical: event.target.value
                            ? Number(event.target.value)
                            : null,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span className="form-label-with-help">
                      Dropset volume weight
                      <InfoTooltip title="Dropset volume weight">
                        {PROFILE_HELP.dropsetWeight}
                      </InfoTooltip>
                    </span>
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.05"
                      value={profile.dropsetWeight}
                      onChange={(event) =>
                        setProfile({
                          ...profile,
                          dropsetWeight: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    <span className="form-label-with-help">
                      Timezone
                      <InfoTooltip title="Timezone">
                        {PROFILE_HELP.timezone}
                      </InfoTooltip>
                    </span>
                    <select
                      value={profile.timezone}
                      onChange={(event) =>
                        setProfile({ ...profile, timezone: event.target.value })
                      }
                    >
                      {[
                        ...new Set([
                          profile.timezone,
                          browserTimeZone(),
                          ...COMMON_TIMEZONES,
                        ]),
                      ]
                        .filter(Boolean)
                        .map((timeZone) => (
                          <option key={timeZone} value={timeZone}>
                            {timeZone.replaceAll('_', ' ')}
                          </option>
                        ))}
                    </select>
                  </label>
                  <div className="span-two profile-subsection-label">
                    <span className="form-label-with-help">
                      Smallest practical load increment ({unit})
                      <InfoTooltip title="Smallest practical load increment">
                        {PROFILE_HELP.loadIncrement}
                      </InfoTooltip>
                    </span>
                  </div>
                  {(['barbell', 'dumbbell', 'machine', 'cable'] as const).map(
                    (equipment) => (
                      <label key={equipment}>
                        <span>{equipment}</span>
                        <input
                          type="number"
                          min="0.1"
                          max="50"
                          step="0.1"
                          value={toDisplayWeight(
                            profile.loadIncrements[equipment],
                            unit,
                          )}
                          onChange={(event) =>
                            setProfile({
                              ...profile,
                              loadIncrements: {
                                ...profile.loadIncrements,
                                [equipment]:
                                  Number(event.target.value) /
                                  (unit === 'lb' ? 2.20462 : 1),
                              },
                            })
                          }
                        />
                      </label>
                    ),
                  )}
                  <div className="span-two profile-context-card">
                    <div className="profile-context-heading">
                      <div>
                        <span className="eyebrow">BODY-WEIGHT TREND</span>
                        <strong>
                          Keep phase decisions grounded in the scale.
                        </strong>
                      </div>
                      <span className="profile-context-note">
                        {bodyWeightSummary.latest == null
                          ? 'No measurements yet'
                          : `${formatWeight(bodyWeightSummary.latest, unit)} latest`}
                      </span>
                    </div>
                    <div className="profile-context-stats">
                      <span>
                        <strong>
                          {bodyWeightSummary.average7d == null
                            ? '—'
                            : formatWeight(bodyWeightSummary.average7d, unit)}
                        </strong>
                        <small>7-day average</small>
                      </span>
                      <span>
                        <strong>
                          {bodyWeightSummary.slopeKgPerWeek == null
                            ? '—'
                            : `${bodyWeightSummary.slopeKgPerWeek > 0 ? '+' : ''}${formatWeight(bodyWeightSummary.slopeKgPerWeek, unit)}`}
                        </strong>
                        <small>weekly trend</small>
                      </span>
                    </div>
                  </div>
                  <div className="span-two profile-context-card">
                    <div className="profile-context-heading">
                      <div>
                        <span className="eyebrow">TRAINING BLOCKS</span>
                        <strong>
                          Mark accumulation, intensity, and deload weeks.
                        </strong>
                      </div>
                      {blockState && (
                        <span className="profile-context-note">
                          {blockState}
                        </span>
                      )}
                    </div>
                    <form className="block-form" onSubmit={createTrainingBlock}>
                      <label>
                        <span>Block name</span>
                        <input
                          value={blockDraft.name}
                          onChange={(event) =>
                            setBlockDraft({
                              ...blockDraft,
                              name: event.target.value,
                            })
                          }
                          placeholder="e.g. Upper/lower accumulation"
                          required
                        />
                      </label>
                      <label>
                        <span>Type</span>
                        <select
                          value={blockDraft.kind}
                          onChange={(event) =>
                            setBlockDraft({
                              ...blockDraft,
                              kind: event.target.value as TrainingBlockKind,
                            })
                          }
                        >
                          <option value="accumulation">Accumulation</option>
                          <option value="intensification">
                            Intensification
                          </option>
                          <option value="deload">Deload</option>
                          <option value="maintenance">Maintenance</option>
                          <option value="custom">Custom</option>
                        </select>
                      </label>
                      <label>
                        <span>Starts</span>
                        <input
                          type="date"
                          value={blockDraft.startsAt}
                          onChange={(event) =>
                            setBlockDraft({
                              ...blockDraft,
                              startsAt: event.target.value,
                            })
                          }
                          required
                        />
                      </label>
                      <label>
                        <span>
                          Ends <small>optional</small>
                        </span>
                        <input
                          type="date"
                          value={blockDraft.endsAt}
                          onChange={(event) =>
                            setBlockDraft({
                              ...blockDraft,
                              endsAt: event.target.value,
                            })
                          }
                        />
                      </label>
                      <Button type="submit">Add block</Button>
                    </form>
                    {trainingBlocks.length > 0 && (
                      <div className="block-list">
                        {trainingBlocks.slice(0, 6).map((block) => (
                          <div className="block-row" key={block.id}>
                            <div>
                              <strong>{block.name}</strong>
                              <small>
                                {block.kind} · {formatShortDate(block.startsAt)}
                                {block.endsAt
                                  ? ` → ${formatShortDate(block.endsAt)}`
                                  : ' → open'}
                              </small>
                            </div>
                            <button
                              type="button"
                              className="icon-button"
                              aria-label={`Delete ${block.name}`}
                              onClick={() => void removeTrainingBlock(block.id)}
                            >
                              <Trash2 aria-hidden="true" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="form-section">
                <div>
                  <span>04</span>
                  <h3>Constraints</h3>
                </div>
                <div className="form-grid">
                  <label className="span-two">
                    <span>Limitations or injuries</span>
                    <textarea
                      rows={4}
                      placeholder="Only include what is useful for training decisions."
                      value={profile.limitations}
                      onChange={(event) =>
                        setProfile({
                          ...profile,
                          limitations: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="span-two">
                    <span>Preferences</span>
                    <textarea
                      rows={4}
                      placeholder="Movements you enjoy, avoid, or want to prioritize."
                      value={profile.preferences}
                      onChange={(event) =>
                        setProfile({
                          ...profile,
                          preferences: event.target.value,
                        })
                      }
                    />
                  </label>
                </div>
              </div>
              <div className="form-actions">
                <Button type="submit">{profileState}</Button>
                {bodyWeightState && <span>{bodyWeightState}</span>}
                <span>Stored in your private Hevy Coach workspace.</span>
              </div>
            </form>
          </section>
        )}

        <footer>
          <span>HEVY COACH / PRIVATE WORKSPACE</span>
          <span>Evidence first. AI second. You approve every write.</span>
        </footer>
      </main>
    </div>
  );
}
