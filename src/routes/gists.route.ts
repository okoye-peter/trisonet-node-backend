import { Router } from "express";
import { protect } from "../middlewares/auth";
import multer from "multer";
import {
    getPost,
    getPosts,
    createPost,
    toggleLike,
    addComment,
    retweetPost,
} from "../controllers/gists.controller";

const memUpload = multer({ storage: multer.memoryStorage() });

const router = Router();

router.use(protect);

router.get("/", getPosts);
router.get("/:id", getPost);
router.post("/", memUpload.single("image"), createPost);
router.post("/:id/like", toggleLike);
router.post("/:id/comment", addComment);
router.post("/:id/retweet", retweetPost);

export default router;
