import { CustomerInformation, getCustomerInformation, getPaymentInformation, PaymentInformation } from '@core/configs';
import { logger } from '@core/logger';
import { orderBy } from 'lodash';
import { Product, Retailer, wait, checkAlreadyPurchased } from './retailer';

interface WalmartProduct extends Product {
  productTitle: string;
  productId: string;
}
  
const baseUrl = 'https://www.walmart.ca/en';
const productTitleSelector = 'h1[data-automation="product-title"]';
const addToCartBtnSelector = 'button[data-automation="cta-button"]:not([disabled])'
const goToCartBtnSelector = 'button[data-automation="checkout"]'
const checkoutBtnSelector = 'button[data-automation="checkout-btn"]';

export class WalMart extends Retailer {
  constructor({ products }: { products: WalmartProduct[] }) {
    super({ products });
    this.retailerName = 'walmart';
  }

  public async purchaseProduct() {
    const page = await this.getPage();
    
    await page.goto(baseUrl);
    for (const product of this.products as WalmartProduct[]) {
      try {
        await this.goToProductPage(product);
        await this.validateProductMatch(product);
        await this.addToCart(product);
        await this.checkout();
        await this.createGuestOrder();
        return true;
      } catch (error) {
        logger.error(error);

        if (error.message === 'Browser is considered a bot, aborting attempt') {
          throw error;
        }
      }
    }
    return false;
  }

  async goToProductPage(product: WalmartProduct) {
    const { productPage } = product;
    const page = await this.getPage();

    logger.info(`Navigating to ${baseUrl}${productPage}`);

    await page.goto(`${baseUrl}${productPage}`, { timeout: 60000 });

    await page.$(productTitleSelector);

    logger.info(`Navigation completed`);
  }

  async validateProductMatch(product: WalmartProduct) {
    const { productTitle: expectedTitle } = product;
    const page = await this.getPage();

    logger.info(`Validating that page is for ${expectedTitle}`);

    const actualTitle = await page.$eval(productTitleSelector, (element) => element.textContent);

    if (expectedTitle !== actualTitle!.trim()) {
      throw new Error(`Product title doesn't match. Expected: ${expectedTitle}, Actual: ${actualTitle}`);
    } 

    logger.info('Page is correct');
  }

  async addToCart(product: WalmartProduct) {
    const { productTitle } = product;
    const page = await this.getPage();
    
    logger.info(`Checking stock of ${productTitle}`);
    if (!(await this.isInStock())) {
      throw new Error('Product not in stock, aborting attempt');
    }

    await page.focus(addToCartBtnSelector);
    await this.sendScreenshot(page, `${Date.now()}_product-in-stock.png`, `${productTitle} is in stock!`);

    logger.info(`${productTitle} is in stock, adding to cart...`);

    await page.click(addToCartBtnSelector, { timeout: 30000 });

    const canCheckout = await this.isInCart();

    if (!canCheckout) {
      throw new Error(`Could not add ${productTitle} to cart. Aborting.`);
    }

    logger.info(`${productTitle} added to cart!`);

    await this.sendScreenshot(page, `${Date.now()}_product-added.png`, `${productTitle} added to cart!`);

    logger.info(`Navigating to cart page`);
    await page.click(goToCartBtnSelector);
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
    const isCheckoutEnabled = await page.waitForSelector(`#modal-root ${goToCartBtnSelector}`, {timeout: 300000});

    return isCheckoutEnabled ? true : false;
  }

  async checkout(retrying: boolean = false) {
    const page = await this.getPage();

    try {
      await page.click(checkoutBtnSelector, {timeout: 60000});

      logger.info('Checkout successful, starting order placement');
      await this.sendScreenshot(page, `${Date.now()}_checkedout.png`, 'Checked out');
    } catch (error) {
      logger.warn(error);
      logger.info('Refreshing and trying to checkout again');

      await this.sendScreenshot(page, `${Date.now()}_checkedout.png`, 'Failed to check out, trying again');

      await this.checkout(true);
    }
  }

