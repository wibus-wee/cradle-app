CREATE TABLE `relay_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`relay_url` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `relay_servers_default_idx` ON `relay_servers` (`is_default`);--> statement-breakpoint
CREATE INDEX `relay_servers_enabled_idx` ON `relay_servers` (`enabled`);