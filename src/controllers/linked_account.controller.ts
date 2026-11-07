import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { sendSuccess } from "../utils/responseWrapper";
import {
    listLinkedAccounts,
    requestLink,
    verifyLink,
    unlinkAccount,
    switchToAccount,
} from "../services/linked_account.service";

export const getLinkedAccounts = asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    const accounts = await listLinkedAccounts(user.id);
    sendSuccess(res, 200, "Partner accounts retrieved successfully", accounts);
});

export const requestAccountLink = asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { identifier, password } = req.body;
    const result = await requestLink({ id: user.id, role: Number(user.role) }, identifier, password);
    sendSuccess(res, 200, `Verification code sent to the partner account's ${result.destination}`, result);
});

export const verifyAccountLink = asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    const accounts = await verifyLink(user.id, req.body.otp);
    sendSuccess(res, 200, "Partner account linked successfully", accounts);
});

export const removeLinkedAccount = asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    const accounts = await unlinkAccount(user.id, BigInt(req.params.userId as string));
    sendSuccess(res, 200, "Partner account unlinked successfully", accounts);
});

export const switchAccount = asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    const session = await switchToAccount(user.id, BigInt(req.params.userId as string));
    sendSuccess(res, 200, "Switched to partner account successfully", session);
});
