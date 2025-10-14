import express from "express";
import fs from "fs";

const router = express.Router();
const FILE_PATH = "./alerts.json";

//create alert
router.post("/create", (req, res) => {
  const { coin, email, threshold, alertType } = req.body;

  if (!coin || !email || !threshold || !alertType)
    return res.status(400).json({ message: "All details are required" });

  const alerts = fs.existsSync(FILE_PATH)
    ? JSON.parse(fs.readFileSync(FILE_PATH))
    : [];

  alerts.push({ coin, email, threshold, alertType });
  fs.writeFileSync(FILE_PATH, JSON.stringify(alerts, null, 2));

  res.status(201).json({ message: "Alert created successfully!" });
});

export default router;
