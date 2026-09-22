import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const athleteProfiles = sqliteTable('athlete_profiles', {
  userId: text('user_id').primaryKey(),
  displayName: text('display_name').notNull().default('Athlete'),
  biologicalSex: text('biological_sex').notNull().default('prefer_not_to_say'),
  age: integer('age'),
  heightCm: integer('height_cm'),
  weightKg: real('weight_kg'),
  weightUnit: text('weight_unit').notNull().default('lb'),
  heightUnit: text('height_unit').notNull().default('imperial'),
  experience: text('experience').notNull().default('intermediate'),
  primaryGoal: text('primary_goal')
    .notNull()
    .default('Build muscle and strength'),
  targetDate: text('target_date'),
  daysPerWeek: integer('days_per_week').notNull().default(4),
  minutesPerSession: integer('minutes_per_session').notNull().default(60),
  equipment: text('equipment').notNull().default('Full gym'),
  limitations: text('limitations').notNull().default(''),
  preferences: text('preferences').notNull().default(''),
  phase: text('phase').notNull().default('maintain'),
  phaseStartedAt: text('phase_started_at'),
  dailyCalories: integer('daily_calories'),
  proteinGrams: integer('protein_grams'),
  sleepHoursTypical: real('sleep_hours_typical'),
  dropsetWeight: real('dropset_weight').notNull().default(0.5),
  loadIncrementsJson: text('load_increments_json')
    .notNull()
    .default('{"barbell":2.5,"dumbbell":2,"machine":5,"cable":2.5}'),
  timezone: text('timezone').notNull().default('UTC'),
  updatedAt: text('updated_at').notNull(),
});

export const conversations = sqliteTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    title: text('title').notNull(),
    pinned: integer('pinned').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_conversations_user_updated').on(table.userId, table.updatedAt),
  ],
);

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id').notNull(),
    userId: text('user_id').notNull(),
    role: text('role').notNull(),
    content: text('content').notNull(),
    model: text('model'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_messages_conversation_created').on(
      table.conversationId,
      table.createdAt,
    ),
  ],
);

export const programs = sqliteTable(
  'programs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    title: text('title').notNull(),
    goal: text('goal').notNull(),
    durationWeeks: integer('duration_weeks').notNull(),
    daysPerWeek: integer('days_per_week').notNull(),
    minutesPerSession: integer('minutes_per_session').notNull(),
    contentJson: text('content_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_programs_user_created').on(table.userId, table.createdAt),
  ],
);

export const weeklyReviews = sqliteTable(
  'weekly_reviews',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    weekStart: text('week_start').notNull(),
    contentJson: text('content_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_weekly_reviews_user_week').on(
      table.userId,
      table.weekStart,
    ),
  ],
);

