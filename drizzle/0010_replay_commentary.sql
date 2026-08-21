ALTER TABLE `replay_sessions` ADD `commentary_path` text;--> statement-breakpoint
ALTER TABLE `replay_sessions` ADD `commentary_offset_ms` integer DEFAULT 0 NOT NULL;
