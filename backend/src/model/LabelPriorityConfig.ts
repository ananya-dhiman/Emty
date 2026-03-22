import mongoose, { Schema, Document, Types } from "mongoose";

export interface ILabelPriorityItem {
  labelId: Types.ObjectId;
  labelNameSnapshot: string;
  rank: number;
}

export interface ILabelPriorityConfig extends Document {
  userId: string;
  accountId: string;
  priorities: ILabelPriorityItem[];
  isReviewedByUser: boolean;
  initializedAt?: Date;
  lastComputedAt?: Date;
  lastEditedAt?: Date;
}

const LabelPriorityItemSchema = new Schema<ILabelPriorityItem>(
  {
    labelId: { type: Schema.Types.ObjectId, ref: "Label", required: true },
    labelNameSnapshot: { type: String, required: true },
    rank: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const LabelPriorityConfigSchema = new Schema<ILabelPriorityConfig>(
  {
    userId: { type: String, required: true, index: true },
    accountId: { type: String, required: true, index: true },
    priorities: { type: [LabelPriorityItemSchema], default: [] },
    isReviewedByUser: { type: Boolean, default: false },
    initializedAt: { type: Date, default: null },
    lastComputedAt: { type: Date, default: null },
    lastEditedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

LabelPriorityConfigSchema.index({ userId: 1, accountId: 1 }, { unique: true });

export const LabelPriorityConfigModel = mongoose.model<ILabelPriorityConfig>(
  "LabelPriorityConfig",
  LabelPriorityConfigSchema
);
