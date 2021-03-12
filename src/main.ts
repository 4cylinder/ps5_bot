import { createBrowser, getBrowser } from '@driver/index';
import { wait, checkAlreadyPurchased, Retailer } from '@pages/retailer';
import { BestBuy } from '@pages/bestbuy';
import { WalMart } from '@pages/walmart';
import { TheSource } from '@pages/thesource';
import { getLoginInformation, getTasks } from '@core/configs';
import { random } from 'lodash';
import { logger } from '@core/logger';
import pm2 from 'pm2';

const main = async () => {
  // Set this to true if you want the bot to log into your account first
  const purchaseAsGuest = false;
  // Set this to false if you want the bot to actually buy the products. DO SO AT YOUR OWN RISK!!!
  const testMode = true;

  const stores = getTasks();
  const loginConfig = getLoginInformation();

  checkAlreadyPurchased();

  const retailers: Retailer[] = [
    new BestBuy(stores.bestbuy.products, loginConfig.bestbuy, testMode),
    new WalMart(stores.walmart.products, loginConfig.walmart, testMode),
    new TheSource(stores.thesource.products, loginConfig.thesource, testMode),
  ];

  let purchaseCompleted = false;
  

  for (let retailer of retailers) {
    await retailer.open();
    if (!purchaseAsGuest) {
      await retailer.login();
      await wait(5000);
    }
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

    for (let retailer of retailers) {
      await retailer.sendText('Shutting down in 1 minute');
    }
  
    await wait(60000);

    for (let retailer of retailers) {
      await retailer.close();
    }

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
