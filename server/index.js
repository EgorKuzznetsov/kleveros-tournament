// server/index.js
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

// ===== ЛОГИ СТАРТА =====
console.log("KEY:", (process.env.CHALLONGE_API_KEY || "").slice(0, 6) + "...");
console.log("TOURNEY:", process.env.CHALLONGE_TOURNEY);

// ===== Rate limit: не более 3 заявок в минуту с одного IP =====
const registerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many requests. Try again later." },
});
app.use("/api/register", registerLimiter);

// ===== Хелперы (нормализация/валидация) =====
function cleanStr(s = "") {
  return String(s || "").trim().replace(/\s+/g, " ");
}
function hasUrl(s = "") {
  return /(https?:\/\/|t\.me\/|@everyone|@here)/i.test(s);
}
function tooManyRepeats(s = "") {
  return /(.)\1{3,}/i.test(s); // aaaa, !!!! и т.д.
}
function isBadInput(s = "") {
  const v = cleanStr(s);
  if (!v) return true;
  if (v.length > 40) return true;
  if (hasUrl(v)) return true;
  if (tooManyRepeats(v)) return true;
  return false;
}
function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// простая память-кулдаун по контакту (telegram/email/ip)
const lastByContact = new Map(); // key -> timestamp
function tooSoon(contact, ms = 30_000) {
  const now = Date.now();
  const t = lastByContact.get(contact) || 0;
  const ok = now - t > ms;
  if (ok) lastByContact.set(contact, now);
  return !ok;
}

// ===== Опционально: hCaptcha-проверка =====
// добавь HCAPTCHA_SECRET в переменные окружения, чтобы включить
async function verifyHCaptcha(token) {
  const secret = process.env.HCAPTCHA_SECRET;
  if (!secret) return true; // если не настроено — пропускаем
  if (!token) return false;
  const resp = await fetch("https://hcaptcha.com/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret, response: token }),
  });
  const data = await resp.json();
  return !!data.success;
}

// ===== Служебный =====
app.get("/", (_, res) => res.send("API ok"));

// ===== Challonge API =====
async function addTeamToChallonge({ teamName, misc }) {
  const tourney = process.env.CHALLONGE_TOURNEY;
  const key = process.env.CHALLONGE_API_KEY;
  if (!key) throw new Error("CHALLONGE_API_KEY is missing");
  if (!tourney) throw new Error("CHALLONGE_TOURNEY is missing");

  const url = `https://api.challonge.com/v1/tournaments/${tourney}/participants.json?api_key=${key}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    // В participant НЕ указываем email — чтобы не было "Pending invitation"
    body: JSON.stringify({ participant: { name: teamName, misc } }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Challonge API error ${resp.status}: ${text}`);
  }
  return await resp.json();
}

// ===== Уведомление в Telegram =====
async function notifyTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn("Telegram env not set");
    return;
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
  const t = await resp.text();
  console.log("Telegram resp:", resp.status, t);
}

