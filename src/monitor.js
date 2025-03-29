require("dotenv").config();
const { ethers } = require("ethers");
const TelegramNotifier = require("./telegram");

// Import contract ABIs
const MORPHO_ABI = require("../contract_abi/morpho_abi.json");
const MARKET_ORACLE_ABI = require("../contract_abi/market_oracle_abi.json");
const COLLATERAL_ORACLE_ABI = require("../contract_abi/collateral_oracle_abi.json");
const BORROW_ORACLE_ABI = require("../contract_abi/debt_oracle_abi.json");
const TOKENS_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

// Configuration from environment variables
const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const MORPHO_ADDRESS =
  process.env.MORPHO_ADDRESS || "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";
const WALLET_ADDRESS = process.env.WALLET_ADDRESS || "";
const MARKET_ID = process.env.MARKET_ID || "";
const LTV_ALERT_THRESHOLD = parseFloat(process.env.LTV_ALERT_THRESHOLD || "0.8"); // Send alert at 80% LTV
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL || "300") * 1000; // Check every 5 minutes
const ALERT_COOLDOWN = parseInt(process.env.ALERT_COOLDOWN || "360") * 1000; // If notified within 6 minutes

// Initialize these after getting market parameters
let collateralOracleContract;
let borrowOracleContract;

// Initialize ethers provider
const provider = new ethers.JsonRpcProvider(RPC_URL);

// Initialize Morpho contracts
const morphoContract = new ethers.Contract(
  MORPHO_ADDRESS,
  MORPHO_ABI,
  provider
);

class MorphoMonitor {
  constructor() {
    this.lastAlertTime = 0;
    this.alertCooldown = ALERT_COOLDOWN;
    this.marketParams = null;
    this.loanDecimals = null;
    this.collateralDecimals = null;
    this.oracleContract = null;
    // Initialize Telegram notifier
    this.telegram = new TelegramNotifier(
      process.env.TOKEN,
      process.env.CHANNEL
    );
  }

