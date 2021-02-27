<h1 align="center">best-buy-sniper 🎯</h1>
<p>
  <img alt="Version" src="https://img.shields.io/badge/version-0.1.0-blue.svg?cacheSeconds=2592000" />
  <img src="https://img.shields.io/badge/npm-%3E%3D5.5.0-blue.svg" />
  <img src="https://img.shields.io/badge/node-%3E%3D9.3.0-blue.svg" />
</p>

> Autonomously buy NVIDIA RTX 30 Series GPUs from Best Buy

## Demo
![](bestbuysniperdemo.gif)

## Install
`npm install`

## Usage
<b>NOTE: By default the auto-checkout is disabled so there is no accidental purchasing. To enable auto-checkout uncomment the code found on `line: 368-370` in the `bestbuy.ts` file located in `src/pages`.</b>

1. FIll in all the data in `config/prod/` and remove the string `template_` from the file extenstions
  
Add or remove the desired cards you want to purchase in `config/prod/tasks.json`

You must have discord notifcation set in order for the bot to work. If you do not want to use it, you must comment out any line of code that has `sendDiscordMessage` in `main.ts` and `bestbuy.ts`.

2. Use `npm run start` to run the bot

3. Now wait for the item to come in stock

4. Stop the bot at any time with `npm run stop`

Note: the bot will no longer run once a purchase has been made. To be able to use the bot again, delete `purchase.json` from the main folder.

## Modifications for Azure Functions

Do deploy after build, set application setting:
PLAYWRIGHT_BROWSERS_PATH to 0
Then stop, start, restart

If changes made to actual code, need to adjust the package.json and run the build locally.  Otherwise js in dist stays static.
"build": "tsc",
Or just run "tsc" in cmd

and finally, for whatever reason, can juggle two different versions of playwright-firefox to help.
"playwright-firefox": "1.8.0", (or 1.4.2)

Helpful link for playwright on Azure Functions: https://anthonychu.ca/post/azure-functions-headless-chromium-puppeteer-playwright/