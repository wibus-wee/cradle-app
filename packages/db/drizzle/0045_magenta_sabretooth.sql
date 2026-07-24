CREATE TABLE `recall_messages` (
	`message_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`workspace_id` text,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`is_sidechain` integer DEFAULT 0 NOT NULL,
	`is_meta` integer DEFAULT 0 NOT NULL,
	`excerpt` text NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recall_messages_session_occurred_at_idx` ON `recall_messages` (`session_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `recall_messages_workspace_occurred_at_idx` ON `recall_messages` (`workspace_id`,`occurred_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `recall_messages_message_id_unique` ON `recall_messages` (`message_id`);--> statement-breakpoint
CREATE TABLE `recall_runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`workspace_id` text,
	`status` text NOT NULL,
	`stop_reason` text,
	`error_text` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `backend_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recall_runs_session_started_at_idx` ON `recall_runs` (`session_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `recall_runs_workspace_started_at_idx` ON `recall_runs` (`workspace_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `recall_runs_status_idx` ON `recall_runs` (`workspace_id`,`status`,`started_at`);--> statement-breakpoint
CREATE TABLE `recall_tool_events` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`session_id` text NOT NULL,
	`workspace_id` text,
	`source_event_id` text NOT NULL,
	`tool_call_id` text,
	`tool_name` text,
	`phase` text NOT NULL,
	`is_failure` integer DEFAULT 0 NOT NULL,
	`summary` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `backend_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recall_tool_events_source_event_unique` ON `recall_tool_events` (`source_event_id`);--> statement-breakpoint
CREATE INDEX `recall_tool_events_session_occurred_at_idx` ON `recall_tool_events` (`session_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `recall_tool_events_workspace_occurred_at_idx` ON `recall_tool_events` (`workspace_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `recall_tool_events_failure_idx` ON `recall_tool_events` (`workspace_id`,`is_failure`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `recall_tool_events_tool_name_idx` ON `recall_tool_events` (`workspace_id`,`tool_name`,`occurred_at`);
--> statement-breakpoint
CREATE VIRTUAL TABLE `recall_messages_fts` USING fts5(
	`message_id` UNINDEXED,
	`workspace_id` UNINDEXED,
	`session_id` UNINDEXED,
	`excerpt`
);
--> statement-breakpoint
CREATE TRIGGER `recall_messages_fts_insert` AFTER INSERT ON `recall_messages` BEGIN
	INSERT INTO `recall_messages_fts` (`message_id`, `workspace_id`, `session_id`, `excerpt`)
	VALUES (new.`message_id`, new.`workspace_id`, new.`session_id`, new.`excerpt`);
END;
--> statement-breakpoint
CREATE TRIGGER `recall_messages_fts_update` AFTER UPDATE ON `recall_messages` BEGIN
	DELETE FROM `recall_messages_fts` WHERE `message_id` = old.`message_id`;
	INSERT INTO `recall_messages_fts` (`message_id`, `workspace_id`, `session_id`, `excerpt`)
	VALUES (new.`message_id`, new.`workspace_id`, new.`session_id`, new.`excerpt`);
END;
--> statement-breakpoint
CREATE TRIGGER `recall_messages_fts_delete` AFTER DELETE ON `recall_messages` BEGIN
	DELETE FROM `recall_messages_fts` WHERE `message_id` = old.`message_id`;
END;
