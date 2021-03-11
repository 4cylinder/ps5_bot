<h1 align="center">ps5_bot 🎯</h1>
<p>
  <img alt="Version" src="https://img.shields.io/badge/version-0.1.0-blue.svg?cacheSeconds=2592000" />
  <img src="https://img.shields.io/badge/npm-%3E%3D5.5.0-blue.svg" />
  <img src="https://img.shields.io/badge/node-%3E%3D9.3.0-blue.svg" />
</p>

> Autonomously buy PS5s (or other products) from Best Buy Canada, Walmart Canada, and possibly more in the future.

## Disclaimer
* This project is derived from https://github.com/zeldridge/best-buy-sniper.
* I do not own the basic idea of using PM2 and Playwright to auto-buy products from these sites. *All credit goes to Zeldrige!*
* The modifications to support multiple retailers are entirely my own.
* *I assume no responsibility* for any personal catastrophies that may result from the use of this bot. Read the instructions carefully if you don't want a nasty surprise on your credit card bill.

## Install
`npm install`

## Usage
### NOTE 1
<b>By default the auto-completion is disabled so there is no accidental purchasing.
To enable auto-completion, change line 15 of `src/main.ts` to `const testMode = false`. DO SO AT YOUR OWN RISK.</b>

### NOTE 2
<b>If you're experimenting and don't want to be inundated with Discord messages, comment out the line in `src/pages/retailer.ts` that makes a call to the function `sendDiscordMessage`.</b>

### Running the bot
1. Fill in all the data in the `config` directory and remove the string `template_` from the file extensions
    - Best Buy and Walmart use a Canada Post API to resolve addresses. I recommend manually going through the order process just once on a random product, and copying the exact format that the API uses when it resolves your address.
    - For example, if your address is `123 Smith Drive`, and the Canada Post API resolves it to `123 Smith Dr`, then you should write `123 Smith Dr` as your address in `customer.json`

2. Add or remove the desired products you want to purchase in `config/tasks.json`

3. Use `npm run start` to run the bot

4. Now wait for the item to come in stock

5. Stop the bot at any time with `npm run stop`

The bot will no longer run once a purchase has been made. To make more purchases, delete `purchase.json` from the main folder.
