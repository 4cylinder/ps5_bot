import { logger } from '@core/logger';
import { wait, Retailer, Product } from '@pages/retailer';
import { BestBuy } from '@pages/bestbuy';
import { WalMart } from '@pages/walmart';
import { TheSource } from '@pages/thesource';
import { Browser, BrowserContext, Page } from 'playwright';
import { LoginInformation } from '@core/configs';

export class Bot {
  browser: Browser;
  purchaseAsGuest: boolean = true;
  testMode: boolean = false;
  context?: BrowserContext;
  retailers: { [key: string]: Retailer};
  
  constructor(browser: Browser, loginConfig: {[key: string]: LoginInformation}, testMode: boolean) {
    this.browser = browser;
    this.testMode = testMode;
    this.retailers = {
      'bestbuy': new BestBuy(loginConfig.bestbuy, testMode),
      'walmart': new WalMart(loginConfig.walmart, testMode),
      'thesource': new TheSource(loginConfig.thesource, testMode),
    };
  }

  async open(): Promise<BrowserContext> {
    this.context = await this.browser.newContext({
      permissions: [],
      viewport: { width: 1920, height: 1080 },
      ignoreHTTPSErrors: true,
    });
    for (let key in this.retailers) {
      const newPage = await this.context.newPage();
      await this.retailers[key].setPage(newPage);
    }
    return this.context;
  }

  async close(): Promise<void> {  
    await this.context?.close();

    this.context = undefined;
  }

  async login() {
    for (let key in this.retailers) {
      await this.retailers[key].login();
      await wait(5000);
    }
  }

  async attemptPurchases(products: Product[]): Promise<boolean> {
    for (const product of products) {
      const retailer = this.retailers[product.retailer];
      await retailer.goToProductPage(product);
      const inStock = await retailer.isInStock();
      if (inStock) {
        await retailer.verifyProductPage(product);
        await retailer.addToCart(product);
        const purchased = await retailer.checkout();
        if (purchased) {
          return true;
        } else {
          logger.info(`Failed to buy ${product.productName} from ${product.retailer}`);
        }
      } else {
        logger.info(`${product.productName} is not in stock at ${product.retailer}`);
      }
    }
    return false;
  }
}
