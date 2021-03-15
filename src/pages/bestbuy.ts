import { find } from 'lodash';
import { CustomerInformation, getCustomerInformation, getPaymentInformation, LoginInformation, PaymentInformation } from '@core/configs';
import { logger } from '@core/logger';
import { Product, Retailer, wait, checkAlreadyPurchased } from './retailer';

interface BestBuyProduct extends Product {
  sku: string;
  model: string;
}

export class BestBuy extends Retailer {
  constructor(products: BestBuyProduct[], loginInfo: LoginInformation, testMode: boolean) {
    super(products, loginInfo, testMode);
    this.retailerName = 'bestbuy';
    const baseUrl = `https://www.${this.retailerName}.ca`;
    this.urls = {
      base: baseUrl,
      account: `${baseUrl}/account/en-ca`,
      cart: `${baseUrl}/en-ca/basket`,
      checkout: `${baseUrl}/checkout/#/en-ca/delivery`,
      queue: `queue.${this.retailerName}.ca`
    }
    this.selectors = {
      loginUsername: '#username',
      loginPassword: '#password',
      signInBtn: '.signin-form-button',
      addToCartBtn: '.productActionWrapperNonMobile_10B89 .addToCartButton:not([disabled])',
      productDetail: '.modelInformation_1ZG9l',
      placeOrderBtn: '.order-now'
    }
  }

  async goToProductPage(product: BestBuyProduct) {
    const { productPage } = product;
    const page = await this.getPage();
    const productPageUrl = `${this.urls.base}/en-ca${productPage}`;
    logger.info(`Navigating to ${productPageUrl}`);

    await page.goto(productPageUrl);
    let navigated: boolean = false;
    // Back in February, the product page auto-navigated to the queue page
    // By looping, we can ensure the bot keeps checking the page
    do {
      try {
        // on my slower laptop it has a tendency to resolve to hidden
        try {
          await page.waitForSelector(this.selectors.productDetail);
        } catch (e) {
          // not sure how well this compensation works...
          await page.waitForSelector('.breadcrumbList_16xQ3');
        }
        navigated = true;
      } catch(err) {
        logger.info(err);
        const url = page.url();
        if (url.includes('queue')) {
          logger.info(`Got redirected to ${url}`);
          await this.sendScreenshot(page, `${Date.now()}_page_redirected.png`, 'Possible queue in effect. Check your PC.');
          await page.waitForNavigation({timeout: 600000});
        } else {
          throw new Error(`Could not navigate to ${productPageUrl}`);
        }
      }
    } while (!navigated);
  }

  async verifyProductPage(product: BestBuyProduct) {
    const { sku: expectedSku, model: expectedModel } = product;
    const page = await this.getPage();

    logger.info(`Validating that page is for ${product.productName}`);

    const actualModel = await page.$eval(
      `${this.selectors.productDetail}:nth-of-type(1) span`,
      (element) => element.textContent
    );

    const actualSku = await page.$eval(
      `${this.selectors.productDetail}:nth-of-type(2) span`,
      (element) => element.textContent
    );

    this.compareValues('Model Number', expectedModel, actualModel!);
    this.compareValues('SKU', expectedSku, actualSku!);
  }

  private async antiAntiBot() {
    const [context] = Retailer.browser.contexts();
    const cookies = await context.cookies();

    const sensorCookie = find(cookies, { name: '_abck' })?.value;
    const sensorValidationRegex = /~0~/g;

    if (sensorCookie && !sensorValidationRegex.test(sensorCookie)) {
      await Promise.all([this.sendText(Retailer.antiBotMsg)]);

      throw new Error(Retailer.antiBotMsg);
    }
  }

  async addToCart(product: BestBuyProduct) {
    const { productName } = product;
    const page = await this.getPage();
    
    await this.antiAntiBot();

    await page.focus(this.selectors.addToCartBtn);
    await this.sendScreenshot(page, `${Date.now()}_product-in-stock.png`, `${productName} is in stock! Adding to cart.`)

    await page.click(this.selectors.addToCartBtn);

    const result = await this.isInCart();

    if (!result){
      throw new Error(`Could not add ${productName} to cart. Aborting.`);
    } 

    await this.sendScreenshot(page, `${Date.now()}_product-added.png`, `${productName} added to cart!`)
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

    await page.goto(this.urls.checkout);
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
            await page.goto(`${this.urls.checkout}/#/en-ca/payment`)
          }
          await this.enterPaymentInfo(paymentInformation);
          await this.sendText('Filled out payment info.');
    
          try {
            await page.click('.continue-to-review');
          } catch (err) {
            await page.goto(`${this.urls.checkout}/#/en-ca/review`);
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
      await page.click(this.selectors.placeOrderBtn);
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
