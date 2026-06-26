// dates.js — ONE source of truth for day math. calDate / unlocatedSince are
// date-only ISO strings (YYYY-MM-DD) interpreted as UTC midnight EVERYWHERE,
// so model.js and workflows.js can never disagree by a timezone offset (ISS-5).
export const DAY_MS = 86400000;
export const toDay = (s) => new Date(s + 'T00:00:00Z');        // ISO day-string → UTC midnight
export const isoDay = (d) => d.toISOString().slice(0, 10);     // Date → YYYY-MM-DD (UTC)
export const today = (now = new Date()) => toDay(isoDay(now)); // wall-clock now → stable UTC day
export const daysBetween = (due, ref) => Math.floor((due.getTime() - ref.getTime()) / DAY_MS);
