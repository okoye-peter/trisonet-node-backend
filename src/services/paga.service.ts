import crypto from 'crypto';
import axios from 'axios';
import https from 'https';
import { PAGA, COMPANY_DETAILS } from '../config/constants';
import { logger, pagaLogger } from '../utils/logger';
import { AppError } from '../utils/AppError';
import { getOrSetCache } from '../utils/cache';

interface PagaResponse {
    success: boolean;
    data?: any;
    error?: string;
    operation: string;
    [key: string]: any;
}

export class PagaService {
    private readonly publicKey: string;
    private readonly secretKey: string;
    private readonly hashKey: string;
    private readonly testMode: boolean;
    private readonly baseUrl: string;
    private readonly businessUrl: string;
    private readonly businessPublicId: string;
    private readonly businessPassword: string;

    constructor() {
        this.publicKey = PAGA.USERNAME || '';
        this.secretKey = PAGA.SECRET_KEY || '';
        this.hashKey = PAGA.HMAC_KEY || '';
        // this.testMode = PAGA.TEST_MODE;
        this.testMode = false;
        this.businessPublicId = PAGA.BUSINESS_PUBLIC_ID || '';
        this.businessPassword = PAGA.BUSINESS_PASSWORD || '';

        // Collect API
        this.baseUrl = this.testMode
            ? 'https://beta-collect.paga.com/'
            : 'https://collect.paga.com/';

        // Business API
        this.businessUrl = this.testMode
            ? 'https://beta.mypaga.com/paga-webservices/business-rest/secured/'
            : 'https://www.mypaga.com/paga-webservices/business-rest/secured/';
    }

    /**
     * Get list of banks
     */
    async getBanks(): Promise<PagaResponse> {
        const referenceNumber = this.generateReference('BNK');
        const hash = this.generateHash([referenceNumber]);

        return await getOrSetCache('paga__banks', 86400, async () => {
            return await this.callApi('getBanks', { referenceNumber }, hash, true);
        });
    }

    /**
     * Register a persistent payment account (Virtual Account for customer)
     */
    async registerCustomer(data: any): Promise<PagaResponse> {
        this.validateRequiredFields(data, [
            'referenceNumber',
            'phoneNumber',
            'firstName',
            'lastName',
            'accountName',
            'accountReference'
        ]);

        const hashParams = [
            data.referenceNumber,
            data.accountReference,
            data.financialIdentificationNumber || '',
            data.creditBankId || '',
            data.creditBankAccountNumber || '',
            data.callbackUrl || ''
        ];

        const hash = this.generateHash(hashParams);

        return await this.callApi('registerPersistentPaymentAccount', data, hash);
    }

