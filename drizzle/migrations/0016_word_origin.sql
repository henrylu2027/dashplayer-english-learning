ALTER TABLE `dp_words` ADD `learned_at` integer;--> statement-breakpoint
CREATE TABLE `dp_word_origin` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`word` text NOT NULL,
	`module` text NOT NULL,
	`sentence` text NOT NULL,
	`sentence_key` text NOT NULL,
	`video_key` text,
	`sentence_index` integer,
	`video_path` text,
	`subtitle_path` text,
	`created_at` integer NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `dp_word_origin_word_sentence_unique` ON `dp_word_origin` (`word`,`sentence_key`);--> statement-breakpoint
CREATE INDEX `dp_word_origin_word_idx` ON `dp_word_origin` (`word`);
