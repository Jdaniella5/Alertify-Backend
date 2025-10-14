import dotenv from "dotenv";
dotenv.config({ path: "./.env" });
import axios from "axios";
import { db } from "../config/firebase.js";
import { collection, getDocs, addDoc, serverTimestamp } from "firebase/firestore";
import { sendEmail } from "./emailNotification.js";

// Supported tokens per oracle
const CHAINLINK_COINS = [
  "bitcoin", "ethereum", "solana", "litecoin", "cardano",
  "polkadot", "binancecoin", "ripple", "matic-network", "dogecoin",
  "shiba-inu", "avalanche-2", "chainlink", "stellar", "tron",
  "vechain", "filecoin", "cosmos", "algorand", "internet-computer", "aptos",
  "arbitrum", "optimism", "sui", "hedera-hashgraph", "the-graph",
  "aave", "synthetix-network-token", "pancakeswap-token", "uniswap"
];

const CHAINLINK_SYMBOLS = {
  "BTC": "bitcoin",
  "ETH": "ethereum",
  "SOL": "solana",
  "LTC": "litecoin",
  "ADA": "cardano",
  "DOT": "polkadot",
  "BNB": "binancecoin",
  "XRP": "ripple",
  "MATIC": "matic-network",
  "DOGE": "dogecoin",
  "SHIB": "shiba-inu",
  "AVAX": "avalanche-2",
  "LINK": "chainlink",
  "XLM": "stellar",
  "TRX": "tron",
  "VET": "vechain",
  "FIL": "filecoin",
  "ATOM": "cosmos",
  "ALGO": "algorand",
  "ICP": "internet-computer",
  "APT": "aptos",
  "ARB": "arbitrum",
  "OP": "optimism",
  "SUI": "sui",
  "HBAR": "hedera-hashgraph",
  "GRT": "the-graph",
  "AAVE": "aave",
  "SNX": "synthetix-network-token",
  "CAKE": "pancakeswap-token",
  "UNI": "uniswap"
};

const REDSTONE_SYMBOLS = [
  "ETH", "BTC", "SOL", "LINK", "ADA", "BNB", "XRP", 
  "DOGE", "UNI", "AVAX", "ATOM", "TRX", "ARB", "SUI", 
  "OP", "AAVE", "CRV"
];

// Add delay between requests to avoid rate limiting
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// API endpoints
const COINGECKO_API = "https://api.coingecko.com/api/v3/simple/price";
const REDSTONE_API = "https://api.redstone.finance/prices";
const PYTH_API = "https://hermes.pyth.network/v2/price_feeds";

// Pyth symbol mapping
const PYTH_SYMBOLS = {
  'BTC': 'Crypto.BTC/USD',
  'ETH': 'Crypto.ETH/USD',
  'ETHEREUM': 'Crypto.ETH/USD',
  'ADA': 'Crypto.ADA/USD',
  'DOGE': 'Crypto.DOGE/USD',
  'SOL': 'Crypto.SOL/USD'
  // Add more mappings as needed
};

// Get token symbol and check if supported
function getTokenInfo(asset) {
  const symbol = asset.toUpperCase();
  return {
    symbol,
    coingeckoId: TOKENS[symbol] || null,
    pythSymbol: PYTH_SYMBOLS[symbol] || null,
    isSupported: symbol in TOKENS
  };
}

// Fetch price from CoinGecko (Chainlink proxy)
// Get price from CoinGecko (used for Chainlink)
async function getChainlinkPrice(asset) {
  // Find the matching coin from COINS list
  const coin = COINS.find(c => c.symbol.toLowerCase() === asset.toLowerCase());
  if (!coin?.id) {
    console.log(`${asset} is not supported by Chainlink oracle`);
    return null;
  }

  try {
    await delay(1000);
    const response = await axios.get(`${COINGECKO_API}/simple/price?ids=${coin.id}&vs_currencies=usd`);
    const price = response.data?.[coin.id]?.usd;
    if (price) {
      console.log(`Chainlink price for ${asset}: $${price}`);
    }
    return price || null;
  } catch (error) {
    console.error(`CoinGecko API error for ${asset}:`, error.message);
    await delay(2000); // Extra delay on error
    return null;
  }
}

