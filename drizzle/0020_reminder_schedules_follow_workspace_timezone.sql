-- NOTIF-B05, KPIS-B30: the reminder jobs decide "today" on the workspace day, so their schedules
-- run in the workspace's time zone rather than UTC: 04:00 and 05:00 where the office is, and the
-- settings service keeps them there when the zone changes. A workspace with no stored zone, as
-- after a fresh install, stays on UTC, which is the setting's default. The next run is the first
-- occurrence in the new zone: a westward move must not run today's reminders a second time.
UPDATE `schedules` SET `timezone` = coalesce(
  (SELECT json_extract(`value`, '$') FROM `settings` WHERE `key` = 'workspace.timezone' AND `user_id` IS NULL),
  'UTC'),
  `last_occurrence` = cast(unixepoch('subsec') * 1000 as integer),
  `updated_at` = cast(unixepoch('subsec') * 1000 as integer)
WHERE `kind` IN ('tasks.reminders', 'kpis.reminders');
