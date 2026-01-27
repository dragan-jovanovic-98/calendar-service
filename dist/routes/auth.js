import { getAuthUrl, exchangeCodeForTokens, getAuthenticatedClient } from '../lib/google-oauth.js';
import { encryptTokens } from '../lib/encryption.js';
import { getClientById, updateClientOAuthTokens, updateClientCalendarId } from '../lib/supabase.js';
import { listCalendars } from '../lib/google-calendar.js';
import { env } from '../config/env.js';
export async function authRoutes(server) {
    // Initiate Google OAuth flow
    // GET /auth/google?client_id=uuid
    server.get('/auth/google', async (request, reply) => {
        const { client_id } = request.query;
        if (!client_id) {
            return reply.status(400).send({ error: 'client_id is required' });
        }
        // Verify client exists
        const client = await getClientById(client_id);
        if (!client) {
            return reply.status(404).send({ error: 'Client not found' });
        }
        // Generate auth URL and redirect
        const authUrl = getAuthUrl(client_id);
        return reply.redirect(authUrl);
    });
    // Google OAuth callback
    // GET /auth/google/callback?code=xxx&state=client_id
    server.get('/auth/google/callback', async (request, reply) => {
        const { code, error, state: clientId } = request.query;
        // Handle OAuth errors
        if (error) {
            console.error('Google OAuth error:', error);
            const errorRedirect = `${env.frontendUrl}/settings?error=oauth_failed`;
            return reply.redirect(errorRedirect);
        }
        if (!code || !clientId) {
            return reply.status(400).send({
                error: 'Missing code or client_id',
            });
        }
        // Verify client exists
        const client = await getClientById(clientId);
        if (!client) {
            return reply.status(404).send({ error: 'Client not found' });
        }
        try {
            // Exchange code for tokens
            const tokens = await exchangeCodeForTokens(code);
            // Encrypt tokens before storing
            const encryptedTokens = encryptTokens(tokens);
            // Store in database
            const success = await updateClientOAuthTokens(clientId, encryptedTokens);
            if (!success) {
                throw new Error('Failed to store tokens');
            }
            // Auto-select primary calendar
            let selectedCalendarId = 'primary';
            try {
                const auth = await getAuthenticatedClient(clientId, encryptedTokens);
                const calendars = await listCalendars(auth);
                const primaryCalendar = calendars.find(c => c.primary);
                if (primaryCalendar) {
                    selectedCalendarId = primaryCalendar.id;
                    await updateClientCalendarId(clientId, selectedCalendarId);
                }
            }
            catch (calErr) {
                console.error('Failed to auto-select calendar, using primary:', calErr);
            }
            // Redirect back to frontend settings page
            const successRedirect = `${env.frontendUrl}/settings?connected=true`;
            return reply.redirect(successRedirect);
        }
        catch (err) {
            console.error('Failed to exchange code for tokens:', err);
            const errorRedirect = `${env.frontendUrl}/settings?error=connection_failed`;
            return reply.redirect(errorRedirect);
        }
    });
    // Check OAuth status for a client
    // GET /auth/status?client_id=uuid
    server.get('/auth/status', async (request, reply) => {
        const { client_id } = request.query;
        if (!client_id) {
            return reply.status(400).send({ error: 'client_id is required' });
        }
        const client = await getClientById(client_id);
        if (!client) {
            return reply.status(404).send({ error: 'Client not found' });
        }
        const hasTokens = client.google_oauth_tokens !== null;
        const isExpired = hasTokens &&
            client.google_oauth_tokens.expiry_date < Date.now();
        return {
            client_id,
            connected: hasTokens,
            expired: hasTokens ? isExpired : null,
            calendar_id: client.google_calendar_id,
        };
    });
    // List available calendars for a client
    // GET /auth/calendars?client_id=uuid
    server.get('/auth/calendars', async (request, reply) => {
        const { client_id } = request.query;
        if (!client_id) {
            return reply.status(400).send({ error: 'client_id is required' });
        }
        const client = await getClientById(client_id);
        if (!client) {
            return reply.status(404).send({ error: 'Client not found' });
        }
        if (!client.google_oauth_tokens) {
            return reply.status(400).send({ error: 'Client has not connected Google Calendar' });
        }
        try {
            const auth = await getAuthenticatedClient(client_id, client.google_oauth_tokens);
            const calendars = await listCalendars(auth);
            return {
                client_id,
                selected_calendar_id: client.google_calendar_id,
                calendars,
            };
        }
        catch (err) {
            console.error('Failed to list calendars:', err);
            return reply.status(500).send({
                error: 'Failed to fetch calendars',
                details: err instanceof Error ? err.message : 'Unknown error',
            });
        }
    });
    // Set selected calendar for a client
    // POST /auth/calendars { client_id, calendar_id }
    server.post('/auth/calendars', async (request, reply) => {
        const { client_id, calendar_id } = request.body;
        if (!client_id || !calendar_id) {
            return reply.status(400).send({ error: 'client_id and calendar_id are required' });
        }
        const client = await getClientById(client_id);
        if (!client) {
            return reply.status(404).send({ error: 'Client not found' });
        }
        if (!client.google_oauth_tokens) {
            return reply.status(400).send({ error: 'Client has not connected Google Calendar' });
        }
        // Verify the calendar exists and is accessible
        try {
            const auth = await getAuthenticatedClient(client_id, client.google_oauth_tokens);
            const calendars = await listCalendars(auth);
            const calendarExists = calendars.some(c => c.id === calendar_id);
            if (!calendarExists) {
                return reply.status(400).send({ error: 'Calendar not found or not accessible' });
            }
        }
        catch (err) {
            console.error('Failed to verify calendar:', err);
            return reply.status(500).send({
                error: 'Failed to verify calendar access',
                details: err instanceof Error ? err.message : 'Unknown error',
            });
        }
        // Update the selected calendar
        const success = await updateClientCalendarId(client_id, calendar_id);
        if (!success) {
            return reply.status(500).send({ error: 'Failed to save calendar selection' });
        }
        return {
            success: true,
            client_id,
            calendar_id,
        };
    });
}
//# sourceMappingURL=auth.js.map