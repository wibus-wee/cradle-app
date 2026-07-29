ALTER TABLE `usage_logs` ADD `cache_write_input_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `usage_logs` ADD `provider_total_cache_write_input_tokens` integer;