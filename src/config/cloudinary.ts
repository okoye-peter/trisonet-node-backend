import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import multer from 'multer';

// Configuration
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME as string,
    api_key: process.env.CLOUDINARY_API_KEY as string,
    api_secret: process.env.CLOUDINARY_API_SECRET as string
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: async (req, file) => {
        let folderName = 'trisonet_uploads';
        if (req.query && req.query.folder) {
            folderName = req.query.folder as string;
        } else if (req.body && req.body.folder) {
            folderName = req.body.folder as string;
        }

        return {
            folder: folderName,
            allowed_formats: ['jpg', 'png', 'jpeg', 'webp', 'pdf'],
            public_id: `${Date.now()}-${file.originalname.split('.')[0]}`,
        };
    },
});

export const upload = multer({ storage: storage });
export { cloudinary };
