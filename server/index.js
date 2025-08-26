import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs/promises";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

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
