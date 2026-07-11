CREATE TABLE `background_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`owner_namespace` text NOT NULL,
	`owner_resource_type` text NOT NULL,
	`owner_resource_id` text NOT NULL,
	`owner_resource_key` text,
	`kind` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`source_kind` text NOT NULL,
	`source_session_id` text,
	`source_run_id` text,
	`attempts` integer DEFAULT 1 NOT NULL,
	`max_attempts` integer DEFAULT 1 NOT NULL,
	`context_json` text DEFAULT '{}' NOT NULL,
	`progress_json` text,
	`result_json` text,
	`error_code` text,
	`error_message` text,
	`error_details_json` text,
	`cancel_requested_at` integer,
	`started_at` integer,
	`finished_at` integer,
	`projected_at` integer,
	`projection_attempts` integer DEFAULT 0 NOT NULL,
	`projection_error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `background_jobs_workspace_id_idx` ON `background_jobs` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `background_jobs_status_idx` ON `background_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `background_jobs_owner_idx` ON `background_jobs` (`owner_namespace`,`owner_resource_type`,`owner_resource_id`);--> statement-breakpoint
CREATE INDEX `background_jobs_owner_kind_idx` ON `background_jobs` (`owner_namespace`,`kind`,`owner_resource_id`);--> statement-breakpoint
CREATE INDEX `background_jobs_source_idx` ON `background_jobs` (`source_kind`,`source_run_id`);--> statement-breakpoint
CREATE INDEX `background_jobs_projection_idx` ON `background_jobs` (`status`,`projected_at`);--> statement-breakpoint
ALTER TABLE `diff_review_commit_plans` ADD `agent_fix_id` text REFERENCES diff_review_agent_fixes(id);--> statement-breakpoint
CREATE UNIQUE INDEX `diff_review_commit_plans_agent_fix_id_unique` ON `diff_review_commit_plans` (`agent_fix_id`);