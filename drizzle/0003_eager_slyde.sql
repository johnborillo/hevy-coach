CREATE TABLE `hevy_sets` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`workout_id` text NOT NULL,
	`exercise_template_id` text NOT NULL,
	`exercise_title` text NOT NULL,
	`exercise_index` integer NOT NULL,
	`set_index` integer NOT NULL,
	`set_type` text DEFAULT 'normal' NOT NULL,
	`weight_kg` real,
	`reps` integer,
	`rpe` real,
	`duration_seconds` integer,
	`distance_meters` real,
	`exercise_notes` text,
	`performed_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_hevy_sets_user_performed` ON `hevy_sets` (`user_id`,`performed_at`);--> statement-breakpoint
CREATE INDEX `idx_hevy_sets_user_exercise_performed` ON `hevy_sets` (`user_id`,`exercise_template_id`,`performed_at`);--> statement-breakpoint
CREATE INDEX `idx_hevy_sets_user_workout` ON `hevy_sets` (`user_id`,`workout_id`);--> statement-breakpoint
CREATE TABLE `hevy_sync_state` (
	`user_id` text PRIMARY KEY NOT NULL,
	`last_event_since` text,
	`full_sync_next_page` integer DEFAULT 1 NOT NULL,
	`full_sync_page_count` integer,
	`full_sync_completed_at` text,
	`templates_synced_at` text,
	`last_sync_at` text,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `hevy_templates` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`title` text NOT NULL,
	`primary_muscle` text,
	`secondary_muscles_json` text DEFAULT '[]' NOT NULL,
	`equipment` text,
	`is_custom` integer DEFAULT 0 NOT NULL,
	`synced_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_hevy_templates_user_title` ON `hevy_templates` (`user_id`,`title`);--> statement-breakpoint
CREATE TABLE `hevy_workouts` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`title` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`description` text,
	`source_updated_at` text,
	`raw_json` text NOT NULL,
	`deleted` integer DEFAULT 0 NOT NULL,
	`synced_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_hevy_workouts_user_start` ON `hevy_workouts` (`user_id`,`start_time`);