    /**
     * Generate virtual account (Payment Request) — Collect API
     */
    async generateVirtualAccount(
        amount: number,
        customerName: string,
        customerPhoneNumber: string,
        referenceNumber?: string,
        options: any = {}
    ): Promise<PagaResponse> {
        const refNumber = referenceNumber || this.generateReference('VR');

        // Expiry handling
        let expiry = options.expiryDateTimeUTC;
        if (!expiry || this.isDateExpired(expiry)) {
            expiry = this.getNigeriaExpiry();
        }

        const currency = "NGN";

        const payer = {
            name: customerName,
            phoneNumber: this.formatPhoneNumber(customerPhoneNumber || COMPANY_DETAILS.PHONE_NUMBER),
            email: "",
            ...options.payer
        };

        const payee = {
            name: COMPANY_DETAILS.NAME, // Should be app name from config but hardcoded for now based on COMPANY_DETAILS
            accountNumber: "",
            phoneNumber: this.formatPhoneNumber(options.payee?.phoneNumber || ""),
            bankId: "",
            bankAccountNumber: "",
            ...options.payee
        };

        const payload: any = {
            ...options,
            referenceNumber: refNumber,
            amount: parseFloat(amount.toString()),
            currency: currency,
            payer: Object.fromEntries(Object.entries(payer).filter(([_, v]) => v !== "")),
            payee: Object.fromEntries(Object.entries(payee).filter(([_, v]) => v !== "")),
            payerCollectionFeeShare: 1,
            payeeCollectionFeeShare: 0,
            isAllowOverPayments: true,
            isAllowPartialPayments: false,
            paymentMethods: ["BANK_TRANSFER"],
            callbackUrl: PAGA.CALLBACK_URL,
            expiryDateTimeUTC: expiry
        };

        const hashParams = [
            refNumber,
            amount.toString(),
            currency,
            payer.phoneNumber || '',
            payer.email || '',
            payee.accountNumber || '',
            payee.phoneNumber || '',
            payee.bankId || '',
            payee.bankAccountNumber || ''
        ];

        const hash = this.generateHash(hashParams);

        const result = await this.callApi('paymentRequest', payload, hash);

        if (!result.success) {
            return result;
        }

        try {
            const data = result.data;
            const virtualAccountDetails = this.extractVirtualAccountDetails(data);

            return {
                success: true,
                operation: 'generateVirtualAccount',
                data: {
                    virtual_account: virtualAccountDetails.account_number,
                    bank_name: virtualAccountDetails.bank_name,
                    account_name: virtualAccountDetails.account_name,
                    amount: data.totalPaymentAmount || amount,
                    reference: refNumber,
                    expires_at: (data.expiryDateTimeUTC || expiry || '').split('T')[1]?.substring(0, 5) || null,
                    expiry_date_full: data.expiryDateTimeUTC || expiry,
                    full_response: data
                }
            };
        } catch (error: any) {
            pagaLogger.error(`Paga generateVirtualAccount Exception`, { error: error.message });
            return {
                success: false,
                error: error.message,
                operation: 'generateVirtualAccount'
            };
        }
    }

    /**
     * Get account balance (Business API)
     */
    async getAccountBalance(): Promise<PagaResponse> {
        const referenceNumber = this.generateReference('BAL');
        const hash = this.generateHash([referenceNumber]);

        return await this.callApi('accountBalance', { referenceNumber }, hash, true);
    }

    /**
     * Verify payment status — Collect API
     */
    async verifyPayment(referenceNumber: string): Promise<PagaResponse> {
        const hash = this.generateHash([referenceNumber]);
        const result = await this.callApi('status', { referenceNumber }, hash);

        if (!result.success) {
            return result;
        }

        const data = result.data;
        const statusCode = data.statusCode ?? null;
        const transactionStatus = data.transactionStatus ?? data.status ?? 'UNKNOWN';

        return {
            success: true,
            operation: 'verifyPayment',
            is_paid: this.isPaymentSuccessful(statusCode, transactionStatus),
            status: transactionStatus,
            status_code: statusCode,
            amount: data.amount ?? data.transactionAmount ?? 0,
            reference: referenceNumber,
            transaction_id: data.transactionId ?? null,
            completed_at: data.completedDateTimeUTC ?? data.transactionDateTime ?? null,
            full_response: data
        };
    }

    /**
     * Validate deposit to bank — Business API
     */
    async validateDepositToBank(data: any): Promise<PagaResponse> {
        this.validateRequiredFields(data, [
            'referenceNumber',
            'amount',
            'destinationBankUUID',
            'destinationBankAccountNumber'
        ]);

        const hashParams = [
            data.referenceNumber,
            data.amount.toString(),
            data.destinationBankUUID,
            data.destinationBankAccountNumber
        ];

        const hash = this.generateHash(hashParams);

        return await this.callApi('validateDepositToBank', data, hash, true);
    }