// ===== Тест ручка на телегу =====
app.get("/api/test-telegram", async (req, res) => {
  try {
    await notifyTelegram(req.query.text || "Test from server");
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ===== Соло-заявки складываем в файл (для ручной компоновки команд) =====
async function saveSoloRequest(data) {
  const path = "./solo_queue.json";
  let curr = [];
  try {
    const raw = await fs.readFile(path, "utf8");
    curr = JSON.parse(raw);
  } catch {
    /* файла пока нет — ок */
  }
  curr.push({ ...data, createdAt: new Date().toISOString() });
  await fs.writeFile(path, JSON.stringify(curr, null, 2), "utf8");
}

// ======== РЕГИСТРАЦИЯ ========
app.post("/api/register", async (req, res) => {
  try {
    const {
      join_type, // 'team' | 'solo'
      format, // произвольная инфа с формы
      team_or_nick, // иногда фронт шлёт это поле
      team_name,
      player_nick,
      roster_text,
      captain_instagram,
      messenger,
      email,
      phone,
      mmr,
      // hCaptcha
      "h-captcha-response": hCaptchaToken,
      // honeypot
      honeypot,
    } = req.body;

    // ===== Honeypot: если бот заполнил скрытое поле — отбой
    if (honeypot) {
      return res.status(400).json({ ok: false, error: "Spam detected" });
    }

    // ===== hCaptcha (если включено переменной окружения)
    const captchaOk = await verifyHCaptcha(hCaptchaToken);
    if (!captchaOk) {
      return res.status(400).json({ ok: false, error: "Captcha failed" });
    }

    // ===== Нормализация/валидация
    const joinType = (join_type || "").toLowerCase();
    const nick = cleanStr(player_nick);
    const team = cleanStr(team_or_nick || team_name);
    const tg = cleanStr(messenger);
    const mail = cleanStr(email);

    // Персональный кулдаун: 1 заявка / 30 сек с одного контакта (или IP)
    const cooldownKey = tg || mail || req.ip;
    if (tooSoon(cooldownKey, 30_000)) {
      return res
        .status(429)
        .json({ ok: false, error: "Будь ласка, спробуйте ще раз трохи пізніше." });
    }

    if (joinType === "solo") {
      if (isBadInput(nick))
        return res.status(400).json({ ok: false, error: "Некоректний нік" });
      if (!tg || tg.length < 3 || tg.length > 50)
        return res
          .status(400)
          .json({ ok: false, error: "Вкажіть коректний Telegram" });
      const mmrNum = Number(mmr);
      if (!Number.isFinite(mmrNum) || mmrNum < 0 || mmrNum > 15000) {
        return res.status(400).json({ ok: false, error: "Некоректний MMR" });
      }
    } else {
      // team
      if (isBadInput(team))
        return res
          .status(400)
          .json({ ok: false, error: "Некоректна назва команди" });
      if (isBadInput(nick))
        return res
          .status(400)
          .json({ ok: false, error: "Некоректний нік капітана" });
      if (!tg || tg.length < 3 || tg.length > 50)
        return res
          .status(400)
          .json({ ok: false, error: "Вкажіть коректний Telegram" });
      if ((roster_text || "").length > 500)
        return res
          .status(400)
          .json({ ok: false, error: "Занадто довгий список складу" });
    }

    // ===== ДАЛЕЕ — БОЕВАЯ ЛОГИКА =====
    if (joinType === "team") {
      // Сохраняем команду в Challonge (без email -> не будет "invitation pending")
      const misc = JSON.stringify({
        format,
        captain_instagram,
        messenger: tg,
        phone,
        roster: cleanStr(roster_text || ""),
      });

      const added = await addTeamToChallonge({
        teamName: team,
        misc,
      });

      // Уведомление в телегу
      await notifyTelegram(
        `🟢 <b>Нова команда</b>\n` +
          `Команда: <b>${escapeHtml(team)}</b>\n` +
          `Капітан: ${escapeHtml(nick)}\n` +
          `Інст: ${escapeHtml(captain_instagram || "-")}\n` +
          `TG: ${escapeHtml(tg || "-")}${phone ? "  Тел: " + escapeHtml(phone) : ""}\n` +
          (roster_text
            ? `Склад: ${escapeHtml(cleanStr(roster_text))}`
            : "")
      );

      return res.json({ ok: true, participant: added });
    } else {
      // SOLO: в очередь + уведомление (в сетку не добавляем)
      const payload = {
        nick,
        instagram: captain_instagram,
        messenger: tg,
        email: mail,
        phone,
        mmr: mmr ? Number(mmr) : null,
      };

      await saveSoloRequest(payload);

      await notifyTelegram(
        `🟡 <b>Соло-заявка</b>\n` +
          `Нік: <b>${escapeHtml(nick)}</b>\n` +
          `MMR: ${payload.mmr ?? "-"}\n` +
          `TG: ${escapeHtml(tg || "-")}\n` +
          `Email: ${escapeHtml(mail || "-")}  Тел: ${escapeHtml(phone || "-")}`
      );

      return res.json({ ok: true, queued: true });
    }
  } catch (e) {
    console.error(e);
    return res.status(400).json({ ok: false, error: e.message });
  }
});

// ===== СТАРТ =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
