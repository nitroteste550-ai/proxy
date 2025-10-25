// index.js
const express = require("express");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const fetch = require("node-fetch");
const bodyParser = require("body-parser");

const app = express();
app.use(helmet());
app.use(bodyParser.json({ limit: "150kb" }));

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PORT = process.env.PORT || 3000;
if (!WEBHOOK_URL) {
  console.error("Configure WEBHOOK_URL nas variáveis de ambiente.");
  process.exit(1);
}

// Rate limit por IP: bem agressivo (ajuste conforme necessário)
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 6,              // max 6 requests por IP por minuto
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Proteções adicionais em memória
const recentIps = new Map(); // ip -> { count, lastTs }

function sanitizeString(s, maxLen = 200) {
  if (typeof s !== "string") return "";
  s = s.replace(/[\x00-\x1F]/g, ""); // remove control chars
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

app.post("/report", async (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress || "unknown";
    const now = Date.now();
    const rec = recentIps.get(ip) || { count: 0, last: now };
    // simples backoff: se muitas requisições num curto periodo, rejeita
    if (now - rec.last < 5 * 1000) {
      rec.count = (rec.count || 0) + 1;
    } else {
      rec.count = 1;
    }
    rec.last = now;
    recentIps.set(ip, rec);
    if (rec.count > 10) return res.status(429).json({ ok: false, msg: "rate_limited" });

    const data = req.body;
    if (!data || typeof data !== "object") return res.status(400).json({ ok: false, msg: "invalid_body" });

    // validações estritas
    if (!Array.isArray(data.brainrots)) return res.status(400).json({ ok: false, msg: "invalid_brainrots" });
    const MAX_BRAINROTS = 25;
    const brainrots = data.brainrots.slice(0, MAX_BRAINROTS)
      .map(x => sanitizeString(String(x || ""), 100))
      .filter(x => x.length > 0);

    
    const playerCount = Number(data.playerCount) || 0;
    const privateServerLink = sanitizeString(String(data.privateServerLink || "N/A"), 200);
    const playerName = sanitizeString(String(data.playerName || "N/A"), 60);
    const description = (brainrots.length)
      ? ("**Brainrots Encontrados:**\n" + brainrots.join("\n"))
      : "Nenhum brainrot secreto detectado neste scan.";

    const payload = {
      username: sanitizeString(String(data.username || "Souza Logger"), 60),
      embeds: [{
        title: sanitizeString(String(data.title || "Auto Souza"), 80),
        description,
        color: 3447003,
        fields: [
          { name: "👤 Jogador", value: playerName, inline: true },
          { name: "👥 Jogadores no Server", value: String(playerCount), inline: true },
          { name: "🔗 Link do Server Privado", value: privateServerLink, inline: false },
        ],
        timestamp: new Date().toISOString()
      }]
    };

    // envia para o Discord
    const r = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      timeout: 10000
    });
    if (!r.ok) {
      console.warn("Discord webhook error:", r.status);
      return res.status(502).json({ ok: false, msg: "discord_error", status: r.status });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("proxy error:", err);
    return res.status(500).json({ ok: false, msg: "server_error" });
  }
});

// limpa mapa de IPs periodicamente (memória)
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of recentIps.entries()) {
    if (now - rec.last > 5 * 60 * 1000) recentIps.delete(ip);
  }
}, 60 * 1000);

app.listen(PORT, () => console.log("Proxy (no-auth) rodando na porta", PORT));