    /**
     * Resolve bank account details
     */
    async resolveBankDetails(bankUUID: string, accountNumber: string, bankCode?: string): Promise<PagaResponse> {
        pagaLogger.info('detail', { bankUUID, accountNumber, bankCode })
        if (bankCode && !bankUUID) {
            const bank = await this.getBankByCode(bankCode);

            if (!bank) {
                pagaLogger.error(`Paga resolveBankDetails Error: Bank with code ${bankCode} not found`);
                return {
                    success: false,
                    error: `Bank with code ${bankCode} not found`,
                    operation: 'resolveBankDetails'
                };
            }

            bankUUID = bank.uuid || bank.bankUUID || bank.uuid;
        }

        const data = {
            referenceNumber: this.generateReference('RESOLVE'),
            amount: 100,
            destinationBankUUID: bankUUID,
            destinationBankAccountNumber: accountNumber
        };

        const result = await this.validateDepositToBank(data);

        if (!result.success) {
            return result;
        }

        const apiData = result.data;
        const statusCode = apiData.responseCode ?? null;
        const isValid = statusCode === 0 || statusCode === '0';

        if (!isValid) {
            pagaLogger.error(`Paga resolveBankDetails Failure`, {
                accountNumber,
                bankUUID,
                response: apiData
            });
            return {
                success: false,
                error: apiData.message || apiData.statusMessage || 'Account validation failed',
                operation: 'resolveBankDetails'
            };
        }

        return {
            success: true,
            operation: 'resolveBankDetails',
            data: {
                account_number: accountNumber,
                account_name: apiData.destinationAccountHolderNameAtBank || apiData.accountName || 'Unknown',
                bank_uuid: bankUUID,
                is_valid: true,
                status_code: statusCode,
                full_response: apiData
            }
        };
    }

    async resolveBankDetailsByCode(bankCode: string, accountNumber: string): Promise<PagaResponse> {
        return await this.resolveBankDetails('', accountNumber, bankCode);
    }

    async getBankByCode(bankCode: string): Promise<any | null> {
        const result = await this.getBanks();

        if (!result.success || !result.data || !result.data.banks) {
            return null;
        }

        return result.data.banks.find((b: any) => b.bankCode === bankCode);
    }

    async getBankByName(bankName: string): Promise<any | null> {
        const result = await this.getBanks();

        if (!result.success || !result.data || !result.data.banks) {
            return null;
        }

        const banks = result.data.banks;
        const lowerCaseBankName = bankName.toLowerCase();

        let bank = banks.find((b: any) => b.name && b.name.toLowerCase() === lowerCaseBankName);

        if (!bank) {
            bank = banks.find((b: any) => b.name && b.name.toLowerCase().includes(lowerCaseBankName));
        }

        return bank;
    }

    /**
     * Withdraw to a Paga account or phone number
     */
    async withdraw(amount: number, destinationAccount: string, referenceNumber?: string, options: any = {}): Promise<PagaResponse> {
        const refNumber = referenceNumber || this.generateReference('WDR');

        const payload = {
            referenceNumber: refNumber,
            amount: amount.toString(),
            currency: 'NGN',
            destinationAccount: destinationAccount,
            suppressRecipientMessage: 'false',
            sendWithdrawalCode: 'false',
            sendAtmWithdrawalCodes: 'false',
            ...options
        };

        const hashParams = [
            refNumber,
            amount.toString(),
            destinationAccount
        ];

        const hash = this.generateHash(hashParams);
        const result = await this.callApi('moneyTransfer', payload, hash, true);

        if (!result.success) {
            return result;
        }

        const data = result.data;
        const statusCode = data.responseCode ?? data.statusCode ?? null;
        const isSuccess = statusCode === 0 || statusCode === '0';

        if (!isSuccess) {
            pagaLogger.error(`Paga withdraw Failure`, {
                destinationAccount,
                amount,
                response: data
            });
        }

        return {
            success: isSuccess,
            operation: 'withdraw',
            reference: refNumber,
            transaction_id: data.transactionId ?? null,
            status_code: statusCode,
            message: data.message || data.statusMessage || null,
            fee: data.fee ?? null,
            receiver: data.receiverRegistrationStatus ?? null,
            full_response: data
        };
    }

