import dotenv from "dotenv";
dotenv.config({ path: "./.env" });
import axios from "axios";
import { serverTimestamp } from "firebase/firestore";
import { db } from "../config/firebase.js";
import { collection, getDocs, addDoc, serverTimestamp } from "firebase/firestore";
import { sendEmail } from "./emailNotification.js";

// Supported tokens per oracle
export const CHAINLINK_COINS = [
  "bitcoin", "ethereum", "solana", "litecoin", "cardano",
  "polkadot", "binancecoin", "ripple", "matic-network", "dogecoin",
  "shiba-inu", "avalanche-2", "chainlink", "stellar", "tron",
  "vechain", "filecoin", "cosmos", "algorand", "internet-computer", "aptos",
  "arbitrum", "optimism", "sui", "hedera-hashgraph", "the-graph",
  "aave", "synthetix-network-token", "pancakeswap-token", "uniswap"
];

// Pyth price feed IDs
export const PYTH_FEEDS = [
  { symbol: 'btc', id: 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43' },
  { symbol: 'eth', id: 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace' },
  { symbol: 'sol', id: 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d' },
  { symbol: 'ada', id: '7c3557a34632c1c8556cbcf5d627bb6fb87fb11d2ad49c2b83e9206020dc2eb8' },
  { symbol: 'bnb', id: '2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d1101c4f' },
  { symbol: 'xrp', id: 'ec5d399846a9209f3fe5881d80995ca7f6058a76b0e44cd5cbad4f68c46c2174' },
  { symbol: 'matic', id: '5de33a9112c2b700c618d803e5c3a862402939a34c2c0a6d09055876213ce5ad' }
];

export const CHAINLINK_SYMBOLS = {
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

export const REDSTONE_SYMBOLS = [
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
  const symbol = asset.toLowerCase();
  const coingeckoId = CHAINLINK_SYMBOLS[symbol.toUpperCase()];
  
  if (!coingeckoId) {
    console.log(`${asset} is not supported by Chainlink oracle`);
    return null;
  }

  try {
    await delay(2000); // Longer delay for CoinGecko rate limits
    const response = await axios.get(`${COINGECKO_API}/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd`);
    const price = response.data?.[coingeckoId]?.usd;
    if (price) {
      console.log(`Chainlink price for ${asset}: $${price}`);
    }
    return price || null;
  } catch (error) {
    if (error.response?.status === 429) {
      console.log(`CoinGecko rate limit hit for ${asset}, waiting 5 seconds...`);
      await delay(5000);
      return getChainlinkPrice(asset); // Retry once
    }
    console.error(`CoinGecko API error for ${asset}:`, error.message);
    await delay(2000);
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
export async function getPrice(asset, oracle = "Chainlink") {
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

// Export the individual price functions
export { getChainlinkPrice, getRedstonePrice, getPythPrice };

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
            asset: alert.asset || "unknown",
            oracle: alert.oracle || "unknown",
            price: Number.isFinite(price) ? price : 0,
            type: alert.type || "unknown",
            threshold: Number.isFinite(alert.threshold) ? alert.threshold: 0,
            timestamp: serverTimestamp()
          };
          
          // Remove any undefined or NaN
const cleanData = Object.fromEntries(
  Object.entries(historyData).filter(([_, v]) => v !== undefined && v !== null && !Number.isNaN(v))
);
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
