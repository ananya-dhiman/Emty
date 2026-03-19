import mongoose, { Schema, Document } from "mongoose";

// ================================
// Label Model (Organization)
// ================================
export interface ILabel extends Document {
    userId: string;
    accountId: string;
    name: string;
    nameNormalized: string;
    description?: string;
    color?: string;
    source: "system" | "ai" | "user";
}
const LabelSchema = new Schema<ILabel>(
    {
        userId: { type: String, required: true },
        accountId: { type: String, required: true },
        name: { type: String, required: true },
        nameNormalized: { type: String, required: true },
        description: { type: String, default: "" },
        color: String,
        source: { type: String, enum: ["system", "ai", "user"], default: "system" }
    },
    { timestamps: true }
);

LabelSchema.pre("validate", function () {
    if (this.name) {
        this.name = this.name.trim();
        this.nameNormalized = this.name.toLowerCase();
    }
});

LabelSchema.index({ userId: 1, accountId: 1, nameNormalized: 1 }, { unique: true });

export const LabelModel = mongoose.model<ILabel>("Label", LabelSchema);
