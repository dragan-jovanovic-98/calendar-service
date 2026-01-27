import { type GoogleOAuthTokens } from './supabase.js';
export declare function createOAuth2Client(): import("google-auth-library").OAuth2Client;
export declare function getAuthUrl(clientId: string): string;
export declare function exchangeCodeForTokens(code: string): Promise<{
    access_token: string;
    refresh_token: string;
    expiry_date: number;
}>;
export declare function refreshAccessToken(refreshToken: string): Promise<{
    access_token: string;
    expiry_date: number;
}>;
export declare function getAuthenticatedClient(clientId: string, encryptedTokens: GoogleOAuthTokens): Promise<ReturnType<typeof createOAuth2Client>>;
//# sourceMappingURL=google-oauth.d.ts.map