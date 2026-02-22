// scripts/generate_timeblocking.mjs
// Generates docs/timeblocking.ics from the Sunset DJs gigs API (dj=javi)
//
// Output: a "visual-only" subscribed calendar with morning blocks that avoid
// (gig time + 1h before + 1h after). Does NOT include the gigs themselves.
//
// Timezone: Asia/Dubai
// Window: breakfast 08:00–08:30 (no event), blocks from 08:30 to before leaving.
// If no gig that day, end at 13:00. No afternoon blocks.
// Days: next 7 days, Mon–Fri only.
//
// Priorities: Music (30m) > Nibango (90m) > YouTube (60m)

import fs from "node:fs";
import path from "node:path";
import https from "node:https";

const TZID = "Asia/Dubai";
const DJ = process.env.DJ ?? "javi";
const API_URL = process.env.GIGS_URL ?? `https://sunsetdjsnew-production.up.railway.app/api/gigs/?dj=${encodeURIComponent(DJ)}`;

const DAYS = Number(process.env.DAYS ?? 7);

// Morning rules
const BREAKFAST_END = "08:30"; // blocks start here
const DEFAULT_END = "13:00";   // if no gig/buffer that morning, stop here
const BREAK_MIN = 15;

// Blocks (priority order)
const BLOCKS = [
    { key: "music", title: "Música (escuchar/descargar)", minutes: 30 },
    { key: "nibango", title: "Nibango (deep work)", minutes: 90 },
    { key: "youtube", title: "YouTube (vídeo viernes)", minutes: 60 },
];

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https
            .get(url, (res) => {
                let data = "";
                res.on("data", (chunk) => (data += chunk));
                res.on("end", () => {
                    if (res.statusCode < 200 || res.statusCode >= 300) {
                        return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
                    }
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(e);
                    }
                });
            })
            .on("error", reject);
    });
}

function pad2(n) {
    return String(n).padStart(2, "0");
}

function ymdToDateParts(ymd) {
    const [y, m, d] = ymd.split("-").map(Number);
    return { y, m, d };
}

function addDaysYmd(ymd, add) {
    const { y, m, d } = ymdToDateParts(ymd);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + add);
    return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function weekdayIndexUTC(ymd) {
    const { y, m, d } = ymdToDateParts(ymd);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCDay(); // 0 Sun ... 6 Sat
}

function parseTime12h(s) {
    // "02:45 PM" -> { hh: 14, mm: 45 }
    const m = s.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!m) throw new Error(`Bad time: ${s}`);
    let hh = Number(m[1]);
    const mm = Number(m[2]);
    const ap = m[3].toUpperCase();
    if (ap === "AM") {
        if (hh === 12) hh = 0;
    } else {
        if (hh !== 12) hh += 12;
    }
    return { hh, mm };
}

function parseRange(range) {
    // "02:45 PM - 06:45 PM"
    const parts = range.split("-").map((x) => x.trim());
    if (parts.length !== 2) throw new Error(`Bad range: ${range}`);
    const a = parseTime12h(parts[0]);
    const b = parseTime12h(parts[1]);
    return { start: a, end: b };
}

function hmToMinutes(hm) {
    const [h, m] = hm.split(":").map(Number);
    return h * 60 + m;
}

