ALTER TABLE `automation_runs` ADD `result_kind` text;--> statement-breakpoint
ALTER TABLE `automation_runs` ADD `result_summary` text;--> statement-breakpoint
ALTER TABLE `automation_runs` ADD `triage_status` text;--> statement-breakpoint
ALTER TABLE `automation_runs` ADD `triaged_at` integer;--> statement-breakpoint
CREATE INDEX `automation_runs_triage_status_idx` ON `automation_runs` (`triage_status`,`finished_at`);