import { NextFunction, Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { PagaService } from "../services/paga.service";
import { sendSuccess } from "../utils/responseWrapper";

export const getBanksList = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const result = await (new PagaService()).getBanks();
    if(!result.success){
        return sendSuccess(res, 200, 'service currently not available', []);
    }

    return sendSuccess(res, 200, 'success', result.data);
})


export const resolveBankAccount = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { accountNumber, bankUUID } = req.body;

    const result = await (new PagaService()).resolveBankDetails(bankUUID, accountNumber);

    if(!result.success){
        return sendSuccess(res, 200, 'service currently not available', []);
    }
    const data = {
        accountNumber: result.data.account_number,
        accountName: result.data.account_name,
        bankUUID: result.data.bank_uuid,
        isValid: result.data.is_valid,
    }

    return sendSuccess(res, 200, 'success', data);
})


export const resetBankAccount = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { accountNumber, bankUUID } = req.body;

    const result = await (new PagaService()).resolveBankDetails(bankUUID, accountNumber);

    if (!result.success) {
        return sendSuccess(res, 200, 'service currently not available', []);
    }

    const data = {
        accountNumber: result.data.account_number,
        accountName: result.data.account_name,
        bankUUID: result.data.bank_uuid,
        isValid: result.data.is_valid,
    }

    return sendSuccess(res, 200, 'success', data);
})

export const getUserBankDetails = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if(!user?.bank || !user?.accountNumber){
        return sendSuccess(res, 400, 'Bank details not found', []);
    }

    const paga = new PagaService();

    const result = await paga.getBankByName(user.bank);
    // return sendSuccess(res, 200, 'service currently not available', result);

    if(!result){
        return sendSuccess(res, 200, 'service currently not available', []);
    }

    const acc = await paga.resolveBankDetailsByCode(result.bankCode, user.accountNumber);

    if(!acc.success){
        return sendSuccess(res, 200, 'service currently not available', []);
    }

    const data = {
        isValid: acc.data.is_valid,
        accountNumber: acc.data.account_number,
        bankUUID: acc.data.bank_uuid,
        accountName: acc.data.account_name,
    }

    return sendSuccess(res, 200, 'success', data);
})