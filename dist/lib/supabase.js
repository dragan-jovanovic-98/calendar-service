import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';
// Service client for server-side operations (bypasses RLS)
export const supabase = createClient(env.supabaseUrl, env.supabaseServiceKey);
// Fetch client by ID
export async function getClientById(clientId) {
    const { data, error } = await supabase
        .from('mortgage_clients')
        .select('id, company_name, timezone, google_oauth_tokens, meeting_lengths, google_calendar_id')
        .eq('id', clientId)
        .single();
    if (error) {
        console.error('Error fetching client:', error);
        return null;
    }
    return data;
}
// Update client OAuth tokens
export async function updateClientOAuthTokens(clientId, tokens) {
    const { error } = await supabase
        .from('mortgage_clients')
        .update({ google_oauth_tokens: tokens })
        .eq('id', clientId);
    if (error) {
        console.error('Error updating OAuth tokens:', error);
        return false;
    }
    return true;
}
// Update client's selected Google Calendar
export async function updateClientCalendarId(clientId, calendarId) {
    const { error } = await supabase
        .from('mortgage_clients')
        .update({ google_calendar_id: calendarId })
        .eq('id', clientId);
    if (error) {
        console.error('Error updating calendar ID:', error);
        return false;
    }
    return true;
}
// Get campaign timezone, with fallback to client timezone
export async function getLeadTimezone(campaignId, clientTimezone) {
    if (!campaignId) {
        return clientTimezone;
    }
    const { data, error } = await supabase
        .from('mortgage_campaigns')
        .select('timezone')
        .eq('id', campaignId)
        .single();
    if (error || !data?.timezone) {
        return clientTimezone;
    }
    return data.timezone;
}
//# sourceMappingURL=supabase.js.map