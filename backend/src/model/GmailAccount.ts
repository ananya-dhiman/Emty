import mongoose, { Schema, Document, Types } from "mongoose";

// ================================
// Gmail Account Model (Multiple accounts per user)
// ================================
export interface IGmailAccount extends Document {
    userId: string;
    emailAddress: string;
    accessToken: string;
    refreshToken: string;
    tokenExpiry: Date;
    syncCheckpointId?: Types.ObjectId; // Optional reference to SyncCheckpoint
}

const GmailAccountSchema = new Schema<IGmailAccount>(
    {
        userId: { type: String, required: true },
        emailAddress: { type: String, required: true },
        accessToken: { type: String, required: true },
        refreshToken: { type: String, required: true },
        tokenExpiry: { type: Date, required: true },
        syncCheckpointId: {
            type: Schema.Types.ObjectId,
            ref: "SyncCheckpoint",
            default: null,
        },
    },
    { timestamps: true }
);

export const GmailAccountModel = mongoose.model<IGmailAccount>(
    "GmailAccount",
    GmailAccountSchema
);
