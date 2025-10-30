import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import alertRoutes from "./routes/alertRoutes.js";
import cron from 'node-cron';
import { checkPrices } from './utils/priceChecker.js';
import { recordPrices } from './utils/oraclePrices.js';


const app = express();
app.use(cors());
app.use(express.json());

// Routes
app.use("/api/alert", alertRoutes);

console.log('Setting up cron jobs...');

// Check prices every minute for alerts
cron.schedule("* * * * *", async () => {
  console.log(`Checking prices for alerts at ${new Date().toLocaleString()}`);
  try {
    await checkPrices();
    console.log("Price check completed. \n");
  } catch (err) {
    console.error("Alert price check failed:", err);
  }
});

// Separate cron: Record historical prices from all oracles hourly
cron.schedule("0 * * * *", async () => {
  console.log(`Recording oracle price history at ${new Date().toLocaleString()}`);
  try {
    await recordPrices();
    console.log("Oracle price history recorded successfully. \n");
  } catch (err) {
    console.error("Oracle price history recording failed:", err);
  }
});

console.log('Cron jobs configured successfully.');

const PORT = process.env.PORT || 1056;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
