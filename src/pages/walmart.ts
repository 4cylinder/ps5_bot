import { CustomerInformation, getCustomerInformation, getPaymentInformation, LoginInformation, PaymentInformation } from '@core/configs';
import { logger } from '@core/logger';
import { Frame, Page } from 'playwright';
import { Product, Retailer, wait, checkAlreadyPurchased } from './retailer';

interface WalmartProduct extends Product {
  productId: string;
}
  
const baseUrl = 'https://www.walmart.ca';
const loginUrl = `${baseUrl}/sign-in`;
const checkoutUrl = `${baseUrl}/checkout`;
const signInBtnSelector = 'button[data-automation="form-btn"]';
const productNameSelector = 'h1[data-automation="product-title"]';
const addToCartBtnSelector = 'button[data-automation="cta-button"]:not([disabled])'
const goToCartBtnSelector = 'button[data-automation="checkout"]'
const checkoutBtnSelector = 'button[data-automation="checkout-btn"]';
const captchaSelector = '.g-recaptcha';

export class WalMart extends Retailer {
  constructor(products: WalmartProduct[], loginInfo: LoginInformation, testMode: boolean) {
    super(products, loginInfo, testMode);
    this.retailerName = 'walmart';
  }

  public async login() {
    this.purchaseAsGuest = false;
    const page = await this.getPage();
    await page.goto(loginUrl);
    await this.fillTextInput(page, '#username', this.loginInfo.email);
    await this.fillTextInput(page, '#password', this.loginInfo.password);
    await page.click(signInBtnSelector, {timeout: 1000});
    logger.info('Logged into walmart');
  }

  async goToProductPage(product: WalmartProduct) {
    const { productPage } = product;
    const page = await this.getPage();

    logger.info(`Navigating to ${baseUrl}/en${productPage}`);

    await page.goto(`${baseUrl}${productPage}`, { timeout: 60000 });
    await page.waitForLoadState('networkidle');
    await page.$(productNameSelector);

    logger.info(`Navigation completed`);
  }

  async verifyProductPage(product: WalmartProduct) {
    const { productName: expectedTitle } = product;
    const page = await this.getPage();

    logger.info(`Verifying that page is for ${expectedTitle}`);

    const actualTitle = await page.$eval(productNameSelector, (element) => element.textContent);

    this.compareValues('Product Name', expectedTitle, actualTitle!);
  }

  async addToCart(product: WalmartProduct) {
    const { productName } = product;
    const page = await this.getPage();

    // Walmart will likely redirect you to a captcha page after you click the add-to-cart button for PS5s
    page.on('framenavigated', async (frame) => {
      const url = frame.url();
      if (url.includes('blocked')) {
        const page = frame.page();
        await this.sendScreenshot(page, `${Date.now()}_product-captcha.png`, `${this.retailerName} has a captcha active!`);
        // give user one minute to click the captcha
        await page.waitForNavigation({timeout: 60000});
      }
    });
    
    await page.focus(addToCartBtnSelector);
    await this.sendScreenshot(page, `${Date.now()}_product-in-stock.png`, `${productName} is in stock! Adding to cart.`);

    await this.clickHack(page, addToCartBtnSelector);
    
    // const result = await this.isInCart();

    // if (!result) {
    //   throw new Error(`Could not add ${productName} to cart. Aborting.`);
    // }

    await this.sendScreenshot(page, `${Date.now()}_product-added.png`, `${productName} added to cart!`);
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
    const isCheckoutEnabled = await page.waitForSelector(`#modal-root ${goToCartBtnSelector}`, {timeout: 10000});

    return isCheckoutEnabled ? true : false;
  }

  async checkout() {
    const page = await this.getPage();

    const customerInformation = getCustomerInformation();
    const paymentInformation = getPaymentInformation();

    logger.info('Checking out');

    const url = await(page.url());

    if (!url.includes('checkout')) {
      await page.goto(checkoutUrl);
    }

    if (this.purchaseAsGuest) {
      logger.info('Continuing as guest');
      await page.waitForSelector('#email', {timeout: 10000});
      await this.fillTextInput(page, '#email', customerInformation.email);

      // Blue "Next" button after filling email address
      await page.click('button[data-automation="form-default-btn"]');

      await page.waitForSelector('#shipping-tab', {timeout: 10000});
      await page.click('#shipping-tab');

      await this.enterShippingInfo(customerInformation);

      // Blue "Next" button after filling shipping info
      await page.click('button[data-automation="next-button"]');

      logger.info('Continuing to payment screen...');

      await this.enterPaymentInfo(paymentInformation);
      await this.sendText('Payment info filled out');
    } else {
      // "Sign In" radio button
      // Don't know why, but sometimes still need to sign in again if done through the bot
      const secondLogin = await page.evaluate(() => {
        const elem = document.querySelector("#yes")
        if (elem) {
          return elem.outerHTML;
        }
        return undefined;
      })
      if (secondLogin != undefined) {
        await page.check('#yes');
        await this.fillTextInput(page, '#email', this.loginInfo.email);
        await this.fillTextInput(page, '#password', this.loginInfo.password);
        await this.clickHack(page, 'button[data-automation="form-default-btn"]');
      }
      // wait for all elements to be visible
      await page.waitForLoadState('networkidle', {timeout:5000});
    }

    await this.sendScreenshot(page, `${Date.now()}_placing-order.png`, 'Placing order...');
    await this.validateOrderTotal( customerInformation.budget);

    await checkAlreadyPurchased();

    if (this.testMode) {
      await this.sendText('You are running in test mode so the execution stops here');
    } else {
      await this.clickHack(page, '.order-now');
      await wait(5000);
      await this.markAsPurchased();
      await this.sendScreenshot(page, `${Date.now()}_order-placed.png`, 'Order placed!')
    }
    return true;
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
    const needToReplace = await page.waitForSelector(`div[data-automation="express-checkout-header-blurb"]`, {timeout: 5000});
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