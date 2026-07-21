UPDATE `backend_runs`
SET
	`status` = 'failed',
	`stop_reason` = 'response.interrupted',
	`error_text` = 'Response interrupted because the Cradle server process exited while the run was streaming.',
	`finished_at` = coalesce(`finished_at`, unixepoch())
WHERE `status` = 'streaming';--> statement-breakpoint
CREATE UNIQUE INDEX `backend_runs_one_streaming_per_session_unique` ON `backend_runs` (`chat_session_id`) WHERE "backend_runs"."status" = 'streaming';
