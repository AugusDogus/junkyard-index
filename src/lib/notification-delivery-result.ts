export type NotificationDeliveryResult =
  | { success: true }
  | { success: false; error: string };

export type NotificationBatchDeliveryResult =
  | { success: true; sentSearchIds: readonly string[] }
  | { success: false; error: string; sentSearchIds: readonly string[] };
