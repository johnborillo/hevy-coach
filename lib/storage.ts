import { getDatabase } from '@/db';
import {
  decodeCoachMessageMetadata,
  encodeCoachMessageMetadata,
  type CoachId,
  type CoachMessageFlags,
} from './coach-options';
import { migrateProgramContent } from './program-v2';

export type WeightUnit = 'kg' | 'lb';
export type HeightUnit = 'metric' | 'imperial';
export type TrainingPhase =
  | 'cut'
  | 'maintain'
  | 'lean_gain'
  | 'gain'
  | 'recomp';
export type LoadIncrements = {
  barbell: number;
  dumbbell: number;
  machine: number;
  cable: number;
};

export type AthleteProfile = {
  displayName: string;
  biologicalSex: string;
  age: number | null;
  heightCm: number | null;
  weightKg: number | null;
  weightUnit: WeightUnit;
  heightUnit: HeightUnit;
  experience: string;
  primaryGoal: string;
  targetDate: string;
  daysPerWeek: number;
  minutesPerSession: number;
  equipment: string;
  limitations: string;
  preferences: string;
  phase: TrainingPhase;
  phaseStartedAt: string;
  dailyCalories: number | null;
  proteinGrams: number | null;
  sleepHoursTypical: number | null;
  dropsetWeight: number;
  loadIncrements: LoadIncrements;
  timezone: string;
};

export type ConversationSummary = {
  id: string;
  title: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  preview: string;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  model: string | null;
  coachId?: CoachId | null;
  fallbackReason?: string | null;
  flags?: CoachMessageFlags | null;
  createdAt: string;
};

export type ProgramEffort = {
  type: 'rir' | 'rpe';
  value: number | [number, number];
};

export type ProgramProgression = {
  rule: 'double_progression' | 'linear_load' | 'rep_target_then_load' | 'hold';
  loadIncrementKg: number;
  triggerReps?: number;
};

export type ProgramExercise = {
  exerciseTemplateId: string | null;
  slotId: string | null;
  name: string;
  sets: number;
  repRange: [number, number];
  effort: ProgramEffort;
  restSeconds: number;
  startingLoadKg: number | null;
  progression: ProgramProgression;
  note: string;
  rationale: string;
};

export type TrainingDay = {
  day: number;
  title: string;
  focus: string;
  exercises: ProgramExercise[];
  hevyRoutineId?: string | null;
};

export type TrainingProgram = {
  id: string;
  schemaVersion: 2;
  title: string;
  goal: string;
  durationWeeks: number;
  daysPerWeek: number;
  minutesPerSession: number;
  overview: string;
  progression: string;
  deload: string;
  days: TrainingDay[];
  createdAt: string;
};

