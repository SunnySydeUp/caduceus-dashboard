/** The scheduler ticks every 60 s; Hermes's own dashboard and CLI call it stale after three missed ticks and some slack. Health (server) and Work › Schedules (web) both judge a heartbeat by this. */
export const SCHEDULER_STALE_AFTER_S = 3 * 60 + 20;
