CREATE TABLE `acp_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`distribution_type` text NOT NULL,
	`install_path` text,
	`cmd` text,
	`args` text DEFAULT '[]' NOT NULL,
	`env` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'installing' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `acp_audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` text NOT NULL,
	`action` text NOT NULL,
	`path` text,
	`details` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_session_id` text NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`signal` text,
	`signal_metadata` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`agent_session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_activities_agent_session_id_idx` ON `agent_activities` (`agent_session_id`);--> statement-breakpoint
CREATE TABLE `agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`provider_target_id` text NOT NULL,
	`agent_id` text,
	`chat_session_id` text,
	`status` text DEFAULT 'created' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_target_id`) REFERENCES `provider_targets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`chat_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `agent_sessions_issue_id_idx` ON `agent_sessions` (`issue_id`);--> statement-breakpoint
CREATE INDEX `agent_sessions_provider_target_id_idx` ON `agent_sessions` (`provider_target_id`);--> statement-breakpoint
CREATE INDEX `agent_sessions_agent_id_idx` ON `agent_sessions` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_sessions_chat_session_id_idx` ON `agent_sessions` (`chat_session_id`);--> statement-breakpoint
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
CREATE INDEX `assets_sha256_idx` ON `assets` (`sha256`);--> statement-breakpoint
CREATE TABLE `automation_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_run_id` text NOT NULL,
	`automation_definition_id` text,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`mime_type` text,
	`content` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`automation_run_id`) REFERENCES `automation_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`automation_definition_id`) REFERENCES `automation_definitions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `automation_artifacts_run_id_idx` ON `automation_artifacts` (`automation_run_id`);--> statement-breakpoint
CREATE INDEX `automation_artifacts_definition_id_idx` ON `automation_artifacts` (`automation_definition_id`);--> statement-breakpoint
CREATE TABLE `automation_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`trigger_json` text NOT NULL,
	`recipe_json` text NOT NULL,
	`created_by_kind` text DEFAULT 'agent' NOT NULL,
	`created_by_id` text,
	`last_run_at` integer,
	`next_run_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `automation_definitions_workspace_id_idx` ON `automation_definitions` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `automation_definitions_enabled_next_run_at_idx` ON `automation_definitions` (`enabled`,`next_run_at`);--> statement-breakpoint
CREATE INDEX `automation_definitions_created_by_id_idx` ON `automation_definitions` (`created_by_id`);--> statement-breakpoint
CREATE TABLE `automation_events` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_definition_id` text,
	`automation_run_id` text,
	`type` text NOT NULL,
	`message` text NOT NULL,
	`attrs_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`automation_definition_id`) REFERENCES `automation_definitions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`automation_run_id`) REFERENCES `automation_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `automation_events_definition_id_idx` ON `automation_events` (`automation_definition_id`);--> statement-breakpoint
CREATE INDEX `automation_events_run_id_idx` ON `automation_events` (`automation_run_id`);--> statement-breakpoint
CREATE INDEX `automation_events_created_at_idx` ON `automation_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_definition_id` text NOT NULL,
	`workspace_id` text,
	`trigger_type` text NOT NULL,
	`occurrence_key` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`trigger_snapshot_json` text NOT NULL,
	`recipe_snapshot_json` text NOT NULL,
	`chat_session_id` text,
	`backend_run_id` text,
	`artifact_count` integer DEFAULT 0 NOT NULL,
	`error_text` text,
	`scheduled_for` integer,
	`claimed_at` integer,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`automation_definition_id`) REFERENCES `automation_definitions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`chat_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`backend_run_id`) REFERENCES `backend_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `automation_runs_definition_id_idx` ON `automation_runs` (`automation_definition_id`);--> statement-breakpoint
CREATE INDEX `automation_runs_workspace_id_idx` ON `automation_runs` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `automation_runs_status_idx` ON `automation_runs` (`status`);--> statement-breakpoint
CREATE INDEX `automation_runs_backend_run_id_idx` ON `automation_runs` (`backend_run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `automation_runs_definition_occurrence_unique` ON `automation_runs` (`automation_definition_id`,`occurrence_key`);--> statement-breakpoint
CREATE TABLE `backend_capability_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_target_id` text,
	`runtime_kind` text DEFAULT 'standard' NOT NULL,
	`source` text NOT NULL,
	`capabilities_json` text NOT NULL,
	`recorded_at` integer NOT NULL,
	FOREIGN KEY (`provider_target_id`) REFERENCES `provider_targets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `backend_run_snapshot_events` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`chat_session_id` text,
	`run_id` text,
	`seq` integer NOT NULL,
	`phase` text NOT NULL,
	`chunk_type` text,
	`tool_call_id` text,
	`tool_name` text,
	`model_id` text,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`total_tokens` integer,
	`estimated_cost_usd` real,
	`occurred_at` integer NOT NULL,
	`duration_ms` integer,
	`payload_json` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `backend_run_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`run_id`) REFERENCES `backend_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `backend_run_snapshot_events_snapshot_seq_unique` ON `backend_run_snapshot_events` (`snapshot_id`,`seq`);--> statement-breakpoint
CREATE INDEX `backend_run_snapshot_events_run_id_idx` ON `backend_run_snapshot_events` (`run_id`);--> statement-breakpoint
CREATE INDEX `backend_run_snapshot_events_tool_call_id_idx` ON `backend_run_snapshot_events` (`tool_call_id`);--> statement-breakpoint
CREATE TABLE `backend_run_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`schema_version` integer NOT NULL,
	`trace_id` text NOT NULL,
	`chat_session_id` text,
	`run_id` text,
	`message_id` text,
	`provider_target_id` text,
	`runtime_kind` text NOT NULL,
	`provider_session_id` text,
	`model_id` text,
	`agent_id` text,
	`workspace_id` text,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`completion_reason` text,
	`error_text` text,
	`summary_json` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`chat_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`run_id`) REFERENCES `backend_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`provider_target_id`) REFERENCES `provider_targets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `backend_run_snapshots_trace_id_idx` ON `backend_run_snapshots` (`trace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `backend_run_snapshots_run_id_unique` ON `backend_run_snapshots` (`run_id`);--> statement-breakpoint
CREATE INDEX `backend_run_snapshots_chat_session_id_idx` ON `backend_run_snapshots` (`chat_session_id`);--> statement-breakpoint
CREATE INDEX `backend_run_snapshots_started_at_idx` ON `backend_run_snapshots` (`started_at`);--> statement-breakpoint
CREATE TABLE `backend_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`binding_id` text,
	`chat_session_id` text NOT NULL,
	`message_id` text,
	`origin` text NOT NULL,
	`status` text NOT NULL,
	`stop_reason` text,
	`error_text` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`binding_id`) REFERENCES `backend_session_bindings`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`chat_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `backend_runs_binding_id_idx` ON `backend_runs` (`binding_id`);--> statement-breakpoint
CREATE INDEX `backend_runs_chat_session_id_idx` ON `backend_runs` (`chat_session_id`);--> statement-breakpoint
CREATE INDEX `backend_runs_message_id_idx` ON `backend_runs` (`message_id`);--> statement-breakpoint
CREATE INDEX `backend_runs_started_at_idx` ON `backend_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `backend_session_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_session_id` text NOT NULL,
	`provider_target_id` text,
	`runtime_kind` text DEFAULT 'standard' NOT NULL,
	`backend_session_id` text,
	`backend_state_snapshot` text,
	`requested_model_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`chat_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_target_id`) REFERENCES `provider_targets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `backend_session_bindings_chat_session_id_unique` ON `backend_session_bindings` (`chat_session_id`);--> statement-breakpoint
