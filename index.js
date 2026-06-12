require('./keep_alive');
const { Client, GatewayIntentBits, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

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

// IDs الرتب - حطها من السيرفر حقك
const ROLE_MUKHTAR     = '1474552028545028292'; // مختار / صاحب المحل
const ROLE_CARSELLER   = '1514665270269055116'; // بائع سيارات
const ROLE_GAS         = '1514666531647131841'; // محطة بنزين
const ROLE_BUILDER     = '1514672754123739186'; // مهندس / باني روم

// أسماء الكاتيغوريز - سوّيها في السيرفر وحط IDs أدناه
// أو البوت يسوّيها أوتوماتيك عند أول تشغيل
let CAT_HOMES_ID   = null; // كاتيغوري البيوت
let CAT_CITY_ID    = null; // كاتيغوري المدينة
let CAT_SHOPS_ID   = null; // كاتيغوري المحلات
let CAT_GANG_ID    = null; // كاتيغوري مدينة العصابة

// ===================== حفظ البيانات في الذاكرة =====================
const homes        = new Map(); // userId -> channelId
const carOwners    = new Set(); // userId الي اشترى سيارة
const fuelMap      = new Map(); // userId -> { count, max }
const dirtyHomes   = new Map(); // channelId -> timeout
const visitRequests = new Map(); // messageId -> { fromId, toId, channelId }

// ===================== دالة إنشاء الكاتيغوريز أوتوماتيك =====================
async function ensureCategories(guild) {
  if (!CAT_HOMES_ID) {
    let cat = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name.includes('البيوت'));
    if (!cat) cat = await guild.channels.create({ name: '🏠 البيوت', type: ChannelType.GuildCategory });
    CAT_HOMES_ID = cat.id;
  }
  if (!CAT_CITY_ID) {
    let cat = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name.includes('المدينة') && !c.name.includes('العصابة'));
    if (!cat) cat = await guild.channels.create({ name: '🌆 المدينة', type: ChannelType.GuildCategory });
    CAT_CITY_ID = cat.id;
  }
  if (!CAT_SHOPS_ID) {
    let cat = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name.includes('المحلات'));
    if (!cat) cat = await guild.channels.create({ name: '🏪 المحلات', type: ChannelType.GuildCategory });
    CAT_SHOPS_ID = cat.id;
  }
  if (!CAT_GANG_ID) {
    let cat = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name.includes('العصابة'));
    if (!cat) cat = await guild.channels.create({ name: '🕶️ مدينة العصابة', type: ChannelType.GuildCategory });
    CAT_GANG_ID = cat.id;
  }
}

// ===================== إنشاء روم المدينة الأساسية (مخفية) =====================
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
        name,
        type: ChannelType.GuildText,
        parent: CAT_CITY_ID,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }
        ]
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
        name,
        type: ChannelType.GuildText,
        parent: CAT_GANG_ID,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }
        ]
      });
    }
  }
}

