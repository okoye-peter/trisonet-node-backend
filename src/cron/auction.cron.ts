import cron from 'node-cron';
import { logger } from '../utils/logger';
import AuctionService from '../services/auction.service';

// PM2 gives every process an incremental index string ('0', '1', etc.) via NODE_APP_INSTANCE
const isPrimaryCluster = !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0';

let isAuctionSweepRunning = false;

if (isPrimaryCluster) {
    logger.info('[auction-cron] Primary cluster instance detected. Registering auction expiry sweep.');

    cron.schedule('*/5 * * * *', async () => {
        if (isAuctionSweepRunning) {
            logger.warn('[auction-cron] Previous sweep is still running. Skipping this execution tick.');
            return;
        }

        isAuctionSweepRunning = true;
        try {
            await AuctionService.cronSweepExpiredAuctions();
        } catch (err: any) {
            logger.error(`[auction-cron] Critical unhandled sweep error: ${err.message}`);
        } finally {
            isAuctionSweepRunning = false;
        }
    });
} else {
    logger.info(`[auction-cron] Secondary cluster worker index (${process.env.NODE_APP_INSTANCE}) isolated: skipping scheduler binding.`);
}
