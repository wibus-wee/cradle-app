CREATE TABLE `session_await_live_status_snapshots` (
	`await_id` text PRIMARY KEY NOT NULL,
	`status_json` text NOT NULL,
	`captured_at` integer NOT NULL,
	FOREIGN KEY (`await_id`) REFERENCES `session_awaits`(`id`) ON UPDATE no action ON DELETE cascade
);
