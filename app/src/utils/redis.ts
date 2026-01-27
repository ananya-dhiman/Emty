import redis from 'redis';

const client = redis.createClient({
    port: 6379 ,
    host: '127.0.0.1' 
});

client.on('connect', () => {
    console.log('Successfully connected to Redis!');
});

client.on('error', (err) => {
    console.error('Error connecting to Redis:', err);
});
export default client;

// 1️⃣ /auth/google (state creation)

// Flow:

// user already authenticated

// generate random state string

// SET key value EX ttl

// pass state to Google

// Important:

// If Redis write fails → abort OAuth

// No state → no redirect

// 2️⃣ /auth/google/callback (state validation)

// Flow:

// read state from query

// GET key

// if null → reject

// extract userId

// DEL key (single-use)

// continue OAuth

// ⚠️ Order matters:

// DEL before token exchange if possible

// prevents double callback replay