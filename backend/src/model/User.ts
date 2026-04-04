import mongoose, { Schema, Document } from "mongoose";

// ================================
// User Model (Auth-level user)
// ================================
export interface IUser extends Document {
    email: string;
    name?: string;
    avatar?: string;
    createdAt: Date;
    firebaseId: string;
    aiSettings?: {
        geminiApiKey?: string;
        openaiApiKey?: string;
        preferredProvider?: "gemini" | "openai";
        preferredModel?: string;
    };
}

const UserSchema = new Schema<IUser>(
    {
        email: { type: String, required: true, unique: true },
        name: String,
        avatar: String,
        firebaseId: { type: String, required: true, unique: true },
        aiSettings: {
            geminiApiKey: { type: String, default: null },
            openaiApiKey: { type: String, default: null },
            preferredProvider: { type: String, enum: ["gemini", "openai"], default: "gemini" },
            preferredModel: { type: String, default: null },
        },
    },
    { timestamps: true }
);

export const UserModel = mongoose.model<IUser>("User", UserSchema);
