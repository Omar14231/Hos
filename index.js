require('./keep_alive');
const {
  Client, GatewayIntentBits, PermissionFlagsBits,
  ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ]
});

// ===================== الإعدادات =====================
const TOKEN = process.env.DISCORD_TOKEN;

const ROLE_MUKHTAR   = '1474552028545028292';
const ROLE_CARSELLER = '1514665270269055116';
const ROLE_GAS       = '1514666531647131841';
const ROLE_BUILDER   = '1514672754123739186';

let CAT_HOMES_ID = null;
let CAT_CITY_ID  = null;
let CAT_SHOPS_ID = null;
let CAT_GANG_ID  = null;

// ===================== الذاكرة =====================
const homes        = new Map(); // userId -> channelId
const carOwners    = new Set(); // userId اشترى سيارة
const fuelMap      = new Map(); // userId -> { count, max }
const dirtyHomes   = new Map(); // channelId -> timeout

// ===================== إنشاء الكاتيغوريز =====================
async function ensureCategories(guild) {
  if (!CAT_HOMES_ID) {
    let c = guild.channels.cache.find(x => x.type === ChannelType.GuildCategory && x.name.includes('البيوت'));
    if (!c) c = await guild.channels.create({ name: '🏠 البيوت', type: ChannelType.GuildCategory });
    CAT_HOMES_ID = c.id;
  }
  if (!CAT_CITY_ID) {
    let c = guild.channels.cache.find(x => x.type === ChannelType.GuildCategory && x.name.includes('المدينة') && !x.name.includes('العصابة'));
    if (!c) c = await guild.channels.create({ name: '🌆 المدينة', type: ChannelType.GuildCategory });
    CAT_CITY_ID = c.id;
  }
  if (!CAT_SHOPS_ID) {
    let c = guild.channels.cache.find(x => x.type === ChannelType.GuildCategory && x.name.includes('المحلات'));
    if (!c) c = await guild.channels.create({ name: '🏪 المحلات', type: ChannelType.GuildCategory });
    CAT_SHOPS_ID = c.id;
  }
  if (!CAT_GANG_ID) {
    let c = guild.channels.cache.find(x => x.type === ChannelType.GuildCategory && x.name.includes('العصابة'));
    if (!c) c = await guild.channels.create({ name: '🕶️ مدينة العصابة', type: ChannelType.GuildCategory });
    CAT_GANG_ID = c.id;
  }
}

// ===================== إنشاء رومات المدينة والعصابة (مخفية) =====================
async function ensureCityRooms(guild) {
  await ensureCategories(guild);

  const cityRooms = [
    '✧┇💭┇✧・شات',
    '✧┇🎟┇✧・الدعم・الفني',
    '✧┇🚗┇✧・متجر・السيارة',
    '✧┇🪧┇✧・شرح・الفكرة',
    '✧┇🚭┇✧・محطة・بنزين',
    '✧┇⌛┇✧・منطقة・في・صيانه',
  ];

  for (const name of cityRooms) {
    const exists = guild.channels.cache.find(c => c.name === name && c.parentId === CAT_CITY_ID);
    if (!exists) {
      await guild.channels.create({
        name, type: ChannelType.GuildText, parent: CAT_CITY_ID,
        permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }]
      });
    }
  }

  const gangRooms = [
    '✧┇🕶┇✧・شات',
    '✧┇🏚┇✧・مكان・مجهور',
  ];

  for (const name of gangRooms) {
    const exists = guild.channels.cache.find(c => c.name === name && c.parentId === CAT_GANG_ID);
    if (!exists) {
      await guild.channels.create({
        name, type: ChannelType.GuildText, parent: CAT_GANG_ID,
        permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }]
      });
    }
  }
}

// ===================== إنشاء بيت للعضو =====================
async function createHome(member) {
  if (homes.has(member.id)) return;
  const guild = member.guild;
  await ensureCategories(guild);

  const channel = await guild.channels.create({
    name: `✧┇🏡┇✧・بيت・${member.user.username}`,
    type: ChannelType.GuildText,
    parent: CAT_HOMES_ID,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
    ]
  });

  homes.set(member.id, channel.id);
  await channel.send(
    `> مرحباً بك يا <@${member.id}> 👋\n> إذا كنت تود أن تكتشف المدينة يرجا كتب أمر **!انتقال**`
  );
  startDirtyTimer(channel);
}

