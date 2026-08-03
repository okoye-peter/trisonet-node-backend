import { prisma, WalletType } from "../config/prisma.js";
import { logger } from "../utils/logger";

export type CommissionLogType =
    | 'direct_referral'
    | 'indirect_referral'
    | 'chain_referral'
    | 'region_fallback'
    | 'influencer'
    | 'patron'
    | 'super_admin'
    | 'school_compensation';

export type CommissionLogStatus = 'success' | 'failed' | 'skipped';

export interface CommissionLogParams {
    recipientId?: bigint | null;
    sourceUserId?: bigint | null;
    type: CommissionLogType;
    status: CommissionLogStatus;
    amount?: number | null;
    walletType?: typeof WalletType[keyof typeof WalletType] | null;
    level?: number | null;
    reason?: string | null;
    reference?: string | null;
    processedVia?: string | null;
    metadata?: Record<string, unknown> | null;
    /** Prisma transaction client - pass when logging inside an existing $transaction so the log commits atomically with the wallet credit it describes. */
    tx?: any;
}

/**
 * Central write path for the commission audit trail. Every place that decides
 * whether or not a user gets paid a commission on someone else's activation
 * should call this, on both the success and the "why didn't they get it" paths.
 *
 * Logging failures are swallowed (never thrown) - a broken audit write must
 * never block or roll back real money movement.
 */
export class CommissionLogService {
    static async log(params: CommissionLogParams): Promise<void> {
        const client = params.tx || prisma;

        try {
            await client.commissionLog.create({
                data: {
                    recipientId: params.recipientId ?? null,
                    sourceUserId: params.sourceUserId ?? null,
                    type: params.type,
                    status: params.status,
                    amount: params.amount ?? null,
                    walletType: params.walletType ?? null,
                    level: params.level ?? null,
                    reason: params.reason ?? null,
                    reference: params.reference ?? null,
                    processedVia: params.processedVia ?? null,
                    metadata: params.metadata ?? undefined,
                }
            });
        } catch (error) {
            logger.error('[CommissionLogService] Failed to write commission log', {
                error: error instanceof Error ? error.message : String(error),
                params: { ...params, tx: undefined }
            });
        }
    }

    static async success(params: Omit<CommissionLogParams, 'status'>): Promise<void> {
        return this.log({ ...params, status: 'success' });
    }

    static async failed(params: Omit<CommissionLogParams, 'status'>): Promise<void> {
        return this.log({ ...params, status: 'failed' });
    }

    static async skipped(params: Omit<CommissionLogParams, 'status'>): Promise<void> {
        return this.log({ ...params, status: 'skipped' });
    }
}
