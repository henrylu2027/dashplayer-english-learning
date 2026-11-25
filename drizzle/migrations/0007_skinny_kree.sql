CREATE TABLE `dp_shadowing_attempt` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_kind` text NOT NULL,
	`video_key` text,
	`sentence_index` integer,
	`video_path` text,
	`subtitle_path` text,
	`reference_text` text NOT NULL,
	`recognized_text` text NOT NULL,
	`score` integer NOT NULL,
	`accuracy` integer NOT NULL,
	`completeness` integer NOT NULL,
	`words_per_minute` integer NOT NULL,
	`duration_sec` real NOT NULL,
	`word_feedback` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dp_shadowing_attempt_created_at_idx` ON `dp_shadowing_attempt` (`created_at`);--> statement-breakpoint
CREATE INDEX `dp_shadowing_attempt_video_sentence_idx` ON `dp_shadowing_attempt` (`video_key`,`sentence_index`,`created_at`);