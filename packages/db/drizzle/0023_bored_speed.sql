CREATE TABLE `plugin_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`location` text NOT NULL,
	`ref` text,
	`sub_path` text,
	`label` text,
	`added_reason` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `plugin_sources_kind_location_idx` ON `plugin_sources` (`kind`,`location`);