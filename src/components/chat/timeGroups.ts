import type { ChatListItem } from "@/types/db";

export type TimeBucket = "Today" | "Yesterday" | "Previous 7 days" | "Older";
export const BUCKET_ORDER: TimeBucket[] = ["Today", "Yesterday", "Previous 7 days", "Older"];

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function bucketFor(iso: string | null, now = new Date()): TimeBucket {
  if (!iso) return "Older";
  const d = new Date(iso);
  const today = startOfLocalDay(now).getTime();
  const yesterday = today - 24 * 60 * 60 * 1000;
  const sevenDaysAgo = today - 7 * 24 * 60 * 60 * 1000;
  const t = d.getTime();
  if (t >= today) return "Today";
  if (t >= yesterday) return "Yesterday";
  if (t >= sevenDaysAgo) return "Previous 7 days";
  return "Older";
}

export function groupByBucket(items: ChatListItem[], now = new Date()) {
  const map = new Map<TimeBucket, ChatListItem[]>();
  for (const b of BUCKET_ORDER) map.set(b, []);
  for (const it of items) {
    const b = bucketFor(it.last_message_at ?? it.updated_at ?? it.created_at, now);
    map.get(b)!.push(it);
  }
  return BUCKET_ORDER.filter((b) => map.get(b)!.length > 0).map((b) => ({
    label: b,
    items: map.get(b)!,
  }));
}

const RTF = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function relativeTime(iso: string | null, now = new Date()): string {
  if (!iso) return "";
  const diffMs = new Date(iso).getTime() - now.getTime();
  const minutes = Math.round(diffMs / 60000);
  if (Math.abs(minutes) < 60) return RTF.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return RTF.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return RTF.format(days, "day");
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return RTF.format(months, "month");
  const years = Math.round(months / 12);
  return RTF.format(years, "year");
}
