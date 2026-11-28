import "server-only";
import { createClient } from "@supabase/supabase-js";

// Watch's OWN database (the Watch Supabase project). Never production.
export function watchDb() {
  const url = process.env.WATCH_SUPABASE_URL;
  const key = process.env.WATCH_SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("WATCH_SUPABASE_URL or WATCH_SUPABASE_SECRET_KEY is not set");
  return createClient(url, key, { db: { schema: "watch" }, auth: { persistSession: false, autoRefreshToken: false } });
}

export type Check = { key: string; title: string; level: "ok" | "early warning" | "critical" | "unknown"; detail: string | null; since: string };
export type Alert = { id: number; check_key: string; level: string; detail: string | null; opened_at: string; seen_at: string | null; seen_by: string | null; closed_at: string | null; sends: number };
export type Wall = {
  now: string;
  snapshot: { at: string; ok: boolean; error: string | null; data: Snapshot | null } | null;
  health: { at: string; status: number | null; ms: number | null }[];
  connections: { at: string; n: number }[];
  checks: Check[];
  alerts: Alert[];
};
export type Snapshot = {
  connections?: { max: number; total: number; active: number; idle: number; waiting_on_lock: number; longest_s: number };
  database?: { cache_hit_pct: number; size_bytes: number; deadlocks_total: number };
  queues?: Record<"email" | "telegram" | "phone", { waiting: number; oldest_s: number; failed_last_hour: number }>;
  pos?: { counters: number; counters_billing_last_30_min: number; bills_last_30_min: number };
  jobs?: { job: string; schedule: string; active: boolean; last_status: string | null; last_start: string | null; last_s: number | null; failed_24h: number }[];
  biggest_tables?: { table: string; bytes: number; rows: number }[];
  slowest?: { what: string; calls: number; mean_ms: number }[];
};

// History page (watch.history)
export type HistoryAlert = {
  id: number; check_key: string; title: string; level: string; detail: string | null;
  opened_at: string; seen_at: string | null; seen_by: string | null; closed_at: string | null; sends: number;
};
export type History = { now: string; days: number; alerts: HistoryAlert[] };

// Settings page (watch.get_settings)
export type WatchSettings = {
  values: Record<string, string>;
  connected: { telegram: boolean; email: boolean; production: boolean; github: boolean };
  changes: { at: string; key: string; old_value: string | null; new_value: string; changed_by: string }[];
};
