const fs = require("fs");
const path = require("path");

const profile = (process.argv[2] || "").toLowerCase().trim();
const VALID = ["admin", "owner", "manager"];

if (!VALID.includes(profile)) {
  console.error("[Credentials Selector] Usage: node scripts/select-credentials.js <admin|owner|manager>");
  process.exit(1);
}

const targetCredsFile = path.resolve(__dirname, "..", "credentials", "android", "credentials." + profile + ".json");
const destCredsFile = path.resolve(__dirname, "..", "credentials.json");

if (!fs.existsSync(targetCredsFile)) {
  console.error("[Credentials Selector] ERROR: Local credentials file not found: " + targetCredsFile);
  process.exit(1);
}

try {
  const data = fs.readFileSync(targetCredsFile, "utf8");
  // Validate it is valid JSON
  JSON.parse(data);
  fs.writeFileSync(destCredsFile, data, "utf8");
  console.log("[Credentials Selector] Successfully activated local credentials for profile: " + profile.toUpperCase());
} catch (err) {
  console.error("[Credentials Selector] Failed to activate credentials:", err.message);
  process.exit(1);
}
