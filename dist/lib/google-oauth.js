import { google } from 'googleapis';
import { env } from '../config/env.js';
import { encryptTokens, decryptTokens } from './encryption.js';
import { updateClientOAuthTokens } from './supabase.js';
// Google Calendar API scopes
const SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events',
];
// Create OAuth2 client
export function createOAuth2Client() {
    return new google.auth.OAuth2(env.googleClientId, env.googleClientSecret, env.googleRedirectUri);
}
// Generate the OAuth authorization URL
export function getAuthUrl(clientId) {
    const oauth2Client = createOAuth2Client();
    return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent', // Force consent to get refresh token
        state: clientId, // Pass client_id through OAuth flow
    });
}
// Exchange authorization code for tokens
export async function exchangeCodeForTokens(code) {
    const oauth2Client = createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.access_token || !tokens.refresh_token) {
        throw new Error('Failed to get tokens from Google');
    }
    return {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry_date: tokens.expiry_date || Date.now() + 3600 * 1000,
    };
}
// Refresh access token using refresh token
export async function refreshAccessToken(refreshToken) {
    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await oauth2Client.refreshAccessToken();
    if (!credentials.access_token) {
        throw new Error('Failed to refresh access token');
    }
    return {
        access_token: credentials.access_token,
        expiry_date: credentials.expiry_date || Date.now() + 3600 * 1000,
    };
}
// Get a valid OAuth2 client with fresh tokens for a client
export async function getAuthenticatedClient(clientId, encryptedTokens) {
    const oauth2Client = createOAuth2Client();
    const tokens = decryptTokens(encryptedTokens);
    // Check if token is expired or will expire in next 5 minutes
    const isExpiringSoon = tokens.expiry_date < Date.now() + 5 * 60 * 1000;
    if (isExpiringSoon) {
        console.log(`Refreshing expired token for client ${clientId}`);
        try {
            const newTokens = await refreshAccessToken(tokens.refresh_token);
            // Update tokens in database (encrypted)
            const updatedTokens = {
                access_token: newTokens.access_token,
                refresh_token: tokens.refresh_token, // Keep same refresh token
                expiry_date: newTokens.expiry_date,
            };
            const encryptedUpdated = encryptTokens(updatedTokens);
            await updateClientOAuthTokens(clientId, encryptedUpdated);
            oauth2Client.setCredentials({
                access_token: newTokens.access_token,
                refresh_token: tokens.refresh_token,
            });
        }
        catch (error) {
            console.error(`Failed to refresh token for client ${clientId}:`, error);
            throw new Error('OAuth token refresh failed. Client needs to re-authenticate.');
        }
    }
    else {
        oauth2Client.setCredentials({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
        });
    }
    return oauth2Client;
}
//# sourceMappingURL=google-oauth.js.map