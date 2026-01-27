import Fastify from 'fastify';
import cors from '@fastify/cors';
import 'dotenv/config';
import { env } from './config/env.js';
import { authRoutes } from './routes/auth.js';
import { webhookRoutes } from './routes/webhook.js';
import { parseDateTime } from './lib/date-parser.js';
const server = Fastify({
    logger: true,
});
await server.register(cors);
// Register routes
await server.register(authRoutes);
await server.register(webhookRoutes);
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
}
catch (err) {
    server.log.error(err);
    process.exit(1);
}
//# sourceMappingURL=index.js.map