import * as chrono from 'chrono-node';
// Default business hours
const DEFAULT_START_HOUR = 9;
const DEFAULT_END_HOUR = 20;
/**
 * Get the UTC offset in milliseconds for a timezone at a given date
 */
function getTimezoneOffsetMs(date, timezone) {
    const targetFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        timeZoneName: 'longOffset',
    });
    const parts = targetFormatter.formatToParts(date);
    const tzPart = parts.find(p => p.type === 'timeZoneName')?.value || '';
    const match = tzPart.match(/GMT([+-])(\d{2}):(\d{2})/);
    if (!match)
        return 0;
    const sign = match[1] === '+' ? 1 : -1;
    const hours = parseInt(match[2], 10);
    const minutes = parseInt(match[3], 10);
    return sign * (hours * 60 + minutes) * 60 * 1000;
}
/**
 * Adjust a date parsed by chrono to the correct timezone.
 * Chrono parses times as if they're in UTC, but we want them in the target timezone.
 */
function adjustDateToTimezone(date, timezone) {
    const offsetMs = getTimezoneOffsetMs(date, timezone);
    return new Date(date.getTime() - offsetMs);
}
/**
 * Create a Date object for a specific time in a specific timezone.
 * Takes a base date and sets the time to the specified hour in the target timezone.
 */
function createDateInTimezone(baseDate, hour, minute, timezone) {
    // Get the date components in the target timezone
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    const parts = formatter.formatToParts(baseDate);
    const year = parseInt(parts.find(p => p.type === 'year')?.value || '2026', 10);
    const month = parseInt(parts.find(p => p.type === 'month')?.value || '1', 10) - 1;
    const day = parseInt(parts.find(p => p.type === 'day')?.value || '1', 10);
    // Create a UTC date for the desired wall-clock time
    const utcDate = new Date(Date.UTC(year, month, day, hour, minute, 0, 0));
    // Adjust for timezone offset
    const offsetMs = getTimezoneOffsetMs(utcDate, timezone);
    return new Date(utcDate.getTime() - offsetMs);
}
// Time of day ranges
const TIME_RANGES = {
    morning: { start: 9, end: 12 },
    afternoon: { start: 12, end: 17 },
    evening: { start: 17, end: 20 },
};
/**
 * Parse a natural language date/time string into a structured format
 *
 * @param input - Natural language string like "Tuesday at 2pm", "today after 4pm"
 * @param timezone - IANA timezone string like "America/Toronto"
 * @param referenceDate - Reference date for parsing (defaults to now)
 * @returns ParseResult with parsed date information
 */
export function parseDateTime(input, timezone, referenceDate = new Date()) {
    const normalizedInput = input.toLowerCase().trim();
    // Handle "after X" patterns (e.g., "today after 4pm", "after 4pm")
    const afterMatch = normalizedInput.match(/after\s+(\d{1,2})\s*(am|pm)?/i);
    if (afterMatch) {
        return parseAfterTime(normalizedInput, afterMatch, timezone, referenceDate);
    }
    // Handle time-of-day patterns (e.g., "tomorrow morning", "Wednesday afternoon")
    for (const [period, hours] of Object.entries(TIME_RANGES)) {
        if (normalizedInput.includes(period)) {
            return parseTimeOfDay(normalizedInput, period, hours, timezone, referenceDate);
        }
    }
    // Use chrono for standard parsing
    const results = chrono.parse(normalizedInput, {
        instant: referenceDate,
        timezone,
    });
    if (results.length === 0) {
        return {
            success: false,
            error: `Could not parse date/time from: "${input}"`,
        };
    }
    const parsed = results[0];
    // Chrono returns time in reference timezone, but we need to adjust to target timezone
    const chronoDate = parsed.start.date();
    const startDate = adjustDateToTimezone(chronoDate, timezone);
    // If no time was specified, treat it as a range (whole day during business hours)
    // Flag this so the voice agent can ask for a specific time
    if (!parsed.start.isCertain('hour')) {
        const dayStart = createDateInTimezone(startDate, DEFAULT_START_HOUR, 0, timezone);
        const dayEnd = createDateInTimezone(startDate, DEFAULT_END_HOUR, 0, timezone);
        return {
            success: true,
            isRange: true,
            needsTimeSpecified: true,
            rangeStart: dayStart,
            rangeEnd: dayEnd,
            slot: {
                start: dayStart,
                end: dayEnd,
                startRFC3339: toRFC3339(dayStart, timezone),
                endRFC3339: toRFC3339(dayEnd, timezone),
                humanReadable: formatHumanReadable(dayStart, timezone),
            },
        };
    }
    // Specific time was given
    return {
        success: true,
        isRange: false,
        slot: {
            start: startDate,
            end: startDate, // Will be adjusted based on meeting length
            startRFC3339: toRFC3339(startDate, timezone),
            endRFC3339: toRFC3339(startDate, timezone),
            humanReadable: formatHumanReadable(startDate, timezone),
        },
    };
}
/**
 * Parse "after X" time patterns
 */
