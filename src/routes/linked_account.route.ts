import { Router } from "express";
import { protect } from "../middlewares/auth";
import { isBlocked } from "../middlewares/isBlocked";
import { validate } from "../middlewares/validateRequest";
import { userRateLimiter } from "../middlewares/rateLimiter";
import {
    getLinkedAccounts,
    requestAccountLink,
    verifyAccountLink,
    removeLinkedAccount,
    switchAccount,
} from "../controllers/linked_account.controller";
import { requestLinkSchema, verifyLinkSchema, linkedUserIdSchema } from "../validations/linked_account.validation";

const router = Router();

// Each request checks a password and may send an SMS/email, so keep it tight.
const linkRequestLimiter = userRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: "Too many link attempts. Please try again after 15 minutes.",
    keyPrefix: "account-link-request",
});

router.use(protect);

// Listing and switching stay open to blocked customers so they can move to another of their accounts.
router.get("/", getLinkedAccounts);
router.post("/:userId/switch", validate(linkedUserIdSchema), switchAccount);

router.post("/link/request", isBlocked, linkRequestLimiter, validate(requestLinkSchema), requestAccountLink);
router.post("/link/verify", isBlocked, validate(verifyLinkSchema), verifyAccountLink);
router.delete("/:userId", isBlocked, validate(linkedUserIdSchema), removeLinkedAccount);

export default router;
