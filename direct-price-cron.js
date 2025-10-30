import { initializeApp, getApp } from "firebase/app";
import { getFirestore, collection, addDoc } from "firebase/firestore";
import axios from 'axios';
import cron from 'node-cron';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Firebase
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

// Try to get existing app or initialize new one
let app;
try {
  app = getApp();
} catch {
  app = initializeApp(firebaseConfig);
}
const db = getFirestore(app);

//API Config
const COINGECKO_API = "https://api.coingecko.com/api/v3/simple/price";
const REDSTONE_API = "https://api.redstone.finance/prices";
const PYTH_API = "https://hermes.pyth.network";

//Coin Lists
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

//fetch from each oracle
async function fetchChainlinkPrices() {
  try {
    const ids = CHAINLINK_COINS.join(",");
    const response = await axios.get(`${COINGECKO_API}?ids=${ids}&vs_currencies=usd`, {
      timeout: 10000, // 10 second timeout
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Alertify Price Tracker'
      }
    });
    
    const prices = {};
    
    for (const coin of CHAINLINK_COINS) {
      try {
        if (response.data[coin]?.usd) {
          const price = Number(response.data[coin].usd);
          if (isFinite(price) && price > 0) {
            prices[coin] = {
              price: price,
              status: 'success',
              updated: new Date().toISOString()
            };
            continue;
          }
        }
        //either no price or invalid price
        prices[coin] = {
          price: null,
          error: 'No valid price available',
          status: 'failed',
          updated: new Date().toISOString()
        };
      } catch (coinError) {
        console.error(`Error processing ${coin}:`, coinError.message);
        prices[coin] = {
          price: null,
          error: `Processing error: ${coinError.message}`,
          status: 'failed',
          updated: new Date().toISOString()
        };
      }
    }
    
    return prices;
  } catch (error) {
    console.error('Chainlink (CoinGecko) API error:', error.message);
    //Return failed status for all coins instead of empty object
    return CHAINLINK_COINS.reduce((acc, coin) => {
      acc[coin] = {
        price: null,
        error: `API error: ${error.message}`,
        status: 'failed',
        updated: new Date().toISOString()
      };
      return acc;
    }, {});
  }
}

async function fetchRedstonePrices() {
  try {
    const symbols = REDSTONE_SYMBOLS.join(',');
    const response = await axios.get(`${REDSTONE_API}?symbols=${symbols}`);
    const prices = {};
    
    // RedStone returns an object with symbol keys
    for (const symbol of REDSTONE_SYMBOLS) {
      const price = response.data[symbol]?.value;
      if (price) {
        console.log(`RedStone ${symbol}: $${price}`);
        prices[symbol.toLowerCase()] = {
          price: Number(price),
          status: 'success'
        };
      } else {
        console.log(`RedStone ${symbol}: No price available`);
        prices[symbol.toLowerCase()] = {
          error: 'No price available',
          status: 'failed'
        };
      }
    }
    
    return prices;
  } catch (error) {
    console.error('RedStone API error:', error.message);
    return {};
  }
}

