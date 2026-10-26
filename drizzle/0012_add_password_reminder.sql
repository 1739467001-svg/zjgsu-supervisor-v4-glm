-- 通知类型增加 password_reminder（初始密码改密提醒，2026-10-26 用户需求）
ALTER TABLE `notifications` MODIFY COLUMN `type` enum('evaluation_complete','plan_reminder','system','password_reminder') NOT NULL;