// ===================== إنشاء بيت للعضو =====================
async function createHome(member) {
  const guild = member.guild;
  await ensureCategories(guild);
  if (homes.has(member.id)) return;

  const channelName = `✧┇🏡┇✧・بيت・${member.user.username}`;
  const channel = await guild.channels.create({
    name: channelName,
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

// ===================== مؤقت البيت الوسخ (ساعة بدون كلام → 🧹) =====================
function startDirtyTimer(channel) {
  if (dirtyHomes.has(channel.id)) clearTimeout(dirtyHomes.get(channel.id));
  const t = setTimeout(async () => {
    try {
      const msg = await channel.send('> 🧹 بيتك اتسخ! يرجا ضع علامة المكنسة لمسحه.');
      const collector = msg.createReactionCollector({ filter: (r, u) => r.emoji.name === '🧹' && !u.bot, time: 600_000 });
      collector.on('collect', async () => {
        await msg.delete().catch(() => {});
        collector.stop();
      });
    } catch {}
  }, 3_600_000);
  dirtyHomes.set(channel.id, t);
}

// ===================== إخفاء / إظهار البيت =====================
async function hideHome(guild, userId) {
  const chId = homes.get(userId);
  if (!chId) return;
  const ch = guild.channels.cache.get(chId);
  if (!ch) return;
  await ch.permissionOverwrites.edit(guild.roles.everyone.id, { ViewChannel: false });
  await ch.permissionOverwrites.edit(userId, { ViewChannel: false });
}

async function showHome(guild, userId) {
  const chId = homes.get(userId);
  if (!chId) return;
  const ch = guild.channels.cache.get(chId);
  if (!ch) return;
  await ch.permissionOverwrites.edit(guild.roles.everyone.id, { ViewChannel: false });
  await ch.permissionOverwrites.edit(userId, { ViewChannel: true, SendMessages: true });
}

// ===================== إخفاء / إظهار المدينة للعضو =====================
async function showCity(guild, userId, catId) {
  const cat = guild.channels.cache.get(catId);
  if (!cat) return;
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

// ===================== الانتقال من البيت للمدينة =====================
async function transitToCity(message, userId, delay, targetCatId, returnMsg) {
  const guild = message.guild;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;

  await message.reply(`> ⏳ جاري نقلك إلى المدينة... انتظر **${delay / 1000} ثانية**`);

  setTimeout(async () => {
    await hideHome(guild, userId);
    await showCity(guild, userId, targetCatId);
    try {
      const homeCh = guild.channels.cache.get(homes.get(userId));
      if (homeCh) await homeCh.send(`> ✅ <@${userId}> وصل للمدينة!`);
    } catch {}
    // رسالة خاصة
    await member.send(`> ✅ وصلت للمدينة! استخدم **!بيت** للعودة.`).catch(() => {});
  }, delay);
}

// ===================== الانتقال من المدينة للبيت =====================
async function transitToHome(message, userId, delay) {
  const guild = message.guild;
  await message.reply(`> ⏳ جاري العودة للبيت... انتظر **${delay / 1000} ثانية**`);
  setTimeout(async () => {
    await hideCity(guild, userId, CAT_CITY_ID).catch(() => {});
    await hideCity(guild, userId, CAT_GANG_ID).catch(() => {});
    await showHome(guild, userId);
  }, delay);
}

// ===================== حساب التأخير بناءً على السيارة والبنزين =====================
function getDelay(userId) {
  if (!carOwners.has(userId)) return 90_000; // دقيقة ونص
  const fuel = fuelMap.get(userId);
  if (fuel && fuel.count >= fuel.max) return 90_000; // سيارة فاضية → دقيقة ونص
  return 10_000; // 10 ثواني صاحب سيارة
}

// ===================== لما يدخل عضو جديد =====================
client.on('guildMemberAdd', async (member) => {
  await createHome(member);
});

// ===================== معالج الرسائل =====================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const { content, member, guild, channel } = message;
  const userId = message.author.id;

  // ريسيت مؤقت الوسخ لو الروم بيت
  if (homes.get(userId) === channel.id) {
    startDirtyTimer(channel);
  }

  const args = content.trim().split(/\s+/);
  const cmd = args[0];

  // ===================== !انتقال → من البيت للمدينة الرئيسية =====================
  if (cmd === '!انتقال') {
    await ensureCityRooms(guild);
    const delay = getDelay(userId);
    await transitToCity(message, userId, delay, CAT_CITY_ID);
    return;
  }

  // ===================== !بيت → العودة للبيت أو زيارة شخص =====================
  if (cmd === '!بيت') {
    const mentioned = message.mentions.users.first();

    // زيارة شخص
    if (mentioned) {
      const targetChId = homes.get(mentioned.id);
      if (!targetChId) return message.reply('> ❌ هذا الشخص ما عنده بيت.');
      const targetCh = guild.channels.cache.get(targetChId);
      if (!targetCh) return message.reply('> ❌ ما لقيت البيت.');

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`visit_yes_${userId}_${mentioned.id}`).setLabel('✅ نعم').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`visit_no_${userId}_${mentioned.id}`).setLabel('❌ لا أريد').setStyle(ButtonStyle.Danger),
      );
      const visitMsg = await targetCh.send({
        content: `> 🚪 <@${mentioned.id}> هل تريد **<@${userId}>** أن يدخل بيتك؟`,
        components: [row]
      });
      visitRequests.set(visitMsg.id, { fromId: userId, toId: mentioned.id });
      await message.reply('> 📨 تم إرسال طلب الزيارة، انتظر الرد.');
      return;
    }

    // العودة للبيت
    const delay = getDelay(userId);
    await transitToHome(message, userId, delay);
    return;
  }

  // ===================== !مدينة → المدينة الرئيسية =====================
  if (cmd === '!مدينة') {
    await ensureCityRooms(guild);
    const delay = getDelay(userId);
    await transitToCity(message, userId, delay, CAT_CITY_ID);
    return;
  }

  // ===================== !مدينة العصابة =====================
  if (content.trim() === '!مدينة العصابة') {
    await ensureCityRooms(guild);
    const delay = getDelay(userId);
    await transitToCity(message, userId, delay, CAT_GANG_ID);
    return;
  }

  // ===================== !محل → رتبة MUKHTAR =====================
  if (cmd === '!محل') {
    if (!member.roles.cache.has(ROLE_MUKHTAR)) return message.reply('> ❌ ما عندك صلاحية هذا الأمر.');
    const target = message.mentions.members.first();
    const shopName = args.slice(2).join(' ');
    if (!target || !shopName) return message.reply('> ⚠️ الاستخدام: `!محل @شخص اسم_المحل`');
    await ensureCategories(guild);

    const shopCh = await guild.channels.create({
      name: shopName,
      type: ChannelType.GuildText,
      parent: CAT_SHOPS_ID,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        // كل من في المدينة يشوف المحل
      ]
    });

    // أعطِ صاحب المحل كامل الصلاحيات
    await shopCh.permissionOverwrites.create(target.id, {
      ViewChannel: true,
      SendMessages: true,
      ManageChannels: true,
      ManageMessages: true,
    });

    // كل أعضاء السيرفر اللي في المدينة يشوفونه
    const cityMembers = guild.members.cache.filter(m => !m.user.bot);
    for (const [, m] of cityMembers) {
      if (m.id === target.id) continue;
      await shopCh.permissionOverwrites.create(m.id, { ViewChannel: true }).catch(() => {});
    }

    await message.reply(`> ✅ تم إنشاء محل **${shopName}** لـ <@${target.id}>`);
    await shopCh.send(`> 🏪 مرحباً <@${target.id}>! هذا محلك، تقدر تديره بالكامل.`);
    return;
  }

  // ===================== !قفل → رتبة MUKHTAR =====================
  if (cmd === '!قفل') {
    if (!member.roles.cache.has(ROLE_MUKHTAR)) return message.reply('> ❌ ما عندك صلاحية.');
    const target = message.mentions.members.first();
    const mentionedChannel = message.mentions.channels.first();
    if (!target || !mentionedChannel) return message.reply('> ⚠️ الاستخدام: `!قفل @شخص #الروم`');
    await mentionedChannel.permissionOverwrites.delete(target.id).catch(() => {});
    await message.reply(`> ✅ تم إزالة <@${target.id}> من ${mentionedChannel}`);
    return;
  }

  // ===================== !بيع → رتبة بائع سيارات =====================
  if (cmd === '!بيع') {
    if (!member.roles.cache.has(ROLE_CARSELLER)) return message.reply('> ❌ ما عندك صلاحية.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('> ⚠️ الاستخدام: `!بيع @شخص`');
    carOwners.add(target.id);
    if (!fuelMap.has(target.id)) fuelMap.set(target.id, { count: 0, max: 25 });
    await message.reply(`> 🚗 تم بيع السيارة لـ <@${target.id}>! الآن يتنقل بـ 10 ثواني.`);
    await target.send('> 🚗 تهانينا! اشتريت سيارة. تنقّلك صار 10 ثواني بدال دقيقة ونص.\n> راقب بنزينك! كل 25 انتقال رح تحتاج تعبئ.').catch(() => {});
    return;
  }

  // ===================== !عب → رتبة محطة بنزين =====================
  if (cmd === '!عب') {
    if (!member.roles.cache.has(ROLE_GAS)) return message.reply('> ❌ ما عندك صلاحية.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('> ⚠️ الاستخدام: `!عب @شخص`');
    if (!carOwners.has(target.id)) return message.reply('> ❌ هذا الشخص ما عنده سيارة.');
    const fuel = fuelMap.get(target.id) || { count: 0, max: 25 };
    fuel.max += 25;
    fuelMap.set(target.id, fuel);
    await message.reply(`> ⛽ تم تعبئة بنزين <@${target.id}>! رصيده الحالي: ${fuel.max - fuel.count} انتقال متبقي.`);
    await target.send(`> ⛽ تم تعبئة بنزينك! رصيدك الحالي: **${fuel.max - fuel.count}** انتقال.`).catch(() => {});
    return;
  }

  // ===================== !روم → رتبة BUILDER =====================
  if (cmd === '!روم') {
    if (!member.roles.cache.has(ROLE_BUILDER)) return message.reply('> ❌ ما عندك صلاحية.');
    // !روم مدينة اسم الروم  أو  !روم مدينة العصابة اسم الروم
    let cityName, roomName;
    if (args[1] === 'مدينة' && args[2] === 'العصابة') {
      cityName = 'العصابة';
      roomName = args.slice(3).join(' ');
    } else if (args[1] === 'مدينة') {
      cityName = 'رئيسية';
      roomName = args.slice(2).join(' ');
    } else {
      return message.reply('> ⚠️ الاستخدام: `!روم مدينة اسم_الروم` أو `!روم مدينة العصابة اسم_الروم`');
    }
    if (!roomName) return message.reply('> ⚠️ اكتب اسم الروم.');
    await ensureCityRooms(guild);
    const parentId = cityName === 'العصابة' ? CAT_GANG_ID : CAT_CITY_ID;
    const newCh = await guild.channels.create({
      name: roomName,
      type: ChannelType.GuildText,
      parent: parentId,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }
      ]
    });
    // من في المدينة يشوفه
    const cityMembers = guild.members.cache.filter(m => !m.user.bot);
    for (const [, m] of cityMembers) {
      await newCh.permissionOverwrites.create(m.id, { ViewChannel: true }).catch(() => {});
    }
    await message.reply(`> ✅ تم إضافة **${roomName}** لمدينة ${cityName === 'العصابة' ? 'العصابة' : 'الرئيسية'}`);
    return;
  }
});

