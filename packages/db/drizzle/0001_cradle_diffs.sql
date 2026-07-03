CREATE TABLE `diff_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`source_id` text,
	`repository_path` text NOT NULL,
	`source_kind` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`review_state` text DEFAULT 'unreviewed' NOT NULL,
	`current_revision_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diff_reviews_workspace_id_idx` ON `diff_reviews` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `diff_reviews_source_id_idx` ON `diff_reviews` (`source_id`);--> statement-breakpoint
CREATE INDEX `diff_reviews_current_revision_id_idx` ON `diff_reviews` (`current_revision_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `diff_reviews_source_unique` ON `diff_reviews` (`source_id`);--> statement-breakpoint
CREATE TABLE `diff_review_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`owner_namespace` text DEFAULT 'diff-review' NOT NULL,
	`binding_json` text DEFAULT '{}' NOT NULL,
	`refresh_policy` text DEFAULT 'manual' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diff_review_sources_workspace_id_idx` ON `diff_review_sources` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `diff_review_sources_kind_idx` ON `diff_review_sources` (`kind`);--> statement-breakpoint
CREATE TABLE `diff_review_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`source_version` text NOT NULL,
	`patch_hash` text NOT NULL,
	`file_count` integer DEFAULT 0 NOT NULL,
	`additions` integer DEFAULT 0 NOT NULL,
	`deletions` integer DEFAULT 0 NOT NULL,
	`patch` text NOT NULL,
	`generated_at` integer NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `diff_reviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diff_review_revisions_review_id_idx` ON `diff_review_revisions` (`review_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `diff_review_revisions_review_patch_unique` ON `diff_review_revisions` (`review_id`,`patch_hash`);--> statement-breakpoint
CREATE TABLE `diff_review_files` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`path` text NOT NULL,
	`previous_path` text,
	`status` text NOT NULL,
	`additions` integer DEFAULT 0 NOT NULL,
	`deletions` integer DEFAULT 0 NOT NULL,
	`is_generated` integer DEFAULT false NOT NULL,
	`is_binary` integer DEFAULT false NOT NULL,
	`is_viewed` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `diff_review_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diff_review_files_revision_id_idx` ON `diff_review_files` (`revision_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `diff_review_files_revision_path_unique` ON `diff_review_files` (`revision_id`,`path`);--> statement-breakpoint
CREATE TABLE `diff_review_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`original_revision_id` text NOT NULL,
	`current_revision_id` text,
	`file_id` text,
	`anchor_json` text,
	`state` text DEFAULT 'open' NOT NULL,
	`created_by` text NOT NULL,
	`resolved_by` text,
	`resolved_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `diff_reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`original_revision_id`) REFERENCES `diff_review_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`current_revision_id`) REFERENCES `diff_review_revisions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`file_id`) REFERENCES `diff_review_files`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `diff_review_threads_review_id_idx` ON `diff_review_threads` (`review_id`);--> statement-breakpoint