  async createGuestOrder() {
    const page = await this.getPage();

    logger.info('Continuing as guest');

    const customerInfo = getCustomerInformation();
    await page.waitForSelector('#email', {timeout: 10000});
    await this.fillTextInput(page, '#email', customerInfo.email);

    // Blue "Next" button after filling email address
    await page.click('button[data-automation="form-default-btn"]');

    await page.waitForSelector('#shipping-tab', {timeout: 10000});
    await page.click('#shipping-tab');

    await this.enterShippingInfo(customerInfo);

    await page.click('button[data-automation="next-button"]');

    logger.info('Continuing to payment screen...');

    await this.enterPaymentInfo(getPaymentInformation());
    await this.sendText('Payment info filled out');

    await checkAlreadyPurchased();

    await this.validateOrderTotal(customerInfo.budget);

    /** Uncomment the lines below to enable the very last step of the ordering. DO SO AT YOUR OWN RISK **/
    await page.$eval(
      'button[data-automation="place-order-button"]',
      (elem) => {
        const element = elem as HTMLElement;
        element.setAttribute('style', 'visibility:visible');
        element.click();
      }
    );
    await wait(5000);
    await this.markAsPurchased();
    await this.sendScreenshot(page, `${Date.now()}_order-placed.png`, 'Order Placed!');
  }

  async enterShippingInfo(customerInfo: CustomerInformation) {
    logger.info('Filling shipping information...');

    const page = await this.getPage();
    await this.fillTextInput(page, '#firstName', customerInfo.firstName);
    await this.fillTextInput(page, '#lastName', customerInfo.lastName);
    
    // Countering an update to the Canada Post API
    await page.type('#address1', customerInfo.address);
    await page.click('#postalCode');

    if (customerInfo.addressSecondLine) {
      await this.fillTextInput(page, '#address2', customerInfo.addressSecondLine)
    }
    // Do this to get an exact match or else the page will ask you to select a "possible match"
    await this.fillTextInput(page, '#city', customerInfo.city.toUpperCase());
    await page.selectOption('#province', customerInfo.province);
    await this.fillTextInput(page, '#postalCode', customerInfo.postalCode);
    await this.fillTextInput(page, '#phoneNumber', customerInfo.phone);

    // Blue "Next" button after filling customer info
    await page.click('button[data-automation="btn-save"]');

    // Walmart probably will still suggest a replacement
    const needToReplace = await page.waitForSelector(`div[data-automation="replace-address-text"]`, {timeout: 1000});
    if (needToReplace) {
      // click radio button that says "Replace Address"
      await page.check('input[data-automation="replace-address-radio"]');
      // click another blue "Next" button
      await page.click('button[data-automation="btn-save"]');
    }
    
    logger.info('Shipping information filled');
  }

  async enterPaymentInfo(paymentInfo: PaymentInformation) {
    logger.info('Filling payment information...');

    const page = await this.getPage();
    await page.waitForSelector('#cardNumber', {timeout: 60000});
    await this.fillTextInput(page, '#cardNumber', paymentInfo.creditCardNumber);
    await this.fillTextInput(page, '#expiryMonth', paymentInfo.expirationMonth);
    // Walmart only allows the last 2 digits of the year, e.g. 2021 = 21
    await this.fillTextInput(page, '#expiryYear', paymentInfo.expirationYear.substring(2));
    await this.fillTextInput(page, '#securityCode', paymentInfo.cvv);

    // Blue "Apply" button at the bottom of the payment section
    await page.click('button[data-automation="apply-button"]');

    await page.waitForSelector(`#payment-${paymentInfo.creditCardNumber.substr(12)}`, {timeout: 2000});

    logger.info('Payment information completed');
  }

  async validateOrderTotal(budget: number) {
    const page = await this.getPage();
    const orderTotalText = await page.$eval(
      'div[data-automation="order-total"] div:nth-of-type(2)',
      (element) => element.textContent
    );
    const orderTotal = orderTotalText ? parseFloat(orderTotalText.replace(/[^0-9.,]/g, '')) : 0;
    if (orderTotal > budget) {
      throw new Error(`Order total of ${orderTotal} does not seems right, aborting`);
    }
  }
}