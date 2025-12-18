import mongoose, { Schema, Document, Types } from "mongoose";

// ================================
// Email Model (Raw facts)
// ================================
export interface IEmail extends Document {
    accountId: Types.ObjectId;
    gmailMessageId: string;
    threadId?: Types.ObjectId;
    from: string;
    to: string[];
    subject: string;
    body: string;
    receivedAt: Date;
    labels: string[];
    embedding?: number[];
}

const EmailSchema = new Schema<IEmail>(
    {
        accountId: { type: Schema.Types.ObjectId, ref: "GmailAccount", required: true },
        gmailMessageId: { type: String, required: true, unique: true },
        threadId: { type: Schema.Types.ObjectId, ref: "Thread" },
        from: String,
        to: [String],
        subject: String,
        body: String,
        receivedAt: Date,
        labels: [String],
        embedding: { type: [Number], select: false },
    },
    { timestamps: true }
);

export const EmailModel = mongoose.model<IEmail>("Email", EmailSchema);
