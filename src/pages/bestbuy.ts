import { getBrowser } from '@driver/index';
import { Browser, BrowserContext, Page } from 'playwright';
import { find, get } from 'lodash';
import { CustomerInformation, getCustomerInformation, getPaymentInformation, PaymentInformation } from '@core/configs';
import { logger } from '@core/logger';
import { resolve } from 'path';
import { sendMessage as sendDiscordMessage } from '@core/notifications/discord';
import { existsSync, writeFileSync } from 'fs';

interface ProductInformation {
  searchText?: string;
  sku: string;
  model: string;
  productName: string;
  productPage: string;
}

export const wait = (ms: number) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const bestBuyUrl = 'https://www.bestbuy.ca/en-ca';

export class BestBuy {
  private browser: Browser;

  private products: ProductInformation[];

  private page?: Page;

  private context?: BrowserContext;

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

  public async purchaseProduct() {
    const page = await this.getPage();

    await page.goto('https://www.bestbuy.ca/en-ca');

    for (const product of this.products) {
      try {
        await this.goToProductPage(product);
        await this.validateProductMatch(product);
        await this.addToCart(product);
        await this.checkout();
        await this.continueAsGuest();
        await this.submitGuestOrder();

        return true;
      } catch (error) {
        logger.error(error);

        if (error.message === 'Browser is considered a bot, aborting attempt') throw error;
      }
    }

    return false;
  }

  private async goToProductPage(product: ProductInformation): Promise<void> {
    const { productPage } = product;
    const page = await this.getPage();

    logger.info(`Navigating to ${bestBuyUrl}${productPage}`);

    await page.goto(`${bestBuyUrl}${productPage}`, { timeout: 60000 });

    await page.waitForSelector('.modelInformation_1ZG9l');

    logger.info(`Navigation completed`);
  }

  private async validateProductMatch(product: ProductInformation) {
    const { sku: expectedSKU } = product;
    const page = await this.getPage();

    logger.info(`Validating that page corresponds to sku ${expectedSKU}`);

    const skuValue = await page.$eval('.modelInformation_1ZG9l:nth-of-type(2) span', (element) => element.textContent);

    if (expectedSKU !== skuValue!.trim())
      throw new Error(`Product page does not belong to product with sku ${expectedSKU}. Actual is ${skuValue}`);

    logger.info(`Page corresponds to sku ${expectedSKU}`);
  }

  public async addToCart(product: ProductInformation) {
    const { productName } = product;
    const page = await this.getPage();
    const [context] = this.browser.contexts();
    const cookies = await context.cookies();
    logger.info(`${JSON.stringify(cookies)}`);
    const sensorCookie = find(cookies, { name: '_abck' })?.value;
    const sensorValidationRegex = /~0~/g;

    if (sensorCookie && !sensorValidationRegex.test(sensorCookie)) {
      await Promise.all([
        sendDiscordMessage({ message: `Browser is considered a bot, aborting attempt` }),
      ]);

      throw new Error('Browser is considered a bot, aborting attempt');
    }

    logger.info(`Checking stock of product "${productName}"`);

    if (!(await this.isInStock())) throw new Error('Product not in stock, aborting attempt');

    await page.focus('.pricingContainer_9GyCd .addToCartButton:not([disabled])');

    const productInStockScreenshotPath = resolve(`screenshots/${Date.now()}_product-in-stock.png`);

    await page.screenshot({
      path: productInStockScreenshotPath,
      type: 'png'
    });

    await Promise.all([
      sendDiscordMessage({ message: `Product "${productName}" in stock!`, image: productInStockScreenshotPath }),
    ]);

    logger.info(`"${productName}" in stock, adding to cart...`);

    await page.click('.pricingContainer_9GyCd .addToCartButton:not([disabled])');

    const result = await this.hasItemBeenAddedToCart();

    if (!result) throw new Error(`Product "${productName}" was not able to be added to the cart`);

    const productAddedImagePath = resolve(`screenshots/${Date.now()}_product-added.png`);

    logger.info(`Product "${productName}" added to cart!`);

    await page.screenshot({
      path: productAddedImagePath,
      type: 'png'
    });

    await Promise.all([
      sendDiscordMessage({ message: `Product "${productName}" added to cart!`, image: productAddedImagePath }),
    ]);
  }

  public async isInStock() {
    const page = await this.getPage();
    const enabledButton = await page.$('.pricingContainer_9GyCd .addToCartButton:not([disabled])');

    if (enabledButton) return true;

    return false;
  }

  private async hasItemBeenAddedToCart() {
    const page = await this.getPage();

    const completedSuccessfuly = await page.waitForResponse(
      (response: any) => response.url() === 'https://www.bestbuy.ca/api/basket/v2/baskets' && response.status() === 200
    );

    return completedSuccessfuly;
  }

  private async checkout(retrying: boolean = false) {
    const page = await this.getPage();
    const customerInformation = getCustomerInformation();

    logger.info(`Navigating to cart`);

    await page.goto('https://www.bestbuy.ca/en-ca/basket');

    if (retrying && (await this.isCartEmpty())) throw new Error('Cart is empty, aborting attempt');

    if (!retrying) {
      await this.changePostalCode(customerInformation.postalCode);
    }

    const startingCheckoutScreenshotPath = resolve(`screenshots/${Date.now()}_starting-checkout.png`);

    await page.screenshot({
      path: startingCheckoutScreenshotPath,
      type: 'png'
    });

    await Promise.all([
      sendDiscordMessage({ message: `Attempting checkout`, image: startingCheckoutScreenshotPath }),
    ]);

    await this.clickCheckoutButton();

    try {
      await page.waitForSelector('.guest-context-container .guest-continue-link', { timeout: 10000 });

      logger.info('Checkout successful, starting order placement');
    } catch (error) {
      logger.warn(error);
      logger.info('Refreshing and trying to checkout again');

      await Promise.all([
        sendDiscordMessage({ message: `Checkout did not went through, trying again`, image: startingCheckoutScreenshotPath }),
      ]);

      await this.checkout(true);
    }
  }

