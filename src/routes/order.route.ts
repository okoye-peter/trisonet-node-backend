import { Router } from "express";
import { protect } from "../middlewares/auth";
import { isBlocked } from "../middlewares/isBlocked";
import { validate } from "../middlewares/validateRequest";
import { cancelOrderSchema, createOrderSchema, createReturnSchema, getOrderSchema, listOrdersSchema } from "../validations/order.validation";
import { cancelOrder, createOrder, createReturn, getOrder, getOrderStatus, listOrders } from "../controllers/order.controller";

const router = Router();

router.use(protect);
router.use(isBlocked);

router.post('/', validate(createOrderSchema), createOrder);
router.get('/', validate(listOrdersSchema), listOrders);
router.get('/:refNo/status', validate(getOrderSchema), getOrderStatus);
router.post('/:refNo/cancel', validate(cancelOrderSchema), cancelOrder);
router.post('/:refNo/return', validate(createReturnSchema), createReturn);
router.get('/:refNo', validate(getOrderSchema), getOrder);

export default router;
