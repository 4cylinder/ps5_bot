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

const baseUrl = 'https://www.bestbuy.ca/en-ca';
const addToCartBtnSelector = '.productActionWrapperNonMobile_10B89 .addToCartButton:not([disabled])';
const productDetailsSelector = '.modelInformation_1ZG9l';

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

    await page.goto(baseUrl);

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

    logger.info(`Navigating to ${baseUrl}${productPage}`);

    await page.goto(`${baseUrl}${productPage}`, { timeout: 60000 });

    await page.waitForSelector(productDetailsSelector);

    logger.info(`Navigation completed`);
  }

  private async validateProductMatch(product: ProductInformation) {
    const { sku: expectedSKU } = product;
    const page = await this.getPage();

    logger.info(`Validating that page is for ${product.productName}`);

    const skuValue = await page.$eval(`${productDetailsSelector}:nth-of-type(2) span`, (element) => element.textContent);

    if (expectedSKU !== skuValue!.trim())
      throw new Error(`Product sku doesn't match. Expected: ${expectedSKU}. Actual: ${skuValue}`);

    logger.info(`Page is correct`);
  }

  public async antiAntiBot() {
    const [context] = this.browser.contexts();
    const cookies = await context.cookies();

    const sensorCookie = find(cookies, { name: '_abck' })?.value;
    const sensorValidationRegex = /~0~/g;

    if (sensorCookie && !sensorValidationRegex.test(sensorCookie)) {
      await Promise.all([
        sendDiscordMessage({ message: `Browser is considered a bot, aborting attempt` }),
      ]);

      throw new Error('Browser is considered a bot, aborting attempt');
    }
  }

  public async addToCart(product: ProductInformation) {
    const { productName } = product;
    const page = await this.getPage();
    
    await this.antiAntiBot();

    logger.info(`Checking stock of product "${productName}"`);
    if (!(await this.isInStock())){
      throw new Error('Product not in stock, aborting attempt')
    };

    await page.focus(addToCartBtnSelector);
    await this.sendScreenshot(page, `${Date.now()}_product-in-stock.png`, `${productName} is in stock!`)

    logger.info(`${productName} in stock, adding to cart...`);

    await page.click(addToCartBtnSelector);

    const result = await this.hasItemBeenAddedToCart();

    if (!result){
      throw new Error(`Could not add ${productName} to cart. Aborting.`);
    } 

    logger.info(`${productName} added to cart!`);

    await this.sendScreenshot(page, `${Date.now()}_product-added.png`, `${productName} added to cart!`)
  }

  public async isInStock() {
    const page = await this.getPage();
    const isButtonEnabled = await page.$(addToCartBtnSelector);

    return isButtonEnabled || false;
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

    await this.sendScreenshot(page, `${Date.now()}_starting-checkout.png`, 'Attempting checkout.');

    await this.clickCheckoutButton();

    if (await this.isQueueActive()) {
      logger.info('Placed in queue, waiting for checkout button again');
      await page.waitForSelector('#buttonConfirmRedirect', { timeout: 300000 });
      await page.click('#buttonConfirmRedirect');
    }

    try {
      await page.waitForSelector('.guest-context-container .guest-continue-link', { timeout: 300000 });

      logger.info('Checkout successful, starting order placement');
    } catch (error) {
      logger.warn(error);
      logger.info('Refreshing and trying to checkout again');

      await this.sendScreenshot(page, `${Date.now()}_starting-checkout.png`, 'Checkout did not go through, trying again.');

      await this.checkout(true);
    }
  }

  private async isQueueActive() {
    const page = await this.getPage();
    const element = await page.$('#lbHeaderH2');
    const elementTextContent = await element?.textContent();
    return elementTextContent ? elementTextContent.trim().toLowerCase() === 'thanks for waiting to check out.' : false;
  }

  private async isCartEmpty() {
    const page = await this.getPage();

    const element = await page.$('.fluid-large-view__title');
    const elementTextContent = await element?.textContent();

    return elementTextContent ? elementTextContent.trim().toLowerCase() === 'your cart is empty' : false;
  }

  private async changePostalCode(postalCode: string) {
    const page = await this.getPage();

    logger.info('Waiting for postal code updater to become available.');
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

  private async createGuestOrder() {
    const page = await this.getPage();
    const customerInformation = getCustomerInformation();
    const paymentInformation = getPaymentInformation();

    logger.info('Continuing as guest');
    await page.click('.guest-continue-link');
    await page.waitForSelector('.checkoutPageContainer .form');

    await this.enterShippingInfo(customerInformation);
    await this.sendScreenshot(page, `${Date.now()}_first-information-page-completed.png`, 'Filled out customer info.');
    
    logger.info('Continuing to payment screen...');

    await page.click('.continue-to-payment');

    await this.enterPaymentInfo(paymentInformation);
    await this.sendScreenshot(page, `${Date.now()}_second-information-page-completed.png`, 'Filled out payment info.');
  }

  private async clickCheckoutButton() {
    const page = await this.getPage();

    logger.info('Trying to checkout...');

    const checkoutLink = await page.$eval('.continueToCheckout_3Dgpe', (anchor) => anchor.getAttribute('href'));

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

    await this.enterShippingInfo(customerInformation);

    await page.screenshot({
      path: resolve(`screenshots/${Date.now()}_first-information-page-completed.png`),
      type: 'png',
      fullPage: true
    });

    logger.info('Continuing to payment screen...');

    await page.click('.continue-to-payment');

    await this.enterPaymentInfo(paymentInformation);

    await page.screenshot({
      path: resolve(`screenshots/${Date.now()}_second-information-page-completed.png`),
      type: 'png',
      fullPage: true
    });

    await page.click('.continue-to-review');

    await this.validateOrderTotal(page, customerInformation.budget);

    logger.info('Placing order...');
    await this.sendScreenshot(page, `${Date.now()}_placing-order.png`, 'Placing order...');

    if (existsSync('purchase.json')) {
      logger.warn('Purchase already completed, ending process');

      process.exit(2);
    }

    // *** UNCOMMENT THIS SECTION TO ENABLE AUTO-CHECKOUT ***

    // await this.placeOrder(page);
    // await wait(3000);
    // logger.info('Order placed!');
    // if (!existsSync('purchase.json')) writeFileSync('purchase.json', '{}');
    // await wait(3000);
    // await this.sendScreenshot(page, `${Date.now()}_order-placed.png`, 'Order placed!')
    // await wait(14000);
  }

  private async placeOrder(page: Page) {
    await page.click('.order-now', {timeout: 120000, force: true});
  }

  private async validateOrderTotal(page: Page, budget: number) {
    logger.info('Performing last validation before placing order...');
    const totalContainer = await page.$('.total td');
    const totalContainerTextContent = await totalContainer?.textContent();
    const parsedTotal = totalContainerTextContent ? parseFloat(totalContainerTextContent.replace('$', '')) : 0;

    if (parsedTotal === 0 || parsedTotal > budget)
      throw new Error(`Total amount of ${parsedTotal} does not seems right, aborting`);
  }

  private async enterShippingInfo(customerInformation: CustomerInformation) {
    const page = await this.getPage();

    logger.info('Filling contact information...');
    await this.fillTextInput(page, '#email', customerInformation.email);
    await this.fillTextInput(page, '#phone', customerInformation.phone);

    logger.info('Filling shipping information...');
    await this.fillTextInput(page, '#firstName', customerInformation.firstName);
    await this.fillTextInput(page, '#lastName', customerInformation.lastName);
    await this.fillTextInput(page, '#addressLine', customerInformation.address);
    await this.fillTextInput(page, '#city', customerInformation.city);
    await page.selectOption('#regionCode', customerInformation.province);
    await this.fillTextInput(page, '#postalCode', customerInformation.postalCode);
  }

  private async enterPaymentInfo(paymentInformation: PaymentInformation) {
    const page = await this.getPage();
    
    logger.info('Filling payment information...');

    await page.$('.creditCardSelector');
    await page.$('.payment');

    await this.fillTextInput(page, '#shownCardNumber', paymentInformation.creditCardNumber);

    await page.selectOption('#expirationMonth', paymentInformation.expirationMonth);
    await page.selectOption('#expirationYear', paymentInformation.expirationYear);

    await this.fillTextInput(page, '#cvv', paymentInformation.cvv);

    logger.info('Payment information completed');
  }

  private async fillTextInput(page: Page, selector: string, value: string) {
    await page.waitForSelector(selector);
    await page.click(selector);
    await page.focus(selector);
    await page.type(selector, value);
  }

  private async sendScreenshot(page: Page, path: string, message: string, fullPage: boolean = false) {
    const screenshotPath = resolve(`screenshots/${path}`);
    await page.screenshot({
      path: screenshotPath,
      type: 'png',
      fullPage: true
    });
    await Promise.all([
      sendDiscordMessage({ message: message, image: screenshotPath }),
    ]);
  }

  private async getPage() {
    return this.page!;
  }
}
