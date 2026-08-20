CREATE TABLE `node_work_links` (
	`local_work_id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`remote_work_id` text NOT NULL,
	`remote_workspace_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`local_work_id`) REFERENCES `works`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `node_work_links_node_id_idx` ON `node_work_links` (`node_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `node_work_links_node_remote_work_unique` ON `node_work_links` (`node_id`,`remote_work_id`);