  async getPositionData() {
    try {
      // Get market parameters first
      if (!this.marketParams) {
        this.marketParams = await morphoContract.idToMarketParams(MARKET_ID);

        // Initialize oracle contract
        this.oracleContract = new ethers.Contract(
          this.marketParams.oracle,
          MARKET_ORACLE_ABI,
          provider
        );

        // Get oracle feed addresses
        const [baseFeed1, quoteFeed1] = await Promise.all([
          this.oracleContract.BASE_FEED_1(), // Collateral
          this.oracleContract.QUOTE_FEED_1(), // Borrow
        ]);

        // Initialize oracle contracts with the feed addresses
        collateralOracleContract = new ethers.Contract(
          baseFeed1,
          COLLATERAL_ORACLE_ABI,
          provider
        );

        borrowOracleContract = new ethers.Contract(
          quoteFeed1,
          BORROW_ORACLE_ABI,
          provider
        );

        console.log("Market Parameters:", {
          loanToken: this.marketParams.loanToken,
          collateralToken: this.marketParams.collateralToken,
          oracle: this.marketParams.oracle,
          irm: this.marketParams.irm,
          lltv: ethers.formatEther(this.marketParams.lltv),
        });

        // Get token information
        const loanTokenContract = new ethers.Contract(
          this.marketParams.loanToken,
          TOKENS_ABI,
          provider
        );
        const collateralTokenContract = new ethers.Contract(
          this.marketParams.collateralToken,
          TOKENS_ABI,
          provider
        );

        [
          this.loanDecimals,
          this.collateralDecimals,
          this.loanSymbol,
          this.collateralSymbol,
        ] = await Promise.all([
          loanTokenContract.decimals(),
          collateralTokenContract.decimals(),
          loanTokenContract.symbol(),
          collateralTokenContract.symbol(),
        ]);
      }

      // Get position data
      const position = await morphoContract.position(MARKET_ID, WALLET_ADDRESS);
      const borrowShares = position.borrowShares;
      const collateralAmount = position.collateral;

      // console.log("Raw Position:", {
      //   borrowShares: borrowShares.toString(),
      //   collateral: collateralAmount.toString(),
      // });

      // Get market data for asset/shares conversion
      const marketData = await morphoContract.market(MARKET_ID);
      const totalBorrowAssets = marketData.totalBorrowAssets;
      const totalBorrowShares = marketData.totalBorrowShares;

      // console.log("Market Data:", {
      //   totalBorrowAssets: totalBorrowAssets.toString(),
      //   totalBorrowShares: totalBorrowShares.toString(),
      // });

      // Convert borrowShares to borrowedAssets using SharesMathLib's logic
      // This recreates the toAssetsUp function from the SharesMathLib
      const VIRTUAL_SHARES = 1000000n; // 1e6 as BigInt
      const VIRTUAL_ASSETS = 1n;

      // For precision in division, work with BigInts
      const borrowSharesBigInt = BigInt(borrowShares.toString());
      const totalBorrowAssetsBigInt = BigInt(totalBorrowAssets.toString());
      const totalBorrowSharesBigInt = BigInt(totalBorrowShares.toString());

      // Implementing mulDivUp logic: (a * b + denominator - 1) / denominator
      const numerator =
        borrowSharesBigInt * (totalBorrowAssetsBigInt + VIRTUAL_ASSETS);
      const denominator = totalBorrowSharesBigInt + VIRTUAL_SHARES;
      const borrowedAssets = (numerator + denominator - 1n) / denominator;

      // Format the position values using their respective decimals
      // console.log("Formatted Position:", {
      //   borrowShares: ethers.formatUnits(borrowShares, this.loanDecimals),
      //   borrowedAssets: ethers.formatUnits(borrowedAssets, this.loanDecimals),
      //   collateral: ethers.formatUnits(
      //     collateralAmount,
      //     this.collateralDecimals
      //   ),
      // });

      // Get oracle information
      const [collateralValue, collateralDecimals] = await Promise.all([
        collateralOracleContract.latestAnswer(),
        collateralOracleContract.decimals(),
      ]);

      const [borrowValue, borrowDecimals] = await Promise.all([
        borrowOracleContract.latestAnswer(),
        borrowOracleContract.decimals(),
      ]);

      // console.log("Oracle values:", {
      //   collateralValue: collateralValue.toString(),
      //   collateralDecimals,
      //   borrowValue: borrowValue.toString(),
      //   borrowDecimals,
      // });

      // Format the raw values using decimals
      const formattedCollateralValue = ethers.formatUnits(
        collateralValue,
        collateralDecimals
      );
      const formattedBorrowValue = ethers.formatUnits(
        borrowValue,
        borrowDecimals
      );

      console.log("Formatted oracle values:", {
        collateralValue: formattedCollateralValue,
        borrowValue: formattedBorrowValue,
      });

      // Get market oracle price
      const marketOraclePrice = await this.oracleContract.price();
      const marketOracleScaledPrice = ethers.formatUnits(marketOraclePrice, 36);
      // console.log("Market Oracle Price:", {
      //   rawPrice: marketOraclePrice.toString(),
      //   scaledPrice: marketOracleScaledPrice,
      //   description: "Price of collateral in loan token units",
      // });

      // Compare with our calculated price
      const calculatedPrice =
        parseFloat(formattedCollateralValue) / parseFloat(formattedBorrowValue);
      console.log("Price Comparison:", {
        marketOraclePrice: marketOracleScaledPrice,
        calculatedPrice: calculatedPrice.toString(),
        difference: Math.abs(
          parseFloat(marketOracleScaledPrice) - calculatedPrice
        ).toString(),
      });

      // Use LLTV from market parameters
      const lltv = parseFloat(ethers.formatEther(this.marketParams.lltv));

      return {
        borrowedAmount: parseFloat(
          ethers.formatUnits(borrowedAssets, this.loanDecimals)
        ),
        collateralAmount: parseFloat(
          ethers.formatUnits(collateralAmount, this.collateralDecimals)
        ),
        collateralPrice: parseFloat(formattedCollateralValue),
        borrowPrice: parseFloat(formattedBorrowValue),
        lltv,
      };
    } catch (error) {
      console.error("Error fetching position data:", error);
      return null;
    }
  }