CREATE INDEX `backend_session_bindings_provider_target_id_idx` ON `backend_session_bindings` (`provider_target_id`);--> statement-breakpoint
CREATE INDEX `backend_session_bindings_runtime_kind_idx` ON `backend_session_bindings` (`runtime_kind`);--> statement-breakpoint
CREATE TABLE `chat_session_queue_items` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`mode` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`text` text NOT NULL,
	`files_json` text DEFAULT '[]' NOT NULL,
	`context_parts_json` text DEFAULT '[]' NOT NULL,
	`provider_target_id` text,
	`model_id` text,
	`thinking_effort` text,
	`permission_mode` text,
	`runtime_access_mode` text,
	`runtime_interaction_mode` text,
	`position` integer NOT NULL,
	`source_run_id` text,
	`started_run_id` text,
	`error_text` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_target_id`) REFERENCES `provider_targets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chat_session_queue_items_session_status_position_idx` ON `chat_session_queue_items` (`session_id`,`status`,`position`);--> statement-breakpoint
CREATE INDEX `chat_session_queue_items_session_created_at_idx` ON `chat_session_queue_items` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `chat_session_queue_items_provider_target_id_idx` ON `chat_session_queue_items` (`provider_target_id`);--> statement-breakpoint
CREATE INDEX `chat_session_queue_items_started_run_id_idx` ON `chat_session_queue_items` (`started_run_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`parent_message_id` text,
	`parent_tool_call_id` text,
	`task_id` text,
	`depth` integer DEFAULT 0 NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'complete' NOT NULL,
	`content` text NOT NULL,
	`message_json` text NOT NULL,
	`error_text` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_session_id_idx` ON `messages` (`session_id`);--> statement-breakpoint
CREATE INDEX `messages_session_created_at_idx` ON `messages` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `messages_parent_tool_call_id_idx` ON `messages` (`parent_tool_call_id`);--> statement-breakpoint
CREATE TABLE `session_events` (
	`sequence_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`aggregate_id` text NOT NULL,
	`aggregate_type` text DEFAULT 'ChatSession' NOT NULL,
	`version` integer NOT NULL,
	`event_type` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`subject_run_id` text GENERATED ALWAYS AS (case
      when event_type = 'RunStarted' then json_extract(payload, '$.run.id')
      when event_type in ('RunCompleted', 'RunFailed', 'RunAborted') then json_extract(payload, '$.runId')
      else null
    end) VIRTUAL,
	`occurred_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_events_aggregate_version_unique` ON `session_events` (`aggregate_id`,`version`);--> statement-breakpoint
CREATE INDEX `session_events_aggregate_id_idx` ON `session_events` (`aggregate_id`);--> statement-breakpoint
CREATE INDEX `session_events_event_type_idx` ON `session_events` (`event_type`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_events_terminal_fact_run_unique` ON `session_events` (`aggregate_id`,`subject_run_id`) WHERE "session_events"."event_type" in ('RunCompleted', 'RunFailed', 'RunAborted') and "session_events"."subject_run_id" is not null;--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_session_id` text,
	`side_context_source` text,
	`workspace_id` text,
	`title` text NOT NULL,
	`title_source` text DEFAULT 'initial' NOT NULL,
	`origin` text DEFAULT 'manual' NOT NULL,
	`provider_target_id` text,
	`runtime_kind` text DEFAULT 'standard' NOT NULL,
	`agent_id` text,
	`config_json` text DEFAULT '{}' NOT NULL,
	`linked_issue_id` text,
	`pinned` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	`last_read_at` integer,
	`pty_started_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`parent_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_target_id`) REFERENCES `provider_targets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`linked_issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `sessions_parent_session_id_idx` ON `sessions` (`parent_session_id`);--> statement-breakpoint
CREATE INDEX `sessions_workspace_id_idx` ON `sessions` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `sessions_origin_idx` ON `sessions` (`origin`);--> statement-breakpoint
CREATE INDEX `sessions_provider_target_id_idx` ON `sessions` (`provider_target_id`);--> statement-breakpoint
CREATE INDEX `sessions_linked_issue_id_idx` ON `sessions` (`linked_issue_id`);--> statement-breakpoint
CREATE INDEX `sessions_archived_at_idx` ON `sessions` (`archived_at`);--> statement-breakpoint
CREATE TABLE `step_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`session_id` text NOT NULL,
	`step_number` integer NOT NULL,
	`step_type` text NOT NULL,
	`model_id` text,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`estimated_cost_usd` real DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `step_usage_run_id_idx` ON `step_usage` (`run_id`);--> statement-breakpoint
CREATE INDEX `step_usage_session_id_idx` ON `step_usage` (`session_id`);--> statement-breakpoint
CREATE TABLE `usage_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`message_id` text,
	`provider_target_id` text,
	`model_id` text,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`provider_target_id`) REFERENCES `provider_targets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `usage_logs_session_id_idx` ON `usage_logs` (`session_id`);--> statement-breakpoint
CREATE INDEX `usage_logs_message_id_idx` ON `usage_logs` (`message_id`);--> statement-breakpoint
CREATE INDEX `usage_logs_provider_target_id_idx` ON `usage_logs` (`provider_target_id`);--> statement-breakpoint
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
CREATE INDEX `conversation_bridge_connection_secrets_secret_idx` ON `conversation_bridge_connection_secrets` (`secret_ref`);--> statement-breakpoint
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
CREATE TABLE `chronicle_accessibility_events` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`snapshot_id` text,
	`accessibility_snapshot_id` text,
	`workspace_id` text,
	`captured_at` integer NOT NULL,
	`provider` text DEFAULT 'macos-ax-observer' NOT NULL,
	`app_bundle_id` text,
	`pid` integer,
	`notification` text NOT NULL,
	`dropped_before` integer DEFAULT 0 NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `chronicle_snapshots`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accessibility_snapshot_id`) REFERENCES `chronicle_accessibility_snapshots`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicle_accessibility_events_source_id_unique` ON `chronicle_accessibility_events` (`source_id`);--> statement-breakpoint
CREATE INDEX `chronicle_accessibility_events_captured_at_idx` ON `chronicle_accessibility_events` (`captured_at`);--> statement-breakpoint
CREATE INDEX `chronicle_accessibility_events_workspace_captured_at_idx` ON `chronicle_accessibility_events` (`workspace_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `chronicle_accessibility_events_notification_idx` ON `chronicle_accessibility_events` (`notification`);--> statement-breakpoint
CREATE INDEX `chronicle_accessibility_events_snapshot_id_idx` ON `chronicle_accessibility_events` (`snapshot_id`);--> statement-breakpoint
CREATE INDEX `chronicle_accessibility_events_accessibility_snapshot_id_idx` ON `chronicle_accessibility_events` (`accessibility_snapshot_id`);--> statement-breakpoint
CREATE TABLE `chronicle_accessibility_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`snapshot_id` text,
	`workspace_id` text,
	`captured_at` integer NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`provider` text DEFAULT 'macos-accessibility' NOT NULL,
	`app_bundle_id` text,
	`window_title` text,
	`element_count` integer DEFAULT 0 NOT NULL,
	`text` text,
	`tree_json` text DEFAULT '[]' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `chronicle_snapshots`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicle_accessibility_snapshots_source_id_unique` ON `chronicle_accessibility_snapshots` (`source_id`);--> statement-breakpoint
CREATE INDEX `chronicle_accessibility_snapshots_snapshot_id_idx` ON `chronicle_accessibility_snapshots` (`snapshot_id`);--> statement-breakpoint
CREATE INDEX `chronicle_accessibility_snapshots_captured_at_idx` ON `chronicle_accessibility_snapshots` (`captured_at`);--> statement-breakpoint
CREATE INDEX `chronicle_accessibility_snapshots_workspace_captured_at_idx` ON `chronicle_accessibility_snapshots` (`workspace_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `chronicle_accessibility_snapshots_status_idx` ON `chronicle_accessibility_snapshots` (`status`);--> statement-breakpoint
CREATE TABLE `chronicle_activity_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`workspace_id` text,
	`start_snapshot_id` text,
	`end_snapshot_id` text,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`segment_type` text DEFAULT 'unknown' NOT NULL,
	`front_app` text,
	`title` text,
	`summary` text,
	`source_counts_json` text DEFAULT '{}' NOT NULL,
	`source_refs_json` text DEFAULT '{}' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`pipeline_status` text DEFAULT 'collecting' NOT NULL,
	`is_crystallized` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `chronicle_activity_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`start_snapshot_id`) REFERENCES `chronicle_snapshots`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`end_snapshot_id`) REFERENCES `chronicle_snapshots`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chronicle_activity_segments_session_id_idx` ON `chronicle_activity_segments` (`session_id`);--> statement-breakpoint
CREATE INDEX `chronicle_activity_segments_workspace_started_at_idx` ON `chronicle_activity_segments` (`workspace_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `chronicle_activity_segments_started_at_idx` ON `chronicle_activity_segments` (`started_at`);--> statement-breakpoint
CREATE INDEX `chronicle_activity_segments_type_idx` ON `chronicle_activity_segments` (`segment_type`);--> statement-breakpoint
CREATE INDEX `chronicle_activity_segments_pipeline_status_idx` ON `chronicle_activity_segments` (`pipeline_status`);--> statement-breakpoint
CREATE INDEX `chronicle_activity_segments_crystallized_idx` ON `chronicle_activity_segments` (`is_crystallized`);--> statement-breakpoint
CREATE TABLE `chronicle_activity_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`front_app` text,
	`title` text,
	`segment_count` integer DEFAULT 0 NOT NULL,
	`snapshot_count` integer DEFAULT 0 NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`audio_transcript_count` integer DEFAULT 0 NOT NULL,
	`audio_raw_segment_count` integer DEFAULT 0 NOT NULL,
	`accessibility_snapshot_count` integer DEFAULT 0 NOT NULL,
	`duration_seconds` integer,
	`is_meeting` integer DEFAULT false NOT NULL,
	`meeting_title` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chronicle_activity_sessions_started_at_idx` ON `chronicle_activity_sessions` (`started_at`);--> statement-breakpoint
