
const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error("Set BOT_TOKEN in the hosting environment variables.");
  process.exit(1);
}

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const games = new Map();
const ratings = new Map();
let offset = 0;

async function call(method, data = {}) {
  const response = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  const result = await response.json();
  if (!result.ok) console.error(method, result.description);
  return result;
}

async function say(chat_id, text, extra = {}) {
  return call("sendMessage", {
    chat_id, text, ...extra
  });
}

function keyboard(rows) {
  return {
    reply_markup: {
      inline_keyboard: rows
    }
  };
}

async function handleMessage(message) {
  const text = message.text || "";
  const chat = message.chat;
  const user = message.from;
  if (!text.startsWith("/")) return;

  const command = text.split(/\s/)[0].split("@")[0];

  if (command === "/start") {
    return say(chat.id,
      "Привет! 🎲 Это Token Game — игра с цветными фишками.\n\n" +
      "Добавь меня в группу, чтобы создать игру командой /newgame."
    );
  }

  if (command === "/newgame") {
    if (chat.type === "private") {
      return say(chat.id, "Создавай игру в групповой переписке.");
    }

    if (games.has(chat.id)) {
      return say(chat.id, "В этой группе уже есть игра. Используй /endgame, чтобы завершить её.");
    }

    games.set(chat.id, {
      host: user.id,
      mode: null,
      players: new Map(),
      started: false,
      turn: 0
    });

    return say(chat.id, "🎲 **Создаём Token Game!**\nВыбери режим:",
      keyboard([[
        { text: "🔵 Режим 21", callback_data: "mode:21" },
        { text: "🟣 Режим 121", callback_data: "mode:121" }
      ]])
    );
  }

  if (command === "/join") {
    const game = games.get(chat.id);
    if (!game) return say(chat.id, "Сначала создай игру: /newgame");
    if (game.started) return say(chat.id, "Игра уже началась.");
    if (game.players.has(user.id)) return say(chat.id, "Ты уже в игре!");

    game.players.set(user.id, {
      id: user.id,
      name: user.first_name || "Игрок",
      score: 0,
      hand: [],
      throwsLeft: 1,
      mustDiscard: false
    });

    return say(chat.id, `✅ ${user.first_name} присоединился к игре!\nИгроков: ${game.players.size}`);
  }

  if (command === "/startgame") {
    const game = games.get(chat.id);
    if (!game) return say(chat.id, "Сначала создай игру: /newgame");
    if (user.id !== game.host) return say(chat.id, "Начать игру может её создатель.");
    if (!game.mode) return say(chat.id, "Сначала выбери режим.");
    if (game.players.size < 2) return say(chat.id, "Нужно хотя бы 2 игрока. Используйте /join.");

    game.started = true;
    game.turn = 0;
    const players = [...game.players.values()];
    await say(chat.id,
      `🚀 Игра началась!\nРежим: ${game.mode}\n` +
      `Цель: ${game.mode}\n` +
      `Очередь ходов: ${players.map(p => p.name).join(" → ")}\n\n` +
      "Каждый игрок должен открыть личный чат со мной и нажать Start."
    );
    return notifyTurn(chat.id, game);
  }

  if (command === "/score") {
    const game = games.get(chat.id);
    if (!game) return say(chat.id, "Сейчас нет активной игры.");
    const list = [...game.players.values()]
      .map(p => `• ${p.name}`)
      .join("\n") || "Пока никого нет.";
    return say(chat.id, `👥 Игроки:\n${list}`);
  }

  if (command === "/rating") {
    const list = [...ratings.entries()]
      .sort((a, b) => b[1].points - a[1].points)
      .slice(0, 20)
      .map(([id, r], i) => `${i + 1}. ${r.name}: ${r.points}`)
      .join("\n");
    return say(chat.id, "🏆 Рейтинг:\n" + (list || "Пока победителей нет."));
  }

  if (command === "/endgame") {
    const game = games.get(chat.id);
    if (!game) return say(chat.id, "Активной игры нет.");
    if (user.id !== game.host) return say(chat.id, "Завершить игру может её создатель.");
    games.delete(chat.id);
    return say(chat.id, "Игра завершена. Чтобы сыграть снова, введи /newgame.");
  }
}

