CREATE TABLE `diff_review_guides` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`provider_target_id` text,
	`runtime_kind` text NOT NULL,
	`model_id` text,
	`input_hash` text NOT NULL,
	`status` text NOT NULL,
	`steps_json` text DEFAULT '[]' NOT NULL,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `diff_reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`revision_id`) REFERENCES `diff_review_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diff_review_guides_review_id_idx` ON `diff_review_guides` (`review_id`);--> statement-breakpoint
CREATE INDEX `diff_review_guides_revision_id_idx` ON `diff_review_guides` (`revision_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `diff_review_guides_review_revision_unique` ON `diff_review_guides` (`review_id`,`revision_id`);