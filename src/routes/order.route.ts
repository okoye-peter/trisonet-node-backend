import { Router } from "express";
import { optionalAuth, protect } from "../middlewares/auth";
import { isBlocked } from "../middlewares/isBlocked";
import { validate } from "../middlewares/validateRequest";
import { cancelOrderSchema, createOrderSchema, createReturnSchema, getOrderSchema, listOrdersSchema } from "../validations/order.validation";
import { cancelOrder, createOrder, createReturn, getOrder, getOrderStatus, listOrders } from "../controllers/order.controller";

const router = Router();

// Checkout and order lookup-by-reference must work for guests (no account) as well
// as logged-in users, so they use optionalAuth instead of the blanket protect below.
// Everything else — listing "my orders", cancelling, returning — requires an account.
router.post('/', optionalAuth, isBlocked, validate(createOrderSchema), createOrder);
router.get('/:refNo/status', optionalAuth, validate(getOrderSchema), getOrderStatus);
router.get('/:refNo', optionalAuth, validate(getOrderSchema), getOrder);

router.use(protect);
router.use(isBlocked);

router.get('/', validate(listOrdersSchema), listOrders);
router.post('/:refNo/cancel', validate(cancelOrderSchema), cancelOrder);
router.post('/:refNo/return', validate(createReturnSchema), createReturn);

export default router;
