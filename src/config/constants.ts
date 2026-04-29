export const ROLES = {
    SUPER_ADMIN: 1,
    ADMIN: 2,
    CUSTOMER: 3,
    INFANT_ADMIN: 4,
    INFLUENCER: 5,
    SPONSOR: 6,
    SCHOOL: 7,
    PATRON: 8,
} as const;

export const ACCOUNT_STATES = {
    SUSPENDED: 0,
    ACTIVE: 1,
} as const;

export const WITHDRAWAL_STATUSES = {
    FAILED: 0,
    SUCCESS: 1,
    PENDING: 2,
} as const;

export const INFANT_SCHOOL_FEE_STATUSES = {
    PENDING: '0',
    SUCCESS: '1',
    FAILED: '2',
    BEING_PROCESSED: '3',
} as const;

export const CLOUDINARY = {
    NAME: process.env.CLOUDINARY_NAME,
    API_KEY: process.env.CLOUDINARY_API_KEY,
    API_SECRET: process.env.CLOUDINARY_API_SECRET,
    FOLDERS: {
        USER_IMAGES: 'users_profile_pictures',
        WARD_SLOTS: 'ward_slot_request_receipts',
    },
} as const;

export const WEB_VERSION = process.env.WEB_VERSION;

export const CLUBKONNECT = {
    USER_ID: process.env.CLUBKONNECT_USERID,
    API_KEY: process.env.CLUBKONNECT_APIKEY,
} as const;

export const VTU_NG = {
    USERNAME: process.env.VTU_USERNAME,
    PASSWORD: process.env.VTU_PASSWORD,
} as const;

export const TERMII = {
    API_KEY: process.env.TERMII_API_KEY,
    SENDER_ID: process.env.TERMII_SENDER_ID,
    EMAIL_CONFIGURATION_ID: process.env.TERMII_EMAIL_CONFIG_ID,
} as const;

export const SCHOOL_FEES_PENALTY_CHARGE = 100000;

export const SPONSOR_INFANT_YEARLY_RETURNS = {
    UNLIMITED: 100000,
    LIMITED: 50000,
    PERSONAL: 30000,
} as const;

export const ORDER_GROUP_STATUSES = {
    CANCELLED: 0,
    PENDING: 1,
    SHIPPED: 2,
    DELIVERED: 3,
} as const;

export const ORDER_PAYMENT_METHODS = {
    WALLET: 1,
    CARD: 2,
} as const;

export const UNBLOCKING_PAYMENT_STATUSES = {
    PENDING: 0,
    APPROVED: 1,
    REJECTED: 2,
} as const;

export const GUARDIAN_MAX_WARDS = 10;

export const ORDERED_CLASS_NAMES = [
    'kindergarten',
    'nursery 1',
    'nursery 2',
    'nursery 3',
    'prep 1',
    'prep 2',
    'prep 3',
    'primary 1',
    'primary 2',
    'primary 3',
    'primary 4',
    'primary 5',
    'primary 6',
    'jss 1',
    'jss 2',
    'jss 3',
    'sss 1',
    'sss 2',
    'sss 3',
] as const;

export const MAX_PATRONS_PER_GROUP = 10;

export const INFANT_FORM_FEE = 30000;

export const MAX_ASSET_DEPOT = 36;

export const COMPANY_DETAILS = {
    NAME: 'Trisonet',
    EMAIL: 'info@trisonet.com',
    PHONE_NUMBER: '+2349078168453',
} as const;

export const PAGA = {
    USERNAME: process.env.PAGA_USERNAME,
    SECRET_KEY: process.env.PAGA_SECRET_KEY,
    HMAC_KEY: process.env.PAGA_HMAC_KEY,
    BASE_URL: process.env.PAGA_BASE_URL,
    TEST_MODE: process.env.PAGA_TEST_MODE === 'true',
    BUSINESS_PUBLIC_ID: process.env.PAGA_BUSINESS_PUBLIC_ID,
    BUSINESS_PASSWORD: process.env.PAGA_BUSINESS_PASSWORD,
    CALLBACK_URL: process.env.PAGA_CALLBACK_URL,
} as const;

export const ACTIVATION_CARD_STATUSES = {
    PENDING: 0,
    APPROVED: 1,
    CANCELLED: 2,
    
} as const

export const PREMBLY = {
    API_KEY: process.env.PREMBLY_API_KEY,
} as const;
