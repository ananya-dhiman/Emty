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

const mapSort = (orderBy?: Array<Record<string, "asc" | "desc">>): Record<string, 1 | -1> => {
    const sort: Record<string, 1 | -1> = {};
    for (const item of orderBy || []) {
        for (const [key, value] of Object.entries(item)) {
            sort[key] = value === "asc" ? 1 : -1;
        }
    }
    return sort;
};

const mapWhere = (where: Record<string, any> = {}): Record<string, any> => {
    const query: Record<string, any> = {};
    for (const [key, value] of Object.entries(where)) {
        if (key === "OR" && Array.isArray(value)) {
            query.$or = value.map((item) => mapWhere(item));
            continue;
        }
        if (value && typeof value === "object" && !Array.isArray(value)) {
            if ("in" in value) {
                query[key] = { $in: value.in };
                continue;
            }
            if ("gte" in value) {
                query[key] = { $gte: value.gte };
                continue;
            }
        }
        query[key] = value;
    }
    return query;
};

export const Label = {
    async findMany(args: { where?: Record<string, any>; orderBy?: Array<Record<string, "asc" | "desc">> } = {}) {
        const query = mapWhere(args.where || {});
        const sort = mapSort(args.orderBy);
        return LabelModel.find(query).sort(sort).lean<ILabel[]>();
    },
    async findUnique(args: {
        where: {
            id?: string;
            userId_accountId_nameNormalized?: { userId: string; accountId: string; nameNormalized: string };
        };
    }) {
        const where = args.where || {};
        if (where.id) {
            return LabelModel.findById(where.id);
        }
        if (where.userId_accountId_nameNormalized) {
            const composite = where.userId_accountId_nameNormalized;
            return LabelModel.findOne({
                userId: composite.userId,
                accountId: composite.accountId,
                nameNormalized: composite.nameNormalized,
            });
        }
        return null;
    },
    async upsert(args: {
        where: { userId_accountId_nameNormalized: { userId: string; accountId: string; nameNormalized: string } };
        create: Record<string, any>;
        update: Record<string, any>;
    }) {
        const composite = args.where.userId_accountId_nameNormalized;
        const filter = {
            userId: composite.userId,
            accountId: composite.accountId,
            nameNormalized: composite.nameNormalized,
        };

        const update: any = { $set: {} };
        for (const [key, value] of Object.entries(args.update || {})) {
            if (value && typeof value === "object" && "increment" in value) {
                if (!update.$inc) update.$inc = {};
                update.$inc[key] = (value as any).increment;
            } else if (value && typeof value === "object" && "push" in value) {
                if (!update.$push) update.$push = {};
                update.$push[key] = (value as any).push;
            } else {
                update.$set[key] = value;
            }
        }

        // For upsert, we need to ensure the 'create' fields are present if it's a new document
        // Use $setOnInsert for fields in 'create' that aren't in 'update'
        const setOnInsert: any = {};
        for (const [key, value] of Object.entries(args.create || {})) {
            if (!(key in (args.update || {})) && !(key in filter)) {
                setOnInsert[key] = value;
            }
        }
        if (Object.keys(setOnInsert).length > 0) {
            update.$setOnInsert = setOnInsert;
        }

        return LabelModel.findOneAndUpdate(filter, update, {
            upsert: true,
            new: true,
            runValidators: true,
        }).lean<ILabel>();
    },
};
