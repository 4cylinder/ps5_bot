import { CustomerInformation, getCustomerInformation, getPaymentInformation, LoginInformation, PaymentInformation } from '@core/configs';
import { logger } from '@core/logger';
import { Product, Retailer, wait, checkAlreadyPurchased } from './retailer';

interface TheSourceProduct extends Product {
  sku: string;
  productName: string;
}

const baseUrl = 'https://www.thesource.ca';
const loginUrl = `${baseUrl}/en-ca/login`;
const checkoutUrl = `${baseUrl}/en-ca/checkout/multi/delivery-mode/add`;
const signInBtnSelector = '#sign-in';
const productNameSelector = '.pdp-name';
const skuSelector = '.identifier';
const addToCartBtnSelector = '#addToCartButton';
const goToCartUrl = `${baseUrl}/cart`;
const checkoutBtnSelector = '.doCheckoutBut';

export class TheSource extends Retailer {
  constructor(products: TheSourceProduct[], loginInfo: LoginInformation, testMode: boolean) {
    super(products, loginInfo, testMode);
    this.retailerName = 'thesource';
  }

  public async login() {
    this.purchaseAsGuest = false;
    const page = await this.getPage();
    await page.goto(loginUrl);
    await this.fillTextInput(page, '#j_username', this.loginInfo.email);
    await this.fillTextInput(page, '#j_password', this.loginInfo.password);

    await page.click(signInBtnSelector, {timeout: 20000});
    logger.info('Logged into The Source');
  }

  async goToProductPage(product: Product) {
    const { productPage } = product;
    const page = await this.getPage();

    logger.info(`Navigating to ${baseUrl}${productPage}`);

    await page.goto(`${baseUrl}${productPage}`, { timeout: 60000 });

    await page.waitForSelector(productNameSelector);

    logger.info(`Navigation completed`);
  }

  async verifyProductPage(product: TheSourceProduct) {
    const { sku: expectedSku } = product;
    const page = await this.getPage();

    logger.info(`Validating that page is for ${product.productName}`);

    const actualSku = await page.$eval(skuSelector, (element) => element.textContent);

    this.compareValues('SKU', expectedSku, actualSku!);
  }

  async addToCart(product: TheSourceProduct) {
    const { productName } = product;
    const page = await this.getPage();
    
    logger.info(`Checking stock of ${productName}`);
    if (!(await this.isInStock())) {
      throw new Error('Product not in stock, aborting attempt');
    }

    await page.focus(addToCartBtnSelector);
    await this.sendScreenshot(page, `${Date.now()}_product-in-stock.png`, `${productName} is in stock! Adding to cart...`);

    await this.clickHack(page, addToCartBtnSelector);

    const result = await this.isInCart();

    if (!result) {
      throw new Error(`Could not add ${productName} to cart. Aborting.`);
    }

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
    const isCheckoutEnabled = await page.waitForSelector('#addToCartLayer .primary-button--big', {timeout: 5000});

    return isCheckoutEnabled ? true : false;
  }

  async checkout() {
    const page = await this.getPage();
    const customerInformation = getCustomerInformation();
    const paymentInformation = getPaymentInformation();

    logger.info('Checking out');

    await page.goto(checkoutUrl);

    await this.sendScreenshot(page, `${Date.now()}_starting-checkout.png`, 'Attempting checkout.');

    if (this.purchaseAsGuest) {
      await page.waitForNavigation();
      logger.info('Continuing as guest');
      await page.click('#guestForm .primary-button');
      await page.waitForNavigation();
    }

    // click radio button that says "Standard Ship to my home"
    await page.$eval(
      '#standard',
      (elem) => {
        const element = elem as HTMLElement;
        element.setAttribute('style', 'visibility:visible');
        element.setAttribute('checked', 'checked');
      }
    );

    // click red button that says "Continue to shipping"
    await page.$eval(
      '#store-button2',
      (elem) => {
        const element = elem as HTMLElement;
        element.removeAttribute('disabled');
        element.click();
      }
    );
    // await this.clickHack(page, '#store-button2');

    if (this.purchaseAsGuest) {
      await this.enterShippingInfo(customerInformation);
    }
    
    // Red "Review Your Order" button
    await this.clickHack(page, 'button[aria-label="Review your order"]');
    // Red "Continue to payment" button
    await this.clickHack(page, 'button[aria-label="Continue to payment"]');
    await this.enterPaymentInfo(paymentInformation);
    await this.sendText('Payment info filled out');
    
    await this.validateOrderTotal(customerInformation.budget);

    /** Uncomment the lines below to enable the very last step of the ordering. DO SO AT YOUR OWN RISK **/
    await this.clickHack(page, '#payNow');
    await wait(5000);
    await this.markAsPurchased();
    await this.sendScreenshot(page, `${Date.now()}_order-placed.png`, 'Order Placed!');
    return true;
  }

  async createOrder(): Promise<void> {
    const page = await this.getPage();

    logger.info('Continuing as guest');
    await page.click('#guestForm .primary-button');

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

  async enterShippingInfo(customerInfo: CustomerInformation) {
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

  // TODO: Figure out how to click the radio button
  async enterPaymentInfo(paymentInfo: PaymentInformation) {
    logger.info('Filling payment information...');

    const page = await this.getPage();
    await page.waitForSelector('#Pay_form_section', {timeout: 1000});
    // click radio button that says "Credit/Debit Card"
    await page.$eval(
      '#rdoCredit',
      (elem) => {
        const element = elem as HTMLElement;
        element.setAttribute('style', 'visibility:visible');
        element.setAttribute('checked', 'checked');
        element.click();
      }
    );
    await this.fillTextInput(page, '#card-number', paymentInfo.creditCardNumber);
    await this.fillTextInput(page, '#expiry-month', paymentInfo.expirationMonth);
    await this.fillTextInput(page, '#expiry-year', paymentInfo.expirationYear.substring(2));
    await this.fillTextInput(page, '#cvv', paymentInfo.cvv);

    logger.info('Payment information completed');
  }

  async validateOrderTotal(budget: number) {
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
