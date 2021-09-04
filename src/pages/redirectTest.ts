import { getBrowser } from '@driver/index';
import { resolve } from 'path';
import { Browser, BrowserContext, Page } from 'playwright';
import { sendMessage as sendDiscordMessage } from '@core/notifications/discord';
import { existsSync, writeFileSync } from 'fs';
import { CustomerInformation, LoginInformation, PaymentInformation } from '@core/configs';
import { logger } from '@core/logger';
import { wait } from './retailer';

export class RedirectTest {
  browser: Browser;
  page?: Page;
  context?: BrowserContext;

  constructor() {
    this.browser = getBrowser();
  }

  async goToPage() {
    const page = await this.getPage();
    page.on('framedetached', async (frame) => {
      const url = frame.url();
      if (url.includes('basket')) {
        const page = frame.page();
        logger.info('got redirected to cart');
        // give user one minute to click the captcha
        await page.waitForNavigation({timeout: 60000});
        logger.info('navigated');
      }
    });
    logger.info('Going to https://www.bestbuy.ca/checkout/');
    await page.goto('https://www.bestbuy.ca/checkout/');
    try {
      await page.click('#email');
    } catch(err) {
      logger.info(err);
      const url = page.url();
      if (!url.includes('checkout')) {
        logger.info(`got redirected to ${url}`);
      }
    }
    
    const redirected = await page.waitForNavigation();
    if (redirected) {
      logger.info("got redirected")
      await wait(1000);
      logger.info(page.url());
    } else {
      logger.info("not redirected");
    }
    // logger.info(shit);
    await wait(10000);
  }

  async open(): Promise<Page> {
    this.context = await this.browser.newContext({
      permissions: [],
    });
    this.page = await this.context.newPage();

    return this.page;
  }

  async close(): Promise<void> {  
    await this.page?.close();
    await this.context?.close();

    this.page = undefined;
    this.context = undefined;
  }

  async getPage() {
    return this.page!;
  }

  async clickHack(page: Page, selector: string) {
    // Some websites will throw "Selector resolved to hidden"
    await page.$eval(
      selector,
      (elem) => {
        const element = elem as HTMLElement;
        element.setAttribute('style', 'visibility:visible');
        element.click();
      }
    );
  }
}