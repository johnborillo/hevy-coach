CREATE TABLE `exercise_slots` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`primary_muscle` text NOT NULL,
	`pattern` text
);
--> statement-breakpoint
CREATE INDEX `idx_exercise_slots_user_name` ON `exercise_slots` (`user_id`,`name`);