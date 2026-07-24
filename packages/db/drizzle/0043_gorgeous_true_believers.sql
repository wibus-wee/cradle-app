ALTER TABLE `worktrees` ADD `size_bytes` integer;--> statement-breakpoint
ALTER TABLE `worktrees` ADD `size_measured_at` integer;--> statement-breakpoint
ALTER TABLE `worktrees` ADD `size_measurement_error` text;