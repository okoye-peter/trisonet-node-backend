import { Router } from "express";
import { protect } from "../middlewares/auth";
import { isBlocked } from "../middlewares/isBlocked";
import { validate } from "../middlewares/validateRequest";
import { getVtuData, buyAirtime, buyData, subCable } from "../controllers/vtu.controller";
import { buyAirtimeSchema, buyDataSchema, subCableSchema } from "../validations/vtu.validation";

const router = Router();

router.use(protect);
router.use(isBlocked);

router.get('/data', getVtuData);
router.post('/buy-airtime', validate(buyAirtimeSchema), buyAirtime);
router.post('/buy-data', validate(buyDataSchema), buyData);
router.post('/sub-cable', validate(subCableSchema), subCable);

export default router;