CREATE INDEX `chronicle_activity_sessions_workspace_started_at_idx` ON `chronicle_activity_sessions` (`workspace_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `chronicle_activity_sessions_meeting_idx` ON `chronicle_activity_sessions` (`is_meeting`);--> statement-breakpoint
CREATE TABLE `chronicle_audio_raw_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`workspace_id` text,
	`recorded_at` integer NOT NULL,
	`source` text DEFAULT 'microphone' NOT NULL,
	`status` text DEFAULT 'captured' NOT NULL,
	`audio_path` text NOT NULL,
	`metadata_path` text NOT NULL,
	`sample_rate` integer NOT NULL,
	`channels` integer NOT NULL,
	`sample_count` integer NOT NULL,
	`dropped_samples` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer NOT NULL,
	`rms_bps` integer DEFAULT 0 NOT NULL,
	`peak_bps` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	`vad_status` text DEFAULT 'not-implemented' NOT NULL,
	`asr_status` text DEFAULT 'not-implemented' NOT NULL,
	`speaker_status` text DEFAULT 'not-implemented' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicle_audio_raw_segments_source_id_unique` ON `chronicle_audio_raw_segments` (`source_id`);--> statement-breakpoint
CREATE INDEX `chronicle_audio_raw_segments_recorded_at_idx` ON `chronicle_audio_raw_segments` (`recorded_at`);--> statement-breakpoint
CREATE INDEX `chronicle_audio_raw_segments_workspace_recorded_at_idx` ON `chronicle_audio_raw_segments` (`workspace_id`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `chronicle_audio_raw_segments_status_idx` ON `chronicle_audio_raw_segments` (`status`);--> statement-breakpoint
CREATE INDEX `chronicle_audio_raw_segments_active_idx` ON `chronicle_audio_raw_segments` (`active`);--> statement-breakpoint
CREATE TABLE `chronicle_audio_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`transcript_id` text NOT NULL,
	`segment_index` integer NOT NULL,
	`start_ms` integer NOT NULL,
	`end_ms` integer,
	`speaker_label` text,
	`text` text NOT NULL,
	`confidence_bps` integer,
	`language` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`transcript_id`) REFERENCES `chronicle_audio_transcripts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicle_audio_segments_transcript_segment_unique` ON `chronicle_audio_segments` (`transcript_id`,`segment_index`);--> statement-breakpoint
CREATE INDEX `chronicle_audio_segments_transcript_id_idx` ON `chronicle_audio_segments` (`transcript_id`);--> statement-breakpoint
CREATE INDEX `chronicle_audio_segments_speaker_label_idx` ON `chronicle_audio_segments` (`speaker_label`);--> statement-breakpoint
CREATE TABLE `chronicle_audio_transcripts` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`workspace_id` text,
	`memory_id` text,
	`title` text,
	`source` text DEFAULT 'imported' NOT NULL,
	`status` text DEFAULT 'imported' NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`language` text,
	`app_bundle_id` text,
	`window_title` text,
	`audio_path` text,
	`transcript_path` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`memory_id`) REFERENCES `chronicle_memories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicle_audio_transcripts_source_id_unique` ON `chronicle_audio_transcripts` (`source_id`);--> statement-breakpoint
CREATE INDEX `chronicle_audio_transcripts_started_at_idx` ON `chronicle_audio_transcripts` (`started_at`);--> statement-breakpoint
CREATE INDEX `chronicle_audio_transcripts_workspace_started_at_idx` ON `chronicle_audio_transcripts` (`workspace_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `chronicle_audio_transcripts_memory_id_idx` ON `chronicle_audio_transcripts` (`memory_id`);--> statement-breakpoint
CREATE INDEX `chronicle_audio_transcripts_status_idx` ON `chronicle_audio_transcripts` (`status`);--> statement-breakpoint
CREATE TABLE `chronicle_dream_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`workspace_id` text,
	`candidate_type` text DEFAULT 'merge' NOT NULL,
	`score_bps` integer DEFAULT 0 NOT NULL,
	`source_knowledge_ids_json` text DEFAULT '[]' NOT NULL,
	`proposed_title` text,
	`proposed_content` text,
	`proposed_card_type` text,
	`proposed_dimension` text,
	`output_knowledge_id` text,
	`status` text DEFAULT 'proposed' NOT NULL,
	`reason` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `chronicle_dream_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`output_knowledge_id`) REFERENCES `chronicle_knowledge_cards`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chronicle_dream_candidates_run_id_idx` ON `chronicle_dream_candidates` (`run_id`);--> statement-breakpoint
CREATE INDEX `chronicle_dream_candidates_workspace_id_idx` ON `chronicle_dream_candidates` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `chronicle_dream_candidates_status_idx` ON `chronicle_dream_candidates` (`status`);--> statement-breakpoint
CREATE INDEX `chronicle_dream_candidates_score_idx` ON `chronicle_dream_candidates` (`score_bps`);--> statement-breakpoint
CREATE INDEX `chronicle_dream_candidates_output_knowledge_id_idx` ON `chronicle_dream_candidates` (`output_knowledge_id`);--> statement-breakpoint
CREATE TABLE `chronicle_dream_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`run_type` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`input_count` integer DEFAULT 0 NOT NULL,
	`output_count` integer DEFAULT 0 NOT NULL,
	`merged_count` integer DEFAULT 0 NOT NULL,
	`deleted_count` integer DEFAULT 0 NOT NULL,
	`source_knowledge_ids_json` text DEFAULT '[]' NOT NULL,
	`output_knowledge_ids_json` text DEFAULT '[]' NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`result_json` text DEFAULT '{}' NOT NULL,
	`error_message` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chronicle_dream_runs_workspace_started_at_idx` ON `chronicle_dream_runs` (`workspace_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `chronicle_dream_runs_run_type_idx` ON `chronicle_dream_runs` (`run_type`);--> statement-breakpoint
CREATE INDEX `chronicle_dream_runs_status_idx` ON `chronicle_dream_runs` (`status`);--> statement-breakpoint
CREATE INDEX `chronicle_dream_runs_started_at_idx` ON `chronicle_dream_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `chronicle_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'info' NOT NULL,
	`message` text NOT NULL,
	`snapshot_id` text,
	`memory_id` text,
	`attrs_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `chronicle_snapshots`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`memory_id`) REFERENCES `chronicle_memories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chronicle_events_created_at_idx` ON `chronicle_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `chronicle_events_type_created_at_idx` ON `chronicle_events` (`type`,`created_at`);--> statement-breakpoint
CREATE INDEX `chronicle_events_snapshot_id_idx` ON `chronicle_events` (`snapshot_id`);--> statement-breakpoint
CREATE INDEX `chronicle_events_memory_id_idx` ON `chronicle_events` (`memory_id`);--> statement-breakpoint
CREATE TABLE `chronicle_knowledge_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`card_type` text DEFAULT 'fact' NOT NULL,
	`dimension` text DEFAULT 'general' NOT NULL,
	`confidence_bps` integer DEFAULT 10000 NOT NULL,
	`source_memory_ids_json` text DEFAULT '[]' NOT NULL,
	`source_segment_ids_json` text DEFAULT '[]' NOT NULL,
	`source_chunk_ids_json` text DEFAULT '[]' NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`stable_key` text DEFAULT '' NOT NULL,
	`content_hash` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`merged_into_id` text,
	`pinned` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_cards_content_hash_idx` ON `chronicle_knowledge_cards` (`content_hash`);--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_cards_stable_key_idx` ON `chronicle_knowledge_cards` (`stable_key`);--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_cards_workspace_updated_at_idx` ON `chronicle_knowledge_cards` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_cards_dimension_idx` ON `chronicle_knowledge_cards` (`dimension`);--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_cards_type_idx` ON `chronicle_knowledge_cards` (`card_type`);--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_cards_status_idx` ON `chronicle_knowledge_cards` (`status`);--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_cards_pinned_idx` ON `chronicle_knowledge_cards` (`pinned`);--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_cards_merged_into_idx` ON `chronicle_knowledge_cards` (`merged_into_id`);--> statement-breakpoint
CREATE TABLE `chronicle_knowledge_files` (
	`id` text PRIMARY KEY NOT NULL,
	`knowledge_id` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text,
	`size_bytes` integer,
	`file_path` text,
	`embedded` integer DEFAULT false NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`knowledge_id`) REFERENCES `chronicle_knowledge_cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_files_knowledge_id_idx` ON `chronicle_knowledge_files` (`knowledge_id`);--> statement-breakpoint
CREATE TABLE `chronicle_knowledge_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`knowledge_id` text NOT NULL,
	`version_id` text,
	`segment_id` text,
	`memory_id` text,
	`memory_chunk_id` text,
	`pipeline_run_id` text,
	`source_kind` text DEFAULT 'activity' NOT NULL,
	`evidence_type` text DEFAULT 'activity-segment' NOT NULL,
	`evidence_id` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`knowledge_id`) REFERENCES `chronicle_knowledge_cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`version_id`) REFERENCES `chronicle_knowledge_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`segment_id`) REFERENCES `chronicle_activity_segments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`memory_id`) REFERENCES `chronicle_memories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`memory_chunk_id`) REFERENCES `chronicle_memory_chunks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`pipeline_run_id`) REFERENCES `chronicle_pipeline_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_sources_knowledge_id_idx` ON `chronicle_knowledge_sources` (`knowledge_id`);--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_sources_version_id_idx` ON `chronicle_knowledge_sources` (`version_id`);--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_sources_segment_id_idx` ON `chronicle_knowledge_sources` (`segment_id`);--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_sources_memory_id_idx` ON `chronicle_knowledge_sources` (`memory_id`);--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_sources_memory_chunk_id_idx` ON `chronicle_knowledge_sources` (`memory_chunk_id`);--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_sources_pipeline_run_id_idx` ON `chronicle_knowledge_sources` (`pipeline_run_id`);--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_sources_evidence_idx` ON `chronicle_knowledge_sources` (`evidence_type`,`evidence_id`);--> statement-breakpoint
