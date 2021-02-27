import { AzureFunction, Context } from "@azure/functions"

import { createBrowser, getBrowser } from './driver/index';
import { BestBuy, wait } from './pages/bestbuy';
import { getTasks } from './core/configs';
import { random } from 'lodash';
import { logger } from './core/logger';
import { sendMessage as sendDiscordMessage } from './core/notifications/discord';

import { resolve } from 'path';
import { existsSync, writeFileSync } from 'fs';

const main = async () => {
    const { stores } = getTasks()[0];
    const { bestbuy: bestbuyConfig } = stores;

    const bestbuy = new BestBuy({ products: bestbuyConfig.products });
    let purchaseCompleted = false;

    await bestbuy.open();

    logger.info('Starting purchase attempts');

    try {

        purchaseCompleted = await bestbuy.purchaseProduct();
        await bestbuy.close();

        return true;
    } catch (error) {
        console.log(error);
        await bestbuy.close();

        throw error;
    }
};

const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {

    await createBrowser();
    const browser = getBrowser();


    try {
        await main();
    } catch (error) {
        logger.error(error);
        logger.warn('main() function failed, shutting down until next CRON job');
        // TODO: Account for this somehow
        // if (error.message === 'Browser is considered a bot, aborting attempt') {
        //     logger.warn('Waiting 3 minutes to refresh bot status');

        //     await wait(18000);
        // }
    }


    await browser.close();

    // var bcontext = await browser.newContext({
    //     permissions: [],
    // });
    // var page = await bcontext.newPage();
    // await page.goto('https://www.bestbuy.ca/en-ca');
    // var content = await page.content();
    // context.log(content);

    // var timeStamp = new Date().toISOString();

    // if (myTimer.isPastDue)
    // {
    //     context.log('Timer function is running late!');
    // }
    // context.log('Timer trigger function ran!', timeStamp);   
};

export default timerTrigger;
