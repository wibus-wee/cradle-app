CREATE TABLE `run_stream_checkpoints` (
	`run_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`message_id` text NOT NULL,
	`message_json` text NOT NULL,
	`chunk_seq` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `run_stream_checkpoints_session_idx` ON `run_stream_checkpoints` (`session_id`);
--> statement-breakpoint
-- One-time purge of legacy streaming checkpoint facts. Version holes are acceptable:
-- aggregate versions are monotonically increasing but not contiguous.
DELETE FROM `session_events` WHERE `event_type` = 'AssistantMessageSnapshotted';