CREATE TABLE `chronicle_knowledge_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`knowledge_id` text NOT NULL,
	`version` integer NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`card_type` text DEFAULT 'fact' NOT NULL,
	`dimension` text DEFAULT 'general' NOT NULL,
	`confidence_bps` integer DEFAULT 10000 NOT NULL,
	`source_memory_ids_json` text DEFAULT '[]' NOT NULL,
	`source_segment_ids_json` text DEFAULT '[]' NOT NULL,
	`source_chunk_ids_json` text DEFAULT '[]' NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`knowledge_id`) REFERENCES `chronicle_knowledge_cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicle_knowledge_versions_card_version_unique` ON `chronicle_knowledge_versions` (`knowledge_id`,`version`);--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_versions_knowledge_id_idx` ON `chronicle_knowledge_versions` (`knowledge_id`);--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_versions_created_at_idx` ON `chronicle_knowledge_versions` (`created_at`);--> statement-breakpoint
CREATE TABLE `chronicle_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`content_hash` text,
	`workspace_id` text,
	`type` text NOT NULL,
	`source` text DEFAULT 'llm' NOT NULL,
	`content` text NOT NULL,
	`prompt` text,
	`source_snapshot_ids_json` text DEFAULT '[]' NOT NULL,
	`source_paths_json` text DEFAULT '[]' NOT NULL,
	`model_profile_id` text,
	`model_id` text,
	`usage_json` text DEFAULT '{}' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicle_memories_source_id_unique` ON `chronicle_memories` (`source_id`);--> statement-breakpoint
CREATE INDEX `chronicle_memories_content_hash_idx` ON `chronicle_memories` (`content_hash`);--> statement-breakpoint
CREATE INDEX `chronicle_memories_created_at_idx` ON `chronicle_memories` (`created_at`);--> statement-breakpoint
CREATE INDEX `chronicle_memories_workspace_created_at_idx` ON `chronicle_memories` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `chronicle_memories_type_created_at_idx` ON `chronicle_memories` (`type`,`created_at`);--> statement-breakpoint
CREATE TABLE `chronicle_memory_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`content` text NOT NULL,
	`content_hash` text NOT NULL,
	`token_count` integer DEFAULT 0 NOT NULL,
	`embedding_status` text DEFAULT 'missing' NOT NULL,
	`embedding_model_id` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `chronicle_memories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicle_memory_chunks_memory_chunk_unique` ON `chronicle_memory_chunks` (`memory_id`,`chunk_index`);--> statement-breakpoint
CREATE INDEX `chronicle_memory_chunks_memory_id_idx` ON `chronicle_memory_chunks` (`memory_id`);--> statement-breakpoint
CREATE INDEX `chronicle_memory_chunks_content_hash_idx` ON `chronicle_memory_chunks` (`content_hash`);--> statement-breakpoint
CREATE INDEX `chronicle_memory_chunks_embedding_status_idx` ON `chronicle_memory_chunks` (`embedding_status`);--> statement-breakpoint
CREATE TABLE `chronicle_memory_embeddings` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_id` text NOT NULL,
	`chunk_id` text NOT NULL,
	`model_id` text NOT NULL,
	`model_version` text NOT NULL,
	`dimensions` integer NOT NULL,
	`vector_json` text NOT NULL,
	`vector_hash` text NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `chronicle_memories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chunk_id`) REFERENCES `chronicle_memory_chunks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicle_memory_embeddings_chunk_model_unique` ON `chronicle_memory_embeddings` (`chunk_id`,`model_id`,`model_version`);--> statement-breakpoint
CREATE INDEX `chronicle_memory_embeddings_memory_id_idx` ON `chronicle_memory_embeddings` (`memory_id`);--> statement-breakpoint
CREATE INDEX `chronicle_memory_embeddings_status_idx` ON `chronicle_memory_embeddings` (`status`);--> statement-breakpoint
CREATE INDEX `chronicle_memory_embeddings_vector_hash_idx` ON `chronicle_memory_embeddings` (`vector_hash`);--> statement-breakpoint
CREATE TABLE `chronicle_memory_keywords` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_id` text NOT NULL,
	`chunk_id` text NOT NULL,
	`term` text NOT NULL,
	`source` text NOT NULL,
	`occurrences` integer DEFAULT 1 NOT NULL,
	`weight` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `chronicle_memories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chunk_id`) REFERENCES `chronicle_memory_chunks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicle_memory_keywords_memory_chunk_term_source_unique` ON `chronicle_memory_keywords` (`memory_id`,`chunk_id`,`term`,`source`);--> statement-breakpoint