export const hevyWorkouts = sqliteTable(
  'hevy_workouts',
  {
    userId: text('user_id').notNull(),
    id: text('id').notNull(),
    title: text('title').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    description: text('description'),
    sourceUpdatedAt: text('source_updated_at'),
    rawJson: text('raw_json').notNull(),
    deleted: integer('deleted').notNull().default(0),
    syncedAt: text('synced_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index('idx_hevy_workouts_user_start').on(table.userId, table.startTime),
  ],
);

export const hevySets = sqliteTable(
  'hevy_sets',
  {
    userId: text('user_id').notNull(),
    id: text('id').notNull(),
    workoutId: text('workout_id').notNull(),
    exerciseTemplateId: text('exercise_template_id').notNull(),
    exerciseTitle: text('exercise_title').notNull(),
    exerciseIndex: integer('exercise_index').notNull(),
    setIndex: integer('set_index').notNull(),
    setType: text('set_type').notNull().default('normal'),
    weightKg: real('weight_kg'),
    reps: integer('reps'),
    rpe: real('rpe'),
    durationSeconds: integer('duration_seconds'),
    distanceMeters: real('distance_meters'),
    exerciseNotes: text('exercise_notes'),
    performedAt: text('performed_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index('idx_hevy_sets_user_performed').on(table.userId, table.performedAt),
    index('idx_hevy_sets_user_exercise_performed').on(
      table.userId,
      table.exerciseTemplateId,
      table.performedAt,
    ),
    index('idx_hevy_sets_user_workout').on(table.userId, table.workoutId),
  ],
);

export const hevyTemplates = sqliteTable(
  'hevy_templates',
  {
    userId: text('user_id').notNull(),
    id: text('id').notNull(),
    title: text('title').notNull(),
    primaryMuscle: text('primary_muscle'),
    secondaryMusclesJson: text('secondary_muscles_json')
      .notNull()
      .default('[]'),
    equipment: text('equipment'),
    isCustom: integer('is_custom').notNull().default(0),
    syncedAt: text('synced_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index('idx_hevy_templates_user_title').on(table.userId, table.title),
  ],
);

export const hevySyncState = sqliteTable('hevy_sync_state', {
  userId: text('user_id').primaryKey(),
  lastEventSince: text('last_event_since'),
  fullSyncNextPage: integer('full_sync_next_page').notNull().default(1),
  fullSyncPageCount: integer('full_sync_page_count'),
  fullSyncCompletedAt: text('full_sync_completed_at'),
  templatesSyncedAt: text('templates_synced_at'),
  lastSyncAt: text('last_sync_at'),
  lastError: text('last_error'),
});

export const muscleOverrides = sqliteTable(
  'muscle_overrides',
  {
    userId: text('user_id').notNull(),
    exerciseTemplateId: text('exercise_template_id').notNull(),
    primaryMuscle: text('primary_muscle').notNull(),
    secondaryMusclesJson: text('secondary_muscles_json')
      .notNull()
      .default('[]'),
    slotId: text('slot_id'),
    countsAs: real('counts_as').notNull().default(1),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.exerciseTemplateId] }),
  ],
);

export const exerciseSlots = sqliteTable(
  'exercise_slots',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    primaryMuscle: text('primary_muscle').notNull(),
    pattern: text('pattern'),
  },
  (table) => [
    index('idx_exercise_slots_user_name').on(table.userId, table.name),
  ],
);

export const progressionStates = sqliteTable(
  'progression_states',
  {
    userId: text('user_id').notNull(),
    slotOrTemplateId: text('slot_or_template_id').notNull(),
    computedAt: text('computed_at').notNull(),
    analysisVersion: integer('analysis_version').notNull(),
    stateJson: text('state_json').notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.slotOrTemplateId] })],
);

export const dashboardSnapshots = sqliteTable('dashboard_snapshots', {
  userId: text('user_id').primaryKey(),
  contentJson: text('content_json').notNull(),
  derivedAt: text('derived_at').notNull(),
  version: integer('version').notNull(),
});

export const derivationState = sqliteTable('derivation_state', {
  userId: text('user_id').primaryKey(),
  fingerprint: text('fingerprint').notNull(),
  derivedAt: text('derived_at').notNull(),
  version: integer('version').notNull(),
});

export const personalRecords = sqliteTable(
  'personal_records',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    key: text('key').notNull(),
    templateId: text('template_id').notNull(),
    slotId: text('slot_id'),
    kind: text('kind').notNull(),
    repBucket: text('rep_bucket'),
    value: real('value').notNull(),
    reps: integer('reps').notNull(),
    loadKg: real('load_kg').notNull(),
    performedAt: text('performed_at').notNull(),
    workoutId: text('workout_id').notNull(),
    previousValue: real('previous_value'),
    previousAt: text('previous_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_personal_records_user_date').on(table.userId, table.performedAt),
    index('idx_personal_records_user_key').on(table.userId, table.key),
  ],
);

export const bodyWeights = sqliteTable(
  'body_weights',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    measuredAt: text('measured_at').notNull(),
    weightKg: real('weight_kg').notNull(),
    source: text('source').notNull().default('manual'),
  },
  (table) => [
    index('idx_body_weights_user_date').on(table.userId, table.measuredAt),
  ],
);

export const trainingBlocks = sqliteTable(
  'training_blocks',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    startsAt: text('starts_at').notNull(),
    endsAt: text('ends_at'),
    programId: text('program_id'),
  },
  (table) => [
    index('idx_training_blocks_user_start').on(table.userId, table.startsAt),
  ],
);
