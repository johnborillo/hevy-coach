CREATE TABLE `personal_records` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`template_id` text NOT NULL,
	`slot_id` text,
	`kind` text NOT NULL,
	`rep_bucket` text,
	`value` real NOT NULL,
	`reps` integer NOT NULL,
	`load_kg` real NOT NULL,
	`performed_at` text NOT NULL,
	`workout_id` text NOT NULL,
	`previous_value` real,
	`previous_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_personal_records_user_date` ON `personal_records` (`user_id`,`performed_at`);--> statement-breakpoint
CREATE INDEX `idx_personal_records_user_key` ON `personal_records` (`user_id`,`key`);