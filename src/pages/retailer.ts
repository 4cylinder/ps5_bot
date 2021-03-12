import { getBrowser } from '@driver/index';
import { resolve } from 'path';
import { Browser, BrowserContext, Page } from 'playwright';
import { sendMessage as sendDiscordMessage } from '@core/notifications/discord';
import { existsSync, writeFileSync } from 'fs';
import { CustomerInformation, LoginInformation, PaymentInformation } from '@core/configs';
import { logger } from '@core/logger';

export interface Product {
  retailer: string;
  productName: string;
  productPage: string;
}

export const wait = (ms: number) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

export const checkAlreadyPurchased = () => {
  if (existsSync('purchase.json')) {
    logger.warn('Purchase already completed, ending process');

    process.exit(2);
  }
}

export abstract class Retailer {
  retailerName?: string;
  purchaseAsGuest: boolean = true;
  testMode: boolean = false;
  protected loginInfo: LoginInformation;
  page?: Page;
  readonly antiBotMsg = 'Browser is considered a bot, aborting attempt';

  constructor(loginInfo: LoginInformation, testMode: boolean) {
    this.loginInfo = loginInfo;
    this.testMode = testMode;
  }

  public async setPage(pg: Page) {
    this.page = pg;
  }

  protected async fillTextInput(page: Page, selector: string, value: string) {
    await page.waitForSelector(selector);
    await page.click(selector);
    await page.focus(selector);
    await page.type(selector, value);
  }

  public async sendText(message: string) {
    logger.info(message);
    await Promise.all([
      sendDiscordMessage({ key: this.retailerName, message: message })
    ]);
  }

  protected async sendScreenshot(page: Page, path: string, message: string, fullPage: boolean = false) {
    logger.info(message);
    const screenshotPath = resolve(`screenshots/${path}`);
    await page.screenshot({
      path: screenshotPath,
      type: 'png',
      fullPage: fullPage
    });
    await Promise.all([
      sendDiscordMessage({ key: this.retailerName, message: message, image: screenshotPath }),
    ]);
  }

  protected async markAsPurchased() {
    logger.info('Order placed!');
    if (!existsSync('purchase.json')) writeFileSync('purchase.json', '{}');
  }

  protected async getPage() {
    return this.page!;
  }

  protected async clickHack(page: Page, selector: string) {
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

  protected compareValues(descriptor: string, expected: string, actual: string) {
    if (expected !== actual.trim()) {
      throw new Error(`${descriptor} doesn't match. Expected: ${expected}. Actual: ${actual}`);
    }
    logger.info(`Page matches ${descriptor} ${expected}`);
  }

  public abstract login(): Promise<void>;

  public abstract goToProductPage(product: Product): Promise<void>;

  public abstract verifyProductPage(product: Product): Promise<void>;

  public abstract addToCart(product: Product): Promise<void>;

  public abstract isInStock(): Promise<boolean>;

  public abstract isInCart(): Promise<boolean>;

  public abstract checkout(): Promise<boolean>;

  public abstract enterShippingInfo(customerInfo: CustomerInformation): Promise<void>;

  public abstract enterPaymentInfo(paymentInfo: PaymentInformation): Promise<void>;

  public abstract validateOrderTotal(budget: number): Promise<void>;
}