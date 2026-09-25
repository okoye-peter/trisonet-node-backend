import { prisma, Prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";
import { ROLES, SELLER_STORE_STATUS } from "../config/constants";

export interface SellerStoreInput {
    name: string;
    description: string;
    logo: string;
    logoPublicId?: string | undefined;
    phone: string;
    address: string;
    stateId?: string | undefined;
}

// The store fields a seller can submit. An approved store's edit is held in
// pending_changes (keyed by these names) until an admin approves it in PHP -
// SellerStoreController::approve applies it by the same snake_case column names.
const EDITABLE_FIELDS = ['name', 'description', 'logo', 'logoPublicId', 'phone', 'address', 'stateId'] as const;
type EditableField = typeof EDITABLE_FIELDS[number];

const COLUMN_NAMES: Record<EditableField, string> = {
    name: 'name',
    description: 'description',
    logo: 'logo',
    logoPublicId: 'logo_public_id',
    phone: 'phone',
    address: 'address',
    stateId: 'state_id',
};

const STATUS_TEXT: Record<number, string> = {
    [SELLER_STORE_STATUS.PENDING]: 'pending',
    [SELLER_STORE_STATUS.APPROVED]: 'approved',
    [SELLER_STORE_STATUS.REJECTED]: 'rejected',
    [SELLER_STORE_STATUS.SUSPENDED]: 'suspended',
};

const storeInclude = { state: { select: { id: true, name: true } } } as const;

const normalize = (input: SellerStoreInput): Record<EditableField, string | null> => ({
    name: input.name,
    description: input.description,
    logo: input.logo,
    logoPublicId: input.logoPublicId ?? null,
    phone: input.phone,
    address: input.address,
    stateId: input.stateId ?? null,
});

// pending_changes is stored with PHP's column names so the admin side can apply it
// with a plain $store->fill(); the seller-facing API reads it back in camelCase.
const toColumns = (values: Partial<Record<EditableField, string | null>>) =>
    Object.fromEntries(Object.entries(values).map(([k, v]) => [COLUMN_NAMES[k as EditableField], v]));

const fromColumns = (json: Prisma.JsonValue | null) => {
    if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
    const byColumn = json as Record<string, unknown>;
    return Object.fromEntries(
        EDITABLE_FIELDS.filter((f) => COLUMN_NAMES[f] in byColumn).map((f) => [f, byColumn[COLUMN_NAMES[f]] ?? null]),
    );
};

const serializeStore = (store: any) => ({
    id: store.id.toString(),
    name: store.name,
    description: store.description,
    logo: store.logo,
    phone: store.phone,
    address: store.address,
    stateId: store.stateId?.toString() ?? null,
    state: store.state ? { id: store.state.id.toString(), name: store.state.name } : null,
    status: STATUS_TEXT[store.status] ?? 'unknown',
    reviewComment: store.reviewComment,
    reviewedAt: store.reviewedAt,
    approvedAt: store.approvedAt,
    pendingChanges: fromColumns(store.pendingChanges),
    pendingChangesStatus: store.pendingChangesStatus === null ? null : STATUS_TEXT[store.pendingChangesStatus] ?? 'unknown',
    canListProducts: store.status === SELLER_STORE_STATUS.APPROVED,
    createdAt: store.createdAt,
});

export class SellerStoreService {
    /**
     * Who may sell: activated, adult customer accounts only. Store guests, infants,
     * schools, sponsors, patrons and staff accounts cannot open a store.
     */
    static eligibility(user: any): { eligible: boolean; reason?: string } {
        if (Number(user.role) !== ROLES.CUSTOMER || user.isInfant) {
            return { eligible: false, reason: 'Only adult partner accounts can open a store.' };
        }
        if (!user.status) {
            return { eligible: false, reason: 'Your account must be activated before you can open a store.' };
        }
        return { eligible: true };
    }

    static assertEligible(user: any) {
        const { eligible, reason } = this.eligibility(user);
        if (!eligible) throw new AppError(reason!, 403);
    }

    static async getMyStore(user: any) {
        const store = await prisma.sellerStore.findUnique({ where: { userId: user.id }, include: storeInclude });
        return {
            ...this.eligibility(user),
            store: store ? serializeStore(store) : null,
        };
    }

    /**
     * Creates the store application, or updates it. Every submission needs admin approval:
     * - no store yet            → created as pending
     * - pending / rejected      → fields updated in place, (re)queued as pending
     * - approved                → held in pending_changes; the live store keeps showing
     *                             its approved details until the edit is approved
     * - suspended               → refused; only an admin can lift a suspension
     */
    static async saveMyStore(user: any, input: SellerStoreInput) {
        this.assertEligible(user);

        const values = normalize(input);

        if (values.stateId) {
            const state = await prisma.state.findUnique({ where: { id: BigInt(values.stateId) }, select: { id: true } });
            if (!state) throw new AppError('Invalid state', 400);
        }

        const liveData = {
            name: values.name!,
            description: values.description!,
            logo: values.logo!,
            logoPublicId: values.logoPublicId,
            phone: values.phone!,
            address: values.address!,
            stateId: values.stateId ? BigInt(values.stateId) : null,
        };

        const resetReview = { reviewComment: null, reviewedBy: null, reviewedAt: null };

        const existing = await prisma.sellerStore.findUnique({ where: { userId: user.id } });

        if (!existing) {
            try {
                const store = await prisma.sellerStore.create({
                    data: { ...liveData, userId: user.id, status: SELLER_STORE_STATUS.PENDING, createdAt: new Date() },
                    include: storeInclude,
                });
                return serializeStore(store);
            } catch (err) {
                // A concurrent submission already created it (seller_stores.user_id is unique).
                if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
                    throw new AppError('Your store application has already been submitted', 409);
                }
                throw err;
            }
        }

        if (existing.status === SELLER_STORE_STATUS.SUSPENDED) {
            throw new AppError('Your store is suspended. Please contact support.', 403);
        }

        if (existing.status !== SELLER_STORE_STATUS.APPROVED) {
            const store = await prisma.sellerStore.update({
                where: { id: existing.id },
                data: { ...liveData, ...resetReview, status: SELLER_STORE_STATUS.PENDING },
                include: storeInclude,
            });
            return serializeStore(store);
        }

        const current: Record<EditableField, string | null> = {
            name: existing.name,
            description: existing.description,
            logo: existing.logo,
            logoPublicId: existing.logoPublicId,
            phone: existing.phone,
            address: existing.address,
            stateId: existing.stateId?.toString() ?? null,
        };
        const changed = Object.fromEntries(
            EDITABLE_FIELDS.filter((f) => values[f] !== current[f]).map((f) => [f, values[f]]),
        );

        if (Object.keys(changed).length === 0) {
            throw new AppError('No changes to submit', 400);
        }

        const store = await prisma.sellerStore.update({
            where: { id: existing.id },
            data: {
                ...resetReview,
                pendingChanges: toColumns(changed),
                pendingChangesStatus: SELLER_STORE_STATUS.PENDING,
            },
            include: storeInclude,
        });
        return serializeStore(store);
    }

    /** Withdraws an approved store's edit that is still awaiting (or was refused) review. */
    static async discardPendingChanges(user: any) {
        const existing = await prisma.sellerStore.findUnique({ where: { userId: user.id } });
        if (!existing || existing.pendingChangesStatus === null) {
            throw new AppError('There are no store changes to discard', 400);
        }

        const store = await prisma.sellerStore.update({
            where: { id: existing.id },
            data: { pendingChanges: Prisma.DbNull, pendingChangesStatus: null, reviewComment: null },
            include: storeInclude,
        });
        return serializeStore(store);
    }
}
