import { getDatabase } from '@/db';

export type WeightUnit = 'kg' | 'lb';
export type HeightUnit = 'metric' | 'imperial';

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
  createdAt: string;
};

export type TrainingDay = {
  day: number;
  title: string;
  focus: string;
  exercises: Array<{
    name: string;
    sets: number;
    reps: string;
    effort: string;
    restSeconds: number;
    note: string;
  }>;
};

export type TrainingProgram = {
  id: string;
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
};

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
  };
}

export async function getProfile(userId: string) {
  const row = await getDatabase()
    .prepare(
      `SELECT display_name, biological_sex, age, height_cm, weight_kg,
        weight_unit, height_unit,
        experience, primary_goal, target_date, days_per_week,
        minutes_per_session, equipment, limitations, preferences
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
        preferences, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  return { id, title, pinned: false, createdAt: now, updatedAt: now, preview: '' };
}

export async function setConversationPinned(
  userId: string,
  id: string,
  pinned: boolean,
) {
  await getDatabase()
    .prepare(
      'UPDATE conversations SET pinned = ? WHERE id = ? AND user_id = ?',
    )
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
       FROM messages WHERE conversation_id = ? AND user_id = ?
       ORDER BY created_at ASC LIMIT 100`,
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
  return result.results.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    model: row.model,
    createdAt: row.created_at,
  })) satisfies ChatMessage[];
}

export async function saveMessage(
  userId: string,
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  model: string | null = null,
) {
  const database = getDatabase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        'INSERT INTO messages (id, conversation_id, user_id, role, content, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(id, conversationId, userId, role, content, model, now),
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
  // Database columns are canonical. This prevents an older content_json blob
  // from making two saved programs appear to share the same metadata.
  return {
    ...content,
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
