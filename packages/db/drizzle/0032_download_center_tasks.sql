CREATE TABLE `download_center_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_namespace` text NOT NULL,
	`owner_resource_type` text NOT NULL,
	`owner_resource_id` text NOT NULL,
	`display_name` text NOT NULL,
	`file_name` text NOT NULL,
	`source_id` text,
	`status` text NOT NULL,
	`transferred_bytes` integer DEFAULT 0 NOT NULL,
	`total_bytes` integer,
	`checksum_algorithm` text,
	`expected_checksum` text,
	`actual_checksum` text,
	`expected_bytes` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 1 NOT NULL,
	`etag` text,
	`error_code` text,
	`error_message` text,
	`started_at` integer,
	`finished_at` integer,
	`artifact_released_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `download_center_tasks_status_idx` ON `download_center_tasks` (`status`);--> statement-breakpoint
CREATE INDEX `download_center_tasks_updated_at_idx` ON `download_center_tasks` (`updated_at`);--> statement-breakpoint
CREATE INDEX `download_center_tasks_owner_idx` ON `download_center_tasks` (`owner_namespace`,`owner_resource_type`,`owner_resource_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_session_pinned_messages` (
	`session_id` text NOT NULL,
	`message_id` text NOT NULL,
	`label` text,
	`done` integer DEFAULT false NOT NULL,
	`pinned_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`session_id`, `message_id`),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_session_pinned_messages`("session_id", "message_id", "label", "done", "pinned_at", "updated_at") SELECT "session_id", "message_id", "label", "done", "pinned_at", "updated_at" FROM `session_pinned_messages`;--> statement-breakpoint
DROP TABLE `session_pinned_messages`;--> statement-breakpoint
ALTER TABLE `__new_session_pinned_messages` RENAME TO `session_pinned_messages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `session_pinned_messages_session_idx` ON `session_pinned_messages` (`session_id`,`pinned_at`);--> statement-breakpoint
CREATE TABLE `__new_session_text_markers` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`message_id` text NOT NULL,
	`start_offset` integer NOT NULL,
	`end_offset` integer NOT NULL,
	`selected_text` text NOT NULL,
	`style` text NOT NULL,
	`color` text NOT NULL,
	`label` text,
	`done` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_session_text_markers`("id", "session_id", "message_id", "start_offset", "end_offset", "selected_text", "style", "color", "label", "done", "created_at", "updated_at") SELECT "id", "session_id", "message_id", "start_offset", "end_offset", "selected_text", "style", "color", "label", "done", "created_at", "updated_at" FROM `session_text_markers`;--> statement-breakpoint
DROP TABLE `session_text_markers`;--> statement-breakpoint
ALTER TABLE `__new_session_text_markers` RENAME TO `session_text_markers`;--> statement-breakpoint
CREATE INDEX `session_text_markers_session_idx` ON `session_text_markers` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `session_text_markers_message_range_idx` ON `session_text_markers` (`message_id`,`start_offset`,`end_offset`);