import { CustomerInformation, getCustomerInformation, getPaymentInformation, PaymentInformation } from '@core/configs';
import { logger } from '@core/logger';
import { Product, Retailer, wait, checkAlreadyPurchased } from './retailer';

interface TheSourceProduct extends Product {
  sku: string;
  productName: string;
}

const baseUrl = 'https://www.thesource.ca/en-ca';
const productNameSelector = '.pdp-name';
const skuSelector = '.identifier';
const addToCartBtnSelector = '#addToCartButton';
const goToCartUrl = `${baseUrl}/cart`;
const checkoutBtnSelector = '.doCheckoutBut';

export class TheSource extends Retailer {
  constructor({ products }: { products: TheSourceProduct[] }) {
    super({ products });
    this.retailerName = 'thesource';
  }

  public async purchaseProduct(): Promise<boolean> {
    const page = await this.getPage();
    
    await page.goto(baseUrl);
    for (const product of this.products as TheSourceProduct[]) {
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
  
  async goToProductPage(product: Product): Promise<void> {
    const { productPage } = product;
    const page = await this.getPage();

    logger.info(`Navigating to ${baseUrl}${productPage}`);

    await page.goto(`${baseUrl}${productPage}`, { timeout: 60000 });

    await page.$(productNameSelector);

    logger.info(`Navigation completed`);
  }

  async validateProductMatch(product: TheSourceProduct): Promise<void> {
    const { productName: expectedName, sku: expectedSku } = product;
    const page = await this.getPage();

    logger.info(`Validating that page is for ${expectedName}`);

    const actualName = await page.$eval(productNameSelector, (element) => element.textContent);

    if (expectedName !== actualName!.trim()) {
      throw new Error(`Product name doesn't match. Expected: ${expectedName}, Actual: ${actualName}`);
    }

    const actualSku = await page.$eval(skuSelector, (element) => element.textContent);

    if (expectedSku !== actualSku!.trim()) {
      throw new Error(`Product SKU doesn't match. Expected: ${expectedSku}, Actual: ${actualSku}`);
    } 

    logger.info('Page is correct');
  }

  async addToCart(product: TheSourceProduct): Promise<void> {
    const { productName } = product;
    const page = await this.getPage();
    
    logger.info(`Checking stock of ${productName}`);
    if (!(await this.isInStock())) {
      throw new Error('Product not in stock, aborting attempt');
    }

    await page.focus(addToCartBtnSelector);
    await this.sendScreenshot(page, `${Date.now()}_product-in-stock.png`, `${productName} is in stock!`);

    logger.info(`${productName} is in stock, adding to cart...`);

    await page.click(addToCartBtnSelector, { timeout: 30000 });

    const canCheckout = await this.isInCart();

    if (!canCheckout) {
      throw new Error(`Could not add ${productName} to cart. Aborting.`);
    }

    logger.info(`${productName} added to cart!`);

    await this.sendScreenshot(page, `${Date.now()}_product-added.png`, `${productName} added to cart!`);
  }

  async isInStock(): Promise<boolean> {
    const page = await this.getPage();
    const isButtonEnabled = await page.$(addToCartBtnSelector);

    if (isButtonEnabled) {
      return true;
    }
    return false;
  }

  async isInCart(): Promise<boolean> {
    const page = await this.getPage();
    const isCheckoutEnabled = await page.waitForSelector('#addToCartLayer .primary-button--big', {timeout: 300000});

    return isCheckoutEnabled ? true : false;
  }

  async checkout(retrying: boolean = false): Promise<void> {
    const page = await this.getPage();
    logger.info(`Navigating to cart page`);
    await page.goto(goToCartUrl);

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

  async createGuestOrder(): Promise<void> {
    const page = await this.getPage();

    logger.info('Continuing as guest');
    await page.click('#guestForm .primary-button');

    wait(5000);

    // click radio button that says "Standard Ship to my home"
    await page.check('#standard', {timeout: 2000});

    // click red button that says "Continue to shipping"
    await page.click('#store-button2', {timeout: 2000});

    const customerInfo = getCustomerInformation();
    await this.enterShippingInfo(customerInfo);

    // Red "Review Your Order" button
    await page.click('.continue-checkout', {timeout: 60000});
    // Red "Continue to payment" button
    await page.click('.continue-checkout', {timeout: 60000});
    await this.enterPaymentInfo(getPaymentInformation());
    await this.sendText('Payment info filled out');
    
    await this.validateOrderTotal(customerInfo.budget);

    /** Uncomment the lines below to enable the very last step of the ordering. DO SO AT YOUR OWN RISK **/
    // await this.placeOrder(page, '#payNow');
    // await wait(5000);
    // await this.markAsPurchased();
    // await this.sendScreenshot(page, `${Date.now()}_order-placed.png`, 'Order Placed!');
  }

  async enterShippingInfo(customerInfo: CustomerInformation): Promise<void> {
    logger.info('Filling shipping information...');

    const page = await this.getPage();
    await this.fillTextInput(page, '#email', customerInfo.email);
    await this.fillTextInput(page, '#deliveryaddressFirstName', customerInfo.firstName);
    await this.fillTextInput(page, '#deliveryaddressSurname', customerInfo.lastName);
    await this.fillTextInput(page, '#deliveryaddressPhoneNumber', customerInfo.phone);
    const fullAddress = `${customerInfo.address}, ${customerInfo.city}, ${customerInfo.province}, ${customerInfo.postalCode}`;
    // Canada Post API
    await this.fillTextInput(page, '#delivery-address-search-field', fullAddress);
    wait(500);
    await page.click('.pcaselected');

    logger.info('Shipping information filled');
  }

  async enterPaymentInfo(paymentInfo: PaymentInformation): Promise<void> {
    logger.info('Filling payment information...');

    const page = await this.getPage();
    // click radio button that says "Credit/Debit Card"
    await page.check('#rdoCredit', {timeout: 2000});
    await this.fillTextInput(page, '#card-number', paymentInfo.creditCardNumber);
    await this.fillTextInput(page, '#expiry-month', paymentInfo.expirationMonth);
    await this.fillTextInput(page, '#expiry-year', paymentInfo.expirationYear.substring(2));
    await this.fillTextInput(page, '#cvv', paymentInfo.cvv);

    logger.info('Payment information completed');
  }

  async validateOrderTotal(budget: number): Promise<void> {
    const page = await this.getPage();
    const orderTotalText = await page.$eval(
      '.cartValueEstimatedTotal',
      (element) => element.textContent
    );
    const orderTotal = orderTotalText ? parseFloat(orderTotalText.replace(/[^0-9.,]/g, '')) : 0;
    if (orderTotal > budget) {
      throw new Error(`Order total of ${orderTotal} does not seems right, aborting`);
    }
  }
}
