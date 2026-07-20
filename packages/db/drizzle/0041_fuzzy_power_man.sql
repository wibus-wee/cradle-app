ALTER TABLE `acp_agents` ADD `source` text DEFAULT 'registry' NOT NULL;--> statement-breakpoint
ALTER TABLE `acp_agents` ADD `override_cmd` text;--> statement-breakpoint
ALTER TABLE `acp_agents` ADD `override_args` text;--> statement-breakpoint
ALTER TABLE `acp_agents` ADD `override_env` text;