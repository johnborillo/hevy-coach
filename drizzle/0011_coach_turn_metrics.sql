CREATE TABLE `coach_turn_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`message_id` text,
	`created_at` text NOT NULL,
	`feature` text NOT NULL,
	`question_kind` text NOT NULL,
	`requested_model` text NOT NULL,
	`served_model` text,
	`outcome` text NOT NULL,
	`passes` integer NOT NULL,
	`requests` integer NOT NULL,
	`history_messages` integer NOT NULL,
	`estimated_prompt_tokens` integer,
	`prompt_tokens` integer,
	`first_pass_prompt_tokens` integer,
	`cached_tokens` integer,
	`completion_tokens` integer,
	`reasoning_tokens` integer,
	`cost` real,
	`total_ms` integer,
	`sections_json` text NOT NULL,
	`completions_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_coach_turn_metrics_user_created` ON `coach_turn_metrics` (`user_id`,`created_at`);