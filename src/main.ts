import { createBrowser, getBrowser } from '@driver/index';
import { wait, checkAlreadyPurchased, Retailer } from '@pages/retailer';
import { BestBuy } from '@pages/bestbuy';
import { WalMart } from '@pages/walmart';
import { TheSource } from '@pages/thesource';
import { getTasks } from '@core/configs';
import { random } from 'lodash';
import { logger } from '@core/logger';
import pm2 from 'pm2';

const main = async () => {
  const { stores } = getTasks()[0];
  const bestbuyConfig = stores.bestbuy;
  const walmartConfig = stores.walmart;
  const theSourceConfig = stores.thesource;

  checkAlreadyPurchased();

  const retailers: Retailer[] = [
    new BestBuy({ products: bestbuyConfig.products }),
    new WalMart({ products: walmartConfig.products }),
    new TheSource({products: theSourceConfig.products }),
  ];

  let purchaseCompleted = false;

  for (let retailer of retailers) {
    await retailer.open();
  }

  logger.info('Starting purchase attempts');

  try {
    do {
      for (let retailer of retailers) {
        const retailerStatus = await retailer.purchaseProduct();
        purchaseCompleted = purchaseCompleted || retailerStatus;
      }
  
      if (!purchaseCompleted) {
        const waitTime = random(60000, 300000);
  
        logger.warn(`Purchase not completed, waiting ${waitTime / 1000} seconds before retrying`);
  
        await wait(waitTime);
      }
    } while (!purchaseCompleted);
  
    logger.info('Shutting down in 1 minute');

    for (let retailer of retailers) {
      await retailer.sendText('Shutting down in 1 minute');
      await retailer.close();
    }
  
    await wait(60000);

    return true;
  } catch (error) {
    console.log(error);

    throw error;
  }
};

pm2.connect(async (error) => {
  if (error) {
    logger.error(error);

    process.exit(2);
  }

  await createBrowser();

  const browser = getBrowser();

  let finished = false;

  do {
    try {
      finished = await main();
    } catch (error) {
      logger.error(error);

      if (error.message === 'Browser is considered a bot, aborting attempt') {
        logger.warn('Waiting 3 minutes to refresh bot status');

        await wait(180000);
      }
    }
  } while (!finished);

  await browser.close();

  pm2.delete('main', () => {
    logger.info('Process closed');
  });
});
