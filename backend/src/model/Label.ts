import mongoose, { Schema, Document } from "mongoose";
import { canonicalizeLabelName } from "../utils/labelNormalization";

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
    status: "active" | "suggested" | "rejected";
    suggestionCount?: number;
    lastSuggestedAt?: Date | null;
    sampleThreadIds?: string[];
}
const LabelSchema = new Schema<ILabel>(
    {
        userId: { type: String, required: true },
        accountId: { type: String, required: true },
        name: { type: String, required: true },
        nameNormalized: { type: String, required: true },
        description: { type: String, default: "" },
        color: String,
        source: { type: String, enum: ["system", "ai", "user"], default: "system" },
        status: {
            type: String,
            enum: ["active", "suggested", "rejected"],
            default: "active",
            index: true,
        },
        suggestionCount: { type: Number, default: 0 },
        lastSuggestedAt: { type: Date, default: null },
        sampleThreadIds: { type: [String], default: [] },
    },
    { timestamps: true }
);

LabelSchema.pre("validate", function () {
    if (this.name) {
        this.name = this.name.trim();
        this.nameNormalized = canonicalizeLabelName(this.name);
    }
});

LabelSchema.index({ userId: 1, accountId: 1, nameNormalized: 1 }, { unique: true });

export const LabelModel = mongoose.model<ILabel>("Label", LabelSchema);
