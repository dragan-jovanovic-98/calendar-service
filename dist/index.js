import Fastify from 'fastify';
import cors from '@fastify/cors';
import 'dotenv/config';
import { env } from './config/env.js';
import { authRoutes } from './routes/auth.js';
import { webhookRoutes } from './routes/webhook.js';
import { googleWebhookRoutes } from './routes/google-webhook.js';
import { parseDateTime } from './lib/date-parser.js';
import { renewExpiringChannels } from './lib/calendar-watch.js';
const server = Fastify({
    logger: true,
});
await server.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
});
// Register routes
await server.register(authRoutes);
await server.register(webhookRoutes);
await server.register(googleWebhookRoutes);
// Health check
server.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
});
// Test date parsing (remove in production)
server.get('/test/parse-date', async (request) => {
    const { input, timezone = 'America/Toronto' } = request.query;
    if (!input) {
        return { error: 'input query parameter required' };
    }
    return parseDateTime(input, timezone);
});
try {
    await server.listen({ port: env.port, host: '0.0.0.0' });
    console.log(`Server running on port ${env.port}`);
    // Renew any watch channels that expired while server was down
    renewExpiringChannels().catch((err) => {
        console.error('Startup watch channel renewal failed:', err);
    });
    // Renew expiring watch channels every 6 hours
    setInterval(() => {
        renewExpiringChannels().catch((err) => {
            console.error('Periodic watch channel renewal failed:', err);
        });
    }, 6 * 60 * 60 * 1000);
}
catch (err) {
    server.log.error(err);
    process.exit(1);
}
//# sourceMappingURL=index.js.map