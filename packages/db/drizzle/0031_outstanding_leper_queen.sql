CREATE TABLE `session_environment_notes` (
	`session_id` text PRIMARY KEY NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session_pinned_messages` (
	`session_id` text NOT NULL,
	`message_id` text NOT NULL,
	`label` text,
	`done` integer DEFAULT 0 NOT NULL,
	`pinned_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`session_id`, `message_id`),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_pinned_messages_session_idx` ON `session_pinned_messages` (`session_id`,`pinned_at`);--> statement-breakpoint
CREATE TABLE `session_text_markers` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`message_id` text NOT NULL,
	`start_offset` integer NOT NULL,
	`end_offset` integer NOT NULL,
	`selected_text` text NOT NULL,
	`style` text NOT NULL,
	`color` text NOT NULL,
	`label` text,
	`done` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_text_markers_session_idx` ON `session_text_markers` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `session_text_markers_message_range_idx` ON `session_text_markers` (`message_id`,`start_offset`,`end_offset`);--> statement-breakpoint
CREATE TABLE `thread_handoffs` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`source_session_id` text NOT NULL,
	`destination_session_id` text NOT NULL,
	`source_provider_target_id` text,
	`destination_provider_target_id` text NOT NULL,
	`imported_message_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`destination_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_provider_target_id`) REFERENCES `provider_targets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`destination_provider_target_id`) REFERENCES `provider_targets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `thread_handoffs_request_unique` ON `thread_handoffs` (`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `thread_handoffs_destination_unique` ON `thread_handoffs` (`destination_session_id`);--> statement-breakpoint
CREATE INDEX `thread_handoffs_source_idx` ON `thread_handoffs` (`source_session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `turn_checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`run_id` text NOT NULL,
	`assistant_message_id` text,
	`workspace_id` text,
	`workspace_path` text NOT NULL,
	`start_ref` text NOT NULL,
	`end_ref` text,
	`status` text DEFAULT 'capturing' NOT NULL,
	`changed_files` integer DEFAULT 0 NOT NULL,
	`additions` integer DEFAULT 0 NOT NULL,
	`deletions` integer DEFAULT 0 NOT NULL,
	`error_text` text,
	`completed_at` integer,
	`restored_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `turn_checkpoints_session_run_unique` ON `turn_checkpoints` (`session_id`,`run_id`);--> statement-breakpoint
CREATE INDEX `turn_checkpoints_session_created_idx` ON `turn_checkpoints` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `turn_checkpoints_session_status_idx` ON `turn_checkpoints` (`session_id`,`status`);