interface SearchContext {
  query: string;
  query_length: number;
  result_count?: number;
  search_time_ms?: number;
  locations_covered?: number;
}

export const AnalyticsEvents = {
  // Landing / marketing
  LANDING_SEARCH_SUBMITTED: "landing_search_submitted",
  PRICING_CTA_CLICKED: "pricing_cta_clicked",

  // Search
  SEARCH_SUBMITTED: "search_submitted",
  SEARCH_COMPLETED: "search_completed",
  SEARCH_EMPTY: "search_empty",
  SEARCH_FAILED: "search_failed",
  SEARCH_SUGGESTION_CLICKED: "search_suggestion_clicked",
  RESULT_CAP_REACHED: "result_cap_reached",
  RESULT_CAP_SIGNUP_CLICKED: "result_cap_signup_clicked",
  RESULT_CAP_PRICING_CLICKED: "result_cap_pricing_clicked",

  // Filters & Sort
  FILTER_APPLIED: "filter_applied",
  FILTERS_CLEARED: "filters_cleared",
  SORT_CHANGED: "sort_changed",

  // Results
  VEHICLE_DETAILS_CLICKED: "vehicle_details_clicked",

  // Saved Searches
  SAVE_SEARCH_DIALOG_OPENED: "save_search_dialog_opened",
  SAVE_SEARCH_DIALOG_CANCELLED: "save_search_dialog_cancelled",
  SAVED_SEARCH_CREATED: "saved_search_created",
  SAVED_SEARCH_DELETED: "saved_search_deleted",
  SAVED_SEARCH_LOADED: "saved_search_loaded",
  SAVED_SEARCH_EMAIL_TOGGLED: "saved_search_email_alerts_toggled",
  SAVED_SEARCH_DISCORD_TOGGLED: "saved_search_discord_alerts_toggled",
  SAVED_SEARCH_AUTH_REQUIRED: "saved_search_auth_required",

  // Auth
  SIGN_IN_SUBMITTED: "sign_in_submitted",
  SIGN_IN_SUCCEEDED: "sign_in_succeeded",
  SIGN_IN_FAILED: "sign_in_failed",
  SIGN_UP_SUBMITTED: "sign_up_submitted",
  SIGN_UP_SUCCEEDED: "sign_up_succeeded",
  SIGN_UP_FAILED: "sign_up_failed",
  SIGN_IN_VIEWED: "sign_in_viewed",
  SIGN_UP_VIEWED: "sign_up_viewed",
  SIGN_OUT_CLICKED: "sign_out_clicked",
  FORGOT_PASSWORD_CLICKED: "forgot_password_clicked",

  // Subscription
  CHECKOUT_INITIATED: "checkout_initiated",
  SUBSCRIPTION_PORTAL_OPENED: "subscription_portal_opened",
  SUBSCRIPTION_ACTIVATED: "subscription_activated",
  SUBSCRIPTION_CREATED: "subscription_created",
  SUBSCRIPTION_STATE_CHANGED: "subscription_state_changed",

  // Account & Settings
  ACCOUNT_DELETED: "account_deleted",
  THEME_CHANGED: "theme_changed",

  // Discord
  DISCORD_SIGN_IN_INITIATED: "discord_sign_in_initiated",
  DISCORD_APP_VERIFIED: "discord_app_verified",
  DISCORD_APP_VERIFY_FAILED: "discord_app_verify_failed",
  DISCORD_APP_DISCONNECTED: "discord_app_disconnected",

  // Unsubscribe
  EMAIL_UNSUBSCRIBED: "email_unsubscribed",
  EMAIL_UNSUBSCRIBE_FAILED: "email_unsubscribe_failed",

  // Alerts Cron
  ALERT_CRON_COMPLETED: "alert_cron_completed",
  ALERT_NOTIFICATION_SENT: "alert_notification_sent",
  ALERT_SUBSCRIPTION_EXPIRED: "alert_subscription_expired",

  // Monetization
  SAVED_SEARCH_LIMIT_REACHED: "saved_search_limit_reached",
} as const;

export type AnalyticsEventName =
  (typeof AnalyticsEvents)[keyof typeof AnalyticsEvents];

export function buildSearchContext(
  query: string,
  resultCount?: number,
  searchTimeMs?: number,
  locationsCovered?: number,
): SearchContext {
  return {
    query,
    query_length: query.trim().length,
    result_count: resultCount,
    search_time_ms: searchTimeMs,
    locations_covered: locationsCovered,
  };
}

export type { SearchContext };
