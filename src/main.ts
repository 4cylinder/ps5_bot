import { createBrowser, getBrowser } from '@driver/index';
import { wait, checkAlreadyPurchased, Retailer } from '@pages/retailer';
import { Bot } from './bot';
import { getLoginInformation, getTasks } from '@core/configs';
import { random } from 'lodash';
import { logger } from '@core/logger';
import pm2 from 'pm2';

const main = async () => {
  // Set this to true if you don't want the bot to log into your account first
  const purchaseAsGuest = false;
  // Set this to false if you want the bot to actually buy the products. DO SO AT YOUR OWN RISK!!!
  const testMode = true;

  const products = getTasks().products;
  const loginConfig = getLoginInformation();
  const browser = getBrowser();

  checkAlreadyPurchased();

  let purchaseCompleted = false;
  
  const bot = new Bot(browser, loginConfig, testMode);
  await bot.open();
  if (!purchaseAsGuest) {
    await bot.login();
  }

  logger.info('Starting purchase attempts');

  try {
    do {
      let status = await bot.attemptPurchases(products);
      purchaseCompleted = purchaseCompleted || status;
  
      if (!purchaseCompleted) {
        const waitTime = random(60000, 180000);
  
        logger.warn(`Purchase not completed, waiting ${waitTime / 1000} seconds before retrying`);
  
        await wait(waitTime);
      }
    } while (!purchaseCompleted);
  
    await wait(60000);

    await bot.close();

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
