CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`filename` text NOT NULL,
	`media_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`sha256` text NOT NULL,
	`storage_path` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assets_workspace_id_idx` ON `assets` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `assets_sha256_idx` ON `assets` (`sha256`);