  calculateLtv(data) {
    if (!data || data.collateralAmount === 0) {
      return 0;
    }

    // LTV = (borrowedAmount * borrowPrice) / (collateralAmount * collateralPrice)
    const ltv =
      (data.borrowedAmount * data.borrowPrice) /
      (data.collateralAmount * data.collateralPrice);

    return ltv;
  }

  calculateLiquidationPrice(data) {
    if (!data || data.borrowedAmount === 0) {
      return 0;
    }

    // Liquidation price = (borrowedAmount * borrowPrice * lltv) / collateralAmount
    const liquidationPrice =
      (data.borrowedAmount * data.borrowPrice) /
      (data.collateralAmount * data.lltv);

    return liquidationPrice;
  }

  calculateBufferPercentage(currentLtv, lltv) {
    if (lltv === 0) {
      return 100; // Avoid division by zero
    }

    const bufferPercentage = 100 * (1 - currentLtv / lltv);
    return bufferPercentage;
  }

  async logAlert(message) {
    const currentTime = Date.now();

    if (currentTime - this.lastAlertTime < this.alertCooldown) {
      console.log("Alert cooldown in effect");
      return;
    }

    console.log(message);
    // Send Telegram notification
    await this.telegram.sendMessage(message);

    this.lastAlertTime = currentTime;
  }

  async monitorPosition() {
    console.log(
      `Starting Morpho position monitor for address ${WALLET_ADDRESS}`
    );
    console.log(
      `LTV alert threshold set to ${LTV_ALERT_THRESHOLD * 100}% of LLTV`
    );
    console.log(`Checking every ${CHECK_INTERVAL / 1000} seconds`);

    const monitor = async () => {
      try {
        const data = await this.getPositionData();

        if (!data) {
          console.log("Could not fetch position data, will retry");
          return;
        }

        const currentLtv = this.calculateLtv(data);
        const liquidationPrice = this.calculateLiquidationPrice(data);
        const bufferPercentage = this.calculateBufferPercentage(
          currentLtv,
          data.lltv
        );

        // Calculate USD values
        const collateralValueUSD = data.collateralAmount * data.collateralPrice;
        const borrowedValueUSD = data.borrowedAmount * data.borrowPrice;

        // Format the values for display
        console.log("-----------------------------------");
        console.log(new Date().toISOString());
        console.log(
          `Collateral amount: ${data.collateralAmount.toFixed(4)} ${
            this.collateralSymbol
          } ($${collateralValueUSD.toFixed(2)})`
        );
        console.log(
          `Borrowed amount: ${data.borrowedAmount.toFixed(2)} ${
            this.loanSymbol
          } ($${borrowedValueUSD.toFixed(2)})`
        );

        console.log(
          `Current LTV: ${currentLtv.toFixed(4)} / LLTV: ${data.lltv.toFixed(
            4
          )}`
        );
        console.log(`Buffer remaining: ${bufferPercentage.toFixed(2)}%`);
        console.log(`Current price: ${data.collateralPrice.toFixed(4)}`);
        console.log(`Liquidation price: ${liquidationPrice.toFixed(4)}`);

        // Check if we need to send an alert
        if (currentLtv >= LTV_ALERT_THRESHOLD) {
          const message = `
<b>🚨 LIQUIDATION RISK ALERT 🚨</b>

Current LTV: ${currentLtv.toFixed(4)}
LLTV Threshold: ${data.lltv.toFixed(4)}
Buffer remaining: ${bufferPercentage.toFixed(2)}%
Current price: ${data.collateralPrice.toFixed(4)}
Liquidation price: ${liquidationPrice.toFixed(4)}
Borrowed amount: ${data.borrowedAmount.toFixed(2)} ${this.loanSymbol}
Collateral amount: ${data.collateralAmount.toFixed(4)} ${this.collateralSymbol}
          `;

          this.logAlert(message);
        }
      } catch (error) {
        console.error("Error in monitoring loop:", error);
      }
    };

    // Initial check
    await monitor();

    // Set up interval for regular checks
    setInterval(monitor, CHECK_INTERVAL);
  }
}

// Run the monitor
(async () => {
  const monitor = new MorphoMonitor();
  await monitor.monitorPosition();
})();