    /**
     * Withdraw to a bank account
     */
    async withdrawToBank(
        amount: number,
        destinationBankUUID: string,
        destinationBankAccountNumber: string,
        referenceNumber?: string,
        options: any = {}
    ): Promise<PagaResponse> {
        const refNumber = referenceNumber || this.generateReference('WDR');

        const payload = {
            referenceNumber: refNumber,
            amount: amount.toString(),
            currency: 'NGN',
            destinationBankUUID: destinationBankUUID,
            destinationBankAccountNumber: destinationBankAccountNumber,
            remarks: '',
            ...options
        };

        const hashParams = [
            refNumber,
            amount.toString(),
            destinationBankUUID,
            destinationBankAccountNumber
        ];

        const hash = this.generateHash(hashParams);
        const result = await this.callApi('depositToBank', payload, hash, true);

        if (!result.success) {
            return result;
        }

        const data = result.data;
        const statusCode = data.responseCode ?? data.statusCode ?? null;
        const isSuccess = statusCode === 0 || statusCode === '0';

        if (!isSuccess) {
            pagaLogger.error(`Paga withdrawToBank Failure`, {
                destinationBankAccountNumber,
                destinationBankUUID,
                amount,
                response: data
            });
        }

        return {
            success: isSuccess,
            operation: 'withdrawToBank',
            reference: refNumber,
            transaction_id: data.transactionId ?? null,
            status_code: statusCode,
            message: data.message || data.statusMessage || null,
            account_name: data.destinationAccountHolderNameAtBank || null,
            fee: data.fee ?? null,
            full_response: data
        };
    }

    /**
     * Verify the status of a withdrawal
     */
    async verifyWithdrawal(referenceNumber: string): Promise<PagaResponse> {
        const hash = this.generateHash([referenceNumber]);
        const result = await this.callApi('transactionStatus', { referenceNumber }, hash, true);

        if (!result.success) {
            return result;
        }

        const data = result.data;
        const statusCode = data.responseCode ?? data.statusCode ?? null;
        const transactionStatus = data.transactionStatus ?? data.status ?? 'UNKNOWN';

        return {
            success: true,
            operation: 'verifyWithdrawal',
            is_completed: this.isPaymentSuccessful(statusCode, transactionStatus),
            status: transactionStatus,
            status_code: statusCode,
            reference: referenceNumber,
            transaction_id: data.transactionId ?? null,
            amount: data.amount ?? data.transactionAmount ?? 0,
            completed_at: data.completedDateTimeUTC ?? data.transactionDateTime ?? null,
            message: data.statusMessage || data.message || null,
            full_response: data
        };
    }

    /**
     * Centralized API Caller
     */
    private async callApi(endpoint: string, data: any, hash: string, isBusiness: boolean = false): Promise<PagaResponse> {
        const url = (isBusiness ? this.businessUrl : this.baseUrl) + endpoint;
        const operation = (isBusiness ? 'Business:' : 'Collect:') + endpoint;

        const maxAttempts = 2;
        let attempt = 0;

        while (attempt < maxAttempts) {
            attempt++;
            try {
                const headers: any = {
                    'hash': hash,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'Connection': 'close',
                };

                if (isBusiness) {
                    headers['principal'] = this.businessPublicId;
                    headers['credentials'] = this.businessPassword;
                }

                const response = await axios.post(url, data, {
                    headers,
                    ...(isBusiness ? {} : {
                        auth: {
                            username: this.publicKey,
                            password: this.secretKey
                        }
                    }),
                    timeout: 60000,
                    httpsAgent: new https.Agent({ keepAlive: false }),
                });


                return {
                    success: true,
                    data: response.data,
                    operation,
                };

            } catch (error: any) {
                if (error.response) {
                    pagaLogger.error(`Paga API Error: ${operation}`, {
                        status: error.response.status,
                        response: error.response.data,
                    });
                    return {
                        success: false,
                        error: `API call failed with status ${error.response.status}: ${JSON.stringify(error.response.data).substring(0, 200)}`,
                        operation,
                    };
                }

                if (attempt < maxAttempts) {
                    pagaLogger.warn(`Paga request failed on attempt ${attempt}, retrying: ${operation}`, {
                        error: error.message,
                    });
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    continue;
                }

                pagaLogger.error(`Paga API Exception: ${operation}`, { error: error.message });
                return {
                    success: false,
                    error: error.message,
                    operation,
                };
            }
        }

        return {
            success: false,
            error: 'Maximum retry attempts reached',
            operation,
        };
    }

