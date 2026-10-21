-- Reorder gives the rows it moves the places they held (EP-B46, COMM-B04). Before that, committee and
-- objective reorder wrote 0..n-1 for the visible rows, which could leave two rows on one place; a
-- swap of those two would then change nothing. Each list is renumbered once, in its current order.
UPDATE `objectives` SET `sort_order` = `ranked`.`place`
FROM (SELECT `id`, row_number() OVER (ORDER BY `sort_order`, `id`) - 1 AS `place` FROM `objectives`) AS `ranked`
WHERE `ranked`.`id` = `objectives`.`id`;
--> statement-breakpoint
UPDATE `committees` SET `sort_order` = `ranked`.`place`
FROM (SELECT `id`, row_number() OVER (ORDER BY `sort_order`, `id`) - 1 AS `place` FROM `committees`) AS `ranked`
WHERE `ranked`.`id` = `committees`.`id`;
