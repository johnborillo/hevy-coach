CREATE TABLE `dashboard_snapshots` (
	`user_id` text PRIMARY KEY NOT NULL,
	`content_json` text NOT NULL,
	`derived_at` text NOT NULL,
	`version` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `derivation_state` (
	`user_id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`derived_at` text NOT NULL,
	`version` integer NOT NULL
);
