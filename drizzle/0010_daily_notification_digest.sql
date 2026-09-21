CREATE TABLE `search_notification_delivery` (
	`user_id` text NOT NULL,
	`channel` text NOT NULL,
	`delivered_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `channel`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `search_notification_intent` ADD `delivery_group_id` text;--> statement-breakpoint
CREATE INDEX `search_notification_intent_recipient_idx` ON `search_notification_intent` (`user_id`,`channel`,`status`);--> statement-breakpoint
-- Preserve the daily limit for notifications sent before this deployment.
INSERT INTO search_notification_delivery (user_id, channel, delivered_at)
SELECT user_id, channel, max(delivered_at)
FROM search_notification_intent
WHERE status = 'delivered' AND delivered_at IS NOT NULL
GROUP BY user_id, channel;
--> statement-breakpoint
-- Keep provider idempotency keys for deliveries already attempted by the old worker.
UPDATE search_notification_intent
SET delivery_group_id = CASE channel
  WHEN 'email' THEN 'email:' || run_id || ':' || publication_sequence || ':' || user_id
  ELSE id
END
WHERE attempts > 0 AND status IN ('pending', 'retry', 'sending');
--> statement-breakpoint
-- Migration runs before the application build. Keep writes by the old deployment
-- compatible until its queued workflows have drained, including on a rollback.
CREATE TRIGGER search_notification_legacy_claim
AFTER UPDATE OF attempts ON search_notification_intent
WHEN NEW.attempts > 0 AND NEW.delivery_group_id IS NULL
BEGIN
  UPDATE search_notification_intent
  SET delivery_group_id = CASE NEW.channel
    WHEN 'email' THEN 'email:' || NEW.run_id || ':' || NEW.publication_sequence || ':' || NEW.user_id
    ELSE NEW.id
  END
  WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER search_notification_delivered_history
AFTER UPDATE OF status, delivered_at ON search_notification_intent
WHEN NEW.status = 'delivered' AND NEW.delivered_at IS NOT NULL
BEGIN
  INSERT INTO search_notification_delivery (user_id, channel, delivered_at)
  VALUES (NEW.user_id, NEW.channel, NEW.delivered_at)
  ON CONFLICT (user_id, channel) DO UPDATE
  SET delivered_at = max(delivered_at, excluded.delivered_at);
END;
