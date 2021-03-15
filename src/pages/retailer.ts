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

export interface PageLinks {
  base: string;
  account: string;
  cart: string;
  checkout: string;
  queue?: string;
}

export interface PageSelectors {
  loginUsername: string;
  loginPassword: string;
  signInBtn: string;
  productDetail: string;
  addToCartBtn: string;
  captcha?: string;
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
  static browser: Browser;
  products: Product[];
  purchaseAsGuest: boolean = false;
  testMode: boolean = false;
  protected loginInfo: LoginInformation;
  page?: Page;
  context?: BrowserContext;
  urls!: PageLinks;
  selectors!: PageSelectors;

  static readonly antiBotMsg = 'Browser is considered a bot, aborting attempt';

  constructor(products: Product[], loginInfo: LoginInformation, testMode: boolean) {
    this.products = products;
    this.loginInfo = loginInfo;
    this.testMode = testMode;
    Retailer.browser = getBrowser();
  }

  async open(): Promise<Page> {
    this.context = await Retailer.browser.newContext({
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

  // For typing into <input> selectors that can't be directly accessed
  // E.g. thesource.ca encapsulates the payment inputs inside iframes
  // The workaround is to click an encapsulating selector and then call keystrokes
  protected async typeHack(page: Page, selector: string, value: string) {
    await page.click(selector);
    for (let i = 0; i < value.length; i++) {
      await page.keyboard.press(value[i]);
    }
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

  public async purchaseProduct() {
    for (const product of this.products) {
      try {
        await this.goToProductPage(product);
        const inStock = await this.isInStock();
        if (inStock) {
          await this.verifyProductPage(product);
          await this.addToCart(product);
          const purchased = await this.checkout();
          if (purchased) {
            return true;
          }
          logger.info(`${product.productName} is not in stock at ${this.retailerName}`);
        }
      } catch (error) {
        logger.error(error);

        if (error.message === Retailer.antiBotMsg) {
          throw error;
        }
      }
      await wait(10000);
    }
    return false;
  }

  public async login() {
    this.purchaseAsGuest = false;
    const page = await this.getPage();

    await page.goto(this.urls.account);

    await this.typeHack(page, this.selectors.loginUsername, this.loginInfo.email);
    await this.typeHack(page, this.selectors.loginPassword, this.loginInfo.password);

    await page.click(this.selectors.signInBtn);

    // TODO: Make best buy's captcha detection more reliable
    // try {
    //   const captcha = await page.waitForSelector('iframe');
    //   if (captcha) {
    //     await this.sendScreenshot(page, `${Date.now()}_logincaptcha.png`, 'Captcha at login page');
    //   }
    // } catch (err) {

    // }
    logger.info(`Logged into ${this.retailerName}`);
  }

  protected async isInStock() {
    const page = await this.getPage();
    const isButtonEnabled = await page.$(this.selectors.addToCartBtn);

    if (isButtonEnabled) {
      return true;
    }
    return false;
  }

  protected abstract goToProductPage(product: Product): Promise<void>;

  protected abstract verifyProductPage(product: Product): Promise<void>;

  protected abstract addToCart(product: Product): Promise<void>;

  protected abstract isInCart(): Promise<boolean>;

  protected abstract checkout(): Promise<boolean>;

  protected abstract enterShippingInfo(customerInfo: CustomerInformation): Promise<void>;

  protected abstract enterPaymentInfo(paymentInfo: PaymentInformation): Promise<void>;

  protected abstract validateOrderTotal(budget: number): Promise<void>;
}