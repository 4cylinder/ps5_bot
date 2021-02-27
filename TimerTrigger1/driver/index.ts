import { firefox, Browser } from 'playwright-firefox';

let browser: Browser;

export const createBrowser = async (): Promise<Browser> => {
  const options = {
    headless: true,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.150 Safari/537.36',
    ignoreHTTPSErrors: true,
    defaultViewport: { width: 1920, height: 1080 }
  };

  browser = await firefox.launch(options);

  return browser;
};

export const getBrowser = (): Browser => {
  return browser;
};
