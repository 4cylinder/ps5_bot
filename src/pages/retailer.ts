import { getBrowser } from '@driver/index';
import { resolve } from 'path';
import { Browser, BrowserContext, Page } from 'playwright';
import { sendMessage as sendDiscordMessage } from '@core/notifications/discord';
import { existsSync, writeFileSync } from 'fs';
import { CustomerInformation, LoginInformation, PaymentInformation } from '@core/configs';
import { logger } from '@core/logger';

export interface Product {
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
  browser: Browser;
  products: Product[];
  purchaseAsGuest: boolean = true;
  protected loginInfo: LoginInformation;
  page?: Page;
  context?: BrowserContext;

  readonly antiBotMsg = 'Browser is considered a bot, aborting attempt';

  constructor(products: Product[], loginInfo: LoginInformation) {
    this.browser = getBrowser();
    this.products = products;
    this.loginInfo = loginInfo;
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

  public async purchaseProduct() {
    for (const product of this.products) {
      try {
        await this.goToProductPage(product);
        const inStock = await this.isInStock();
        if (inStock) {
          await this.validateProductMatch(product);
          await this.addToCart(product);
          const purchased = await this.checkout();
          if (purchased) {
            return true;
          }
        }
      } catch (error) {
        logger.error(error);

        if (error.message === this.antiBotMsg) {
          throw error;
        }
      }
    }
    return false;
  }

  protected abstract goToProductPage(product: Product): Promise<void>;

  protected abstract validateProductMatch(product: Product): Promise<void>;

  protected abstract addToCart(product: Product): Promise<void>;

  protected abstract isInStock(): Promise<boolean>;

  protected abstract isInCart(): Promise<boolean>;

  protected abstract checkout(): Promise<boolean>;

  protected abstract enterShippingInfo(customerInfo: CustomerInformation): Promise<void>;

  protected abstract enterPaymentInfo(paymentInfo: PaymentInformation): Promise<void>;

  protected abstract validateOrderTotal(budget: number): Promise<void>;
}