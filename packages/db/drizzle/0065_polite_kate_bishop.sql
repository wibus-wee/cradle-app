ALTER TABLE `acp_agents` ADD `auth_method_id` text;--> statement-breakpoint
ALTER TABLE `acp_agents` ADD `auth_secret_refs_json` text DEFAULT '{}' NOT NULL;