ALTER TABLE `replay_sessions` ADD COLUMN `full_video_encode_path` text;
--> statement-breakpoint
ALTER TABLE `replay_sessions` ADD COLUMN `full_video_youtube_id` text;
--> statement-breakpoint
ALTER TABLE `replay_sessions` ADD COLUMN `full_video_privacy` text;
--> statement-breakpoint
ALTER TABLE `replay_sessions` ADD COLUMN `full_video_published_at` integer;
