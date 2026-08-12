-- Make rpy_path optional for OBS / media-only sessions and store race analysis package.
ALTER TABLE `replay_sessions` ADD COLUMN `race_package` text;
