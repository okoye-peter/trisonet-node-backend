import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { sendSuccess } from "../utils/responseWrapper";
import { SellerStoreService } from "../services/seller_store.service";
import { SellerProductService } from "../services/seller_product.service";
import { SellerStoreOrderService } from "../services/seller_store_order.service";
import { sellerProductBody } from "../validations/seller.validation";

export const getMyStore = asyncHandler(
    async (req: Request, res: Response) => {
        const user = (req as any).user;
        const result = await SellerStoreService.getMyStore(user);
        sendSuccess(res, 200, "Store retrieved successfully", result);
    }
);

export const saveMyStore = asyncHandler(
    async (req: Request, res: Response) => {
        const user = (req as any).user;
        const { name, description, logo, logoPublicId, phone, address, stateId } = req.body;

        const store = await SellerStoreService.saveMyStore(user, { name, description, logo, logoPublicId, phone, address, stateId });

        sendSuccess(res, 200, "Your store has been submitted for review", store);
    }
);

export const discardPendingStoreChanges = asyncHandler(
    async (req: Request, res: Response) => {
        const user = (req as any).user;
        const store = await SellerStoreService.discardPendingChanges(user);
        sendSuccess(res, 200, "Pending store changes discarded", store);
    }
);

export const listMyProducts = asyncHandler(
    async (req: Request, res: Response) => {
        const user = (req as any).user;
        const { page, limit, status, search } = req.query;
        const result = await SellerProductService.list(user, {
            page: page ? Number(page) : undefined,
            limit: limit ? Number(limit) : undefined,
            status: status as string | undefined,
            search: search as string | undefined,
        });
        sendSuccess(res, 200, "Products retrieved successfully", result);
    }
);

export const getMyProduct = asyncHandler(
    async (req: Request, res: Response) => {
        const user = (req as any).user;
        const product = await SellerProductService.get(user, req.params.id as string);
        sendSuccess(res, 200, "Product retrieved successfully", product);
    }
);

export const createMyProduct = asyncHandler(
    async (req: Request, res: Response) => {
        const user = (req as any).user;
        // validate() only checks the body - parse again for the coerced/trimmed values.
        const input = sellerProductBody.parse(req.body);
        const product = await SellerProductService.create(user, input);
        sendSuccess(res, 201, "Product submitted for review", product);
    }
);

export const updateMyProduct = asyncHandler(
    async (req: Request, res: Response) => {
        const user = (req as any).user;
        const input = sellerProductBody.parse(req.body);
        const { product, sentForReview } = await SellerProductService.update(user, req.params.id as string, input);
        sendSuccess(res, 200, sentForReview ? "Product changes submitted for review" : "Product updated", { product, sentForReview });
    }
);

export const deleteMyProduct = asyncHandler(
    async (req: Request, res: Response) => {
        const user = (req as any).user;
        await SellerProductService.remove(user, req.params.id as string);
        sendSuccess(res, 200, "Product deleted");
    }
);

export const listMyOrders = asyncHandler(
    async (req: Request, res: Response) => {
        const user = (req as any).user;
        const { page, limit, status, search } = req.query;
        const result = await SellerStoreOrderService.list(user, {
            page: page ? Number(page) : undefined,
            limit: limit ? Number(limit) : undefined,
            status: status as string | undefined,
            search: search as string | undefined,
        });
        sendSuccess(res, 200, "Orders retrieved successfully", result);
    }
);

export const getMyOrder = asyncHandler(
    async (req: Request, res: Response) => {
        const user = (req as any).user;
        const order = await SellerStoreOrderService.get(user, req.params.refNo as string);
        sendSuccess(res, 200, "Order retrieved successfully", order);
    }
);

export const updateMyOrderStatus = asyncHandler(
    async (req: Request, res: Response) => {
        const user = (req as any).user;
        const order = await SellerStoreOrderService.markShipped(user, req.params.refNo as string, {
            name: req.body.courierName,
            phone: req.body.courierPhone,
        });
        sendSuccess(res, 200, "Order marked as shipped", order);
    }
);
