CREATE TABLE `athlete_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`display_name` text DEFAULT 'Athlete' NOT NULL,
	`biological_sex` text DEFAULT 'prefer_not_to_say' NOT NULL,
	`age` integer,
	`height_cm` integer,
	`weight_kg` integer,
	`experience` text DEFAULT 'intermediate' NOT NULL,
	`primary_goal` text DEFAULT 'Build muscle and strength' NOT NULL,
	`target_date` text,
	`days_per_week` integer DEFAULT 4 NOT NULL,
	`minutes_per_session` integer DEFAULT 60 NOT NULL,
	`equipment` text DEFAULT 'Full gym' NOT NULL,
	`limitations` text DEFAULT '' NOT NULL,
	`preferences` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_conversations_user_updated` ON `conversations` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`model` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_messages_conversation_created` ON `messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `programs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`goal` text NOT NULL,
	`duration_weeks` integer NOT NULL,
	`days_per_week` integer NOT NULL,
	`minutes_per_session` integer NOT NULL,
	`content_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_programs_user_created` ON `programs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `weekly_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`week_start` text NOT NULL,
	`content_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_weekly_reviews_user_week` ON `weekly_reviews` (`user_id`,`week_start`);--> statement-breakpoint
PRAGMA optimize;
