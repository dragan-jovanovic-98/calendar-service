// Environment configuration with validation

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

export const env = {
  // Server
  port: parseInt(optionalEnv('PORT', '3000')),
  nodeEnv: optionalEnv('NODE_ENV', 'development'),
  baseUrl: requireEnv('BASE_URL'),

  // Supabase
  supabaseUrl: requireEnv('SUPABASE_URL'),
  supabaseServiceKey: requireEnv('SUPABASE_SERVICE_KEY'),

  // Google OAuth
  googleClientId: requireEnv('GOOGLE_CLIENT_ID'),
  googleClientSecret: requireEnv('GOOGLE_CLIENT_SECRET'),
  googleRedirectUri: requireEnv('GOOGLE_REDIRECT_URI'),

  // Security
  encryptionKey: requireEnv('ENCRYPTION_KEY'),

  // Frontend
  frontendUrl: optionalEnv('FRONTEND_URL', 'http://localhost:5173'),
} as const;
