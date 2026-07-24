CREATE TABLE `recall_attunement_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`session_id` text NOT NULL,
	`operation` text NOT NULL,
	`content` text,
	`evidence_ids_json` text DEFAULT '[]' NOT NULL,
	`attunement_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`resolved_at` integer,
	`executed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attunement_id`) REFERENCES `recall_attunements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recall_attunement_requests_session_status_idx` ON `recall_attunement_requests` (`session_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `recall_attunement_requests_workspace_status_idx` ON `recall_attunement_requests` (`workspace_id`,`status`,`updated_at`);