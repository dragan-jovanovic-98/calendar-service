export interface ParsedTimeSlot {
    start: Date;
    end: Date;
    startRFC3339: string;
    endRFC3339: string;
    humanReadable: string;
}
export interface ParseResult {
    success: boolean;
    slot?: ParsedTimeSlot;
    isRange?: boolean;
    rangeStart?: Date;
    rangeEnd?: Date;
    needsTimeSpecified?: boolean;
    error?: string;
}
/**
 * Parse a natural language date/time string into a structured format
 *
 * @param input - Natural language string like "Tuesday at 2pm", "today after 4pm"
 * @param timezone - IANA timezone string like "America/Toronto"
 * @param referenceDate - Reference date for parsing (defaults to now)
 * @returns ParseResult with parsed date information
 */
export declare function parseDateTime(input: string, timezone: string, referenceDate?: Date): ParseResult;
/**
 * Convert a Date to RFC3339 format with timezone
 */
export declare function toRFC3339(date: Date, timezone: string): string;
/**
 * Add minutes to a date and return new RFC3339 string
 */
export declare function addMinutesToDate(date: Date, minutes: number, timezone: string): {
    date: Date;
    rfc3339: string;
};
//# sourceMappingURL=date-parser.d.ts.map