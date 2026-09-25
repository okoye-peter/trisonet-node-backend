import { Router } from "express";
import { protect } from "../middlewares/auth";
import { isBlocked } from "../middlewares/isBlocked";
import { validate } from "../middlewares/validateRequest";
import {
    saveSellerStoreSchema,
    listSellerProductsSchema,
    sellerProductIdSchema,
    createSellerProductSchema,
    updateSellerProductSchema,
    listSellerOrdersSchema,
    sellerOrderRefSchema,
    updateSellerOrderStatusSchema,
} from "../validations/seller.validation";
import {
    getMyStore,
    saveMyStore,
    discardPendingStoreChanges,
    listMyProducts,
    getMyProduct,
    createMyProduct,
    updateMyProduct,
    deleteMyProduct,
    listMyOrders,
    getMyOrder,
    updateMyOrderStatus,
} from "../controllers/seller.controller";

// Partner seller self-service. Store guests never reach this router - '/api/seller'
// is deliberately not in STORE_GUEST_ALLOWED_PATH_PREFIXES - and every write also
// re-checks eligibility in SellerStoreService.
const router = Router();

router.use(protect);
router.use(isBlocked);

router.get('/store', getMyStore);
router.put('/store', validate(saveSellerStoreSchema), saveMyStore);
router.delete('/store/pending-changes', discardPendingStoreChanges);

router.get('/products', validate(listSellerProductsSchema), listMyProducts);
router.post('/products', validate(createSellerProductSchema), createMyProduct);
router.get('/products/:id', validate(sellerProductIdSchema), getMyProduct);
router.put('/products/:id', validate(updateSellerProductSchema), updateMyProduct);
router.delete('/products/:id', validate(sellerProductIdSchema), deleteMyProduct);

router.get('/orders', validate(listSellerOrdersSchema), listMyOrders);
router.get('/orders/:refNo', validate(sellerOrderRefSchema), getMyOrder);
router.patch('/orders/:refNo/status', validate(updateSellerOrderStatusSchema), updateMyOrderStatus);

export default router;
