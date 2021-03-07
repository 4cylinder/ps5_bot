import { getBrowser } from '@driver/index';
import { resolve } from 'path';
import { Browser, BrowserContext, Page } from 'playwright';
import { sendMessage as sendDiscordMessage } from '@core/notifications/discord';
import { existsSync, writeFileSync } from 'fs';
import { CustomerInformation, PaymentInformation } from '@core/configs';
import { logger } from '@core/logger';

export interface Product {
  searchText?: string;
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
  page?: Page;
  context?: BrowserContext;

  readonly antiBotMsg = 'Browser is considered a bot, aborting attempt';

  constructor({ products }: { products: any[] }) {
    this.browser = getBrowser();
    this.products = products;
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
    await Promise.all([
      // sendDiscordMessage({ key: this.retailerName, message: message })
    ]);
  }

  protected async sendScreenshot(page: Page, path: string, message: string, fullPage: boolean = false) {
    const screenshotPath = resolve(`screenshots/${path}`);
    await page.screenshot({
      path: screenshotPath,
      type: 'png',
      fullPage: fullPage
    });
    await Promise.all([
      // sendDiscordMessage({ key: this.retailerName, message: message, image: screenshotPath }),
    ]);
  }

  protected async markAsPurchased() {
    logger.info('Order placed!');
    if (!existsSync('purchase.json')) writeFileSync('purchase.json', '{}');
  }

  protected async getPage() {
    return this.page!;
  }

  protected async placeOrder(page: Page, buttonSelector: string) {
    await page.click(buttonSelector, {timeout: 120000, force: true});
  }

  public abstract purchaseProduct(): Promise<boolean>;

  protected abstract goToProductPage(product: Product): Promise<void>;

  protected abstract validateProductMatch(product: Product): Promise<void>;

  protected abstract isInStock(): Promise<boolean>;

  protected abstract isInCart(): Promise<boolean>;

  protected abstract checkout(retrying: boolean): Promise<void>;

  protected abstract createGuestOrder(): Promise<void>;

  protected abstract enterShippingInfo(customerInfo: CustomerInformation): Promise<void>;

  protected abstract enterPaymentInfo(paymentInfo: PaymentInformation): Promise<void>;

  protected abstract validateOrderTotal(budget: number): Promise<void>;
}