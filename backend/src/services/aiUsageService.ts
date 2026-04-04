import { AIUsageDailyModel } from "../model/AIUsageDaily";

export const SHARED_DAILY_QUOTA = 40;
export const BYOK_DAILY_QUOTA = 200;

export const getUtcDateKey = (): string => new Date().toISOString().slice(0, 10);

export const getDailyQuotaLimit = (hasByokKey: boolean): number =>
  hasByokKey ? BYOK_DAILY_QUOTA : SHARED_DAILY_QUOTA;

export interface DailyUsageStatus {
  quotaDateUtc: string;
  dailyQuotaLimit: number;
  dailyQuotaUsed: number;
  dailyQuotaRemaining: number;
}

export const getDailyUsageStatus = async (
  userId: string,
  quotaLimit: number
): Promise<DailyUsageStatus> => {
  const dateKey = getUtcDateKey();
  const usage = await AIUsageDailyModel.findOne({ userId, dateKey });
  const used = usage?.processedCount || 0;
  return {
    quotaDateUtc: dateKey,
    dailyQuotaLimit: quotaLimit,
    dailyQuotaUsed: used,
    dailyQuotaRemaining: Math.max(quotaLimit - used, 0),
  };
};

export const consumeDailyQuota = async (
  userId: string,
  quotaLimit: number
): Promise<DailyUsageStatus | null> => {
  const dateKey = getUtcDateKey();

  await AIUsageDailyModel.updateOne(
    { userId, dateKey },
    {
      $setOnInsert: {
        userId,
        dateKey,
        processedCount: 0,
        quotaLimit,
      },
    },
    { upsert: true }
  );

  const updated = await AIUsageDailyModel.findOneAndUpdate(
    { userId, dateKey, processedCount: { $lt: quotaLimit } },
    {
      $inc: { processedCount: 1 },
      $set: {
        quotaLimit,
        lastUpdatedAt: new Date(),
      },
    },
    { new: true }
  );

  if (!updated) return null;

  const used = updated.processedCount || 0;
  return {
    quotaDateUtc: dateKey,
    dailyQuotaLimit: quotaLimit,
    dailyQuotaUsed: used,
    dailyQuotaRemaining: Math.max(quotaLimit - used, 0),
  };
};

