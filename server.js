import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// --- DATABASE ---
const db = new Database("sms.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS sms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_number TEXT,
    to_number TEXT,
    body TEXT,
    provider_raw TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// --- MIDDLEWARE ---
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// --- OTP EXTRACTION ---
function extractOtp(body) {
  if (!body) return null;
  const clean = body.replace(/\s+/g, " ");

  const regex = /\b(\d{3}[-\s]?\d{3}|\d{4,8})\b/;
  const match = clean.match(regex);
  return match ? match[0] : null;
}

// --- HEALTH CHECK ---
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// --- WEBHOOK FOR SMS PROVIDER ---
app.post("/webhook/sms", (req, res) => {
  try {
    const payload = req.body.data?.payload || req.body;

    const from = payload.from || payload.from_number || payload.msisdn || "unknown";
    const to = payload.to || payload.to_number || payload.to_msisdn || "unknown";
    const text = payload.text || payload.body || payload.message || "";

    const stmt = db.prepare(`
      INSERT INTO sms (from_number, to_number, body, provider_raw)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(from, to, text, JSON.stringify(req.body));

    console.log("📩 SMS received:", { from, to, text });

    res.status(200).json({ received: true });
  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// --- DASHBOARD ---
app.get("/", (req, res) => {
  const stmt = db.prepare(`
    SELECT id, from_number, to_number, body, created_at
    FROM sms
    ORDER BY created_at DESC
    LIMIT 100
  `);

  const rows = stmt.all();

  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8" />
    <title>UK SMS Inbox</title>
    <style>
      body {
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #050816;
        color: #e5e7eb;
        margin: 0;
        padding: 20px;
      }
      h1 {
        margin-bottom: 10px;
      }
      .subtitle {
        color: #9ca3af;
        margin-bottom: 20px;
      }
      table {
        border-collapse: collapse;
        width: 100%;
        background: #0b1120;
        border-radius: 12px;
        overflow: hidden;
      }
      th, td {
        padding: 10px 12px;
        border-bottom: 1px solid #111827;
        font-size: 14px;
      }
      th {
        background: #111827;
        text-align: left;
      }
      tr:nth-child(even) {
        background: #020617;
      }
      .otp {
        font-weight: bold;
        padding: 2px 6px;
        border-radius: 6px;
        background: #1d4ed8;
        color: white;
        display: inline-block;
        margin-left: 6px;
      }
      .badge {
        display: inline-block;
        font-size: 11px;
        padding: 2px 6px;
        border-radius: 999px;
        background: #111827;
        color: #9ca3af;
        margin-left: 8px;
      }
      .meta {
        font-size: 12px;
        color: #9ca3af;
      }
      .code {
        font-family: "SF Mono", ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      }
      .header-row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 12px;
      }
      .pill {
        border-radius: 999px;
        border: 1px solid #374151;
        padding: 4px 10px;
        font-size: 12px;
        color: #9ca3af;
      }
      a {
        color: #60a5fa;
        text-decoration: none;
      }
    </style>
  </head>
  <body>
    <div class="header-row">
      <div>
        <h1>UK SMS Inbox</h1>
        <div class="subtitle">Your private verification line — if the code lands, it lives here.</div>
      </div>
      <div class="pill">
        Last ${rows.length} messages · <a href="/">Refresh</a>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>From → To</th>
          <th>Message</th>
          <th>Received At</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map((row) => {
            const otp = extractOtp(row.body);
            return `
              <tr>
                <td class="code">#${row.id}</td>
                <td>
                  <div class="code">${row.from_number}</div>
                  <div class="meta">→ ${row.to_number}</div>
                </td>
                <td>
                  <span>${row.body.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</span>
                  ${
                    otp
                      ? `<span class="otp">${otp}</span><span class="badge">OTP</span>`
                      : ""
                  }
                </td>
                <td class="meta">${row.created_at}</td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>

  </body>
  </html>
  `;

  res.send(html);
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
