import {
  index,
  integer,
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
  weightKg: integer('weight_kg'),
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
