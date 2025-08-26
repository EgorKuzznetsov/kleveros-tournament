import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs/promises";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
const registerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Слишком много запросов. Попробуйте позже." }
});
app.use("/api/register", registerLimiter);
const lastByContact = new Map(); // key: messenger|email -> timestamp
function tooSoon(contact, ms = 30_000) {
  const now = Date.now();
  const t = lastByContact.get(contact) || 0;
  const ok = now - t > ms;
  if (ok) lastByContact.set(contact, now);
  return !ok;
}
function cleanStr(s = "") {
  return String(s || "").trim().replace(/\s+/g, " ");
}
function hasUrl(s="") { return /(https?:\/\/|t\.me\/|@everyone|@here)/i.test(s); }
function tooManyRepeats(s="") { return /(.)\1{3,}/i.test(s); } // aaaa / !!!! и т.п.

function isBadInput(s="") {
  const v = cleanStr(s);
  if (!v) return true;
  if (v.length > 40) return true;
  if (hasUrl(v)) return true;
  if (tooManyRepeats(v)) return true;
  return false;
}
console.log("KEY:", (process.env.CHALLONGE_API_KEY || "").slice(0, 6) + "...");
console.log("TOURNEY:", process.env.CHALLONGE_TOURNEY);

app.get("/", (_, res) => res.send("API ok"));

// --- Challonge: добавить команду как участника (name = название команды) ---
async function addTeamToChallonge({ teamName, misc }) {
  const tourney = process.env.CHALLONGE_TOURNEY;
  const key = process.env.CHALLONGE_API_KEY;
  if (!key) throw new Error("CHALLONGE_API_KEY is missing");
  if (!tourney) throw new Error("CHALLONGE_TOURNEY is missing");

  const url = `https://api.challonge.com/v1/tournaments/${tourney}/participants.json?api_key=${key}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ participant: { name: teamName, misc } }) // без email -> не будет "Pending invitation"
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Challonge API error ${resp.status}: ${text}`);
  }
  return await resp.json();
}

// --- Telegram уведомления ---
async function notifyTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set");
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" })
  });
  const body = await resp.text();
  console.log("Telegram resp:", resp.status, body);
  if (!resp.ok) throw new Error(`Telegram error ${resp.status}: ${body}`);
}

// тест ТГ: GET /api/test-telegram?text=hi
app.get("/api/test-telegram", async (req, res) => {
  try {
    await notifyTelegram(req.query.text || "Test from server");
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// локальный бэкап соло-заявок
async function saveSoloRequest(data) {
  const path = "./solo_queue.json";
  let arr = [];
  try { arr = JSON.parse(await fs.readFile(path, "utf8")); } catch {}
  arr.push({ ...data, createdAt: new Date().toISOString() });
  await fs.writeFile(path, JSON.stringify(arr, null, 2), "utf8");
}

// ---- основной маршрут ----
app.post("/api/register", async (req, res) => {
  try {
    console.log("Incoming register:", req.body);

    const {
      join_type,            // 'team' | 'solo'
      team_or_nick,         // команда или ник
      messenger,            // Telegram
      email, phone,         // опц.
      mmr,                  // для solo
      player_nick,          // для информации (капитан/игрок)
      team_name,            // для информации
      roster_text           // опц. состав команды текстом
    } = req.body;
if (req.body.honeypot) {
      return res.status(400).json({ ok:false, error:"Spam detected" });
    }

    // Нормализация
    const joinType = (join_type || "").toLowerCase();
    const nick = cleanStr(player_nick);
    const team = cleanStr(team_or_nick || team_name);
    const tg   = cleanStr(messenger);
    const mail = cleanStr(email);

    // Персональный кулдаун: не чаще 1 заявки / 30 сек с одного контакта
    const cooldownKey = tg || mail || req.ip;
    if (tooSoon(cooldownKey, 30_000)) {
      return res.status(429).json({ ok:false, error:"Пожалуйста, подождите немного и отправьте снова." });
    }

    // Базовая валидация
    if (joinType === "solo") {
      if (isBadInput(nick)) return res.status(400).json({ ok:false, error:"Некоректний нік" });
      if (!tg || tg.length < 3 || tg.length > 50) return res.status(400).json({ ok:false, error:"Вкажіть коректний Telegram" });
      const mmrNum = Number(mmr);
      if (!Number.isFinite(mmrNum) || mmrNum < 0 || mmrNum > 15000) {
        return res.status(400).json({ ok:false, error:"Некоректний MMR" });
      }
    } else {
      // team
      if (isBadInput(team)) return res.status(400).json({ ok:false, error:"Некоректна назва команди" });
      if (isBadInput(nick)) return res.status(400).json({ ok:false, error:"Некоректний нік капітана" });
      if (!tg || tg.length < 3 || tg.length > 50) return res.status(400).json({ ok:false, error:"Вкажіть коректний Telegram" });
      if ((roster_text || "").length > 500) return res.status(400).json({ ok:false, error:"Занадто довгий список складу" });
    }
    const type = String(join_type || "").trim().toLowerCase();

    if (!team_or_nick?.trim())
      return res.status(400).json({ ok: false, error: "Название команды / ник обязателен" });
    if (!messenger?.trim())
      return res.status(400).json({ ok: false, error: "Укажи Telegram для связи" });

    if (type === "team") {
      const misc = JSON.stringify({
        captain_nick: player_nick || null,
        messenger,
        phone: phone || null,
        email: email || null,
        roster_text: roster_text || null
      });
      const added = await addTeamToChallonge({ teamName: team_or_nick.trim(), misc });

      await notifyTelegram(
        `🟢 <b>Новая команда</b>\n` +
        `Команда: <b>${team_or_nick.trim()}</b>\n` +
        `Капитан: ${player_nick || "-"}\n` +
        `TG: ${messenger}${phone ? " | Тел: " + phone : ""}${email ? " | Email: " + email : ""}\n` +
        (roster_text ? `Состав: ${roster_text}` : "")
      );

      return res.json({ ok: true, participant: added });
    }

   if (type === "solo") {
  const mmrNum = mmr !== undefined && String(mmr).trim() !== "" ? Number(mmr) : null;
  if (mmrNum === null || Number.isNaN(mmrNum) || mmrNum < 0)
    return res.status(400).json({ ok: false, error: "Укажи корректный MMR (число ≥ 0)" });

  const payload = {
    nick: team_or_nick.trim(),
    messenger,
    email: email || null,
    phone: phone || null,
    mmr: mmrNum
  };

  // Сохраним — это быстро
  await saveSoloRequest(payload);

  // 👉 СРАЗУ отдать ответ клиенту
  res.json({ ok: true, queued: true });

  // 👉 Уведомление — фоном
  notifyTelegram(
    `🟡 <b>Соло-заявка</b>\n` +
    `Ник: <b>${payload.nick}</b>\n` +
    `MMR: ${payload.mmr}\n` +
    `TG: ${payload.messenger}\n` +
    `Email: ${payload.email || "-"} | Тел: ${payload.phone || "-"}`
  ).catch(console.error);

  return; // ответ уже отправлен
}

    return res.status(400).json({ ok: false, error: "Неверный join_type (team/solo)" });
  } catch (e) {
    console.error(e);
    res.status(400).json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
