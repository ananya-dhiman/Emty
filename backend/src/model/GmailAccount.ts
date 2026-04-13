import mongoose, { Schema, Document, Types } from "mongoose";
import * as userLocalRepository from "../db/repositories/userLocalRepository";
import * as accountLocalRepository from "../db/repositories/accountLocalRepository";

// ================================
// Gmail Account Model (Multiple accounts per user)
// ================================
export interface IGmailAccount extends Document {
    id?: string;
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

export const GmailAccount = {
    async findUnique(args: { where: { id?: string; emailAddress?: string } }) {
        const where = args.where || {};
        if (where.id) {
            const doc = await GmailAccountModel.findById(where.id).lean<any>();
            return doc ? { ...doc, id: String(doc._id) } : null;
        }
        if (where.emailAddress) {
            const doc = await GmailAccountModel.findOne({ emailAddress: where.emailAddress }).lean<any>();
            return doc ? { ...doc, id: String(doc._id) } : null;
        }
        return null;
    },
    async update(args: { where: { id: string }; data: Partial<IGmailAccount> & Record<string, any> }) {
        const updated = await GmailAccountModel.findByIdAndUpdate(
            args.where.id,
            { $set: args.data },
            { new: true, lean: true }
        );
        if (updated) {
            userLocalRepository.upsert(updated.userId);
            accountLocalRepository.upsert({
                id: String((updated as any)._id),
                user_id: updated.userId,
                email_address: updated.emailAddress,
                config_json: "{}",
            });
        }
        return updated ? { ...(updated as any), id: String((updated as any)._id) } : null;
    },
};
