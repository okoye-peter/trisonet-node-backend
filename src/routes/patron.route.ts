import { Router } from "express";
import { protect, restrictTo } from "../middlewares/auth";
import { validate } from "../middlewares/validateRequest";
import { ROLES } from "../config/constants";
import * as patronController from "../controllers/patron.controller";
import * as patronValidation from "../validations/patron.validation";

const router = Router();

// All routes here require the user to be logged in and have the PATRON role
router.use(protect);
router.use(restrictTo(ROLES.PATRON));

router.get('/dashboard', patronController.getDashboard);
router.get('/plans', patronController.getPlans);
router.get('/members', patronController.getMembers);
router.get('/beneficiaries', patronController.getBeneficiaries);

router.post(
    '/create-group',
    validate(patronValidation.createGroupSchema),
    patronController.createGroup
);

router.post(
    '/add-co-patron',
    validate(patronValidation.addMemberSchema),
    patronController.createOrganizationCoPatron
);

router.post(
    '/members',
    validate(patronValidation.addMemberSchema),
    patronController.addMember
);

router.post(
    '/credit-member',
    validate(patronValidation.creditMemberSchema),
    patronController.creditMember
);

router.post(
    '/fund-group',
    validate(patronValidation.fundGroupSchema),
    patronController.initiateFunding
);

router.get(
    '/funding-status/:reference',
    patronController.checkFundingStatus
);

router.post(
    '/withdrawal/otp',
    patronController.sendWithdrawalOtp
);

export default router;
