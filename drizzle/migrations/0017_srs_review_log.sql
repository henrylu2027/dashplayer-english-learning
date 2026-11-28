ALTER TABLE `dp_srs_card` ADD `mastered_at` integer;--> statement-breakpoint
CREATE TABLE `dp_srs_review_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` integer NOT NULL,
	`form` text NOT NULL,
	`score` integer,
	`passed` integer,
	`verdict` text NOT NULL,
	`error_tags` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `dp_srs_review_log_card_idx` ON `dp_srs_review_log` (`card_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `dp_srs_review_log_created_idx` ON `dp_srs_review_log` (`created_at`);
