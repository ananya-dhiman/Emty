import mongoose, { Schema, Document, Types } from "mongoose";

// ================================
// Rule Model (Intent)
// ================================
export interface IRule extends Document {
    userId: Types.ObjectId;
    accountId: Types.ObjectId;
    type: "LABEL" | "DELETE";
    conditions: Record<string, any>;
    action: Record<string, any>;
    enabled: boolean;
}

const RuleSchema = new Schema<IRule>(
    {
        userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
        accountId: { type: Schema.Types.ObjectId, ref: "GmailAccount", required: true },
        type: { type: String, enum: ["LABEL", "DELETE"], required: true },
        conditions: Schema.Types.Mixed,
        action: Schema.Types.Mixed,
        enabled: { type: Boolean, default: true },
    },
    { timestamps: true }
);

export const RuleModel = mongoose.model<IRule>("Rule", RuleSchema);

//Scope to add preferences later( how are rules and preferences different?)