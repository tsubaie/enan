-- NOTIF-B05: the due-today and overdue reminders run once a day, at 04:00 UTC (07:00 in Riyadh),
-- before the office starts. The id is fixed so a restored backup and a fresh install agree.
INSERT INTO `schedules` (`id`, `kind`, `cron`, `timezone`, `payload`) VALUES
  ('01a15e8f-e11a-746f-bbee-5ffd81afb54f', 'tasks.reminders', '0 4 * * *', 'UTC', '{}')
ON CONFLICT (`id`) DO NOTHING;
