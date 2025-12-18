import mongoose, { Schema, Document, Types } from "mongoose";

// ================================
// ContextIndex Model (Retrieval / Vector Search)
// ================================
export interface IContextIndex extends Document {
    ownerType: "EMAIL" | "THREAD";
    ownerId: Types.ObjectId;
    accountId: Types.ObjectId;
    embedding: number[];
    metadata?: Record<string, any>;
}

const ContextIndexSchema = new Schema<IContextIndex>(
    {
        ownerType: { type: String, enum: ["EMAIL", "THREAD"], required: true },
        ownerId: { type: Schema.Types.ObjectId, required: true },
        accountId: { type: Schema.Types.ObjectId, ref: "GmailAccount", required: true },
        embedding: { type: [Number], required: true, select: false },
        metadata: Schema.Types.Mixed,
    },
    { timestamps: true }
);

export const ContextIndexModel = mongoose.model<IContextIndex>(
    "ContextIndex",
    ContextIndexSchema
);
