PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_thread_handoffs` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`source_session_id` text NOT NULL,
	`destination_session_id` text NOT NULL,
	`source_provider_target_id` text,
	`destination_provider_target_id` text,
	`imported_message_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`destination_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_provider_target_id`) REFERENCES `provider_targets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`destination_provider_target_id`) REFERENCES `provider_targets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_thread_handoffs`("id", "request_id", "source_session_id", "destination_session_id", "source_provider_target_id", "destination_provider_target_id", "imported_message_count", "created_at") SELECT "id", "request_id", "source_session_id", "destination_session_id", "source_provider_target_id", "destination_provider_target_id", "imported_message_count", "created_at" FROM `thread_handoffs`;--> statement-breakpoint
DROP TABLE `thread_handoffs`;--> statement-breakpoint
ALTER TABLE `__new_thread_handoffs` RENAME TO `thread_handoffs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `thread_handoffs_request_unique` ON `thread_handoffs` (`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `thread_handoffs_destination_unique` ON `thread_handoffs` (`destination_session_id`);--> statement-breakpoint
CREATE INDEX `thread_handoffs_source_idx` ON `thread_handoffs` (`source_session_id`,`created_at`);