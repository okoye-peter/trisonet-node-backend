import { cloudinary } from '../config/cloudinary';

/**
 * Extracts the public_id from a Cloudinary URL and deletes the file directly.
 * Useful for cleaning up orphaned uploads if a subsequent operation fails.
 * 
 * @param url The full Cloudinary URL of the uploaded file
 * @returns boolean indicating success or failure
 */
export const deleteCloudinaryFileByUrl = async (url: string): Promise<boolean> => {
    try {
        if (!url) return false;

        const urlParts = url.split('/upload/');
        if (urlParts.length !== 2) {
            return false;
        }

        const rawPath = urlParts[1];
        if (!rawPath) return false;

        // Remove the version tag (e.g. v16421345/) and get the full path without the extension
        const publicIdWithExtension = rawPath.replace(/^v\d+\//, '');
        const public_id = publicIdWithExtension.substring(0, publicIdWithExtension.lastIndexOf('.'));

        if (!public_id) {
            return false;
        }

        const result = await cloudinary.uploader.destroy(public_id);

        return result.result === 'ok';
    } catch (error) {
        console.error('Error deleting file from Cloudinary:', error);
        return false;
    }
};
