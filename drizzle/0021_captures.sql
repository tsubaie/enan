-- CAPTURES-I01: voice captures and their suggestions (ADR 0071). New tables only: the previous
-- release never reads them, and note_voice_memos is neither read nor rewritten.
CREATE TABLE `capture_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`capture_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`field_states` text DEFAULT '{}' NOT NULL,
	`source_spans` text DEFAULT '[]' NOT NULL,
	`type_flag` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`live_entity_type` text,
	`live_entity_id` text,
	`live_revision_at_approve` integer,
	`merge_target_id` text,
	`approved_at` integer,
	`approved_by` text,
	`discarded_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by` text,
	`deleted_at` integer,
	`deleted_op_id` text,
	FOREIGN KEY (`capture_id`) REFERENCES `captures`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`merge_target_id`) REFERENCES `capture_suggestions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "capture_suggestions_kind_check" CHECK("capture_suggestions"."kind" in ('task', 'meeting_note', 'committee_note')),
	CONSTRAINT "capture_suggestions_type_flag_check" CHECK("capture_suggestions"."type_flag" in ('task', 'meeting_note', 'committee_note')),
	CONSTRAINT "capture_suggestions_status_check" CHECK("capture_suggestions"."status" in ('pending', 'approved', 'discarded', 'merged')),
	CONSTRAINT "capture_suggestions_live_type_check" CHECK("capture_suggestions"."live_entity_type" in ('task', 'note'))
);
--> statement-breakpoint
CREATE INDEX `capture_suggestions_capture_idx` ON `capture_suggestions` (`capture_id`,`status`) WHERE "capture_suggestions"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `capture_suggestions_live_idx` ON `capture_suggestions` (`live_entity_id`);--> statement-breakpoint
CREATE INDEX `capture_suggestions_merge_idx` ON `capture_suggestions` (`merge_target_id`);--> statement-breakpoint
CREATE INDEX `capture_suggestions_approver_idx` ON `capture_suggestions` (`approved_by`);--> statement-breakpoint
CREATE INDEX `capture_suggestions_creator_idx` ON `capture_suggestions` (`created_by`);--> statement-breakpoint
CREATE TABLE `captures` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`file_id` text NOT NULL,
	`duration_seconds` integer DEFAULT 0 NOT NULL,
	`transcript` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`error_code` text,
	`error_detail` text,
	`context_committee_id` text,
	`context_note_type` text,
	`transcribe_job_id` text,
	`interpret_job_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by` text,
	`updated_by` text,
	`deleted_at` integer,
	`deleted_op_id` text,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`context_committee_id`) REFERENCES `committees`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`transcribe_job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`interpret_job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "captures_duration_check" CHECK("captures"."duration_seconds" between 0 and 900),
	CONSTRAINT "captures_status_check" CHECK("captures"."status" in ('queued', 'transcribing', 'interpreting', 'ready', 'needs_transcript', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `captures_creator_idx` ON `captures` (`created_by`,`created_at`) WHERE "captures"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `captures_status_idx` ON `captures` (`status`);--> statement-breakpoint
CREATE INDEX `captures_file_idx` ON `captures` (`file_id`);--> statement-breakpoint
CREATE INDEX `captures_committee_idx` ON `captures` (`context_committee_id`);--> statement-breakpoint
CREATE INDEX `captures_transcribe_job_idx` ON `captures` (`transcribe_job_id`);--> statement-breakpoint
CREATE INDEX `captures_interpret_job_idx` ON `captures` (`interpret_job_id`);--> statement-breakpoint
CREATE INDEX `captures_updater_idx` ON `captures` (`updated_by`);