export const DEFAULT_PROFILE: AthleteProfile = {
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

type ProfileRow = {
  display_name: string;
  biological_sex: string;
  age: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  weight_unit: WeightUnit;
  height_unit: HeightUnit;
  experience: string;
  primary_goal: string;
  target_date: string | null;
  days_per_week: number;
  minutes_per_session: number;
  equipment: string;
  limitations: string;
  preferences: string;
  phase: TrainingPhase;
  phase_started_at: string | null;
  daily_calories: number | null;
  protein_grams: number | null;
  sleep_hours_typical: number | null;
  dropset_weight: number;
  load_increments_json: string;
  timezone: string;
};

function parseLoadIncrements(value: string): LoadIncrements {
  try {
    const parsed = JSON.parse(value) as Partial<LoadIncrements>;
    return {
      barbell: Number.isFinite(parsed.barbell) ? Number(parsed.barbell) : 2.5,
      dumbbell: Number.isFinite(parsed.dumbbell) ? Number(parsed.dumbbell) : 2,
      machine: Number.isFinite(parsed.machine) ? Number(parsed.machine) : 5,
      cable: Number.isFinite(parsed.cable) ? Number(parsed.cable) : 2.5,
    };
  } catch {
    return { ...DEFAULT_PROFILE.loadIncrements };
  }
}

function rowToProfile(row: ProfileRow): AthleteProfile {
  return {
    displayName: row.display_name,
    biologicalSex: row.biological_sex,
    age: row.age,
    heightCm: row.height_cm,
    weightKg: row.weight_kg,
    weightUnit: row.weight_unit,
    heightUnit: row.height_unit,
    experience: row.experience,
    primaryGoal: row.primary_goal,
    targetDate: row.target_date ?? '',
    daysPerWeek: row.days_per_week,
    minutesPerSession: row.minutes_per_session,
    equipment: row.equipment,
    limitations: row.limitations,
    preferences: row.preferences,
    phase: row.phase,
    phaseStartedAt: row.phase_started_at ?? '',
    dailyCalories: row.daily_calories,
    proteinGrams: row.protein_grams,
    sleepHoursTypical: row.sleep_hours_typical,
    dropsetWeight: row.dropset_weight,
    loadIncrements: parseLoadIncrements(row.load_increments_json),
    timezone: row.timezone || 'UTC',
  };
}

export async function getProfile(userId: string) {
  const row = await getDatabase()
    .prepare(
      `SELECT display_name, biological_sex, age, height_cm, weight_kg,
        weight_unit, height_unit,
        experience, primary_goal, target_date, days_per_week,
        minutes_per_session, equipment, limitations, preferences,
        phase, phase_started_at, daily_calories, protein_grams,
        sleep_hours_typical, dropset_weight, load_increments_json, timezone
       FROM athlete_profiles WHERE user_id = ?`,
    )
    .bind(userId)
    .first<ProfileRow>();

  return row ? rowToProfile(row) : DEFAULT_PROFILE;
}

export async function saveProfile(userId: string, profile: AthleteProfile) {
  const now = new Date().toISOString();
  await getDatabase()
    .prepare(
      `INSERT INTO athlete_profiles (
        user_id, display_name, biological_sex, age, height_cm, weight_kg,
        weight_unit, height_unit, experience, primary_goal, target_date,
        days_per_week, minutes_per_session, equipment, limitations,
        preferences, phase, phase_started_at, daily_calories, protein_grams,
        sleep_hours_typical, dropset_weight, load_increments_json, timezone,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        display_name = excluded.display_name,
        biological_sex = excluded.biological_sex,
        age = excluded.age,
        height_cm = excluded.height_cm,
        weight_kg = excluded.weight_kg,
        weight_unit = excluded.weight_unit,
        height_unit = excluded.height_unit,
        experience = excluded.experience,
        primary_goal = excluded.primary_goal,
        target_date = excluded.target_date,
        days_per_week = excluded.days_per_week,
        minutes_per_session = excluded.minutes_per_session,
        equipment = excluded.equipment,
        limitations = excluded.limitations,
        preferences = excluded.preferences,
        phase = excluded.phase,
        phase_started_at = excluded.phase_started_at,
        daily_calories = excluded.daily_calories,
        protein_grams = excluded.protein_grams,
        sleep_hours_typical = excluded.sleep_hours_typical,
        dropset_weight = excluded.dropset_weight,
        load_increments_json = excluded.load_increments_json,
        timezone = excluded.timezone,
        updated_at = excluded.updated_at`,
    )
    .bind(
      userId,
      profile.displayName,
      profile.biologicalSex,
      profile.age,
      profile.heightCm,
      profile.weightKg,
      profile.weightUnit,
      profile.heightUnit,
      profile.experience,
      profile.primaryGoal,
      profile.targetDate || null,
      profile.daysPerWeek,
      profile.minutesPerSession,
      profile.equipment,
      profile.limitations,
      profile.preferences,
      profile.phase,
      profile.phaseStartedAt || null,
      profile.dailyCalories,
      profile.proteinGrams,
      profile.sleepHoursTypical,
      profile.dropsetWeight,
      JSON.stringify(profile.loadIncrements),
      profile.timezone,
      now,
    )
    .run();
  return profile;
}

export async function listConversations(userId: string) {
  const result = await getDatabase()
    .prepare(
      `SELECT c.id, c.title, c.pinned, c.created_at, c.updated_at,
        COALESCE((SELECT content FROM messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.created_at DESC LIMIT 1), '') AS preview
       FROM conversations c WHERE c.user_id = ?
       ORDER BY c.pinned DESC, c.updated_at DESC LIMIT 50`,
    )
    .bind(userId)
    .all<{
      id: string;
      title: string;
      pinned: number;
      created_at: string;
      updated_at: string;
      preview: string;
    }>();

  return result.results.map((row) => ({
    id: row.id,
    title: row.title,
    pinned: Boolean(row.pinned),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    preview: row.preview,
  })) satisfies ConversationSummary[];
}

export async function createConversation(
  userId: string,
  title = 'New coaching chat',
) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await getDatabase()
    .prepare(
      'INSERT INTO conversations (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(id, userId, title, now, now)
    .run();
  return {
    id,
    title,
    pinned: false,
    createdAt: now,
    updatedAt: now,
    preview: '',
  };
}

export async function setConversationPinned(
  userId: string,
  id: string,
  pinned: boolean,
) {
  await getDatabase()
    .prepare('UPDATE conversations SET pinned = ? WHERE id = ? AND user_id = ?')
    .bind(pinned ? 1 : 0, id, userId)
    .run();
}

export async function deleteConversation(userId: string, id: string) {
  const database = getDatabase();
  await database.batch([
    database
      .prepare('DELETE FROM messages WHERE conversation_id = ? AND user_id = ?')
      .bind(id, userId),
    database
      .prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?')
      .bind(id, userId),
  ]);
}

export async function listMessages(userId: string, conversationId: string) {
  const result = await getDatabase()
    .prepare(
      `SELECT id, conversation_id, role, content, model, created_at
       FROM (
         SELECT id, conversation_id, role, content, model, created_at
         FROM messages WHERE conversation_id = ? AND user_id = ?
         ORDER BY created_at DESC LIMIT 100
       )
       ORDER BY created_at ASC`,
    )
    .bind(conversationId, userId)
    .all<{
      id: string;
      conversation_id: string;
      role: 'user' | 'assistant';
      content: string;
      model: string | null;
      created_at: string;
    }>();
  return result.results.map((row) => {
    const metadata = decodeCoachMessageMetadata(row.model);
    return {
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      content: row.content,
      model: metadata.model,
      coachId: row.role === 'assistant' ? metadata.coachId : null,
      fallbackReason: row.role === 'assistant' ? metadata.fallbackReason : null,
      flags:
        row.role === 'assistant' && 'flags' in metadata
          ? (metadata.flags ?? null)
          : null,
      createdAt: row.created_at,
    };
  }) satisfies ChatMessage[];
}

export async function saveMessage(
  userId: string,
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  model: string | null = null,
  coachId: CoachId | null = null,
  fallbackReason: string | null = null,
  flags: CoachMessageFlags | null = null,
) {
  const database = getDatabase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const storedModel =
    role === 'assistant' && model && coachId
      ? encodeCoachMessageMetadata(coachId, model, fallbackReason, flags)
      : model;
  await database.batch([
    database
      .prepare(
        'INSERT INTO messages (id, conversation_id, user_id, role, content, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(id, conversationId, userId, role, content, storedModel, now),
    database
      .prepare(
        'UPDATE conversations SET updated_at = ?, title = CASE WHEN title = ? AND ? = ? THEN ? ELSE title END WHERE id = ? AND user_id = ?',
      )
      .bind(
        now,
        'New coaching chat',
        role,
        'user',
        content.slice(0, 54),
        conversationId,
        userId,
      ),
  ]);
  return {
    id,
    conversationId,
    role,
    content,
    model,
    coachId,
    fallbackReason,
    flags,
    createdAt: now,
  } satisfies ChatMessage;
}

export async function listPrograms(userId: string) {
  const result = await getDatabase()
    .prepare(
      `SELECT id, title, goal, duration_weeks, days_per_week,
        minutes_per_session, content_json, created_at
       FROM programs WHERE user_id = ? ORDER BY created_at DESC LIMIT 12`,
    )
    .bind(userId)
    .all<{
      id: string;
      title: string;
      goal: string;
      duration_weeks: number;
      days_per_week: number;
      minutes_per_session: number;
      content_json: string;
      created_at: string;
    }>();

  return result.results.map(rowToProgram);
}

type ProgramRow = {
  id: string;
  title: string;
  goal: string;
  duration_weeks: number;
  days_per_week: number;
  minutes_per_session: number;
  content_json: string;
  created_at: string;
};

function rowToProgram(row: ProgramRow) {
  let content: Partial<TrainingProgram> = {};
  try {
    content = JSON.parse(row.content_json) as Partial<TrainingProgram>;
  } catch {
    content = {};
  }
  const migrated = migrateProgramContent({
    ...content,
    title: row.title,
    goal: row.goal,
    durationWeeks: row.duration_weeks,
    daysPerWeek: row.days_per_week,
    minutesPerSession: row.minutes_per_session,
  });
  // Database columns are canonical. This prevents an older content_json blob
  // from making two saved programs appear to share the same metadata.
  return {
    ...migrated,
    id: row.id,
    title: row.title,
    goal: row.goal,
    durationWeeks: row.duration_weeks,
    daysPerWeek: row.days_per_week,
    minutesPerSession: row.minutes_per_session,
    createdAt: row.created_at,
  } as TrainingProgram;
}

export async function getProgram(userId: string, id: string) {
  const row = await getDatabase()
    .prepare(
      `SELECT id, title, goal, duration_weeks, days_per_week,
        minutes_per_session, content_json, created_at
       FROM programs WHERE id = ? AND user_id = ? LIMIT 1`,
    )
    .bind(id, userId)
    .first<ProgramRow>();
  return row ? rowToProgram(row) : null;
}

export async function saveProgram(
  userId: string,
  program: Omit<TrainingProgram, 'id' | 'createdAt'>,
) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const {
    title,
    goal,
    durationWeeks,
    daysPerWeek,
    minutesPerSession,
    ...content
  } = program;
  await getDatabase()
    .prepare(
      `INSERT INTO programs (id, user_id, title, goal, duration_weeks,
        days_per_week, minutes_per_session, content_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      userId,
      title,
      goal,
      durationWeeks,
      daysPerWeek,
      minutesPerSession,
      JSON.stringify(content),
      createdAt,
    )
    .run();
  return {
    id,
    title,
    goal,
    durationWeeks,
    daysPerWeek,
    minutesPerSession,
    ...content,
    createdAt,
  };
}

export async function updateProgram(
  userId: string,
  id: string,
  program: Omit<TrainingProgram, 'id' | 'createdAt'>,
) {
  const {
    title,
    goal,
    durationWeeks,
    daysPerWeek,
    minutesPerSession,
    ...content
  } = program;
  const result = await getDatabase()
    .prepare(
      `UPDATE programs SET title = ?, goal = ?, duration_weeks = ?,
        days_per_week = ?, minutes_per_session = ?, content_json = ?
       WHERE id = ? AND user_id = ?`,
    )
    .bind(
      title,
      goal,
      durationWeeks,
      daysPerWeek,
      minutesPerSession,
      JSON.stringify(content),
      id,
      userId,
    )
    .run();
  if (!result.meta.changes) return null;
  const saved = await getProgram(userId, id);
  return saved;
}

export async function deleteProgram(userId: string, id: string) {
  const result = await getDatabase()
    .prepare('DELETE FROM programs WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .run();
  return Boolean(result.meta.changes);
}