CREATE INDEX `chronicle_memory_keywords_term_idx` ON `chronicle_memory_keywords` (`term`);--> statement-breakpoint
CREATE INDEX `chronicle_memory_keywords_memory_id_idx` ON `chronicle_memory_keywords` (`memory_id`);--> statement-breakpoint
CREATE INDEX `chronicle_memory_keywords_source_term_idx` ON `chronicle_memory_keywords` (`source`,`term`);--> statement-breakpoint
CREATE TABLE `chronicle_message_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`label` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`workspace_id` text,
	`team_id` text,
	`bot_token_ref` text,
	`channel_ids_json` text DEFAULT '[]' NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`last_sync_at` integer,
	`last_message_at` integer,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chronicle_message_sources_platform_enabled_idx` ON `chronicle_message_sources` (`platform`,`enabled`);--> statement-breakpoint
CREATE INDEX `chronicle_message_sources_workspace_id_idx` ON `chronicle_message_sources` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `chronicle_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`workspace_id` text,
	`platform` text NOT NULL,
	`external_message_id` text NOT NULL,
	`team_id` text,
	`channel_id` text NOT NULL,
	`channel_name` text,
	`thread_id` text,
	`user_id` text,
	`user_name` text,
	`text` text DEFAULT '' NOT NULL,
	`is_dm` integer DEFAULT false NOT NULL,
	`message_ts` text NOT NULL,
	`message_at` integer NOT NULL,
	`permalink` text,
	`attachments_json` text DEFAULT '[]' NOT NULL,
	`raw_json` text DEFAULT '{}' NOT NULL,
	`dedup_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `chronicle_message_sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicle_messages_source_external_unique` ON `chronicle_messages` (`source_id`,`external_message_id`);--> statement-breakpoint
CREATE INDEX `chronicle_messages_source_message_at_idx` ON `chronicle_messages` (`source_id`,`message_at`);--> statement-breakpoint
CREATE INDEX `chronicle_messages_workspace_message_at_idx` ON `chronicle_messages` (`workspace_id`,`message_at`);--> statement-breakpoint
CREATE INDEX `chronicle_messages_dedup_hash_idx` ON `chronicle_messages` (`dedup_hash`);--> statement-breakpoint
CREATE TABLE `chronicle_model_resources` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`status` text DEFAULT 'missing' NOT NULL,
	`display_name` text NOT NULL,
	`path` text,
	`version` text,
	`message` text,
	`size_bytes` integer,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicle_model_resources_category_unique` ON `chronicle_model_resources` (`category`);--> statement-breakpoint
CREATE INDEX `chronicle_model_resources_status_idx` ON `chronicle_model_resources` (`status`);--> statement-breakpoint
CREATE TABLE `chronicle_pipeline_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`segment_id` text,
	`workspace_id` text,
	`trigger` text NOT NULL,
	`source_key` text NOT NULL,
	`stage` text DEFAULT 'collection' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`error_message` text,
	`snapshot_ids_json` text DEFAULT '[]' NOT NULL,
	`message_ids_json` text DEFAULT '[]' NOT NULL,
	`audio_transcript_ids_json` text DEFAULT '[]' NOT NULL,
	`audio_raw_segment_ids_json` text DEFAULT '[]' NOT NULL,
	`memory_ids_json` text DEFAULT '[]' NOT NULL,
	`segment_ids_json` text DEFAULT '[]' NOT NULL,
	`snapshots_count` integer DEFAULT 0 NOT NULL,
	`messages_count` integer DEFAULT 0 NOT NULL,
	`audio_transcripts_count` integer DEFAULT 0 NOT NULL,
	`audio_raw_segments_count` integer DEFAULT 0 NOT NULL,
	`memories_count` integer DEFAULT 0 NOT NULL,
	`segments_count` integer DEFAULT 0 NOT NULL,
	`triage_results_json` text DEFAULT '{}' NOT NULL,
	`summary_results_json` text DEFAULT '{}' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `chronicle_activity_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`segment_id`) REFERENCES `chronicle_activity_segments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicle_pipeline_runs_source_key_unique` ON `chronicle_pipeline_runs` (`source_key`);--> statement-breakpoint
CREATE INDEX `chronicle_pipeline_runs_status_idx` ON `chronicle_pipeline_runs` (`status`);--> statement-breakpoint
CREATE INDEX `chronicle_pipeline_runs_session_id_idx` ON `chronicle_pipeline_runs` (`session_id`);--> statement-breakpoint
CREATE INDEX `chronicle_pipeline_runs_segment_id_idx` ON `chronicle_pipeline_runs` (`segment_id`);--> statement-breakpoint
CREATE INDEX `chronicle_pipeline_runs_started_at_idx` ON `chronicle_pipeline_runs` (`started_at`);--> statement-breakpoint
CREATE INDEX `chronicle_pipeline_runs_workspace_started_at_idx` ON `chronicle_pipeline_runs` (`workspace_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `chronicle_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`workspace_id` text,
	`captured_at` integer NOT NULL,
	`display_id` integer DEFAULT 0 NOT NULL,
	`segment_dir` text DEFAULT '' NOT NULL,
	`frame_path` text DEFAULT '' NOT NULL,
	`artifact_path` text,
	`ocr_text` text,
	`app_bundle_id` text,
	`window_title` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicle_snapshots_source_id_unique` ON `chronicle_snapshots` (`source_id`);--> statement-breakpoint
CREATE INDEX `chronicle_snapshots_captured_at_idx` ON `chronicle_snapshots` (`captured_at`);--> statement-breakpoint
CREATE INDEX `chronicle_snapshots_workspace_captured_at_idx` ON `chronicle_snapshots` (`workspace_id`,`captured_at`);--> statement-breakpoint
CREATE TABLE `chronicle_speaker_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`stable_key` text NOT NULL,
	`display_name` text NOT NULL,
	`normalized_label` text NOT NULL,
	`aliases_json` text DEFAULT '[]' NOT NULL,
	`embedding_json` text,
	`embedding_dimensions` integer,
	`embedding_model_id` text,
	`sample_count` integer DEFAULT 0 NOT NULL,
	`last_seen_at` integer,
	`source_transcript_id` text,
	`source_segment_id` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_transcript_id`) REFERENCES `chronicle_audio_transcripts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_segment_id`) REFERENCES `chronicle_audio_segments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicle_speaker_profiles_stable_key_unique` ON `chronicle_speaker_profiles` (`stable_key`);--> statement-breakpoint
CREATE INDEX `chronicle_speaker_profiles_workspace_last_seen_idx` ON `chronicle_speaker_profiles` (`workspace_id`,`last_seen_at`);--> statement-breakpoint
CREATE INDEX `chronicle_speaker_profiles_normalized_label_idx` ON `chronicle_speaker_profiles` (`normalized_label`);--> statement-breakpoint
CREATE INDEX `chronicle_speaker_profiles_source_transcript_id_idx` ON `chronicle_speaker_profiles` (`source_transcript_id`);--> statement-breakpoint
CREATE INDEX `chronicle_speaker_profiles_source_segment_id_idx` ON `chronicle_speaker_profiles` (`source_segment_id`);--> statement-breakpoint
CREATE TABLE `diff_review_agent_fixes` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`target_revision_id` text,
	`thread_id` text,
	`anchor_json` text,
	`instruction` text NOT NULL,
	`profile_id` text,
	`expected_output` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`session_id` text,
	`run_id` text,
	`artifact_id` text,
	`result_revision_id` text,
	`error_message` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `diff_reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_revision_id`) REFERENCES `diff_review_revisions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`thread_id`) REFERENCES `diff_review_threads`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`result_revision_id`) REFERENCES `diff_review_revisions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `diff_review_agent_fixes_review_id_idx` ON `diff_review_agent_fixes` (`review_id`);--> statement-breakpoint
