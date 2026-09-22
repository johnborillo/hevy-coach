CREATE TABLE `body_weights` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`measured_at` text NOT NULL,
	`weight_kg` real NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_body_weights_user_date` ON `body_weights` (`user_id`,`measured_at`);--> statement-breakpoint
CREATE TABLE `training_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text,
	`program_id` text
);
--> statement-breakpoint
CREATE INDEX `idx_training_blocks_user_start` ON `training_blocks` (`user_id`,`starts_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_athlete_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`display_name` text DEFAULT 'Athlete' NOT NULL,
	`biological_sex` text DEFAULT 'prefer_not_to_say' NOT NULL,
	`age` integer,
	`height_cm` integer,
	`weight_kg` real,
	`weight_unit` text DEFAULT 'lb' NOT NULL,
	`height_unit` text DEFAULT 'imperial' NOT NULL,
	`experience` text DEFAULT 'intermediate' NOT NULL,
	`primary_goal` text DEFAULT 'Build muscle and strength' NOT NULL,
	`target_date` text,
	`days_per_week` integer DEFAULT 4 NOT NULL,
	`minutes_per_session` integer DEFAULT 60 NOT NULL,
	`equipment` text DEFAULT 'Full gym' NOT NULL,
	`limitations` text DEFAULT '' NOT NULL,
	`preferences` text DEFAULT '' NOT NULL,
	`phase` text DEFAULT 'maintain' NOT NULL,
	`phase_started_at` text,
	`daily_calories` integer,
	`protein_grams` integer,
	`sleep_hours_typical` real,
	`dropset_weight` real DEFAULT 0.5 NOT NULL,
	`load_increments_json` text DEFAULT '{"barbell":2.5,"dumbbell":2,"machine":5,"cable":2.5}' NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_athlete_profiles`("user_id", "display_name", "biological_sex", "age", "height_cm", "weight_kg", "weight_unit", "height_unit", "experience", "primary_goal", "target_date", "days_per_week", "minutes_per_session", "equipment", "limitations", "preferences", "phase", "phase_started_at", "daily_calories", "protein_grams", "sleep_hours_typical", "dropset_weight", "load_increments_json", "timezone", "updated_at") SELECT "user_id", "display_name", "biological_sex", "age", "height_cm", "weight_kg", "weight_unit", "height_unit", "experience", "primary_goal", "target_date", "days_per_week", "minutes_per_session", "equipment", "limitations", "preferences", 'maintain', NULL, NULL, NULL, NULL, 0.5, '{"barbell":2.5,"dumbbell":2,"machine":5,"cable":2.5}', 'UTC', "updated_at" FROM `athlete_profiles`;--> statement-breakpoint
DROP TABLE `athlete_profiles`;--> statement-breakpoint
ALTER TABLE `__new_athlete_profiles` RENAME TO `athlete_profiles`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
