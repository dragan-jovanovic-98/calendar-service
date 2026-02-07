import { google } from 'googleapis';
import { randomUUID } from 'crypto';
import { env } from '../config/env.js';
import { getAuthenticatedClient } from './google-oauth.js';
import { getClientById } from './supabase.js';
import { upsertWatchChannel, markWatchChannelStopped, getExpiringWatchChannels, getClientsWithOAuth, } from './supabase.js';
const WEBHOOK_URL = `${env.baseUrl}/webhook/google-calendar`;
/**
 * Create a watch channel for push notifications on a Google Calendar.
 * Google will POST to our webhook whenever events change.
 */
export async function createWatchChannel(auth, clientId, calendarId) {
    const calendar = google.calendar({ version: 'v3', auth });
    const channelId = randomUUID();
    try {
        const response = await calendar.events.watch({
            calendarId,
            requestBody: {
                id: channelId,
                type: 'web_hook',
                address: WEBHOOK_URL,
            },
        });
        const resourceId = response.data.resourceId;
        const expiration = new Date(Number(response.data.expiration));
        if (!resourceId) {
            console.error(`No resourceId returned for watch channel ${channelId}`);
            return null;
        }
        // Store in database
        const success = await upsertWatchChannel({
            clientId,
            channelId,
            resourceId,
            calendarId,
            expiration,
        });
        if (!success) {
            console.error(`Failed to store watch channel ${channelId} in database`);
            // Try to stop the channel we just created since we can't track it
            try {
                await calendar.channels.stop({
                    requestBody: { id: channelId, resourceId },
                });
            }
            catch {
                // Best effort cleanup
            }
            return null;
        }
        console.log(`Created watch channel ${channelId} for client ${clientId}, calendar ${calendarId}, expires ${expiration.toISOString()}`);
        return { channelId, resourceId, expiration };
    }
    catch (error) {
        console.error(`Failed to create watch channel for client ${clientId}:`, error);
        return null;
    }
}
/**
 * Stop a watch channel (e.g., before renewal or when calendar changes).
 */
export async function stopWatchChannel(auth, channelId, resourceId) {
    const calendar = google.calendar({ version: 'v3', auth });
    try {
        await calendar.channels.stop({
            requestBody: {
                id: channelId,
                resourceId,
            },
        });
        console.log(`Stopped watch channel ${channelId}`);
    }
    catch (error) {
        // Channel may already be expired — that's fine
        console.warn(`Failed to stop watch channel ${channelId} (may be expired):`, error);
    }
    await markWatchChannelStopped(channelId);
}
/**
 * Renew watch channels that are expiring within 24 hours.
 * Creates a new channel, then stops the old one.
 */
export async function renewExpiringChannels() {
    const expiringChannels = await getExpiringWatchChannels(24 * 60); // 24 hours
    if (expiringChannels.length === 0) {
        return;
    }
    console.log(`Renewing ${expiringChannels.length} expiring watch channel(s)`);
    for (const channel of expiringChannels) {
        try {
            const client = await getClientById(channel.client_id);
            if (!client?.google_oauth_tokens) {
                console.warn(`Client ${channel.client_id} has no OAuth tokens, skipping renewal`);
                await markWatchChannelStopped(channel.channel_id);
                continue;
            }
            const auth = await getAuthenticatedClient(channel.client_id, client.google_oauth_tokens);
            // Create new channel first
            const newChannel = await createWatchChannel(auth, channel.client_id, channel.calendar_id);
            if (newChannel) {
                // Stop old channel (best effort — the upsert already replaced it in DB)
                await stopOldChannel(auth, channel);
            }
        }
        catch (error) {
            console.error(`Failed to renew watch channel for client ${channel.client_id}:`, error);
        }
    }
}
/**
 * Stop an old channel without marking it in DB (since it was already replaced by upsert).
 */
async function stopOldChannel(auth, channel) {
    const calendar = google.calendar({ version: 'v3', auth });
    try {
        await calendar.channels.stop({
            requestBody: {
                id: channel.channel_id,
                resourceId: channel.resource_id,
            },
        });
        console.log(`Stopped old watch channel ${channel.channel_id}`);
    }
    catch (error) {
        console.warn(`Failed to stop old channel ${channel.channel_id} (may be expired):`, error);
    }
}
/**
 * Bootstrap watch channels for all existing clients with OAuth tokens.
 * Call this once after deployment or on startup to ensure all clients are watched.
 */
export async function bootstrapWatchChannels() {
    const clients = await getClientsWithOAuth();
    console.log(`Bootstrapping watch channels for ${clients.length} client(s)`);
    for (const client of clients) {
        const calendarId = client.google_calendar_id || 'primary';
        try {
            const auth = await getAuthenticatedClient(client.id, client.google_oauth_tokens);
            await createWatchChannel(auth, client.id, calendarId);
        }
        catch (error) {
            console.error(`Failed to bootstrap watch channel for client ${client.id}:`, error);
        }
    }
}
//# sourceMappingURL=calendar-watch.js.map