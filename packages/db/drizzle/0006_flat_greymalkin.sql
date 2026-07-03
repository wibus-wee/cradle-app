ALTER TABLE `sessions` ADD `origin` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
CREATE INDEX `sessions_origin_idx` ON `sessions` (`origin`);