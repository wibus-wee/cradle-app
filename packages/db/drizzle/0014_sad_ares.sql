ALTER TABLE `remote_runtime_session_links` RENAME TO `remote_host_agentd_session_links`;--> statement-breakpoint
ALTER TABLE `remote_runtime_hosts` RENAME TO `remote_hosts`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_remote_host_agentd_session_links` (
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
	FOREIGN KEY (`remote_host_id`) REFERENCES `remote_hosts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_remote_host_agentd_session_links`("id", "chat_session_id", "remote_host_id", "remote_agent_id", "remote_runtime_kind", "daemon_host_id", "provider_session_id", "state_snapshot_json", "created_at", "updated_at") SELECT "id", "chat_session_id", "remote_host_id", "remote_agent_id", "remote_runtime_kind", "daemon_host_id", "provider_session_id", "state_snapshot_json", "created_at", "updated_at" FROM `remote_host_agentd_session_links`;--> statement-breakpoint
DROP TABLE `remote_host_agentd_session_links`;--> statement-breakpoint
ALTER TABLE `__new_remote_host_agentd_session_links` RENAME TO `remote_host_agentd_session_links`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `remote_host_agentd_session_links_chat_session_id_unique` ON `remote_host_agentd_session_links` (`chat_session_id`);--> statement-breakpoint
CREATE INDEX `remote_host_agentd_session_links_host_idx` ON `remote_host_agentd_session_links` (`remote_host_id`);--> statement-breakpoint
CREATE INDEX `remote_host_agentd_session_links_agent_idx` ON `remote_host_agentd_session_links` (`remote_agent_id`);--> statement-breakpoint
DROP INDEX `remote_runtime_hosts_ssh_target_idx`;--> statement-breakpoint
DROP INDEX `remote_runtime_hosts_enabled_idx`;--> statement-breakpoint
ALTER TABLE `remote_hosts` ADD `capabilities_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
UPDATE `remote_hosts`
SET `capabilities_json` = json_object(
	'agentd',
	json_object(
		'enabled', 1,
		'remoteSocketPath', `remote_socket_path`,
		'lastDaemonHostId', `last_daemon_host_id`,
		'lastDaemonVersion', `last_daemon_version`,
		'lastPlatform', `last_platform`,
		'lastArch', `last_arch`
	),
	'cradleServer',
	json_object(
		'enabled', 0,
		'remoteHost', '127.0.0.1',
		'remotePort', 21423
	)
);--> statement-breakpoint
CREATE INDEX `remote_hosts_enabled_idx` ON `remote_hosts` (`enabled`);--> statement-breakpoint
ALTER TABLE `remote_hosts` DROP COLUMN `ssh_target`;--> statement-breakpoint
ALTER TABLE `remote_hosts` DROP COLUMN `remote_socket_path`;--> statement-breakpoint
ALTER TABLE `remote_hosts` DROP COLUMN `last_daemon_host_id`;--> statement-breakpoint
ALTER TABLE `remote_hosts` DROP COLUMN `last_daemon_version`;--> statement-breakpoint
ALTER TABLE `remote_hosts` DROP COLUMN `last_platform`;--> statement-breakpoint
ALTER TABLE `remote_hosts` DROP COLUMN `last_arch`;
