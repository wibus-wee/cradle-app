ALTER TABLE `chronicle_audio_segments` ADD `speaker_profile_id` text;--> statement-breakpoint
ALTER TABLE `chronicle_audio_segments` ADD `speaker_assignment_source` text DEFAULT 'unassigned' NOT NULL;--> statement-breakpoint
ALTER TABLE `chronicle_audio_segments` ADD `speaker_match_confidence_bps` integer;--> statement-breakpoint
CREATE INDEX `chronicle_audio_segments_speaker_profile_id_idx` ON `chronicle_audio_segments` (`speaker_profile_id`);--> statement-breakpoint
ALTER TABLE `chronicle_speaker_profiles` ADD `identity_source` text DEFAULT 'automatic' NOT NULL;