CREATE INDEX `diff_review_agent_fixes_target_revision_id_idx` ON `diff_review_agent_fixes` (`target_revision_id`);--> statement-breakpoint
CREATE INDEX `diff_review_agent_fixes_thread_id_idx` ON `diff_review_agent_fixes` (`thread_id`);--> statement-breakpoint
CREATE INDEX `diff_review_agent_fixes_result_revision_id_idx` ON `diff_review_agent_fixes` (`result_revision_id`);--> statement-breakpoint
CREATE INDEX `diff_review_agent_fixes_status_idx` ON `diff_review_agent_fixes` (`status`);--> statement-breakpoint
CREATE TABLE `diff_review_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`author_kind` text DEFAULT 'user' NOT NULL,
	`author_id` text NOT NULL,
	`body_markdown` text NOT NULL,
	`external_url` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `diff_review_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diff_review_comments_thread_id_idx` ON `diff_review_comments` (`thread_id`);--> statement-breakpoint
CREATE TABLE `diff_review_commit_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`strategy` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`groups_json` text NOT NULL,
	`rationale` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `diff_reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`revision_id`) REFERENCES `diff_review_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diff_review_commit_plans_review_id_idx` ON `diff_review_commit_plans` (`review_id`);--> statement-breakpoint
CREATE INDEX `diff_review_commit_plans_revision_id_idx` ON `diff_review_commit_plans` (`revision_id`);--> statement-breakpoint
CREATE INDEX `diff_review_commit_plans_created_at_idx` ON `diff_review_commit_plans` (`created_at`);--> statement-breakpoint
CREATE TABLE `diff_review_events` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`event_kind` text NOT NULL,
	`actor_kind` text DEFAULT 'system' NOT NULL,
	`actor_id` text,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `diff_reviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diff_review_events_review_id_idx` ON `diff_review_events` (`review_id`);--> statement-breakpoint
CREATE INDEX `diff_review_events_created_at_idx` ON `diff_review_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `diff_review_file_view_state` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`file_id` text NOT NULL,
	`user_id` text NOT NULL,
	`viewed` integer DEFAULT true NOT NULL,
	`viewed_at` integer NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `diff_reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`revision_id`) REFERENCES `diff_review_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `diff_review_files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diff_review_file_view_state_review_id_idx` ON `diff_review_file_view_state` (`review_id`);--> statement-breakpoint
