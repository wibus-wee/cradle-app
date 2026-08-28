CREATE TABLE `chat_runtime_auth_recoveries` (
	`queue_item_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`run_id` text,
	`provider_target_id` text,
	`runtime_kind` text NOT NULL,
	`provider` text NOT NULL,
	`methods_json` text NOT NULL,
	`configuration_namespace` text NOT NULL,
	`configuration_resource_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`retry_queue_item_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`queue_item_id`) REFERENCES `chat_session_queue_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_target_id`) REFERENCES `provider_targets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`retry_queue_item_id`) REFERENCES `chat_session_queue_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chat_runtime_auth_recoveries_session_status_idx` ON `chat_runtime_auth_recoveries` (`session_id`,`status`);--> statement-breakpoint
ALTER TABLE `acp_agents` ADD `connection_type` text DEFAULT 'stdio' NOT NULL;--> statement-breakpoint
ALTER TABLE `acp_agents` ADD `endpoint_url` text;--> statement-breakpoint
ALTER TABLE `acp_agents` ADD `remote_headers_secret_refs_json` text DEFAULT '{}' NOT NULL;