async function fetchPythPrices() {
  try {
    // 1. Get all available feeds
    const feedsResponse = await axios.get(`${PYTH_API}/v2/price_feeds`);
    const allFeeds = feedsResponse.data;

    // Define symbols we want to track (matching frontend)
    const targetSymbols = [
      "BTC", "ETH", "SOL", "LTC", "ADA", "DOT", "BNB", "XRP",
      "MATIC", "DOGE", "SHIB", "AVAX", "LINK", "XLM", "TRX",
      "VET", "FIL", "ATOM", "ALGO", "ICP", "APT", "ARB", "OP",
      "SUI", "HBAR", "GRT", "AAVE", "SNX", "CAKE", "UNI"
    ];

    // 2. Filter feeds for our target symbols and ensure USD pairs
    const selectedFeeds = allFeeds.filter(feed => {
      const base = feed.attributes?.base;
      const displaySymbol = feed.attributes?.display_symbol;
      // Only accept USD pairs and make sure symbol is in our target list
      return displaySymbol?.endsWith('/USD') && 
             (targetSymbols.includes(base) || targetSymbols.includes(displaySymbol.split('/')[0]));
    });

    if (selectedFeeds.length === 0) {
      console.log('No matching Pyth feeds found');
      return {};
    }

    // 3. Get latest prices for selected feeds
    const query = selectedFeeds.map(f => `ids[]=${f.id}`).join("&");
    const pricesResponse = await axios.get(`${PYTH_API}/v2/updates/price/latest?${query}`);
    const priceData = pricesResponse.data;

    const prices = {};

    // 4. Process each price update
    priceData.parsed.forEach(p => {
      const feed = selectedFeeds.find(f => f.id === p.id);
      const symbol = (feed?.attributes?.base || feed?.attributes?.display_symbol?.split("/")?.[0])?.toLowerCase();
      
      if (symbol) {
        const rawPrice = Number(p.price.price);
        const expo = Number(p.price.expo);
        const realPrice = rawPrice * Math.pow(10, expo);
        
        console.log(`Pyth ${symbol.toUpperCase()}: $${realPrice}`);
        
        prices[symbol] = {
          price: realPrice,
          confidence: Number(p.price.conf) * Math.pow(10, expo),
          publishTime: new Date(p.price.publish_time * 1000).toISOString(),
          status: 'success'
        };
      }
    });

    return prices;
  } catch (error) {
    console.error('Pyth API error:', error.message);
    return {};
  }
}

async function recordPrices() {
  console.log('\n Recording prices from all oracles at:', new Date().toISOString());
  
  try {
    // Fetch all prices in parallel
    const [chainlinkPrices, redstonePrices, pythPrices] = await Promise.all([
      fetchChainlinkPrices(),
      fetchRedstonePrices(),
      fetchPythPrices()
    ]);

    // Clean the data for Firebase
    const cleanPrices = (prices) => {
      const cleaned = {};
      for (const [key, value] of Object.entries(prices)) {
        if (!value) continue; // Skip null/undefined values
        
        cleaned[key] = {
          status: value.status || 'failed',
          price: value.price ? Number(value.price) : null,
          ...(value.confidence ? { confidence: Number(value.confidence) } : {}),
          ...(value.error ? { error: String(value.error) } : { error: null })
        };
      }
      return cleaned;
    };

    const priceData = {
      chainlink: cleanPrices(chainlinkPrices),
      redstone: cleanPrices(redstonePrices),
      pyth: cleanPrices(pythPrices),
      timestamp: new Date().toISOString(),
      created: Date.now()
    };

    console.log('\nStoring data in Firebase:', JSON.stringify(priceData, null, 2));

    // Store in Firebase
    await addDoc(collection(db, 'priceHistory'), priceData);
    console.log('Successfully recorded prices from all oracles\n');
    
    // Log some stats
    console.log('Stats:');
    console.log('Chainlink prices:', Object.keys(chainlinkPrices).length);
    console.log('RedStone prices:', Object.keys(redstonePrices).length);
    console.log('Pyth prices:', Object.keys(pythPrices).length);
    
  } catch (error) {
    console.error('Error recording prices:', error);
  }
}

// Handle process termination gracefully
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down price recording service...');
  process.exit(0);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
  // Don't exit the process, just log the error
});

// Run every hour 
const job = cron.schedule('0 * * * *', () => {
  recordPrices().catch(error => {
    console.error('Error in scheduled price recording:', error);
    // Don't exit the process on error, let the cron job continue
  });
}, {
  scheduled: true,
  timezone: "UTC"
});

// Start the cron job
job.start();

console.log('Price recording service started. Will update every hour on the hour.');

// Run initial price recording
await recordPrices().catch(error => {
  console.error('❌ Error in initial price recording:', error);
});

// This prevents the Node.js process from exiting
process.stdin.resume();