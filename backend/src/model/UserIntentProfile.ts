import mongoose, { Schema, Document } from "mongoose";

export interface IUserIntentProfile extends Document {
  userId: string;

  // Positive signals (what user wants)
  includeKeywords: string[];
  preferredDomains: string[];

  // Negative signals (what user does not want)
  excludeKeywords: string[];
  blockedDomains: string[];

  // Strong explicit signals (highest priority, set by feedback buttons)
  boostedEmailIds: string[];
  suppressedEmailIds: string[];

  // User intent for AI layer
  intentSummary: string;
  userPrompt: string[]; // Array: one entry per instruction box

  // Cold-start auto-extracted labels
  inferredLabels: string[];

  // Weights for scoring engine (future use)
  weights: {
    keyword: number;
    domain: number;
    feedback: number;
  };

  // Metadata
  onboardingCompleted: boolean;
  lastUpdated: Date;
}

const UserIntentProfileSchema = new Schema<IUserIntentProfile>(
  {
    userId: { type: String, required: true, unique: true },

    includeKeywords: { type: [String], default: [] },
    preferredDomains: { type: [String], default: [] },

    excludeKeywords: { type: [String], default: [] },
    blockedDomains: { type: [String], default: [] },

    boostedEmailIds: { type: [String], default: [] },
    suppressedEmailIds: { type: [String], default: [] },

    intentSummary: { type: String, default: "" },
    userPrompt: { type: [String], default: [] },

    inferredLabels: { type: [String], default: [] },

    weights: {
      keyword: { type: Number, default: 10 },
      domain: { type: Number, default: 20 },
      feedback: { type: Number, default: 50 },
    },

    onboardingCompleted: { type: Boolean, default: false },
    lastUpdated: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// UserIntentProfileSchema.index({ userId: 1 }); - duplicated by unique:true
export const UserIntentProfileModel = mongoose.model<IUserIntentProfile>(
  "UserIntentProfile",
  UserIntentProfileSchema
);

export const UserIntentProfile = {
  async findUnique(args: { where: { userId: string }; select?: Record<string, boolean> }) {
    const q = UserIntentProfileModel.findOne({ userId: args.where.userId });
    if (args.select) {
      const projection: Record<string, 1> = {};
      for (const [k, v] of Object.entries(args.select)) {
        if (v) projection[k] = 1;
      }
      q.select(projection);
    }
    return q.lean<IUserIntentProfile | null>();
  },
  async upsert(args: {
    where: { userId: string };
    create: Record<string, any>;
    update: Record<string, any>;
  }) {
    return UserIntentProfileModel.findOneAndUpdate(
      { userId: args.where.userId },
      { 
        $set: args.update || {},
        $setOnInsert: args.create || {} 
      },
      { 
        upsert: true, 
        new: true, 
        runValidators: true 
      }
    ).lean<IUserIntentProfile>();
  },
};
