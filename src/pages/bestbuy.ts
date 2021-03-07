import { find } from 'lodash';
import { CustomerInformation, getCustomerInformation, getPaymentInformation, PaymentInformation } from '@core/configs';
import { logger } from '@core/logger';
import { sendMessage as sendDiscordMessage } from '@core/notifications/discord';
import { Product, Retailer, wait, checkAlreadyPurchased } from './retailer';

interface BestBuyProduct extends Product {
  sku: string;
  model: string;
  productName: string;
}

const baseUrl = 'https://www.bestbuy.ca/en-ca';
const addToCartBtnSelector = '.productActionWrapperNonMobile_10B89 .addToCartButton:not([disabled])';
const productDetailsSelector = '.modelInformation_1ZG9l';

export class BestBuy extends Retailer {
  constructor({ products }: { products: BestBuyProduct[] }) {
    super({ products });
    this.retailerName = 'bestbuy';
  }

  public async purchaseProduct() {
    const page = await this.getPage();

    await page.goto(baseUrl);

    for (const product of this.products as BestBuyProduct[]) {
      try {
        await this.goToProductPage(product);
        await this.validateProductMatch(product);
        await this.addToCart(product);
        await this.checkout();
        await this.createGuestOrder();

        return true;
      } catch (error) {
        logger.error(error);

        if (error.message === this.antiBotMsg) {
          throw error;
        }
      }
    }
    return false;
  }

  async goToProductPage(product: BestBuyProduct) {
    const { productPage } = product;
    const page = await this.getPage();

    logger.info(`Navigating to ${baseUrl}${productPage}`);

    await page.goto(`${baseUrl}${productPage}`, { timeout: 60000 });

    await page.waitForSelector(productDetailsSelector);

    logger.info(`Navigation completed`);
  }

  async validateProductMatch(product: BestBuyProduct) {
    const { sku: expectedSKU } = product;
    const page = await this.getPage();

    logger.info(`Validating that page is for ${product.productName}`);

    const skuValue = await page.$eval(
      `${productDetailsSelector}:nth-of-type(2) span`,
      (element) => element.textContent
    );

    if (expectedSKU !== skuValue!.trim()) {
      throw new Error(`Product sku doesn't match. Expected: ${expectedSKU}. Actual: ${skuValue}`);
    }

    logger.info(`Page is correct`);
  }

  private async antiAntiBot() {
    const [context] = this.browser.contexts();
    const cookies = await context.cookies();

    const sensorCookie = find(cookies, { name: '_abck' })?.value;
    const sensorValidationRegex = /~0~/g;

    if (sensorCookie && !sensorValidationRegex.test(sensorCookie)) {
      await Promise.all([
        sendDiscordMessage({ message: this.antiBotMsg}),
      ]);

      throw new Error(this.antiBotMsg);
    }
  }

  async addToCart(product: BestBuyProduct) {
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

    const result = await this.isInCart();

    if (!result){
      throw new Error(`Could not add ${productName} to cart. Aborting.`);
    } 

    logger.info(`${productName} added to cart!`);

    await this.sendScreenshot(page, `${Date.now()}_product-added.png`, `${productName} added to cart!`)
  }

  async isInStock() {
    const page = await this.getPage();
    const isButtonEnabled = await page.$(addToCartBtnSelector);

    if (isButtonEnabled) {
      return true;
    }
    return false;
  }

  async isInCart() {
    const page = await this.getPage();

    const completedSuccessfuly = await page.waitForResponse(
      (response: any) => response.url() === 'https://www.bestbuy.ca/api/basket/v2/baskets' && response.status() === 200
    );

    if (completedSuccessfuly) {
      return true;
    }
    return false;
  }

  async checkout(retrying: boolean = false) {
    const page = await this.getPage();
    const customerInformation = getCustomerInformation();

    logger.info(`Navigating to cart`);

    await page.goto('https://www.bestbuy.ca/en-ca/basket');

    if (retrying && (await this.isCartEmpty())) throw new Error('Cart is empty, aborting attempt');

    if (!retrying) {
      await this.changePostalCode(customerInformation.postalCode);
    }

    await this.sendScreenshot(page, `${Date.now()}_starting-checkout.png`, 'Attempting checkout.');

    try {
      await this.clickCheckoutButton();
    } catch(err) {
      // TODO: Capture redirect to queue page
      if (await this.isQueueActive()) {
        logger.info('Placed in queue, waiting for checkout button again');
        await page.waitForSelector('#buttonConfirmRedirect', { timeout: 300000 });
        await page.click('#buttonConfirmRedirect');
      }
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

  async isQueueActive() {
    const page = await this.getPage();
    const element = await page.$('#lbHeaderH2');
    const elementTextContent = await element?.textContent();
    return elementTextContent ? elementTextContent.trim().toLowerCase() === 'thanks for waiting to check out.' : false;
  }

  async isCartEmpty() {
    const page = await this.getPage();

    const element = await page.$('.fluid-large-view__title');
    const elementTextContent = await element?.textContent();

    return elementTextContent ? elementTextContent.trim().toLowerCase() === 'your cart is empty' : false;
  }

  async changePostalCode(postalCode: string) {
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

  async createGuestOrder() {
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
    await this.sendText('Filled out payment info.');

    await page.click('.continue-to-review');

    await this.validateOrderTotal( customerInformation.budget);

    logger.info('Placing order...');
    await this.sendScreenshot(page, `${Date.now()}_placing-order.png`, 'Placing order...');

    await checkAlreadyPurchased();

    /** Uncomment the lines below to enable the very last step of the ordering. DO SO AT YOUR OWN RISK **/
    // await this.placeOrder(page, '.order-now');
    // await wait(3000);
    // await this.markAsPurchased();
    // await wait(3000);
    // await this.sendScreenshot(page, `${Date.now()}_order-placed.png`, 'Order placed!')
    // await wait(14000);
  }

  async clickCheckoutButton() {
    const page = await this.getPage();

    logger.info('Trying to checkout...');

    const checkoutLink = await page.$eval('.continueToCheckout_3Dgpe', (anchor) => anchor.getAttribute('href'));

    await page.goto(checkoutLink || '');
  }

  async validateOrderTotal(budget: number) {
    const page = await this.getPage();
    logger.info('Performing last validation before placing order...');
    const totalContainer = await page.$('.total td');
    const totalContainerTextContent = await totalContainer?.textContent();
    const parsedTotal = totalContainerTextContent ? parseFloat(totalContainerTextContent.replace('$', '')) : 0;

    if (parsedTotal === 0 || parsedTotal > budget)
      throw new Error(`Total amount of ${parsedTotal} does not seems right, aborting`);
  }

  async enterShippingInfo(customerInformation: CustomerInformation) {
    const page = await this.getPage();

    logger.info('Filling contact information...');
    await this.fillTextInput(page, '#email', customerInformation.email);
    await this.fillTextInput(page, '#phone', customerInformation.phone);

    logger.info('Filling shipping information...');
    await this.fillTextInput(page, '#firstName', customerInformation.firstName);
    await this.fillTextInput(page, '#lastName', customerInformation.lastName);


    await page.type('#addressLine', customerInformation.address);
    // Countering an update to the Canada Post API
    await page.click('#email');

    await this.fillTextInput(page, '#city', customerInformation.city);
    await page.selectOption('#regionCode', customerInformation.province);
    await this.fillTextInput(page, '#postalCode', customerInformation.postalCode);
  }

  async enterPaymentInfo(paymentInformation: PaymentInformation) {
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
}
