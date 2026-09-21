CREATE TABLE `progression_states` (
	`user_id` text NOT NULL,
	`slot_or_template_id` text NOT NULL,
	`computed_at` text NOT NULL,
	`analysis_version` integer NOT NULL,
	`state_json` text NOT NULL,
	PRIMARY KEY(`user_id`, `slot_or_template_id`)
);
