CREATE TABLE `fabric_membership` (
	`fabric_id` text PRIMARY KEY NOT NULL,
	`relay_url` text NOT NULL,
	`local_node_id` text NOT NULL,
	`role` text NOT NULL,
	`owner_key_secret_id` text,
	`identity_key_secret_id` text NOT NULL,
	`encryption_key_secret_id` text NOT NULL,
	`certificate_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `node_session_links` (
	`local_session_id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`remote_session_id` text NOT NULL,
	`remote_workspace_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`local_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `node_session_links_node_id_idx` ON `node_session_links` (`node_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `node_session_links_node_remote_session_unique` ON `node_session_links` (`node_id`,`remote_session_id`);