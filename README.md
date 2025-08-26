# Dota 2 Cup — сайт турнира (IRL призы от магазина)

Статический сайт турнира по Dota 2: регистрация (Netlify Forms), правила, сетка (Challonge embed), страница победителей.

## 🚀 Быстрый старт
1. **Отредактируйте** тексты и даты в `index.html`, `rules.html`.
2. **Настройте регистрацию:**
   - Если деплой на **Netlify** — ничего менять не нужно, форма `register.html` соберет заявки автоматически (Forms).
   - Иначе замените `action="success.html"` на URL вашей Google Form/серверного обработчика.
3. **Сетка:** откройте `bracket.html` и замените `YOUR_TOURNEY_HANDLE` на ID турнира с Challonge (модуль Embed).
4. **Победители:** заполните `data/winners.json` после турнира.
5. **Деплой:** залейте папку на Netlify/Vercel/GitHub Pages.

## 🧩 Структура
```
dota2-tournament-site/
├─ index.html          # главная (таймер, призы, CTA)
├─ register.html       # регистрация (Netlify Forms)
├─ success.html        # страница после отправки заявки
├─ rules.html          # правила турнира
├─ bracket.html        # встроенная сетка Challonge
├─ winners.html        # страница победителей (читается из data/winners.json)
├─ js/
│  └─ main.js          # меню, таймер
├─ data/
│  └─ winners.json     # данные победителей
└─ assets/
   ├─ hero.jpg         # замените своими изображениями
   ├─ prize1.jpg
   ├─ prize2.jpg
   └─ prize3.jpg
```

## 🛠 Что настроить под себя
- Название магазина и адрес — в `index.html`/`rules.html`.
- Дата старта — атрибут `data-start` в блоке `#countdown` на главной.
- Призы и изображения — раздел «Призы» на главной и файлы в `assets/`.
- Discord/Telegram ссылки — добавьте на главной и в `rules.html`.

## 💡 Советы по организации
- Сделайте постер турнира и прикрепите к главной (hero.jpg).
- Добавьте правила по 1x1/5x5, BO1/BO3 в `rules.html`.
- После создания турнира на Challonge — вставьте embed в `bracket.html`.
- Собирайте контактные e-mail/Discord для рассылки расписания.

Удачного турнира! 🎮
