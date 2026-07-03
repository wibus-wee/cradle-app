CREATE TABLE `remote_runtime_hosts` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`ssh_target` text NOT NULL,
	`remote_socket_path` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_daemon_host_id` text,
	`last_daemon_version` text,
	`last_platform` text,
	`last_arch` text,
	`last_seen_at` integer,
	`connection_config_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `remote_runtime_hosts_ssh_target_idx` ON `remote_runtime_hosts` (`ssh_target`);
--> statement-breakpoint
CREATE INDEX `remote_runtime_hosts_enabled_idx` ON `remote_runtime_hosts` (`enabled`);
--> statement-breakpoint
CREATE TABLE `remote_runtime_session_links` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_session_id` text NOT NULL,
	`remote_host_id` text NOT NULL,
	`remote_agent_id` text NOT NULL,
	`remote_runtime_kind` text NOT NULL,
	`daemon_host_id` text,
	`provider_session_id` text,
	`state_snapshot_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`chat_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`remote_host_id`) REFERENCES `remote_runtime_hosts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `remote_runtime_session_links_chat_session_id_unique` ON `remote_runtime_session_links` (`chat_session_id`);
--> statement-breakpoint
CREATE INDEX `remote_runtime_session_links_host_idx` ON `remote_runtime_session_links` (`remote_host_id`);
--> statement-breakpoint
CREATE INDEX `remote_runtime_session_links_agent_idx` ON `remote_runtime_session_links` (`remote_agent_id`);
