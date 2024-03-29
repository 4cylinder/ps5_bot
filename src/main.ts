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
  // Set this to true if you don't want the bot to log into your account first
  const purchaseAsGuest = false;
  // Set this to false if you want the bot to actually buy the products. DO SO AT YOUR OWN RISK!!!
  const testMode = true;

  const tasks = getTasks();
  const loginConfig = getLoginInformation();

  checkAlreadyPurchased();

  const retailers: Retailer[] = [
    new BestBuy(tasks.bestbuy, loginConfig.bestbuy, testMode),
    new WalMart(tasks.walmart, loginConfig.walmart, testMode),
    new TheSource(tasks.thesource, loginConfig.thesource, testMode),
  ];

  let purchaseCompleted = false;

  if (purchaseAsGuest) {
    retailers.forEach(function(retailer) {
      retailer.purchaseAsGuest = true;
    })
  } 

  logger.info('Starting purchase attempts');

  try {
    do {
      for (let retailer of retailers) {
        await retailer.open();
      }

      if (!purchaseAsGuest) {
        await Promise.all(retailers.map(function(retailer) {
          return retailer.login();
        }));
      }

      let statuses = await Promise.all(retailers.map(function(retailer) {
        return retailer.purchaseProduct();
      }));

      statuses.forEach(function(status) {
        purchaseCompleted = purchaseCompleted || status;
      });

      logger.warn(`Purchase not completed, waiting 10 minutes before retrying`);
      for (let retailer of retailers) {
        await retailer.close();
      }
      await wait(10 * 60 * 1000);
    } while (!purchaseCompleted);

    return true;
  } catch (error) {
    logger.error(error);
    throw error;
  }
};

pm2.connect(async (error) => {
  if (error) {
    logger.error(error);

    process.exit(2);
  }

  await createBrowser();

  let finished = false;

  do {
    try {
      finished = await main();
    } catch (error) {
      logger.error(error);

      if (error.message === Retailer.antiBotMsg) {
        logger.warn('Waiting 3 minutes to refresh bot status');

        await wait(180000);
      }
    }
  } while (!finished);

  await Retailer.browser.close();

  pm2.delete('main', () => {
    logger.info('Process closed');
  });
});