  private async isCartEmpty() {
    const page = await this.getPage();

    const element = await page.$('.fluid-large-view__title');
    const elementTextContent = await element?.textContent();

    return elementTextContent ? elementTextContent.trim().toLowerCase() === 'your cart is empty' : false;
  }

  private async changePostalCode(postalCode: string) {
    const page = await this.getPage();

    logger.info('Waiting for postal code updater to become available');

    await page.waitForSelector('#postalCode');

    logger.info('Changing postal code...');

    await page.click('#postalCode');
    await page.focus('#postalCode');
    // in case a partial postal code was pre-filled
    for (let i = 0; i < 6; i ++) {
      await page.keyboard.press('Backspace');
    }
    await page.type('#postalCode', postalCode);
    await page.click('.zipCodeButton__8xwJ');

    logger.info('Updated postal code');

  }

  private async clickCheckoutButton() {
    const page = await this.getPage();

    logger.info('Trying to checkout...');

    const checkoutLink = await page.$eval('.checkoutButton_2PqYr a', (anchor) => anchor.getAttribute('href'));

    await page.goto(checkoutLink || '');
  }

  private async continueAsGuest() {
    const page = await this.getPage();

    logger.info('Continuing as guest');
    
    await page.click('.guest-continue-link');

    await page.waitForSelector('.checkoutPageContainer .form');
  }

  private async submitGuestOrder() {
    const page = await this.getPage();
    const customerInformation = getCustomerInformation();
    const paymentInformation = getPaymentInformation();

    logger.info('Started order information completion');

    await this.completeShippingInformation(customerInformation);

    await page.screenshot({
      path: resolve(`screenshots/${Date.now()}_first-information-page-completed.png`),
      type: 'png',
      fullPage: true
    });

    logger.info('Continuing to payment screen...');

    await page.click('.continue-to-payment');

    await this.completePaymentInformation(paymentInformation);

    await page.screenshot({
      path: resolve(`screenshots/${Date.now()}_second-information-page-completed.png`),
      type: 'png',
      fullPage: true
    });

    await page.click('.continue-to-review');

    logger.info('Performing last validation before placing order...');

    const placeOrderButton = await page.$('.order-now');

    const totalContainer = await page.$('.total td');
    const totalContainerTextContent = await totalContainer?.textContent();
    const parsedTotal = totalContainerTextContent ? parseFloat(totalContainerTextContent.replace('$', '')) : 0;

    if (parsedTotal === 0 || parsedTotal > customerInformation.budget)
      throw new Error(`Total amount of ${parsedTotal} does not seems right, aborting`);

    logger.info('Placing order...');

    const placingOrderScreenshotPath = resolve(`screenshots/${Date.now()}_placing-order.png`);

    await page.screenshot({
      path: placingOrderScreenshotPath,
      type: 'png',
      fullPage: true
    });

    await Promise.all([
      sendDiscordMessage({ message: `Placing order...`, image: placingOrderScreenshotPath }),
    ]);

    if (existsSync('purchase.json')) {
      logger.warn('Purchase already completed, ending process');

      process.exit(2);
    }

    // *** UNCOMMENT THIS SECTION TO ENABLE AUTO-CHECKOUT ***

    if (!!placeOrderButton) {
      await page.click('.order-now');
    }

    await wait(3000);

    logger.info('Order placed!');

    if (!existsSync('purchase.json')) writeFileSync('purchase.json', '{}');

    const orderPlacedScreenshotPath = resolve(`screenshots/${Date.now()}_order-placed-1.png`);

    await page.screenshot({
      path: orderPlacedScreenshotPath,
      type: 'png',
      fullPage: true
    });

    await Promise.all([
      sendDiscordMessage({ message: `Order placed!`, image: orderPlacedScreenshotPath }),
    ]);

    await wait(3000);

    await page.screenshot({
      path: resolve(`screenshots/${Date.now()}_order-placed-2.png`),
      type: 'png',
      fullPage: true
    });

    await wait(14000);
  }

  private async completeShippingInformation(customerInformation: CustomerInformation) {
    const page = await this.getPage();

    logger.info('Filling contact information...');

    await page.type('#email', customerInformation.email);
    await page.type('#phone', customerInformation.phone);

    logger.info('Filling shipping information...');

    await page.type('#firstName', customerInformation.firstName);
    await page.type('#lastName', customerInformation.lastName);

    await page.type('#addressLine', customerInformation.address);

    await page.type('#city', customerInformation.city);
    await page.selectOption('#regionCode', customerInformation.province);
    await page.type('#postalCode', customerInformation.postalCode);

    logger.info('Shipping information completed');
  }

  private async completePaymentInformation(paymentInformation: PaymentInformation) {
    const page = await this.getPage();
    
    logger.info('Filling payment information...');

    await page.$('.creditCardSelector');
    await page.$('.payment');

    await page.click('#shownCardNumber');
    await page.focus('#shownCardNumber');
    await page.type('#shownCardNumber', paymentInformation.creditCardNumber);

    await page.selectOption('#expirationMonth', paymentInformation.expirationMonth);
    await page.selectOption('#expirationYear', paymentInformation.expirationYear);

    await page.click('#cvv');
    await page.focus('#cvv');
    await page.type('#cvv', paymentInformation.cvv);

    logger.info('Payment information completed');
  }

  private async getPage() {
    return this.page!;
  }
}
