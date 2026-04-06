import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

/**
 * Authentication Helper Functions
 * Simple and generalized for any Firebase project
 */

/**
 * Sign in with Google
 * Returns user data and Firebase token
 */
export const signInWithGoogle = async () => {
    try {
        const { signInWithPopup } = await import("firebase/auth");
        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        const token = await user.getIdToken();

        return {
            success: true,
            user: {
                uid: user.uid,
                email: user.email,
                displayName: user.displayName,
                photoURL: user.photoURL
            },
            token
        };
    } catch (error: any) {
        console.error("Google sign-in error:", error.message);
        return {
            success: false,
            error: error.message
        };
    }
};

/**
 * Sign out current user
 */
export const signOutUser = async () => {
    try {
        await auth.signOut();
        // Clear token from localStorage
        localStorage.removeItem('firebaseToken');
        return { success: true };
    } catch (error: any) {
        console.error("Sign out error:", error.message);
        return { success: false, error: error.message };
    }
};

/**
 * Get current user
 */
export const getCurrentUser = () => {
    return auth.currentUser;
};

/**
 * Get current user's token
 */
export const getUserToken = async () => {
    const user = auth.currentUser;
    if (user) {
        return await user.getIdToken();
    }
    return null;
};

export { auth, provider };
