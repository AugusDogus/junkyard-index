export type NotificationDeliveryResult =
  | { success: true }
  | { success: false; error: string };
