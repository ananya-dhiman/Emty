import mongoose, { Schema, Document, Types } from "mongoose";

// ================================
// Label Model (Organization)
// ================================
export interface ILabel extends Document {
    userId: Types.ObjectId;
    accountId: Types.ObjectId;
    name: string;
    color?: string;
}

const LabelSchema = new Schema<ILabel>(
    {
        userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
        accountId: { type: Schema.Types.ObjectId, ref: "GmailAccount", required: true },
        name: { type: String, required: true },
        color: String,
    },
    { timestamps: true }
);

export const LabelModel = mongoose.model<ILabel>("Label", LabelSchema);
