import { find } from 'lodash';
import { CustomerInformation, getCustomerInformation, getPaymentInformation, LoginInformation, PaymentInformation } from '@core/configs';
import { logger } from '@core/logger';
import { Product, Retailer, wait, checkAlreadyPurchased } from './retailer';
import { Browser } from 'playwright';

interface BestBuyProduct extends Product {
  sku: string;
  model: string;
}

const baseUrl = 'https://www.bestbuy.ca';
const loginUrl = `${baseUrl}/account/en-ca`;
const cartUrl = `${baseUrl}/en-ca/basket`;
const checkoutUrl = `${baseUrl}/checkout/#/en-ca/review`;
const signInBtnSelector = '.signin-form-button';
const addToCartBtnSelector = '.productActionWrapperNonMobile_10B89 .addToCartButton:not([disabled])';
const productDetailsSelector = '.modelInformation_1ZG9l';

export class BestBuy extends Retailer {
  constructor(loginInfo: LoginInformation, testMode: boolean) {
    super(loginInfo, testMode);
    this.retailerName = 'bestbuy';
  }

  public async login() {
    this.purchaseAsGuest = false;
    const page = await this.getPage();
    await page.bringToFront();
    await page.goto(loginUrl);
    await this.fillTextInput(page, '#username', this.loginInfo.email);
    await this.fillTextInput(page, '#password', this.loginInfo.password);

    await page.click(signInBtnSelector, {timeout: 3000});
    logger.info('Logged into Best Buy');
  }

  async goToProductPage(product: BestBuyProduct) {
    const { productPage } = product;
    const page = await this.getPage();
    await page.bringToFront();

    logger.info(`Navigating to ${baseUrl}/en-ca${productPage}`);

    await page.goto(`${baseUrl}/en-ca${productPage}`);
    let navigated: boolean = false;
    // Back in February, the product page auto-navigated to the queue page
    // By looping, we can ensure the bot keeps checking the page
    do {
      try {
        // on my slower laptop it has a tendency to resolve to hidden
        try {
          await page.waitForSelector(productDetailsSelector);
        } catch (e) {
          // not sure how well this compensation works...
          await page.waitForSelector('.productName_3nyxM');
        }
        
        logger.info(`Navigation completed`);
        navigated = true;
      } catch(err) {
        logger.info(err);
        const url = page.url();
        if (!url.includes(product.sku) || url.includes('softblock') || url.includes('queue')) {
          logger.info(`Got redirected to ${url}`);
          await this.sendScreenshot(page, `${Date.now()}_page_redirected.png`, 'Possible queue in effect. Check your PC.');
          await page.waitForNavigation({timeout: 600000});
        }
      }
    } while (!navigated);
  }

  async verifyProductPage(product: BestBuyProduct) {
    const { sku: expectedSku, model: expectedModel } = product;
    const page = await this.getPage();

    logger.info(`Validating that page is for ${product.productName}`);

    const actualModel = await page.$eval(
      `${productDetailsSelector}:nth-of-type(1) span`,
      (element) => element.textContent
    );

    const actualSku = await page.$eval(
      `${productDetailsSelector}:nth-of-type(2) span`,
      (element) => element.textContent
    );

    this.compareValues('Model Number', expectedModel, actualModel!);
    this.compareValues('SKU', expectedSku, actualSku!);
  }

  private async antiAntiBot() {
    const context = this.page?.context();
    const cookies = await context?.cookies();

    const sensorCookie = find(cookies, { name: '_abck' })?.value;
    const sensorValidationRegex = /~0~/g;

    if (sensorCookie && !sensorValidationRegex.test(sensorCookie)) {
      await Promise.all([this.sendText(this.antiBotMsg)]);

      throw new Error(this.antiBotMsg);
    }
  }

  async addToCart(product: BestBuyProduct) {
    const { productName } = product;
    const page = await this.getPage();
    
    // await this.antiAntiBot();

    await page.focus(addToCartBtnSelector);
    await this.sendScreenshot(page, `${Date.now()}_product-in-stock.png`, `${productName} is in stock! Adding to cart.`)

    await page.click(addToCartBtnSelector);

    const result = await this.isInCart();

    if (!result){
      throw new Error(`Could not add ${productName} to cart. Aborting.`);
    } 

    await this.sendScreenshot(page, `${Date.now()}_product-added.png`, `${productName} added to cart!`)
  }

  async isInStock() {
    logger.info('Checking product stock');
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

  async checkout() {
    const page = await this.getPage();
    const customerInformation = getCustomerInformation();
    const paymentInformation = getPaymentInformation();

    logger.info('Checking out');

    await page.goto(checkoutUrl);
    // Hopefully, navigating directly to the checkout page via the URL should trigger the queue
    // If not, the next TODO is to implement this do/while on the cart page...
    let navigated = false;
    do {
      try {
        if (this.purchaseAsGuest) {
          logger.info('Continuing as guest');
    
          await page.waitForSelector('.checkoutPageContainer .form');
    
          await this.enterShippingInfo(customerInformation);
          await this.sendScreenshot(page, `${Date.now()}_first-information-page-completed.png`, 'Filled out customer info.');
          
          logger.info('Continuing to payment screen...');
    
          try {
            await page.click('.continue-to-payment');
          } catch (err) {
            await page.goto(`${checkoutUrl}/#/en-ca/payment`)
          }
          await this.enterPaymentInfo(paymentInformation);
          await this.sendText('Filled out payment info.');
    
          try {
            await page.click('.continue-to-review');
          } catch (err) {
            await page.goto(`${checkoutUrl}/#/en-ca/review`);
          }
        } else {
          await this.fillTextInput(page, '#cvv', paymentInformation.cvv);
        }
        navigated = true;
      } catch (error) {
        logger.info(error);
        const url = page.url();
        if (!url.includes('checkout') || url.includes('softblock') || url.includes('queue')) {
          logger.info(`Got redirected to ${url}`);
          await this.sendScreenshot(page, `${Date.now()}_page_redirected.png`, 'Possible queue in effect. Check your PC.');
          await page.waitForNavigation({timeout: 600000});
        }
      }

    } while (!navigated);
    
    await this.sendScreenshot(page, `${Date.now()}_starting-checkout.png`, 'Attempting checkout.');

    await this.validateOrderTotal( customerInformation.budget);

    await this.sendScreenshot(page, `${Date.now()}_placing-order.png`, 'Placing order...');

    await checkAlreadyPurchased();

    if (this.testMode) {
      await this.sendText('You are running in test mode so the execution stops here');
    } else {
      await page.click('.order-now');
      await wait(5000);
      await this.markAsPurchased();
      await this.sendScreenshot(page, `${Date.now()}_order-placed.png`, 'Order placed!')
    }

    return true;
  }

  async isQueueActive() {
    const page = await this.getPage();
    const element = await page.$('#lbHeaderH2');
    const elementTextContent = await element?.textContent();
    return elementTextContent ? elementTextContent.trim().toLowerCase() === 'thanks for waiting to check out.' : false;
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

  async validateOrderTotal(budget: number) {
    const page = await this.getPage();
    logger.info('Performing last validation before placing order...');
    const totalContainer = await page.$('.total td');
    const totalContainerTextContent = await totalContainer?.textContent();
    const parsedTotal = totalContainerTextContent ? parseFloat(totalContainerTextContent.replace('$', '')) : 0;

    if (parsedTotal === 0 || parsedTotal > budget) {
      throw new Error(`Total amount of ${parsedTotal} does not seems right, aborting`);
    }
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