CREATE INDEX `diff_review_file_view_state_revision_id_idx` ON `diff_review_file_view_state` (`revision_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `diff_review_file_view_state_file_user_unique` ON `diff_review_file_view_state` (`review_id`,`revision_id`,`file_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `diff_review_files` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`path` text NOT NULL,
	`previous_path` text,
	`status` text NOT NULL,
	`additions` integer DEFAULT 0 NOT NULL,
	`deletions` integer DEFAULT 0 NOT NULL,
	`is_generated` integer DEFAULT false NOT NULL,
	`is_binary` integer DEFAULT false NOT NULL,
	`is_viewed` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `diff_review_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diff_review_files_revision_id_idx` ON `diff_review_files` (`revision_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `diff_review_files_revision_path_unique` ON `diff_review_files` (`revision_id`,`path`);--> statement-breakpoint
CREATE TABLE `diff_review_guides` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`provider_target_id` text,
	`runtime_kind` text NOT NULL,
	`model_id` text,
	`session_id` text,
	`run_id` text,
	`input_hash` text NOT NULL,
	`status` text NOT NULL,
	`title` text,
	`steps_json` text DEFAULT '[]' NOT NULL,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `diff_reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`revision_id`) REFERENCES `diff_review_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diff_review_guides_review_id_idx` ON `diff_review_guides` (`review_id`);--> statement-breakpoint
CREATE INDEX `diff_review_guides_revision_id_idx` ON `diff_review_guides` (`revision_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `diff_review_guides_review_revision_unique` ON `diff_review_guides` (`review_id`,`revision_id`);--> statement-breakpoint
CREATE TABLE `diff_review_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`diff_style` text DEFAULT 'split' NOT NULL,
	`code_theme` text DEFAULT 'system' NOT NULL,
	`font_size` integer DEFAULT 11 NOT NULL,
	`line_height` integer DEFAULT 18 NOT NULL,
	`hide_whitespace_only` integer DEFAULT false NOT NULL,
	`structural_highlighting` integer DEFAULT false NOT NULL,
	`collapse_generated_files` integer DEFAULT false NOT NULL,
	`notification_mode` text DEFAULT 'reviews-and-comments' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diff_review_preferences_workspace_id_idx` ON `diff_review_preferences` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `diff_review_preferences_workspace_user_unique` ON `diff_review_preferences` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `diff_review_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`source_version` text NOT NULL,
	`patch_hash` text NOT NULL,
	`file_count` integer DEFAULT 0 NOT NULL,
	`additions` integer DEFAULT 0 NOT NULL,
	`deletions` integer DEFAULT 0 NOT NULL,
	`patch` text NOT NULL,
	`generated_at` integer NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `diff_reviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diff_review_revisions_review_id_idx` ON `diff_review_revisions` (`review_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `diff_review_revisions_review_patch_unique` ON `diff_review_revisions` (`review_id`,`patch_hash`);--> statement-breakpoint
CREATE TABLE `diff_review_source_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text,
	`review_id` text NOT NULL,
	`operation_kind` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`request_json` text DEFAULT '{}' NOT NULL,
	`response_json` text,
	`error_message` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `diff_review_sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`review_id`) REFERENCES `diff_reviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diff_review_source_operations_review_id_idx` ON `diff_review_source_operations` (`review_id`);--> statement-breakpoint
CREATE INDEX `diff_review_source_operations_source_id_idx` ON `diff_review_source_operations` (`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `diff_review_source_operations_idempotency_unique` ON `diff_review_source_operations` (`source_id`,`operation_kind`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `diff_review_source_readiness_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`source_kind` text NOT NULL,
	`state` text NOT NULL,
	`actions_json` text DEFAULT '[]' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diff_review_source_readiness_workspace_id_idx` ON `diff_review_source_readiness_cache` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `diff_review_source_readiness_kind_unique` ON `diff_review_source_readiness_cache` (`workspace_id`,`source_kind`);--> statement-breakpoint
CREATE TABLE `diff_review_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`owner_namespace` text DEFAULT 'diff-review' NOT NULL,
	`binding_json` text DEFAULT '{}' NOT NULL,
	`refresh_policy` text DEFAULT 'manual' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diff_review_sources_workspace_id_idx` ON `diff_review_sources` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `diff_review_sources_kind_idx` ON `diff_review_sources` (`kind`);--> statement-breakpoint
CREATE TABLE `diff_review_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`decision` text NOT NULL,
	`body_markdown` text,
	`submitted_at` integer NOT NULL,
	`source_sync_state` text DEFAULT 'local-only' NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `diff_reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`revision_id`) REFERENCES `diff_review_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diff_review_submissions_review_id_idx` ON `diff_review_submissions` (`review_id`);--> statement-breakpoint
CREATE INDEX `diff_review_submissions_revision_id_idx` ON `diff_review_submissions` (`revision_id`);--> statement-breakpoint
CREATE TABLE `diff_review_thread_reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`user_id` text NOT NULL,
	`reaction` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `diff_review_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diff_review_thread_reactions_thread_id_idx` ON `diff_review_thread_reactions` (`thread_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `diff_review_thread_reactions_unique` ON `diff_review_thread_reactions` (`thread_id`,`user_id`,`reaction`);--> statement-breakpoint
CREATE TABLE `diff_review_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`original_revision_id` text NOT NULL,
	`current_revision_id` text,
	`file_id` text,
	`anchor_json` text,
	`state` text DEFAULT 'open' NOT NULL,
	`created_by` text NOT NULL,
	`resolved_by` text,
	`resolved_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `diff_reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`original_revision_id`) REFERENCES `diff_review_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`current_revision_id`) REFERENCES `diff_review_revisions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`file_id`) REFERENCES `diff_review_files`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `diff_review_threads_review_id_idx` ON `diff_review_threads` (`review_id`);--> statement-breakpoint
CREATE INDEX `diff_review_threads_state_idx` ON `diff_review_threads` (`state`);--> statement-breakpoint
CREATE INDEX `diff_review_threads_current_revision_id_idx` ON `diff_review_threads` (`current_revision_id`);--> statement-breakpoint
CREATE TABLE `diff_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`source_id` text,
	`repository_path` text NOT NULL,
	`source_kind` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`review_state` text DEFAULT 'unreviewed' NOT NULL,
	`current_revision_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diff_reviews_workspace_id_idx` ON `diff_reviews` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `diff_reviews_source_id_idx` ON `diff_reviews` (`source_id`);--> statement-breakpoint
CREATE INDEX `diff_reviews_current_revision_id_idx` ON `diff_reviews` (`current_revision_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `diff_reviews_source_unique` ON `diff_reviews` (`source_id`);--> statement-breakpoint
CREATE TABLE `external_provider_records` (
	`id` text PRIMARY KEY NOT NULL,
	`source_key` text NOT NULL,
	`external_id` text NOT NULL,
	`app` text NOT NULL,
	`name` text NOT NULL,
	`provider_kind` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`fingerprint` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`warnings_json` text DEFAULT '[]' NOT NULL,
	`last_seen_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_provider_records_source_external_unique` ON `external_provider_records` (`source_key`,`external_id`);--> statement-breakpoint
CREATE INDEX `external_provider_records_source_idx` ON `external_provider_records` (`source_key`);--> statement-breakpoint
CREATE INDEX `external_provider_records_status_idx` ON `external_provider_records` (`status`);--> statement-breakpoint
CREATE TABLE `external_provider_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`plugin_name` text NOT NULL,
	`source_id` text NOT NULL,
	`label` text NOT NULL,
	`description` text,
	`enabled` integer DEFAULT true NOT NULL,
	`capabilities_json` text DEFAULT '{}' NOT NULL,
	`inventory_json` text DEFAULT '{}' NOT NULL,
	`warnings_json` text DEFAULT '[]' NOT NULL,
	`last_sync_status` text DEFAULT 'never' NOT NULL,
	`last_sync_message` text,
	`last_sync_error` text,
	`last_sync_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_provider_sources_plugin_source_unique` ON `external_provider_sources` (`plugin_name`,`source_id`);--> statement-breakpoint
CREATE TABLE `external_issue_items` (
	`id` text PRIMARY KEY NOT NULL,
	`binding_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`status_id` text,
	`source_key` text NOT NULL,
	`external_id` text NOT NULL,
	`external_key` text NOT NULL,
	`external_url` text,
	`repository_owner` text NOT NULL,
	`repository_name` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`source_state` text NOT NULL,
	`labels_json` text DEFAULT '[]' NOT NULL,
	`assignees_json` text DEFAULT '[]' NOT NULL,
	`milestone` text,
	`source_created_at` text,
	`source_updated_at` text,
	`source_closed_at` text,
	`sync_status` text DEFAULT 'active' NOT NULL,
	`fingerprint` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`warnings_json` text DEFAULT '[]' NOT NULL,
	`last_seen_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`binding_id`) REFERENCES `external_issue_source_bindings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`status_id`) REFERENCES `issue_statuses`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_issue_items_workspace_source_external_unique` ON `external_issue_items` (`workspace_id`,`source_key`,`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `external_issue_items_workspace_source_key_unique` ON `external_issue_items` (`workspace_id`,`source_key`,`external_key`);--> statement-breakpoint
CREATE INDEX `external_issue_items_binding_idx` ON `external_issue_items` (`binding_id`);--> statement-breakpoint
CREATE INDEX `external_issue_items_workspace_idx` ON `external_issue_items` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `external_issue_items_status_idx` ON `external_issue_items` (`status_id`);--> statement-breakpoint
CREATE INDEX `external_issue_items_sync_status_idx` ON `external_issue_items` (`sync_status`);--> statement-breakpoint
CREATE TABLE `external_issue_repository_cursors` (
	`id` text PRIMARY KEY NOT NULL,
	`source_key` text NOT NULL,
	`repository_owner` text NOT NULL,
	`repository_name` text NOT NULL,
	`etag` text,
	`cursor_json` text DEFAULT '{}' NOT NULL,
	`last_fetch_status` text DEFAULT 'never' NOT NULL,
	`last_fetch_message` text,
	`last_fetch_error` text,
	`last_fetched_at` integer,
	`next_fetch_after` integer,
	`rate_limit_reset_at` integer,
	`rate_limit_remaining` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_issue_repository_cursors_source_repo_unique` ON `external_issue_repository_cursors` (`source_key`,`repository_owner`,`repository_name`);--> statement-breakpoint
CREATE INDEX `external_issue_repository_cursors_next_fetch_idx` ON `external_issue_repository_cursors` (`next_fetch_after`);--> statement-breakpoint
CREATE TABLE `external_issue_source_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`source_key` text NOT NULL,
	`repository_owner` text NOT NULL,
	`repository_name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`schedule_enabled` integer DEFAULT false NOT NULL,
	`refresh_interval_seconds` integer DEFAULT 3600 NOT NULL,
	`last_refresh_status` text DEFAULT 'never' NOT NULL,
	`last_refresh_message` text,
	`last_refresh_error` text,
	`last_refresh_at` integer,
	`next_refresh_after` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_issue_bindings_workspace_source_repo_unique` ON `external_issue_source_bindings` (`workspace_id`,`source_key`,`repository_owner`,`repository_name`);--> statement-breakpoint
CREATE INDEX `external_issue_bindings_workspace_idx` ON `external_issue_source_bindings` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `external_issue_bindings_source_idx` ON `external_issue_source_bindings` (`source_key`);--> statement-breakpoint
CREATE INDEX `external_issue_bindings_schedule_idx` ON `external_issue_source_bindings` (`schedule_enabled`,`next_refresh_after`);--> statement-breakpoint
CREATE TABLE `external_issue_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`plugin_name` text NOT NULL,
	`source_id` text NOT NULL,
	`label` text NOT NULL,
	`description` text,
	`enabled` integer DEFAULT true NOT NULL,
	`registration_status` text DEFAULT 'registered' NOT NULL,
	`capabilities_json` text DEFAULT '{}' NOT NULL,
	`inventory_json` text DEFAULT '{}' NOT NULL,
	`warnings_json` text DEFAULT '[]' NOT NULL,
	`last_sync_status` text DEFAULT 'never' NOT NULL,
	`last_sync_message` text,
	`last_sync_error` text,
	`last_sync_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_issue_sources_plugin_source_unique` ON `external_issue_sources` (`plugin_name`,`source_id`);--> statement-breakpoint
CREATE INDEX `external_issue_sources_registration_status_idx` ON `external_issue_sources` (`registration_status`);--> statement-breakpoint
CREATE TABLE `external_work_import_items` (
	`id` text PRIMARY KEY NOT NULL,
	`source_app` text NOT NULL,
	`source_scope` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_path` text,
	`external_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`workspace_id` text,
	`session_id` text,
	`message_id` text,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'imported' NOT NULL,
	`status_reason` text,
	`imported_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_work_import_items_fingerprint_unique` ON `external_work_import_items` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `external_work_import_items_source_idx` ON `external_work_import_items` (`source_app`,`source_kind`);--> statement-breakpoint
CREATE INDEX `external_work_import_items_workspace_id_idx` ON `external_work_import_items` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `external_work_import_items_session_id_idx` ON `external_work_import_items` (`session_id`);--> statement-breakpoint
CREATE TABLE `agent_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`encrypted_secret` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`avatar_url` text,
	`avatar_style` text DEFAULT 'bottts-neutral' NOT NULL,
	`avatar_seed` text NOT NULL,
	`provider_target_id` text,
	`model_id` text,
	`thinking_effort` text DEFAULT 'high' NOT NULL,
	`runtime_kind` text DEFAULT 'standard' NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`provider_target_id`) REFERENCES `provider_targets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `issue_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`content` text NOT NULL,
	`author_kind` text DEFAULT 'user' NOT NULL,
	`author_id` text,
	`source_chat_session_id` text,
	`agent_activity_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `issue_comments_issue_id_idx` ON `issue_comments` (`issue_id`);--> statement-breakpoint
CREATE TABLE `issue_field_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`field` text NOT NULL,
	`from_value` text,
	`to_value` text,
	`actor_kind` text DEFAULT 'user' NOT NULL,
	`actor_id` text,
	`source_chat_session_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `issue_field_changes_issue_id_idx` ON `issue_field_changes` (`issue_id`);--> statement-breakpoint
CREATE TABLE `issue_milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`due_date` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `issue_milestones_workspace_id_idx` ON `issue_milestones` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `issue_relations` (
	`id` text PRIMARY KEY NOT NULL,
	`source_issue_id` text NOT NULL,
	`target_issue_id` text NOT NULL,
	`type` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`source_issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `issue_relations_source_issue_id_idx` ON `issue_relations` (`source_issue_id`);--> statement-breakpoint
CREATE INDEX `issue_relations_target_issue_id_idx` ON `issue_relations` (`target_issue_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `issue_relations_pair_type_unique` ON `issue_relations` (`source_issue_id`,`target_issue_id`,`type`);--> statement-breakpoint
CREATE TABLE `issue_statuses` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`category` text DEFAULT 'unstarted' NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `issue_statuses_workspace_id_idx` ON `issue_statuses` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `issue_statuses_workspace_name_unique` ON `issue_statuses` (`workspace_id`,`name`);--> statement-breakpoint
CREATE TABLE `issues` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`number` integer NOT NULL,
	`status_id` text,
	`milestone_id` text,
	`parent_issue_id` text,
	`title` text NOT NULL,
	`description` text,
	`priority` text DEFAULT 'none' NOT NULL,
	`labels` text DEFAULT '[]' NOT NULL,
	`assignee_kind` text,
	`assignee_id` text,
	`due_date` integer,
	`created_by_kind` text DEFAULT 'user' NOT NULL,
	`created_by_id` text DEFAULT '__self__' NOT NULL,
	`source_chat_session_id` text,
	`delegate_agent_id` text,
	`delegate_provider_target_id` text,
	`context_refs` text DEFAULT '[]' NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`status_id`) REFERENCES `issue_statuses`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`milestone_id`) REFERENCES `issue_milestones`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`delegate_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`delegate_provider_target_id`) REFERENCES `provider_targets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `issues_workspace_id_idx` ON `issues` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `issues_workspace_number_unique` ON `issues` (`workspace_id`,`number`);--> statement-breakpoint
CREATE INDEX `issues_status_id_idx` ON `issues` (`status_id`);--> statement-breakpoint
CREATE INDEX `issues_milestone_id_idx` ON `issues` (`milestone_id`);--> statement-breakpoint
CREATE INDEX `issues_parent_issue_id_idx` ON `issues` (`parent_issue_id`);--> statement-breakpoint
CREATE INDEX `issues_delegate_agent_id_idx` ON `issues` (`delegate_agent_id`);--> statement-breakpoint
CREATE INDEX `issues_delegate_provider_target_id_idx` ON `issues` (`delegate_provider_target_id`);--> statement-breakpoint
CREATE TABLE `kanban_boards` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`filter_config` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `kanban_boards_workspace_id_idx` ON `kanban_boards` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `model_registry_mappings` (
	`model_id` text PRIMARY KEY NOT NULL,
	`registry_model_id` text NOT NULL,
	`match_type` text DEFAULT 'alias' NOT NULL,
	`model_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `model_registry_mappings_registry_model_idx` ON `model_registry_mappings` (`registry_model_id`);--> statement-breakpoint
CREATE TABLE `observability_events` (
	`id` text PRIMARY KEY NOT NULL,
	`schema_version` integer NOT NULL,
	`source` text NOT NULL,
	`code` text NOT NULL,
	`severity` text NOT NULL,
	`category` text NOT NULL,
	`message` text NOT NULL,
	`attrs_json` text,
	`chat_session_id` text,
	`run_id` text,
	`message_id` text,
	`trace_id` text,
	`dedupe_key` text,
	`parent_event_id` text,
	`occurred_at` integer NOT NULL,
	`recorded_at` integer NOT NULL,
	FOREIGN KEY (`chat_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`run_id`) REFERENCES `backend_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_event_id`) REFERENCES `observability_events`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `observability_events_recorded_at_idx` ON `observability_events` (`recorded_at`);--> statement-breakpoint
CREATE INDEX `observability_events_code_idx` ON `observability_events` (`code`);--> statement-breakpoint
CREATE INDEX `observability_events_run_id_idx` ON `observability_events` (`run_id`);--> statement-breakpoint
CREATE TABLE `observability_incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`dedupe_key` text NOT NULL,
	`code` text NOT NULL,
	`severity` text NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`message` text NOT NULL,
	`chat_session_id` text,
	`run_id` text,
	`message_id` text,
	`first_occurred_at` integer NOT NULL,
	`last_occurred_at` integer NOT NULL,
	`last_recorded_at` integer NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`last_event_id` text,
	`attrs_json` text,
	FOREIGN KEY (`chat_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`run_id`) REFERENCES `backend_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`last_event_id`) REFERENCES `observability_events`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `observability_incidents_dedupe_key_unique` ON `observability_incidents` (`dedupe_key`);--> statement-breakpoint
CREATE TABLE `plugin_activation_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`plugin_name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`reason` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plugin_activation_policies_plugin_unique` ON `plugin_activation_policies` (`plugin_name`);--> statement-breakpoint
CREATE TABLE `plugin_storage_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`plugin_name` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plugin_storage_entries_plugin_key_unique` ON `plugin_storage_entries` (`plugin_name`,`key`);--> statement-breakpoint
CREATE INDEX `plugin_storage_entries_plugin_idx` ON `plugin_storage_entries` (`plugin_name`);--> statement-breakpoint
CREATE TABLE `provider_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`provider_kind` text NOT NULL,
	`display_name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`icon_slug` text,
	`connection_config_json` text DEFAULT '{}' NOT NULL,
	`credential_ref` text,
	`enabled_models_json` text DEFAULT '[]' NOT NULL,
	`custom_models_json` text DEFAULT '[]' NOT NULL,
	`source_key` text,
	`external_record_id` text,
	`source_fingerprint` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "provider_targets_kind_source_shape_check" CHECK(
      (
        "provider_targets"."kind" = 'manual'
        AND "provider_targets"."source_key" IS NULL
        AND "provider_targets"."external_record_id" IS NULL
      )
      OR
      (
        "provider_targets"."kind" = 'external'
        AND "provider_targets"."source_key" IS NOT NULL
        AND "provider_targets"."external_record_id" IS NOT NULL
      )
    )
);
--> statement-breakpoint
CREATE INDEX `provider_targets_kind_idx` ON `provider_targets` (`kind`);--> statement-breakpoint
CREATE INDEX `provider_targets_enabled_idx` ON `provider_targets` (`enabled`);--> statement-breakpoint
CREATE UNIQUE INDEX `provider_targets_source_record_unique` ON `provider_targets` (`source_key`,`external_record_id`);--> statement-breakpoint
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
CREATE INDEX `relay_servers_enabled_idx` ON `relay_servers` (`enabled`);--> statement-breakpoint
CREATE TABLE `remote_hosts` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`connection_config_json` text DEFAULT '{}' NOT NULL,
	`capabilities_json` text DEFAULT '{}' NOT NULL,
	`last_seen_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `remote_hosts_enabled_idx` ON `remote_hosts` (`enabled`);--> statement-breakpoint
CREATE TABLE `provider_target_model_cache` (
	`provider_target_id` text PRIMARY KEY NOT NULL,
	`models_json` text DEFAULT '[]' NOT NULL,
	`fetched_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`provider_target_id`) REFERENCES `provider_targets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `runtime_audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider_target_id` text,
	`provider_kind` text NOT NULL,
	`action` text NOT NULL,
	`subject` text,
	`details` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`provider_target_id`) REFERENCES `provider_targets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `await_bypass_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`repo` text NOT NULL,
	`check_pattern` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_await_bypass_rules_workspace` ON `await_bypass_rules` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `github_api_cache` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`data_json` text NOT NULL,
	`etag` text,
	`fetched_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_awaits` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_session_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`source` text NOT NULL,
	`filter_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reason` text,
	`resume_text` text,
	`resume_payload_json` text,
	`failure_kind` text,
	`bypassed_checks_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`triggered_at` integer,
	`expires_at` integer,
	`fire_at` integer,
	`last_checked_at` integer,
	`last_error_text` text,
	FOREIGN KEY (`chat_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_session_awaits_status` ON `session_awaits` (`status`);--> statement-breakpoint
CREATE INDEX `idx_session_awaits_session` ON `session_awaits` (`chat_session_id`);--> statement-breakpoint
CREATE TABLE `kv_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`locator_json` text NOT NULL,
	`git_identity_json` text DEFAULT '{}' NOT NULL,
	`identifier` text DEFAULT '' NOT NULL,
	`pinned` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_locator_unique` ON `workspaces` (`locator_json`);