// ===================== مؤقت البيت الوسخ (ساعة بدون كلام) =====================
function startDirtyTimer(channel) {
  if (dirtyHomes.has(channel.id)) clearTimeout(dirtyHomes.get(channel.id));
  const t = setTimeout(async () => {
    try {
      const msg = await channel.send('> 🧹 بيتك اتسخ! ضع علامة المكنسة لمسح الرسالة.');
      const collector = msg.createReactionCollector({
        filter: (r, u) => r.emoji.name === '🧹' && !u.bot,
        time: 600_000
      });
      collector.on('collect', () => msg.delete().catch(() => {}));
    } catch {}
  }, 3_600_000);
  dirtyHomes.set(channel.id, t);
}

// ===================== إخفاء / إظهار البيت =====================
async function hideHome(guild, userId) {
  const ch = guild.channels.cache.get(homes.get(userId));
  if (!ch) return;
  await ch.permissionOverwrites.edit(guild.roles.everyone.id, { ViewChannel: false });
  await ch.permissionOverwrites.edit(userId, { ViewChannel: false });
}

async function showHome(guild, userId) {
  const ch = guild.channels.cache.get(homes.get(userId));
  if (!ch) return;
  await ch.permissionOverwrites.edit(guild.roles.everyone.id, { ViewChannel: false });
  await ch.permissionOverwrites.edit(userId, { ViewChannel: true, SendMessages: true });
}

// ===================== إخفاء / إظهار المدينة للعضو =====================
async function showCity(guild, userId, catId) {
  const rooms = guild.channels.cache.filter(c => c.parentId === catId && c.type === ChannelType.GuildText);
  for (const [, ch] of rooms) {
    await ch.permissionOverwrites.edit(userId, { ViewChannel: true, SendMessages: true });
  }
}

async function hideCity(guild, userId, catId) {
  const rooms = guild.channels.cache.filter(c => c.parentId === catId && c.type === ChannelType.GuildText);
  for (const [, ch] of rooms) {
    await ch.permissionOverwrites.edit(userId, { ViewChannel: false }).catch(() => {});
  }
}

// ===================== حساب التأخير =====================
function getDelay(userId) {
  if (!carOwners.has(userId)) return 90_000;
  const fuel = fuelMap.get(userId);
  if (!fuel || fuel.count >= fuel.max) return 90_000;
  return 10_000;
}

// ===================== الانتقال للمدينة (مع نظام البنزين) =====================
async function transitToCity(message, userId, targetCatId) {
  const guild = message.guild;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;

  let delay = 90_000;

  if (carOwners.has(userId)) {
    const fuel = fuelMap.get(userId) || { count: 0, max: 25 };
    if (fuel.count >= fuel.max) {
      delay = 90_000;
      await message.reply('> ⚠️ سيارتك بدون بنزين! انتقالك صار دقيقة ونص.\n> روح لمحطة البنزين.');
    } else {
      delay = 10_000;
      fuel.count++;
      fuelMap.set(userId, fuel);
      const remaining = fuel.max - fuel.count;
      if (remaining === 5) {
        await member.send('> ⚠️ تحذير! بقي لك **5** انتقالات فقط، روح عبّ بنزين.').catch(() => {});
      }
      if (remaining === 0) {
        await member.send('> 🚨 البنزين خلص! انتقالاتك الجاية رح تاخذ دقيقة ونص.').catch(() => {});
      }
    }
  }

  await message.reply(`> ⏳ جاري نقلك... انتظر **${Math.round(delay / 1000)} ثانية**`);

  setTimeout(async () => {
    await hideHome(guild, userId).catch(() => {});
    await showCity(guild, userId, targetCatId);
    await member.send('> ✅ وصلت! استخدم **!بيت** للعودة.').catch(() => {});
  }, delay);
}

// ===================== الانتقال للبيت =====================
async function transitToHome(message, userId) {
  const guild = message.guild;
  const delay = getDelay(userId);

  await message.reply(`> ⏳ جاري العودة للبيت... انتظر **${Math.round(delay / 1000)} ثانية**`);

  setTimeout(async () => {
    await hideCity(guild, userId, CAT_CITY_ID).catch(() => {});
    await hideCity(guild, userId, CAT_GANG_ID).catch(() => {});
    await showHome(guild, userId);
  }, delay);
}

// ===================== عضو جديد يدخل =====================
client.on('guildMemberAdd', async (member) => {
  await createHome(member);
});

