import { initializeApp, getApp } from "firebase/app";
import { getFirestore, collection, addDoc } from "firebase/firestore";
import axios from "axios";
import cron from "node-cron";
import dotenv from "dotenv";

dotenv.config();

//   FIREBASE INIT 
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
};

let app;
try {
  app = getApp();
} catch {
  app = initializeApp(firebaseConfig);
}
const db = getFirestore(app);

//  API CONFIG 
const COINGECKO_API = "https://api.coingecko.com/api/v3/simple/price";
const REDSTONE_API = "https://api.redstone.finance/prices";
const PYTH_FEEDS_API = "https://hermes.pyth.network/v2/price_feeds";
const PYTH_PRICE_API = "https://hermes.pyth.network/v2/updates/price/latest";

//  COIN & SYMBOL LISTS (from FE) 
const CHAINLINK_COINS = [
  "bitcoin", "ethereum", "solana", "litecoin", "cardano",
  "polkadot", "binancecoin", "ripple", "matic-network", "dogecoin",
  "shiba-inu", "avalanche-2", "chainlink", "stellar", "tron",
  "vechain", "filecoin", "cosmos", "algorand", "internet-computer", "aptos",
  "arbitrum", "optimism", "sui", "hedera-hashgraph", "the-graph",
  "aave", "synthetix-network-token", "pancakeswap-token", "uniswap"
];

const REDSTONE_SYMBOLS = [
  "BTC", "ETH", "SOL", "LTC", "ADA", "DOT", "BNB", "XRP",
  "MATIC", "DOGE", "SHIB", "AVAX", "LINK", "XLM", "TRX",
  "VET", "FIL", "ATOM", "ALGO", "ICP", "APT", "ARB", "OP",
  "SUI", "HBAR", "GRT", "AAVE", "SNX", "CAKE", "UNI", "CRV"
];

const PYTH_SYMBOLS = [
  "BTC", "ETH", "SOL", "LTC", "ADA", "DOT", "BNB", "XRP",
  "MATIC", "DOGE", "SHIB", "AVAX", "LINK", "XLM", "TRX",
  "VET", "FIL", "ATOM", "ALGO", "ICP", "APT", "ARB", "OP",
  "SUI", "HBAR", "GRT", "AAVE", "SNX", "CAKE", "UNI"
];

// FETCH FUNCTIONS

// Chainlink (CoinGecko)
async function fetchChainlinkPrices() {
  try {
    const ids = CHAINLINK_COINS.join(",");
    const response = await axios.get(`${COINGECKO_API}?ids=${ids}&vs_currencies=usd`, {
      timeout: 10000,
      headers: {
        "Accept": "application/json",
        "User-Agent": "Alertify Price Tracker",
      },
    });

    const prices = {};
    for (const coin of CHAINLINK_COINS) {
      const price = response.data[coin]?.usd;
      prices[coin.toUpperCase()] = {
        oracle: "Chainlink",
        price: price ?? null,
        status: price ? "Active" : "Failed",
        updated: new Date().toISOString(),
      };
    }

    return prices;
  } catch (error) {
    console.error("Chainlink API Error:", error.message);
    return CHAINLINK_COINS.reduce((acc, coin) => {
      acc[coin.toUpperCase()] = {
        oracle: "Chainlink",
        price: null,
        status: "Failed",
        updated: new Date().toISOString(),
      };
      return acc;
    }, {});
  }
}

// RedStone
async function fetchRedstonePrices() {
  try {
    const symbols = REDSTONE_SYMBOLS.join(",");
    const response = await axios.get(`${REDSTONE_API}?symbols=${symbols}`);
    const data = response.data;

    const prices = {};
    for (const symbol of REDSTONE_SYMBOLS) {
      const price = data[symbol]?.value;
      const timestamp = data[symbol]?.timestamp;

      prices[symbol] = {
        oracle: "RedStone",
        price: price ?? null,
        status: price ? "Active" : "Failed",
        updated: timestamp ? new Date(timestamp).toISOString() : new Date().toISOString(),
      };
    }

    return prices;
  } catch (error) {
    console.error("RedStone API Error:", error.message);
    return REDSTONE_SYMBOLS.reduce((acc, sym) => {
      acc[sym] = {
        oracle: "RedStone",
        price: null,
        status: "Failed",
        updated: new Date().toISOString(),
      };
      return acc;
    }, {});
  }
}

// Pyth
async function fetchPythPrices() {
  try {
    //  Get available feeds
    const feedsRes = await axios.get(PYTH_FEEDS_API);
    const feeds = feedsRes.data;

    // Filter to target symbols
    const selected = feeds.filter(
      (f) =>
        PYTH_SYMBOLS.includes(f.attributes?.base) ||
        PYTH_SYMBOLS.includes(f.attributes?.display_symbol?.split("/")?.[0])
    );

    if (selected.length === 0) return {};

    // Fetch latest prices for selected IDs
    const query = selected.map((f) => `ids[]=${f.id}`).join("&");
    const pricesRes = await axios.get(`${PYTH_PRICE_API}?${query}`);
    const prices = pricesRes.data;

    // Format results
    const formatted = {};
    prices.parsed.forEach((p) => {
      const feed = selected.find((f) => f.id === p.id);
      const asset = feed?.attributes?.base || p.id;
      const rawPrice = Number(p.price.price);
      const expo = Number(p.price.expo);
      const realPrice = rawPrice * Math.pow(10, expo);

      formatted[asset.toUpperCase()] = {
        oracle: "Pyth",
        price: realPrice,
        status: "Active",
        updated: new Date(p.price.publish_time * 1000).toISOString(),
      };
    });

    return formatted;
  } catch (error) {
    console.error("Pyth API Error:", error.message);
    return PYTH_SYMBOLS.reduce((acc, sym) => {
      acc[sym] = {
        oracle: "Pyth",
        price: null,
        status: "Failed",
        updated: new Date().toISOString(),
      };
      return acc;
    }, {});
  }
}

//  MAIN JOB
export async function recordPrices() {
  console.log("\n Recording oracle prices:", new Date().toISOString());

  try {
    const [chainlink, redstone, pyth] = await Promise.all([
      fetchChainlinkPrices(),
      fetchRedstonePrices(),
      fetchPythPrices(),
    ]);

    const priceData = {
      chainlink,
      redstone,
      pyth,
      timestamp: new Date().toISOString(),
      created: Date.now(),
    };

    console.log(" Storing price snapshot in Firestore...");
    await addDoc(collection(db, "priceHistory"), priceData);

    console.log(" Successfully recorded prices.\n");
  } catch (error) {
    console.error(" Error recording prices:", error);
  }
}
