import mongoose, { Schema, Document, Types } from "mongoose";

// ================================
// Label Model (Organization)
// ================================
export interface ILabel extends Document {
    userId: string;
    accountId: string;
    name: string;
    description?: string;
    color?: string;
    source: "system" | "ai" | "user";
}
const LabelSchema = new Schema<ILabel>(
    {
        userId: { type: String, required: true },
        accountId: { type: String, required: true },
        name: { type: String, required: true },
        description: { type: String, default: "" },
        color: String,
        source: { type: String, enum: ["system", "ai", "user"], default: "system" }
    },
    { timestamps: true }
);

export const LabelModel = mongoose.model<ILabel>("Label", LabelSchema);
