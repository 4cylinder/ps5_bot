import { chromium, Browser, LaunchOptions } from 'playwright';

let browser: Browser;

export const createBrowser = async (): Promise<Browser> => {
  browser = await chromium.launch({headless: false});
  return browser;
};

export const getBrowser = (): Browser => {
  return browser;
};
