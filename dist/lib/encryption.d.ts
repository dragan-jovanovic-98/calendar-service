export declare function encrypt(plaintext: string): string;
export declare function decrypt(encryptedValue: string): string;
export declare function encryptTokens(tokens: {
    access_token: string;
    refresh_token: string;
    expiry_date: number;
}): {
    access_token: string;
    refresh_token: string;
    expiry_date: number;
};
export declare function decryptTokens(encryptedTokens: {
    access_token: string;
    refresh_token: string;
    expiry_date: number;
}): {
    access_token: string;
    refresh_token: string;
    expiry_date: number;
};
//# sourceMappingURL=encryption.d.ts.map