    /**
     * Generate SHA-512 Hash
     */
    generateHash(params: string[]): string {
        const stringToHash = params
            .filter(param => param !== null && param !== '')
            .join('') + this.hashKey;

        return crypto.createHash('sha512').update(stringToHash).digest('hex');
    }

    /**
     * Format phone number for Paga (digits only, e.g. 2348103...)
     */
    private formatPhoneNumber(phoneNumber: string): string {
        if (!phoneNumber) return '';

        // Remove all non-digits
        let cleaned = phoneNumber.replace(/\D/g, '');

        // If it starts with 0, replace with 234
        if (cleaned.startsWith('0') && cleaned.length === 11) {
            cleaned = '234' + cleaned.substring(1);
        }

        return cleaned;
    }

    /**
     * Generate unique reference
     */
    generateReference(prefix: string = 'PAGA'): string {
        const timestamp = Math.floor(Date.now() / 1000).toString(16).toUpperCase();
        const randomBytes = crypto.randomBytes(4).toString('hex').toUpperCase(); // always 8 chars
        return `${prefix.toUpperCase()}${timestamp}${randomBytes}`;
    }

    /**
     * Extract virtual account details
     */
    private extractVirtualAccountDetails(response: any): any {
        if (!response.paymentMethods || !Array.isArray(response.paymentMethods)) {
            pagaLogger.error("Payment methods not found in response");
            throw new AppError("Payment methods not found in response", 500);
        }

        for (const method of response.paymentMethods) {
            if (method.name === 'BANK_TRANSFER') {
                return {
                    account_number: method.properties?.AccountNumber || null,
                    bank_name: method.properties?.BankName || 'Paga',
                    account_name: method.properties?.AccountName || 'Trisonet'
                };
            }
        }

        pagaLogger.error("BANK_TRANSFER details not found in response");
        throw new AppError("BANK_TRANSFER details not found in response", 500);
    }

    /**
     * Check if payment was successful
     */
    private isPaymentSuccessful(statusCode: any, transactionStatus: string): boolean {
        const successfulStatusCodes = ['0', '00', 'SUCCESS'];
        const successfulStatuses = ['SUCCESS', 'SUCCESSFUL', 'COMPLETED', 'PAID'];

        const codeMatch = statusCode !== null && successfulStatusCodes.includes(String(statusCode).toUpperCase());
        const statusMatch = successfulStatuses.includes(transactionStatus.toUpperCase());

        return codeMatch || statusMatch;
    }

    /**
     * Calculate charge including VAT
     */
    calculateCharge(amount: number): number {
        const chargeRate = 0.008062; // From PHP config('paga.charges')
        const vatRate = 0.075;     // From PHP config('paga.vat')
        const capped = 1000;       // From PHP config('paga.capped')

        const charge = amount * chargeRate;
        const vat = charge * vatRate;
        const totalCharge = charge + vat;

        return Math.min(Math.round(totalCharge * 100) / 100, capped);
    }

    /**
     * Validate required fields
     */
    private validateRequiredFields(data: any, requiredFields: string[]): void {
        for (const field of requiredFields) {
            if (data[field] === undefined || data[field] === null || data[field] === '') {
                pagaLogger.error(`Missing required field: ${field}`);
                throw new AppError(`Missing required field: ${field}`, 400);
            }
        }
    }

    private getNigeriaExpiry() {
        const date = new Date();
        date.setMinutes(date.getMinutes() + 30);
        return new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'Africa/Lagos',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }).format(date).replace(' ', 'T');
    };

    private isDateExpired(expiryString: string): boolean {
        const expiryDate = new Date(expiryString);
        // Get current time in Lagos
        const nowLagos = new Date(new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'Africa/Lagos',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }).format(new Date()).replace(' ', 'T'));

        return expiryDate <= nowLagos;
    }

}
