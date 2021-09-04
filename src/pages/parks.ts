import { find } from 'lodash';
import { CustomerInformation, getCustomerInformation, getPaymentInformation, LoginInformation, PaymentInformation } from '@core/configs';
import { logger } from '@core/logger';
import { Product, Retailer, wait, checkAlreadyPurchased } from './retailer';

const baseUrl = 'https://discovercamping.ca/BCCWeb';
const loginUrl = `${baseUrl}/Default.aspx#`;
const cartPage = `${baseUrl}/Customers/ShoppingCart.aspx`;

interface ParksProduct extends Product {
  location: string;
}


export class Parks extends Retailer {
  constructor(products: ParksProduct[], loginInfo: LoginInformation, testMode: boolean) {
    super(products, loginInfo, testMode);
    this.retailerName = 'parks';
  }

  public async login() {
    this.purchaseAsGuest = false;
    const page = await this.getPage();
    await page.goto(loginUrl);
    await page.click('#aLogin', {timeout: 2000});
    await this.fillTextInput(page, '#txtUserName', this.loginInfo.email);
    await this.fillTextInput(page, '#txtPassword', this.loginInfo.password);
    await page.click('#divOnlyLogin', {timeout: 2000});
  }

  async goToProductPage(product: ParksProduct) {
    const page = await this.getPage();
    const { location, productName, productPage } = product;
    logger.info(`Navigating to ${baseUrl}/${productPage}`);
    await page.goto(`${baseUrl}/${productPage}`);
    // the right-facing chevron arrow next to the date
    await page.click('#Next', {timeout: 2000});
    await page.click('#collapsed_41', {timeout: 2000});
    // await page.click('#collapsed_43', {timeout: 2000});
  }

  async verifyProductPage(product: ParksProduct) {
    return;
  }

  async addToCart(product: ParksProduct) {
    logger.info('Adding to cart');
    const page = await this.getPage();
    // await page.click('#mainContent_RPTMainmembershiplist_RPTSubmembershiplist_1_panelAddToCart_0')
    await page.click('#mainContent_RPTMainmembershiplist_RPTSubmembershiplist_0_panelAddToCart_1')
  }

  async isInStock() {
    logger.info('Checking product stock');
    const page = await this.getPage();
    // const isButtonEnabled = await page.$('#mainContent_RPTMainmembershiplist_RPTSubmembershiplist_1_panelAddToCart_0')
    const isButtonEnabled = await page.$('#mainContent_RPTMainmembershiplist_RPTSubmembershiplist_0_panelAddToCart_1');
    if (isButtonEnabled) {
      return true;
    }
    return false;
  }

  async isInCart() {
    return true;
  }

  async checkout() {
    const page = await this.getPage();
    await page.goto(cartPage);
    await page.check('#mainContent_chkAgree');

    await checkAlreadyPurchased();

    if (this.testMode) {
      await this.sendText('You are running in test mode so the execution stops here');
    } else {
      await page.click('#mainContent_aCheckOut');
      await this.markAsPurchased();
      await this.sendScreenshot(page, `${Date.now()}_order-placed.png`, 'Order Placed!');
      return true;
    }
    return false;
  }

  async enterShippingInfo(customerInfo: CustomerInformation) {
    return;
  }

  async enterPaymentInfo(paymentInfo: PaymentInformation) {
    return;
  }

  async validateOrderTotal(budget: number) {
    return;
  }
}
