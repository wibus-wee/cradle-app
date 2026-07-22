CREATE TABLE `recall_attunements` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`session_id` text NOT NULL,
	`content` text NOT NULL,
	`evidence_ids_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`archived_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recall_attunements_workspace_updated_at_idx` ON `recall_attunements` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `recall_attunements_session_id_idx` ON `recall_attunements` (`session_id`);--> statement-breakpoint
CREATE INDEX `recall_attunements_status_idx` ON `recall_attunements` (`workspace_id`,`status`);