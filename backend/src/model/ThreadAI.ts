import mongoose, { Schema, Document, Types } from "mongoose";

// ================================
// ThreadAI Model (Context-level understanding)
// ================================
export interface IThreadAI extends Document {
    threadId: Types.ObjectId;
    summary: string;
    extractedFacts?: Record<string, any>;
    embedding?: number[];
}

const ThreadAISchema = new Schema<IThreadAI>(
    {
        threadId: { type: Schema.Types.ObjectId, ref: "Thread", unique: true },
        summary: String,
        extractedFacts: Schema.Types.Mixed,
        embedding: { type: [Number], select: false },
    },
    { timestamps: true }
);

export const ThreadAIModel = mongoose.model<IThreadAI>("ThreadAI", ThreadAISchema);