// ===================== معالج الأزرار (طلب الزيارة) =====================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  const { customId, guild } = interaction;

  if (customId.startsWith('visit_yes_')) {
    const [, , fromId, toId] = customId.split('_');
    const homeCh = guild.channels.cache.get(homes.get(toId));
    if (!homeCh) return interaction.reply({ content: '> ❌ ما لقيت البيت.', ephemeral: true });

    await homeCh.permissionOverwrites.create(fromId, { ViewChannel: true, SendMessages: true });
    await interaction.update({ content: '> ✅ تم قبول الزيارة!', components: [] });
    await homeCh.send(`> 👋 <@${fromId}> دخل البيت!`);

  } else if (customId.startsWith('visit_no_')) {
    await interaction.update({ content: '> ❌ تم رفض الزيارة.', components: [] });
  }
});

// ===================== دالة تحديث عدادات البنزين عند الانتقال =====================
// تُستدعى من transitToCity
const originalTransit = transitToCity;
// نعيد تعريف transitToCity مع البنزين
async function transitToCityFull(message, userId, delay, targetCatId) {
  const guild = message.guild;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;

  // تحقق من البنزين
  if (carOwners.has(userId)) {
    const fuel = fuelMap.get(userId) || { count: 0, max: 25 };
    if (fuel.count >= fuel.max) {
      // سيارة فاضية → بطيء
      await message.reply('> ⚠️ سيارتك بدون بنزين! انتقالك صار دقيقة ونص.\n> اذهب لمحطة البنزين وقل لهم `!عب @منشنك`');
      delay = 90_000;
    } else {
      fuel.count++;
      fuelMap.set(userId, fuel);
      const remaining = fuel.max - fuel.count;

      if (remaining === 5) {
        await member.send(`> ⚠️ سيارتك تحتاج بنزين! بقي لك **5** انتقالات فقط.`).catch(() => {});
      }
      if (remaining === 0) {
        await member.send(`> 🚨 السيارة طفت! انتقالاتك الجاية رح تاخذ دقيقة ونص حتى تعبئ.`).catch(() => {});
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

// ===================== !أبدأ٧٧ → الأدمن فقط يبني كل شيء =====================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.content.trim() !== '!أبدأ٧٧') return;
  if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return message.reply('> ❌ هذا الأمر للأدمن فقط.');
  }

  const guild = message.guild;
  const status = await message.reply('> ⏳ جاري بناء السيرفر...');

  await ensureCategories(guild);
  await ensureCityRooms(guild);

  // أنشئ بيوت لكل الأعضاء الموجودين اللي ما عندهم بيت
  const members = await guild.members.fetch();
  let count = 0;
  for (const [, member] of members) {
    if (member.user.bot) continue;
    if (!homes.has(member.id)) {
      await createHome(member);
      count++;
      await new Promise(r => setTimeout(r, 500)); // تأخير بسيط لتجنب rate limit
    }
  }

  await status.edit(`> ✅ تم بناء السيرفر!\n> 🏠 تم إنشاء **${count}** بيت\n> 🌆 تم بناء رومات المدينة كاملة`);
});

// ===================== تشغيل البوت =====================
client.once('ready', () => {
  console.log(`✅ البوت شغال: ${client.user.tag}`);
  console.log('⏳ السيرفر فاضي - انتظر أمر !أبدأ٧٧ من الأدمن');
});

// ======= Override الانتقال باستخدام النسخة الكاملة مع البنزين =======
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const { content, member, guild } = message;
  const userId = message.author.id;
  const args = content.trim().split(/\s+/);
  const cmd = args[0];

  if (cmd === '!انتقال') {
    await ensureCityRooms(guild);
    let delay = 90_000;
    if (carOwners.has(userId)) {
      const fuel = fuelMap.get(userId) || { count: 0, max: 25 };
      delay = fuel.count >= fuel.max ? 90_000 : 10_000;
    }
    await transitToCityFull(message, userId, delay, CAT_CITY_ID);
  }
  if (content.trim() === '!مدينة العصابة') {
    await ensureCityRooms(guild);
    let delay = 90_000;
    if (carOwners.has(userId)) {
      const fuel = fuelMap.get(userId) || { count: 0, max: 25 };
      delay = fuel.count >= fuel.max ? 90_000 : 10_000;
    }
    await transitToCityFull(message, userId, delay, CAT_GANG_ID);
  }
  if (cmd === '!مدينة' && args[1] !== 'العصابة') {
    await ensureCityRooms(guild);
    let delay = 90_000;
    if (carOwners.has(userId)) {
      const fuel = fuelMap.get(userId) || { count: 0, max: 25 };
      delay = fuel.count >= fuel.max ? 90_000 : 10_000;
    }
    await transitToCityFull(message, userId, delay, CAT_CITY_ID);
  }
});

client.login(TOKEN);
