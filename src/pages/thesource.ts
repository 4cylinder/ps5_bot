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
    await page.waitForLoadState('networkidle');
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
      logger.info('Continuing as guest');
      await page.click('#guestForm .primary-button');
      await page.waitForNavigation();
    }

    await this.clickHack(page, 'input#standard');
    await page.goto(`${baseUrl}/en-ca/checkout/multi/shipping-billing/add`);
    
    if (this.purchaseAsGuest) {
      await this.enterShippingInfo(customerInformation);
    }
    wait(1000);
    await page.goto(`${baseUrl}/en-ca/checkout/multi/cartorder-summary/getcart`);
    await page.goto(`${baseUrl}/en-ca/checkout/multi/payment-method/choose`);
    
    await this.enterPaymentInfo(paymentInformation);
    await this.sendText('Payment info filled out');
    
    await this.validateOrderTotal(customerInformation.budget);

    await checkAlreadyPurchased();

    if (this.testMode) {
      await this.sendText('You are running in test mode so the execution stops here');
    } else {
      await this.clickHack(page, '#payNow');
      await wait(5000);
      await this.markAsPurchased();
      await this.sendScreenshot(page, `${Date.now()}_order-placed.png`, 'Order Placed!');
      return true;
    }
    return false;
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
    try {
      await page.$eval(
        '#rdoCredit',
        (elem) => {
          const element = elem as HTMLElement;
          element.setAttribute('style', 'visibility:visible');
          element.setAttribute('checked', 'checked');
          element.click();
        }
      );
    } catch (err) {
      await this.clickHack(page, 'a[data-payment-option="1"]');
    }

    // IDs here are actually divs. The input fields are inside iframes within the divs.
    // Couldn't figure out how to resolve the iframe selectors,
    // but clicking the divs and going keystroke-by-keystroke works!
    await page.click('#cardNumber');
    for (let i = 0; i < paymentInfo.creditCardNumber.length; i++) {
      await page.keyboard.press(paymentInfo.creditCardNumber[i])
    }
    await page.click('#expiryMonth');
    for (let i = 0; i < 2; i++) {
      await page.keyboard.press(paymentInfo.expirationMonth[i])
    }
    await page.click('#expiryYear');
    for (let i = 2; i < 4; i++) {
      await page.keyboard.press(paymentInfo.expirationYear[i])
    }
    await page.click('#cvv');
    for (let i = 0; i < paymentInfo.cvv.length; i++) {
      await page.keyboard.press(paymentInfo.cvv[i])
    }

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