CREATE INDEX `diff_review_threads_state_idx` ON `diff_review_threads` (`state`);--> statement-breakpoint
CREATE INDEX `diff_review_threads_current_revision_id_idx` ON `diff_review_threads` (`current_revision_id`);--> statement-breakpoint
CREATE TABLE `diff_review_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`author_kind` text DEFAULT 'user' NOT NULL,
	`author_id` text NOT NULL,
	`body_markdown` text NOT NULL,
	`external_url` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `diff_review_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diff_review_comments_thread_id_idx` ON `diff_review_comments` (`thread_id`);--> statement-breakpoint
CREATE TABLE `diff_review_thread_reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`user_id` text NOT NULL,
	`reaction` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `diff_review_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diff_review_thread_reactions_thread_id_idx` ON `diff_review_thread_reactions` (`thread_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `diff_review_thread_reactions_unique` ON `diff_review_thread_reactions` (`thread_id`,`user_id`,`reaction`);--> statement-breakpoint
CREATE TABLE `diff_review_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`decision` text NOT NULL,
	`body_markdown` text,
	`submitted_at` integer NOT NULL,
	`source_sync_state` text DEFAULT 'local-only' NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `diff_reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`revision_id`) REFERENCES `diff_review_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diff_review_submissions_review_id_idx` ON `diff_review_submissions` (`review_id`);--> statement-breakpoint
CREATE INDEX `diff_review_submissions_revision_id_idx` ON `diff_review_submissions` (`revision_id`);--> statement-breakpoint
CREATE TABLE `diff_review_file_view_state` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`file_id` text NOT NULL,
	`user_id` text NOT NULL,
	`viewed` integer DEFAULT true NOT NULL,
	`viewed_at` integer NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `diff_reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`revision_id`) REFERENCES `diff_review_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `diff_review_files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diff_review_file_view_state_review_id_idx` ON `diff_review_file_view_state` (`review_id`);--> statement-breakpoint
CREATE INDEX `diff_review_file_view_state_revision_id_idx` ON `diff_review_file_view_state` (`revision_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `diff_review_file_view_state_file_user_unique` ON `diff_review_file_view_state` (`review_id`,`revision_id`,`file_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `diff_review_agent_fixes` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`thread_id` text,
	`anchor_json` text,
	`instruction` text NOT NULL,
	`profile_id` text,
	`expected_output` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`session_id` text,
	`run_id` text,
	`artifact_id` text,
	`result_revision_id` text,
	`error_message` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `diff_reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `diff_review_threads`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`result_revision_id`) REFERENCES `diff_review_revisions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `diff_review_agent_fixes_review_id_idx` ON `diff_review_agent_fixes` (`review_id`);--> statement-breakpoint
CREATE INDEX `diff_review_agent_fixes_thread_id_idx` ON `diff_review_agent_fixes` (`thread_id`);--> statement-breakpoint
CREATE INDEX `diff_review_agent_fixes_result_revision_id_idx` ON `diff_review_agent_fixes` (`result_revision_id`);--> statement-breakpoint
CREATE INDEX `diff_review_agent_fixes_status_idx` ON `diff_review_agent_fixes` (`status`);--> statement-breakpoint
CREATE TABLE `diff_review_source_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text,
	`review_id` text NOT NULL,
	`operation_kind` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`request_json` text DEFAULT '{}' NOT NULL,
	`response_json` text,
	`error_message` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `diff_review_sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`review_id`) REFERENCES `diff_reviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diff_review_source_operations_review_id_idx` ON `diff_review_source_operations` (`review_id`);--> statement-breakpoint
CREATE INDEX `diff_review_source_operations_source_id_idx` ON `diff_review_source_operations` (`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `diff_review_source_operations_idempotency_unique` ON `diff_review_source_operations` (`source_id`,`operation_kind`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `diff_review_source_readiness_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`source_kind` text NOT NULL,
	`state` text NOT NULL,
	`actions_json` text DEFAULT '[]' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diff_review_source_readiness_workspace_id_idx` ON `diff_review_source_readiness_cache` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `diff_review_source_readiness_kind_unique` ON `diff_review_source_readiness_cache` (`workspace_id`,`source_kind`);--> statement-breakpoint
CREATE TABLE `diff_review_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`diff_style` text DEFAULT 'split' NOT NULL,
	`code_theme` text DEFAULT 'system' NOT NULL,
	`font_size` integer DEFAULT 11 NOT NULL,
	`line_height` integer DEFAULT 18 NOT NULL,
	`hide_whitespace_only` integer DEFAULT false NOT NULL,
	`structural_highlighting` integer DEFAULT false NOT NULL,
	`collapse_generated_files` integer DEFAULT false NOT NULL,
	`notification_mode` text DEFAULT 'reviews-and-comments' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diff_review_preferences_workspace_id_idx` ON `diff_review_preferences` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `diff_review_preferences_workspace_user_unique` ON `diff_review_preferences` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `diff_review_events` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`event_kind` text NOT NULL,
	`actor_kind` text DEFAULT 'system' NOT NULL,
	`actor_id` text,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `diff_reviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diff_review_events_review_id_idx` ON `diff_review_events` (`review_id`);--> statement-breakpoint
CREATE INDEX `diff_review_events_created_at_idx` ON `diff_review_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `diff_review_commit_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`strategy` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`groups_json` text NOT NULL,
	`rationale` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `diff_reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`revision_id`) REFERENCES `diff_review_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diff_review_commit_plans_review_id_idx` ON `diff_review_commit_plans` (`review_id`);--> statement-breakpoint
CREATE INDEX `diff_review_commit_plans_revision_id_idx` ON `diff_review_commit_plans` (`revision_id`);--> statement-breakpoint
CREATE INDEX `diff_review_commit_plans_created_at_idx` ON `diff_review_commit_plans` (`created_at`);