// Fetch price from RedStone
async function getRedstonePrice(asset) {
  const symbol = asset.toUpperCase();
  
  if (!REDSTONE_SYMBOLS.includes(symbol)) {
    console.log(`${asset} is not supported by RedStone oracle`);
    return null;
  }

  try {
    await delay(1000);
    const response = await axios.get(`${REDSTONE_API}?symbols=${symbol}`);
    const price = response.data?.[symbol]?.value;
    if (price) {
      console.log(`RedStone price for ${asset}: $${price}`);
    }
    return price || null;
  } catch (error) {
    console.error(`RedStone API error for ${asset}:`, error.message);
    await delay(2000); // Extra delay on error
    return null;
  }
}

// Fetch price from Pyth
async function getPythPrice(asset) {
  // Find the matching Pyth feed
  const feed = PYTH_FEEDS.find(f => f.symbol.toLowerCase() === asset.toLowerCase());
  if (!feed?.id) {
    console.log(`${asset} is not supported by Pyth oracle`);
    return null;
  }

  try {
    await delay(1000);
    const response = await axios.get(`${PYTH_API}/latest/price/${feed.id}`);
    if (response.data?.price) {
      const price = response.data.price.price * Math.pow(10, response.data.price.expo);
      console.log(`Pyth price for ${asset}: $${price}`);
      return price;
    }
    return null;
  } catch (error) {
    console.error(`Pyth API error for ${asset}:`, error.message);
    await delay(2000); // Extra delay on error
    return null;
  }
}

// Get price from specified oracle
async function getPrice(asset, oracle = "Chainlink") {
  switch (oracle) {
    case "Chainlink":
      return await getChainlinkPrice(asset);
    case "RedStone":
      return await getRedstonePrice(asset);
    case "Pyth":
      return await getPythPrice(asset);
    default:
      console.log(`Unknown oracle ${oracle}, falling back to Chainlink`);
      return await getChainlinkPrice(asset);
  }
}

async function checkPrices() {
  try {
    console.log("Starting price check...");
    const alertsRef = collection(db, "alerts");
    const snapshot = await getDocs(alertsRef);
    
    if (snapshot.empty) {
      console.log("No alerts found");
      return;
    }

    // Process alerts sequentially to avoid rate limiting
    for (const doc of snapshot.docs) {
      const alert = doc.data();
      const id = doc.id;
      
      try {
        // Log the alert details including oracle
        console.log(`Checking ${alert.asset} with ${alert.oracle || 'Chainlink'} oracle...`);
        
        // Use the oracle specified in the alert
        const price = await getPrice(alert.asset, alert.oracle);
        
        if (!price) {
          console.log(`No valid price found for ${alert.asset} using ${alert.oracle} oracle`);
          continue;
        }

        console.log(`${alert.asset} (${alert.oracle}): $${price}`);

        let triggered = false;
        if (alert.type === "Price Above" && price > alert.threshold) {
          triggered = true;
        } else if (alert.type === "Price Below" && price < alert.threshold) {
          triggered = true;
        }

        if (triggered && alert.notify.email) {
          console.log(`Alert triggered for ${alert.asset} using ${alert.oracle} oracle at $${price}`);
          
          await sendEmail({
            to: alert.notify.email,
            subject: `Price Alert for ${alert.asset.toUpperCase()} (${alert.oracle})`,
            text: `Price Alert Triggered!\n\n` +
                  `Asset: ${alert.asset.toUpperCase()}\n` +
                  `Oracle: ${alert.oracle}\n` +
                  `Current Price: $${price}\n` +
                  `Alert Type: ${alert.type}\n` +
                  `Threshold: $${alert.threshold}\n` +
                  `Time: ${new Date().toLocaleString()}`
          });

          // Debug oracle info
          console.log("Alert data:", {
            asset: alert.asset,
            oracle: alert.oracle,
            type: alert.type,
            threshold: alert.threshold
          });

          const historyRef = collection(db, "alertHistory");
          const historyData = {
            alertId: id,
            asset: alert.asset,
            oracle: alert.oracle,
            price: price,
            type: alert.type,
            threshold: alert.threshold,
            timestamp: serverTimestamp()
          };
          
          console.log("Storing alert history:", historyData);
          await addDoc(historyRef, historyData);
          
          console.log(`Alert triggered and notification sent for ${alert.asset}`);
        }
      } catch (error) {
        console.error(`Error processing ${alert.asset}:`, error.message);
      }
      
      // Add delay between processing each alert
      await delay(2000);
    }
  } catch (error) {
    console.error("Error checking prices:", error.message);
  }
}

export { checkPrices };
