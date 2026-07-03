CREATE TABLE `plugin_activation_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`plugin_name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`reason` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plugin_activation_policies_plugin_unique` ON `plugin_activation_policies` (`plugin_name`);