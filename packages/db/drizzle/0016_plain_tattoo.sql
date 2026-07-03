CREATE TABLE `composer_drafts` (
	`surface_id` text PRIMARY KEY NOT NULL,
	`draft_json` text DEFAULT '{}' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `composer_drafts_updated_at_idx` ON `composer_drafts` (`updated_at`);--> statement-breakpoint
CREATE INDEX `composer_drafts_deleted_at_idx` ON `composer_drafts` (`deleted_at`);