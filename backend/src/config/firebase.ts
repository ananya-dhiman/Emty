import admin from 'firebase-admin';

// Initialize Firebase Admin SDK
admin.initializeApp({
    credential: admin.credential.cert({
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY,
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
    } as admin.ServiceAccount),
});

export default admin;

