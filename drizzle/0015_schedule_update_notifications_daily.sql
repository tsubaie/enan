-- ADMIN-B59, ADR 0059: update notifications are queued when the updater writes its status; the
-- schedule from 0008 stays as a daily safety net, which also notices an updater that stopped.
UPDATE `schedules` SET `cron` = '30 4 * * *'
WHERE `id` = '01a17d2c-5e1b-7c3a-9f4e-2b8d6c0a1e57' AND `cron` = '*/5 * * * *';