function minutesToHm(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${pad2(h)}:${pad2(m)}`;
}

function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
}

function mergeIntervals(intervals) {
    // intervals = [{startMin, endMin}] within a day (0..1440)
    const sorted = intervals
        .filter((i) => i.endMin > i.startMin)
        .sort((a, b) => a.startMin - b.startMin);

    const merged = [];
    for (const i of sorted) {
        const last = merged[merged.length - 1];
        if (!last || i.startMin > last.endMin) merged.push({ ...i });
        else last.endMin = Math.max(last.endMin, i.endMin);
    }
    return merged;
}

function subtractIntervals(available, busy) {
    // both merged, within a day
    let out = [];
    for (const a of available) {
        let cursor = a.startMin;
        for (const b of busy) {
            if (b.endMin <= cursor) continue;
            if (b.startMin >= a.endMin) break;
            if (b.startMin > cursor) out.push({ startMin: cursor, endMin: Math.min(b.startMin, a.endMin) });
            cursor = Math.max(cursor, b.endMin);
            if (cursor >= a.endMin) break;
        }
        if (cursor < a.endMin) out.push({ startMin: cursor, endMin: a.endMin });
    }
    return out;
}

function dtLocalFloating(ymd, hm) {
    // ICS local time with TZID
    // ymd=YYYY-MM-DD, hm=HH:MM
    const { y, m, d } = ymdToDateParts(ymd);
    const [H, M] = hm.split(":").map(Number);
    return `${y}${pad2(m)}${pad2(d)}T${pad2(H)}${pad2(M)}00`;
}

function uidForEvent(key, ymd, startHm) {
    // Stable UID so calendar updates cleanly
    return `tb-${DJ}-${key}-${ymd}-${startHm.replace(":", "")}@javibeat`;
}

function buildIcs(events) {
    const lines = [];
    lines.push("BEGIN:VCALENDAR");
    lines.push("VERSION:2.0");
    lines.push("PRODID:-//JaviBeat//Timeblocking//EN");
    lines.push("CALSCALE:GREGORIAN");
    lines.push("METHOD:PUBLISH");
    lines.push("X-WR-CALNAME:Timeblocking");
    lines.push("X-WR-TIMEZONE:" + TZID);

    const dtstamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

    for (const ev of events) {
        lines.push("BEGIN:VEVENT");
        lines.push(`UID:${ev.uid}`);
        lines.push(`DTSTAMP:${dtstamp}`);
        lines.push(`SUMMARY:${ev.summary}`);
        lines.push(`DTSTART;TZID=${TZID}:${ev.dtstart}`);
        lines.push(`DTEND;TZID=${TZID}:${ev.dtend}`);
        lines.push("STATUS:CONFIRMED");
        lines.push("TRANSP:OPAQUE"); // show as busy (visual)
        lines.push("END:VEVENT");
    }

    lines.push("END:VCALENDAR");
    return lines.join("\r\n") + "\r\n";
}

function chooseMorningEnd(busyMerged, defaultEndMin) {
    // Find earliest busy interval start that is AFTER morning start (08:30).
    // If busy starts earlier than 08:30, it doesn't matter for morning blocks.
    // If there is a busy block later, we end before it.
    let earliest = null;
    for (const b of busyMerged) {
        if (b.endMin <= hmToMinutes(BREAKFAST_END)) continue;
        earliest = b.startMin;
        break;
    }
    if (earliest == null) return defaultEndMin;
    return clamp(earliest, 0, defaultEndMin);
}

function scheduleBlocks(freeIntervals, ymd) {
    const events = [];

    // Greedy scheduling into the earliest free time, with small breaks between blocks.
    let remainingFree = freeIntervals.slice();

    for (const blk of BLOCKS) {
        // find first interval big enough
        const needed = blk.minutes;
        let placed = false;

        for (let idx = 0; idx < remainingFree.length; idx++) {
            const it = remainingFree[idx];
            const len = it.endMin - it.startMin;
            if (len < needed) continue;

            const startMin = it.startMin;
            const endMin = startMin + needed;

            const startHm = minutesToHm(startMin);
            const endHm = minutesToHm(endMin);
            events.push({
                uid: uidForEvent(blk.key, ymd, startHm),
                summary: blk.title,
                dtstart: dtLocalFloating(ymd, startHm),
                dtend: dtLocalFloating(ymd, endHm),
            });

            // update interval: consume block + break
            const newStart = endMin + BREAK_MIN;
            const newIntervals = [];

            // before consumed (none because we place at start)
            // after consumed
            if (newStart < it.endMin) newIntervals.push({ startMin: newStart, endMin: it.endMin });

            // replace idx interval with newIntervals
            remainingFree = [
                ...remainingFree.slice(0, idx),
                ...newIntervals,
                ...remainingFree.slice(idx + 1),
            ];

            placed = true;
            break;
        }

        // If it doesn't fit, we just skip it (because lower priority items come later anyway).
        if (!placed) continue;
    }

    return events;
}

async function main() {
    const data = await fetchJson(API_URL);

    const today = data.server_date; // "YYYY-MM-DD"
    const gigs = Array.isArray(data.gigs) ? data.gigs : [];

    const byDate = new Map();
    for (const g of gigs) {
        if (!g?.date || !g?.time) continue;
        const arr = byDate.get(g.date) ?? [];
        arr.push(g);
        byDate.set(g.date, arr);
    }

    const allEvents = [];

    for (let i = 0; i < DAYS; i++) {
        const ymd = addDaysYmd(today, i);
        const dow = weekdayIndexUTC(ymd);
        const isWeekday = dow >= 1 && dow <= 5; // Mon-Fri
        if (!isWeekday) continue;

        // Busy = (gig +/- 60 min)
        const gigsForDay = byDate.get(ymd) ?? [];
        const busy = [];
        for (const g of gigsForDay) {
            const { start, end } = parseRange(g.time);
            const startMin = start.hh * 60 + start.mm;
            const endMin = end.hh * 60 + end.mm;
            busy.push({
                startMin: clamp(startMin - 60, 0, 1440),
                endMin: clamp(endMin + 60, 0, 1440),
            });
        }
        const busyMerged = mergeIntervals(busy);

        const morningStartMin = hmToMinutes(BREAKFAST_END);
        const defaultEndMin = hmToMinutes(DEFAULT_END);
        const morningEndMin = chooseMorningEnd(busyMerged, defaultEndMin);

        if (morningEndMin <= morningStartMin) continue;

        const available = [{ startMin: morningStartMin, endMin: morningEndMin }];

        // Remove busy from available (mostly redundant because we already end before the earliest busy,
        // but keeps it safe if there are morning conflicts one day)
        const free = subtractIntervals(available, busyMerged).filter((x) => x.endMin > x.startMin);

        const dayEvents = scheduleBlocks(free, ymd);
        allEvents.push(...dayEvents);
    }

    const ics = buildIcs(allEvents);

    const outDir = path.join(process.cwd(), "docs");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "timeblocking.ics"), ics, "utf8");

    console.log(`Generated ${allEvents.length} events into docs/timeblocking.ics`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});