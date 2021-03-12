import { firefox, Browser, LaunchOptions } from 'playwright';

let browser: Browser;

export const createBrowser = async (): Promise<Browser> => {
  const options: LaunchOptions = {
    headless: false,
  };

  browser = await firefox.launch(options);

  return browser;
};

export const getBrowser = (): Browser => {
  return browser;
};
