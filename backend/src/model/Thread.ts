import mongoose, { Schema, Document, Types } from "mongoose";

// ================================
// Thread Model (Conversation)
// ================================
export interface IThread extends Document {
    accountId: Types.ObjectId;
    gmailThreadId: string;
    emailIds: Types.ObjectId[];
}

const ThreadSchema = new Schema<IThread>(
    {
        accountId: { type: Schema.Types.ObjectId, ref: "GmailAccount", required: true },
        gmailThreadId: { type: String, required: true },
        emailIds: [{ type: Schema.Types.ObjectId, ref: "Email" }],
    },
    { timestamps: true }
);

export const ThreadModel = mongoose.model<IThread>("Thread", ThreadSchema);
