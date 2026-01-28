export declare const supabase: import("@supabase/supabase-js").SupabaseClient<any, "public", "public", any, any>;
export interface AvailabilityRule {
    days: number[];
    start: string;
    end: string;
}
export interface BusinessHours {
    rules: AvailabilityRule[];
}
export interface Vacation {
    start: string;
    end: string;
}
export interface MortgageClient {
    id: string;
    company_name: string;
    timezone: string;
    google_oauth_tokens: GoogleOAuthTokens | null;
    meeting_length: number | null;
    google_calendar_id: string | null;
    business_hours: BusinessHours | null;
    excluded_dates: string[] | null;
    holidays: string[] | null;
    vacations: Vacation[] | null;
}
export interface GoogleOAuthTokens {
    access_token: string;
    refresh_token: string;
    expiry_date: number;
}
export declare function getClientById(clientId: string): Promise<MortgageClient | null>;
export declare function updateClientOAuthTokens(clientId: string, tokens: GoogleOAuthTokens): Promise<boolean>;
export declare function updateClientCalendarId(clientId: string, calendarId: string): Promise<boolean>;
export declare function getLeadTimezone(campaignId: string | null | undefined, clientTimezone: string): Promise<string>;
export interface LeadWithPhone {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
}
export declare function getLeadById(leadId: string): Promise<LeadWithPhone | null>;
export declare function createAppointment(clientId: string, leadId: string, startTime: Date, endTime: Date, timezone: string, calendarEventId: string, externalCallId?: string): Promise<{
    id: string;
}>;
export declare function updateLeadStatus(leadId: string, status: string): Promise<void>;
export declare function isTimeBlocked(dateTime: Date, client: MortgageClient): {
    blocked: boolean;
    reason?: string;
};
//# sourceMappingURL=supabase.d.ts.map