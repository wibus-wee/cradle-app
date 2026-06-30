CREATE TABLE `conversation_bridge_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`adapter_owner` text NOT NULL,
	`adapter_id` text NOT NULL,
	`display_name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`secret_refs_json` text DEFAULT '{}' NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`health_status` text DEFAULT 'unknown' NOT NULL,
	`health_message` text,
	`last_started_at` integer,
	`last_stopped_at` integer,
	`last_error_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `conversation_bridge_connections_platform_idx` ON `conversation_bridge_connections` (`platform`);--> statement-breakpoint
CREATE INDEX `conversation_bridge_connections_adapter_idx` ON `conversation_bridge_connections` (`adapter_owner`,`adapter_id`);--> statement-breakpoint
CREATE INDEX `conversation_bridge_connections_enabled_idx` ON `conversation_bridge_connections` (`enabled`);--> statement-breakpoint
CREATE TABLE `conversation_bridge_channel_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`external_workspace_id` text NOT NULL,
	`external_channel_id` text NOT NULL,
	`cradle_workspace_id` text NOT NULL,
	`session_agent_id` text,
	`session_provider_target_id` text,
	`session_runtime_kind` text,
	`session_model_id` text,
	`bound_by_external_actor_id` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `conversation_bridge_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cradle_workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`session_provider_target_id`) REFERENCES `provider_targets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_bridge_channel_bindings_connection_channel_unique` ON `conversation_bridge_channel_bindings` (`connection_id`,`external_workspace_id`,`external_channel_id`);--> statement-breakpoint
CREATE INDEX `conversation_bridge_channel_bindings_workspace_idx` ON `conversation_bridge_channel_bindings` (`cradle_workspace_id`);--> statement-breakpoint
CREATE TABLE `conversation_bridge_thread_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`external_workspace_id` text NOT NULL,
	`external_channel_id` text NOT NULL,
	`external_thread_id` text NOT NULL,
	`session_id` text NOT NULL,
	`cradle_workspace_id` text,
	`created_by_external_actor_id` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `conversation_bridge_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cradle_workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_bridge_thread_bindings_connection_thread_unique` ON `conversation_bridge_thread_bindings` (`connection_id`,`external_workspace_id`,`external_channel_id`,`external_thread_id`);--> statement-breakpoint
CREATE INDEX `conversation_bridge_thread_bindings_session_idx` ON `conversation_bridge_thread_bindings` (`session_id`);--> statement-breakpoint
CREATE INDEX `conversation_bridge_thread_bindings_channel_idx` ON `conversation_bridge_thread_bindings` (`connection_id`,`external_workspace_id`,`external_channel_id`);--> statement-breakpoint
CREATE TABLE `conversation_bridge_inbound_events` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`external_event_id` text NOT NULL,
	`external_workspace_id` text,
	`external_channel_id` text,
	`external_thread_id` text,
	`external_message_id` text,
	`event_type` text NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`reason` text,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`received_at` integer NOT NULL,
	`processed_at` integer,
	FOREIGN KEY (`connection_id`) REFERENCES `conversation_bridge_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_bridge_inbound_events_connection_event_unique` ON `conversation_bridge_inbound_events` (`connection_id`,`external_event_id`);--> statement-breakpoint
CREATE INDEX `conversation_bridge_inbound_events_status_idx` ON `conversation_bridge_inbound_events` (`status`);--> statement-breakpoint
CREATE INDEX `conversation_bridge_inbound_events_thread_idx` ON `conversation_bridge_inbound_events` (`connection_id`,`external_workspace_id`,`external_channel_id`,`external_thread_id`);--> statement-breakpoint
CREATE TABLE `conversation_bridge_delivery_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`external_workspace_id` text NOT NULL,
	`external_channel_id` text NOT NULL,
	`external_thread_id` text NOT NULL,
	`session_id` text NOT NULL,
	`cradle_message_id` text,
	`run_id` text,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`external_message_id` text,
	`error_text` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `conversation_bridge_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `conversation_bridge_delivery_attempts_status_idx` ON `conversation_bridge_delivery_attempts` (`status`);--> statement-breakpoint
CREATE INDEX `conversation_bridge_delivery_attempts_thread_idx` ON `conversation_bridge_delivery_attempts` (`connection_id`,`external_workspace_id`,`external_channel_id`,`external_thread_id`);--> statement-breakpoint
CREATE INDEX `conversation_bridge_delivery_attempts_session_idx` ON `conversation_bridge_delivery_attempts` (`session_id`);--> statement-breakpoint
CREATE TABLE `conversation_bridge_connection_secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`name` text NOT NULL,
	`secret_ref` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `conversation_bridge_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`secret_ref`) REFERENCES `agent_credentials`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_bridge_connection_secrets_connection_name_unique` ON `conversation_bridge_connection_secrets` (`connection_id`,`name`);--> statement-breakpoint
CREATE INDEX `conversation_bridge_connection_secrets_secret_idx` ON `conversation_bridge_connection_secrets` (`secret_ref`);
