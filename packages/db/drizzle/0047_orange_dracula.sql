CREATE TABLE `recall_file_touches` (
	`id` text PRIMARY KEY NOT NULL,
	`tool_event_id` text NOT NULL,
	`session_id` text NOT NULL,
	`workspace_id` text,
	`path` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`tool_event_id`) REFERENCES `recall_tool_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recall_file_touches_tool_event_path_unique` ON `recall_file_touches` (`tool_event_id`,`path`);--> statement-breakpoint
CREATE INDEX `recall_file_touches_workspace_path_occurred_at_idx` ON `recall_file_touches` (`workspace_id`,`path`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `recall_file_touches_session_path_occurred_at_idx` ON `recall_file_touches` (`session_id`,`path`,`occurred_at`);