-- NOTES-I08: voice memos on notes. A new table only: the previous release never reads it.
CREATE TABLE `note_voice_memos` (
	`id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`file_id` text NOT NULL,
	`duration_seconds` integer DEFAULT 0 NOT NULL,
	`transcript` text,
	`transcription_status` text DEFAULT 'pending' NOT NULL,
	`transcription_job_id` text,
	`transcription_error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by` text,
	`deleted_at` integer,
	`deleted_op_id` text,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`transcription_job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "note_voice_memos_duration_check" CHECK("note_voice_memos"."duration_seconds" between 0 and 900),
	CONSTRAINT "note_voice_memos_status_check" CHECK("note_voice_memos"."transcription_status" in ('pending', 'done', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE INDEX `note_voice_memos_note_idx` ON `note_voice_memos` (`note_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `note_voice_memos_file_idx` ON `note_voice_memos` (`file_id`);--> statement-breakpoint
CREATE INDEX `note_voice_memos_job_idx` ON `note_voice_memos` (`transcription_job_id`);--> statement-breakpoint
CREATE INDEX `note_voice_memos_creator_idx` ON `note_voice_memos` (`created_by`);