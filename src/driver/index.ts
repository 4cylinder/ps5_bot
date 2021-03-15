import { firefox, Browser } from 'playwright';

let browser: Browser;

export const createBrowser = async (): Promise<Browser> => {
  browser = await firefox.launch({
    headless: false,
  });

  return browser;
};

export const getBrowser = (): Browser => {
  return browser;
};
