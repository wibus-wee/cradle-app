CREATE TABLE `remote_session_links` (
	`local_session_id` text PRIMARY KEY NOT NULL,
	`host_id` text NOT NULL,
	`remote_session_id` text NOT NULL,
	`remote_workspace_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`local_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `remote_hosts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `remote_session_links_host_id_idx` ON `remote_session_links` (`host_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `remote_session_links_host_remote_session_unique` ON `remote_session_links` (`host_id`,`remote_session_id`);