import type { OAuth2Client } from 'google-auth-library';
/**
 * Create a watch channel for push notifications on a Google Calendar.
 * Google will POST to our webhook whenever events change.
 */
export declare function createWatchChannel(auth: OAuth2Client, clientId: string, calendarId: string): Promise<{
    channelId: string;
    resourceId: string;
    expiration: Date;
} | null>;
/**
 * Stop a watch channel (e.g., before renewal or when calendar changes).
 */
export declare function stopWatchChannel(auth: OAuth2Client, channelId: string, resourceId: string): Promise<void>;
/**
 * Renew watch channels that are expiring within 24 hours.
 * Creates a new channel, then stops the old one.
 */
export declare function renewExpiringChannels(): Promise<void>;
/**
 * Bootstrap watch channels for all existing clients with OAuth tokens.
 * Call this once after deployment or on startup to ensure all clients are watched.
 */
export declare function bootstrapWatchChannels(): Promise<void>;
//# sourceMappingURL=calendar-watch.d.ts.map