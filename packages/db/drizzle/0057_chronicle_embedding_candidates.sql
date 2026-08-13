CREATE TABLE `chronicle_memory_embedding_buckets` (
	`id` text PRIMARY KEY NOT NULL,
	`embedding_id` text NOT NULL,
	`memory_id` text NOT NULL,
	`model_id` text NOT NULL,
	`model_version` text NOT NULL,
	`band_index` integer NOT NULL,
	`bucket_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`embedding_id`) REFERENCES `chronicle_memory_embeddings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`memory_id`) REFERENCES `chronicle_memories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicle_memory_embedding_buckets_embedding_band_unique` ON `chronicle_memory_embedding_buckets` (`embedding_id`,`band_index`);
--> statement-breakpoint
CREATE INDEX `chronicle_memory_embedding_buckets_candidate_idx` ON `chronicle_memory_embedding_buckets` (`model_id`,`model_version`,`band_index`,`bucket_key`);
--> statement-breakpoint
CREATE INDEX `chronicle_memory_embedding_buckets_memory_id_idx` ON `chronicle_memory_embedding_buckets` (`memory_id`);
