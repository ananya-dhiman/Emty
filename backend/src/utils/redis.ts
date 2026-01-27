import { createClient } from 'redis';

// Create Redis client with new redis v4+ API
export const client = createClient({
    socket: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379')
    }
});

// Handle Redis connection events
client.on('connect', () => {
    console.log('✅ Successfully connected to Redis');
});

client.on('error', (err: Error | string) => {
    console.error('❌ Redis connection error:', err);
});

// Connect to Redis
client.connect().catch((err: Error | string) => {
    console.error('Failed to connect to Redis:', err);
});