async function notifyTurn(groupId, game) {
  if (!game.started) return;
  const players = [...game.players.values()];
  const player = players[game.turn % players.length];
  await say(groupId, `🎯 Сейчас ходит ${player.name}.`);
  await say(player.id,
    `Твой ход в режиме ${game.mode}!`,
    keyboard([
      [{ text: "🎲 Взять фишку", callback_data: `draw:${groupId}` }],
      [{ text: "⏭️ Пропустить ход", callback_data: `pass:${groupId}` }],
      [{ text: "🎯 Бросить фишку", callback_data: `throw:${groupId}` }]
    ])
  );
}

async function handleCallback(query) {
  const data = query.data || "";
  const user = query.from;
  await call("answerCallbackQuery", { callback_query_id: query.id });

  if (data.startsWith("mode:")) {
    const mode = data.split(":")[1];
    const message = query.message;
    const game = games.get(message.chat.id);
    if (!game) return;
    if (user.id !== game.host) {
      return say(user.id, "Выбрать режим может создатель игры.");
    }
    game.mode = Number(mode);
    return say(message.chat.id,
      `✅ Выбран режим ${mode}. Теперь игроки могут присоединиться командой /join.\nСоздатель может начать игру командой /startgame.`
    );
  }

  const [action, groupIdText] = data.split(":");
  const groupId = Number(groupIdText);
  const game = games.get(groupId);
  if (!game || !game.started) return say(user.id, "Игра уже завершена.");

  const players = [...game.players.values()];
  const player = players[game.turn % players.length];
  if (player.id !== user.id) return say(user.id, "Сейчас не твой ход.");

  if (action === "draw") {
    const max = game.mode === 21 ? 9 : 21;
    const value = Math.floor(Math.random() * max) + 1;
    const colors = ["🔴", "🔵", "🟡", "🟣"];
    player.hand.push({ value, color: colors[Math.floor(Math.random() * colors.length)] });
    const total = player.hand.reduce((sum, chip) => sum + chip.value, 0);
    await say(user.id,
      `Ты взял фишку ${player.hand[player.hand.length - 1].color} ${value}.\n` +
      `Сумма твоих фишек: ${total} / ${game.mode}.\n` +
      `Фишек у тебя: ${player.hand.length}.`
    );
    return;
  }

  if (action === "throw") {
    if (player.throwsLeft <= 0) return say(user.id, "Ты уже использовал бросок в этой игре.");
    const opponents = players.filter(p => p.id !== player.id);
    if (!opponents.length) return say(user.id, "Нет соперников.");
    return say(user.id, "Выбери соперника:", keyboard(
      opponents.map(p => [{ text: p.name, callback_data: `target:${groupId}:${p.id}` }])
    ));
  }

  if (action === "target") {
    const targetId = Number(data.split(":")[2]);
    const target = game.players.get(targetId);
    if (!target || target.id === player.id) return say(user.id, "Неверный соперник.");
    if (!player.hand.length) return say(user.id, "Сначала возьми хотя бы одну фишку.");
    const chip = player.hand.pop();
    target.hand.push(chip);
    player.throwsLeft--;
    await say(target.id, `🎯 В тебя бросили фишку ${chip.color} ${chip.value}!`);
    await say(groupId, `🎯 ${player.name} бросил фишку сопернику.`);
    return nextTurn(groupId, game);
  }

  if (action === "pass") {
    return nextTurn(groupId, game);
  }
}

async function nextTurn(groupId, game) {
  game.turn = (game.turn + 1) % game.players.size;
  await notifyTurn(groupId, game);
}

async function poll() {
  console.log("[bot] polling for updates");
  while (true) {
    try {
      const result = await call("getUpdates", {
        offset, timeout: 30,
        allowed_updates: ["message", "callback_query"]
      });
      if (!result.ok) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        continue;
      }
      for (const update of result.result) {
        offset = update.update_id + 1;
        if (update.message) await handleMessage(update.message);
        if (update.callback_query) await handleCallback(update.callback_query);
      }
    } catch (error) {
      console.error("[bot] polling error:", error.message);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

poll();

