DROP INDEX `blobs_sha256_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `blobs_sha256_media_type_unique` ON `blobs` (`sha256`,`media_type`);