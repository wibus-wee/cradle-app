ALTER TABLE `session_events` ADD `subject_run_id` text GENERATED ALWAYS AS (case
      when event_type = 'RunStarted' then json_extract(payload, '$.run.id')
      when event_type in ('RunCompleted', 'RunFailed', 'RunAborted') then json_extract(payload, '$.runId')
      else null
    end) VIRTUAL;--> statement-breakpoint
CREATE UNIQUE INDEX `session_events_terminal_fact_run_unique` ON `session_events` (`aggregate_id`,`subject_run_id`) WHERE "session_events"."event_type" in ('RunCompleted', 'RunFailed', 'RunAborted') and "session_events"."subject_run_id" is not null;
