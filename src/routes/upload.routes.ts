import { Router } from 'express';
import { uploadFile, deleteFile } from '../controllers/upload.controller';
import { upload } from '../config/cloudinary';
import { protect } from '../middlewares/auth';
import { validate } from '../middlewares/validateRequest';
import { deleteFileSchema } from '../validations/upload.validation';

const router = Router();

router.use(protect); // Only auth users can interact with files

router.post('/', upload.single('file'), uploadFile);
router.delete('/', validate(deleteFileSchema), deleteFile);

export const uploadRouter = router;