function parseAfterTime(input, match, timezone, referenceDate) {
    let hour = parseInt(match[1], 10);
    const meridiem = match[2]?.toLowerCase();
    // Handle AM/PM
    if (meridiem === 'pm' && hour < 12) {
        hour += 12;
    }
    else if (meridiem === 'am' && hour === 12) {
        hour = 0;
    }
    else if (!meridiem && hour < 12 && hour < DEFAULT_START_HOUR) {
        // Assume PM for business hours if no meridiem specified
        hour += 12;
    }
    // Parse the date part (e.g., "today", "tomorrow", "Tuesday")
    const withoutAfter = input.replace(/after\s+\d{1,2}\s*(am|pm)?/i, '').trim();
    let baseDate;
    if (withoutAfter) {
        const dateResults = chrono.parse(withoutAfter, {
            instant: referenceDate,
            timezone,
        });
        const chronoDate = dateResults.length > 0 ? dateResults[0].start.date() : referenceDate;
        baseDate = adjustDateToTimezone(chronoDate, timezone);
    }
    else {
        baseDate = new Date(referenceDate);
    }
    const rangeStart = createDateInTimezone(baseDate, hour, 0, timezone);
    const rangeEnd = createDateInTimezone(baseDate, DEFAULT_END_HOUR, 0, timezone);
    return {
        success: true,
        isRange: true,
        rangeStart,
        rangeEnd,
        slot: {
            start: rangeStart,
            end: rangeEnd,
            startRFC3339: toRFC3339(rangeStart, timezone),
            endRFC3339: toRFC3339(rangeEnd, timezone),
            humanReadable: `after ${formatTime(hour)} on ${formatDate(rangeStart, timezone)}`,
        },
    };
}
/**
 * Parse time-of-day patterns (morning, afternoon, evening)
 */
function parseTimeOfDay(input, period, hours, timezone, referenceDate) {
    // Remove the period word to parse the date part
    const withoutPeriod = input.replace(period, '').trim();
    let baseDate;
    if (withoutPeriod) {
        const dateResults = chrono.parse(withoutPeriod, {
            instant: referenceDate,
            timezone,
        });
        const chronoDate = dateResults.length > 0 ? dateResults[0].start.date() : referenceDate;
        baseDate = adjustDateToTimezone(chronoDate, timezone);
    }
    else {
        baseDate = new Date(referenceDate);
    }
    const rangeStart = createDateInTimezone(baseDate, hours.start, 0, timezone);
    const rangeEnd = createDateInTimezone(baseDate, hours.end, 0, timezone);
    return {
        success: true,
        isRange: true,
        rangeStart,
        rangeEnd,
        slot: {
            start: rangeStart,
            end: rangeEnd,
            startRFC3339: toRFC3339(rangeStart, timezone),
            endRFC3339: toRFC3339(rangeEnd, timezone),
            humanReadable: `${period} on ${formatDate(rangeStart, timezone)}`,
        },
    };
}
/**
 * Convert a Date to RFC3339 format with timezone
 */
export function toRFC3339(date, timezone) {
    // Format in the target timezone
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const get = (type) => parts.find(p => p.type === type)?.value || '';
    const dateStr = `${get('year')}-${get('month')}-${get('day')}`;
    const timeStr = `${get('hour')}:${get('minute')}:${get('second')}`;
    // Get timezone offset
    const offset = getTimezoneOffset(date, timezone);
    return `${dateStr}T${timeStr}${offset}`;
}
/**
 * Get timezone offset string (e.g., "-05:00", "+00:00")
 */
function getTimezoneOffset(date, timezone) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        timeZoneName: 'longOffset',
    });
    const parts = formatter.formatToParts(date);
    const tzPart = parts.find(p => p.type === 'timeZoneName')?.value || '';
    // Extract offset from "GMT-05:00" format
    const match = tzPart.match(/GMT([+-]\d{2}:\d{2})/);
    if (match?.[1]) {
        return match[1];
    }
    // Fallback for "GMT" (UTC)
    if (tzPart === 'GMT') {
        return '+00:00';
    }
    return 'Z';
}
/**
 * Format a date for human-readable output
 */
function formatHumanReadable(date, timezone) {
    return new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    }).format(date);
}
/**
 * Format just the date part
 */
function formatDate(date, timezone) {
    return new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'long',
        month: 'short',
        day: 'numeric',
    }).format(date);
}
/**
 * Format hour to 12-hour time
 */
function formatTime(hour) {
    const h = hour % 12 || 12;
    const meridiem = hour < 12 ? 'AM' : 'PM';
    return `${h}:00 ${meridiem}`;
}
/**
 * Add minutes to a date and return new RFC3339 string
 */
export function addMinutesToDate(date, minutes, timezone) {
    const newDate = new Date(date.getTime() + minutes * 60 * 1000);
    return {
        date: newDate,
        rfc3339: toRFC3339(newDate, timezone),
    };
}
//# sourceMappingURL=date-parser.js.map