// ===================== معالج الرسائل =====================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const { content, member, guild, channel } = message;
  const userId = message.author.id;
  const args = content.trim().split(/\s+/);
  const cmd = args[0];

  // ريسيت مؤقت الوسخ لو الرسالة في بيت الشخص
  if (homes.get(userId) === channel.id) startDirtyTimer(channel);

  // ==================== !أبدأ٧٧ ====================
  if (content.trim() === '!أبدأ٧٧') {
    if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply('> ❌ هذا الأمر للأدمن فقط.');
    }
    const status = await message.reply('> ⏳ جاري بناء السيرفر...');
    await ensureCityRooms(guild);
    const members = await guild.members.fetch();
    let count = 0;
    for (const [, m] of members) {
      if (m.user.bot) continue;
      if (!homes.has(m.id)) {
        await createHome(m);
        count++;
        await new Promise(r => setTimeout(r, 600));
      }
    }
    await status.edit(`> ✅ تم بناء السيرفر!\n> 🏠 تم إنشاء **${count}** بيت\n> 🌆 رومات المدينة جاهزة`);
    return;
  }

  // ==================== !انتقال ====================
  if (cmd === '!انتقال') {
    await ensureCityRooms(guild);
    await transitToCity(message, userId, CAT_CITY_ID);
    return;
  }

  // ==================== !مدينة ====================
  if (cmd === '!مدينة' && args[1] !== 'العصابة') {
    await ensureCityRooms(guild);
    await transitToCity(message, userId, CAT_CITY_ID);
    return;
  }

  // ==================== !مدينة العصابة ====================
  if (content.trim() === '!مدينة العصابة') {
    await ensureCityRooms(guild);
    await transitToCity(message, userId, CAT_GANG_ID);
    return;
  }

  // ==================== !بيت ====================
  if (cmd === '!بيت') {
    const mentioned = message.mentions.users.first();
    if (mentioned) {
      // زيارة شخص
      const targetChId = homes.get(mentioned.id);
      if (!targetChId) return message.reply('> ❌ هذا الشخص ما عنده بيت.');
      const targetCh = guild.channels.cache.get(targetChId);
      if (!targetCh) return message.reply('> ❌ ما لقيت البيت.');

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`visit_yes_${userId}_${mentioned.id}`).setLabel('✅ نعم').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`visit_no_${userId}_${mentioned.id}`).setLabel('❌ لا أريد').setStyle(ButtonStyle.Danger),
      );
      await targetCh.send({ content: `> 🚪 <@${mentioned.id}> هل تريد **<@${userId}>** أن يدخل بيتك؟`, components: [row] });
      await message.reply('> 📨 تم إرسال طلب الزيارة، انتظر الرد.');
    } else {
      // عودة للبيت
      await transitToHome(message, userId);
    }
    return;
  }

  // ==================== !محل (رتبة مختار) ====================
  if (cmd === '!محل') {
    if (!member.roles.cache.has(ROLE_MUKHTAR)) return message.reply('> ❌ ما عندك صلاحية.');
    const target = message.mentions.members.first();
    const shopName = args.slice(2).join(' ');
    if (!target || !shopName) return message.reply('> ⚠️ الاستخدام: `!محل @شخص اسم_المحل`');
    await ensureCategories(guild);

    const shopCh = await guild.channels.create({
      name: shopName, type: ChannelType.GuildText, parent: CAT_SHOPS_ID,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: target.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] },
      ]
    });

    // كل من في المدينة يشوف المحل
    const allMembers = guild.members.cache.filter(m => !m.user.bot && m.id !== target.id);
    for (const [, m] of allMembers) {
      await shopCh.permissionOverwrites.create(m.id, { ViewChannel: true }).catch(() => {});
    }

    await message.reply(`> ✅ تم إنشاء محل **${shopName}** لـ <@${target.id}>`);
    await shopCh.send(`> 🏪 مرحباً <@${target.id}>! هذا محلك، تقدر تديره بالكامل.`);
    return;
  }

  // ==================== !قفل (رتبة مختار) ====================
  if (cmd === '!قفل') {
    if (!member.roles.cache.has(ROLE_MUKHTAR)) return message.reply('> ❌ ما عندك صلاحية.');
    const target = message.mentions.members.first();
    const mentionedChannel = message.mentions.channels.first();
    if (!target || !mentionedChannel) return message.reply('> ⚠️ الاستخدام: `!قفل @شخص #الروم`');
    await mentionedChannel.permissionOverwrites.delete(target.id).catch(() => {});
    await message.reply(`> ✅ تم إزالة <@${target.id}> من ${mentionedChannel}`);
    return;
  }

  // ==================== !بيع (رتبة بائع سيارات) ====================
  if (cmd === '!بيع') {
    if (!member.roles.cache.has(ROLE_CARSELLER)) return message.reply('> ❌ ما عندك صلاحية.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('> ⚠️ الاستخدام: `!بيع @شخص`');
    carOwners.add(target.id);
    if (!fuelMap.has(target.id)) fuelMap.set(target.id, { count: 0, max: 25 });
    await message.reply(`> 🚗 تم بيع السيارة لـ <@${target.id}>!`);
    await target.send('> 🚗 تهانينا! اشتريت سيارة، تنقّلك صار 10 ثواني.\n> راقب بنزينك! كل 25 انتقال تحتاج تعبئ.').catch(() => {});
    return;
  }

  // ==================== !عب (رتبة بنزين) ====================
  if (cmd === '!عب') {
    if (!member.roles.cache.has(ROLE_GAS)) return message.reply('> ❌ ما عندك صلاحية.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('> ⚠️ الاستخدام: `!عب @شخص`');
    if (!carOwners.has(target.id)) return message.reply('> ❌ هذا الشخص ما عنده سيارة.');
    const fuel = fuelMap.get(target.id) || { count: 0, max: 25 };
    fuel.max += 25;
    fuelMap.set(target.id, fuel);
    const remaining = fuel.max - fuel.count;
    await message.reply(`> ⛽ تم تعبئة بنزين <@${target.id}>! المتبقي: ${remaining} انتقال`);
    await target.send(`> ⛽ تم تعبئة بنزينك! رصيدك: **${remaining}** انتقال.`).catch(() => {});
    return;
  }

  // ==================== !روم (رتبة باني) ====================
  if (cmd === '!روم') {
    if (!member.roles.cache.has(ROLE_BUILDER)) return message.reply('> ❌ ما عندك صلاحية.');
    let parentId, roomName;
    if (args[1] === 'مدينة' && args[2] === 'العصابة') {
      parentId = CAT_GANG_ID;
      roomName = args.slice(3).join(' ');
    } else if (args[1] === 'مدينة') {
      parentId = CAT_CITY_ID;
      roomName = args.slice(2).join(' ');
    } else {
      return message.reply('> ⚠️ الاستخدام: `!روم مدينة اسم_الروم` أو `!روم مدينة العصابة اسم_الروم`');
    }
    if (!roomName) return message.reply('> ⚠️ اكتب اسم الروم.');
    await ensureCityRooms(guild);

    const newCh = await guild.channels.create({
      name: roomName, type: ChannelType.GuildText, parent: parentId,
      permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }]
    });
    const allMembers = guild.members.cache.filter(m => !m.user.bot);
    for (const [, m] of allMembers) {
      await newCh.permissionOverwrites.create(m.id, { ViewChannel: true }).catch(() => {});
    }
    await message.reply(`> ✅ تم إضافة **${roomName}** للمدينة`);
    return;
  }
});

// ===================== أزرار الزيارة =====================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  const { customId, guild } = interaction;

  if (customId.startsWith('visit_yes_')) {
    const parts = customId.split('_');
    const fromId = parts[2];
    const toId   = parts[3];
    const homeCh = guild.channels.cache.get(homes.get(toId));
    if (!homeCh) return interaction.reply({ content: '> ❌ ما لقيت البيت.', ephemeral: true });
    await homeCh.permissionOverwrites.create(fromId, { ViewChannel: true, SendMessages: true });
    await interaction.update({ content: '> ✅ تم قبول الزيارة!', components: [] });
    await homeCh.send(`> 👋 <@${fromId}> دخل البيت!`);

  } else if (customId.startsWith('visit_no_')) {
    await interaction.update({ content: '> ❌ تم رفض الزيارة.', components: [] });
  }
});

// ===================== تشغيل البوت =====================
client.once('ready', () => {
  console.log(`✅ البوت شغال: ${client.user.tag}`);
  console.log('⏳ السيرفر فاضي - انتظر أمر !أبدأ٧٧ من الأدمن');
});

client.login(TOKEN);
