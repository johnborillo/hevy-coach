CREATE TABLE `muscle_overrides` (
	`user_id` text NOT NULL,
	`exercise_template_id` text NOT NULL,
	`primary_muscle` text NOT NULL,
	`secondary_muscles_json` text DEFAULT '[]' NOT NULL,
	`slot_id` text,
	`counts_as` real DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `exercise_template_id`)
);
