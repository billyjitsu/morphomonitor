# Morpho Position Monitor

A Node.js script to monitor your [Morpho Finance](https://morpho.org/) positions and receive liquidation risk alerts via Telegram.

## Overview

This tool monitors your Morpho lending/borrowing positions to help prevent liquidations. It continuously checks your Liquidation Loan-to-Value (LLTV) ratio and sends alerts to your Telegram when your position approaches liquidation risk.

### Key Features

- **Real-time monitoring** of your Morpho positions
- **Automated Telegram alerts** when positions approach liquidation
- **Customizable risk thresholds** to receive warnings at your preferred safety level
- **Detailed position information** including current LTV, buffer percentage, and liquidation price
- **Supports all Morpho markets** (single-collateral vaults)

## How It Works

1. The script connects to the Morpho smart contracts on network of choice
2. It periodically checks your position's health by:
   - Retrieving your collateral and borrowed amounts
   - Getting current oracle prices
   - Calculating your current LTV and liquidation thresholds
3. When your position exceeds your set risk threshold, it sends a warning to your Telegram

## Setup Instructions

### Prerequisites

- Node.js and npm/yarn installed
- A Telegram account
- A Morpho position

### Installation

1. Clone this repository:
   ```
   git clone https://github.com/yourusername/morpho-monitor.git
   cd morpho-monitor
   ```

2. Install dependencies:
   ```
   npm install
   ```
   or
   ```
   yarn install
   ```

3. Create a `.env` file based on the example:
   ```
   cp .env.example .env
   ```

4. Create a Telegram bot:
   - Open Telegram and search for "BotFather"
   - Send "/newbot" and follow instructions to create a bot
   - Copy the API token provided

5. Get your Telegram channel ID:
   - Create a new channel or group
   - Add "@getidsbot" to your channel/group
   - Copy the channel ID that the bot provides

6. Find your Morpho market ID:
   - After depositing into a Morpho vault, check the transaction logs
   - Find the market ID in the event data (as shown in the tutorial)

7. Update your `.env` file with:
   - Your wallet address
   - The market ID for your position
   - Your Telegram bot token
   - Your Telegram channel ID
   - Your preferred risk threshold and check intervals

### Configuration Options

Edit the `.env` file to customize your monitoring:

```
# RPC endpoint - use your own for reliability
RPC_URL=https://mainnet.base.org

# Morpho contract address on Base
MORPHO_ADDRESS=0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb

# Your wallet address that has the Morpho position
WALLET_ADDRESS="Your wallet address"

# Morpho market ID where you have your position
MARKET_ID="Your market ID"

# Alert when LTV reaches this percentage of LLTV (0.7 = 70%)
LTV_ALERT_THRESHOLD=0.74

# Check interval in seconds (300 = 5 minutes)
CHECK_INTERVAL=300

# Space out notifications (360 = 6 minutes)
ALERT_COOLDOWN=360

# Token for Telegram bot 
TOKEN="Your Telegram bot token"

# Channel ID for Telegram
CHANNEL="Your Telegram channel ID"
```

### Running the Monitor

Start the monitoring script:

```
npm start
```
or
```
yarn start
```

For production use, consider using a process manager like PM2 or running it on a cloud service.

## Advanced Usage


### Running on a Server

For 24/7 monitoring:

```
# Install PM2
npm install -g pm2

# Start with PM2
pm2 start index.js --name morpho-monitor

# Ensure it starts on reboot
pm2 startup
pm2 save
```

## Disclaimer

This tool is provided as is, without warranty of any kind. Always monitor your positions manually as well. Crypto markets can move quickly, and automated tools may have delays or errors.
