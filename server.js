import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import alertRoutes from "./routes/alertRoutes.js";
import cron from "node-cron";
import { checkPrices } from "./utils/priceChecker.js";



const app = express();
app.use(cors());
app.use(express.json());

// Routes
app.use("/api/alert", alertRoutes);

cron.schedule("* * * * *", async () => {
  console.log(`Checking prices for alerts at ${new Date().toLocaleString()}`);
  try {
    await checkPrices();
    console.log("Price check completed. \n");
  } catch (err) {
    console.error("cron job failed:", err.message)
  }
});

const PORT = process.env.PORT || 1056;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
