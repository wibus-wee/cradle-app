CREATE TABLE IF NOT EXISTS `provider_extension_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_target_id` text NOT NULL,
	`extension_owner` text NOT NULL,
	`extension_id` text NOT NULL,
	`desired_enabled` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'disabled' NOT NULL,
	`activation_json` text DEFAULT '{}' NOT NULL,
	`output_credential_ref` text,
	`source_fingerprint` text,
	`credential_strategy` text,
	`credential_owner` text DEFAULT 'host' NOT NULL,
	`lease_epoch` integer DEFAULT 0 NOT NULL,
	`lease_phase` text DEFAULT 'none' NOT NULL,
	`lease_state_json` text DEFAULT '{}' NOT NULL,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`provider_target_id`) REFERENCES `provider_targets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`output_credential_ref`) REFERENCES `agent_credentials`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `provider_extension_bindings_target_idx` ON `provider_extension_bindings` (`provider_target_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `provider_extension_bindings_owner_idx` ON `provider_extension_bindings` (`extension_owner`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `provider_extension_bindings_status_idx` ON `provider_extension_bindings` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `provider_extension_bindings_target_extension_unique` ON `provider_extension_bindings` (`provider_target_id`,`extension_owner`,`extension_id`);
