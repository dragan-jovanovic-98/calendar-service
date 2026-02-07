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
    broker_first_name: string | null;
    broker_last_name: string | null;
    business_phone: string | null;
    primary_email: string | null;
    buffer_minutes: number;
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
export declare function createAppointment(clientId: string, leadId: string | null, startTime: Date, endTime: Date, timezone: string, calendarEventId: string, externalCallId?: string): Promise<{
    id: string;
}>;
export declare function updateLeadStatus(leadId: string, status: string): Promise<void>;
export interface WatchChannel {
    id: string;
    client_id: string;
    channel_id: string;
    resource_id: string;
    calendar_id: string;
    expiration: string;
    sync_token: string | null;
    status: string;
}
export declare function getWatchChannelByChannelId(channelId: string): Promise<WatchChannel | null>;
export declare function upsertWatchChannel(params: {
    clientId: string;
    channelId: string;
    resourceId: string;
    calendarId: string;
    expiration: Date;
}): Promise<boolean>;
export declare function updateWatchChannelSyncToken(id: string, syncToken: string): Promise<boolean>;
export declare function clearWatchChannelSyncToken(id: string): Promise<boolean>;
export declare function markWatchChannelStopped(channelId: string): Promise<boolean>;
export declare function getExpiringWatchChannels(withinMinutes: number): Promise<WatchChannel[]>;
export declare function getAppointmentByCalendarEventId(eventId: string): Promise<{
    id: string;
} | null>;
export declare function findLeadByEmail(clientId: string, email: string): Promise<{
    id: string;
    first_name: string | null;
    last_name: string | null;
} | null>;
export declare function createAppointmentFromGoogleBooking(params: {
    clientId: string;
    leadId: string | null;
    startTime: string;
    endTime: string;
    timezone: string;
    calendarEventId: string;
    title: string | null;
    notes: string | null;
    externalBookingUrl: string | null;
}): Promise<{
    id: string;
}>;
export declare function getClientsWithOAuth(): Promise<Array<{
    id: string;
    google_oauth_tokens: GoogleOAuthTokens;
    google_calendar_id: string | null;
}>>;
export declare function isTimeBlocked(dateTime: Date, client: MortgageClient): {
    blocked: boolean;
    reason?: string;
};
//# sourceMappingURL=supabase.d.ts.map