CREATE TABLE `blobs` (
	`id` text PRIMARY KEY NOT NULL,
	`sha256` text NOT NULL,
	`media_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`storage_path` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blobs_sha256_unique` ON `blobs` (`sha256`);--> statement-breakpoint
CREATE TABLE `chat_message_blob_refs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`message_id` text NOT NULL,
	`part_path` text NOT NULL,
	`kind` text NOT NULL,
	`blob_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`blob_id`) REFERENCES `blobs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `chat_message_blob_refs_session_id_idx` ON `chat_message_blob_refs` (`session_id`);--> statement-breakpoint
CREATE INDEX `chat_message_blob_refs_message_id_idx` ON `chat_message_blob_refs` (`message_id`);--> statement-breakpoint
CREATE INDEX `chat_message_blob_refs_blob_id_idx` ON `chat_message_blob_refs` (`blob_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `chat_message_blob_refs_message_part_path_unique` ON `chat_message_blob_refs` (`message_id`,`part_path`);