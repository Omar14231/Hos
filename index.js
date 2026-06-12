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

const ROLE_MUKHTAR   = '1474552028545028292'; // مختار
const ROLE_CARSELLER = '1514665270269055116'; // بائع سيارات
const ROLE_GAS       = '1514666531647131841'; // محطة بنزين
const ROLE_BUILDER   = '1514672754123739186'; // باني رومات

// رتبة عالية تقدر تسوي مدن جديدة وتستخدم ق/ف
// حط ID رتبتك أنت هنا
const ROLE_HIGH      = '1474553962597191804'; // غيّر هذا لـ ID رتبتك العالية

// ===================== الذاكرة =====================
const homes         = new Map(); // userId -> channelId
const carOwners     = new Set(); // userId اشترى سيارة
const fuelMap       = new Map(); // userId -> { count, max }
const dirtyHomes    = new Map(); // channelId -> timeout
const cityCategories = new Map(); // اسم المدينة -> categoryId
// رومات المدينة الأصلية اللي تعرض بس (بدون كتابة)
const readOnlyRooms = new Set(); // channelId

// ===================== إنشاء الكاتيغوريز الأساسية =====================
let CAT_HOMES_ID = null;
let CAT_SHOPS_ID = null;

async function ensureBaseCategories(guild) {
  if (!CAT_HOMES_ID) {
    let c = guild.channels.cache.find(x => x.type === ChannelType.GuildCategory && x.name.includes('البيوت'));
    if (!c) c = await guild.channels.create({ name: '🏠 البيوت', type: ChannelType.GuildCategory });
    CAT_HOMES_ID = c.id;
  }
  if (!CAT_SHOPS_ID) {
    let c = guild.channels.cache.find(x => x.type === ChannelType.GuildCategory && x.name.includes('المحلات'));
    if (!c) c = await guild.channels.create({ name: '🏪 المحلات', type: ChannelType.GuildCategory });
    CAT_SHOPS_ID = c.id;
  }
}

// ===================== إنشاء مدينة جديدة =====================
async function createCity(guild, cityName) {
  if (cityCategories.has(cityName)) return cityCategories.get(cityName);

  const cat = await guild.channels.create({
    name: `🌆 مدينة ${cityName}`,
    type: ChannelType.GuildCategory,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }
    ]
  });
  cityCategories.set(cityName, cat.id);
  return cat.id;
}

// ===================== رومات المدينة الرئيسية (مخفية + قراءة فقط للعضو) =====================
async function ensureCityRooms(guild, catId, readOnly = true) {
  const cityRooms = [
    '✧┇💭┇✧・شات',
    '✧┇🎟┇✧・الدعم・الفني',
    '✧┇🚗┇✧・متجر・السيارة',
    '✧┇🪧┇✧・شرح・الفكرة',
    '✧┇🚭┇✧・محطة・بنزين',
    '✧┇⌛┇✧・منطقة・في・صيانه',
  ];

  for (const name of cityRooms) {
    const exists = guild.channels.cache.find(c => c.name === name && c.parentId === catId);
    if (!exists) {
      const ch = await guild.channels.create({
        name, type: ChannelType.GuildText, parent: catId,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }
        ]
      });
      // روم شات يسمح بالكتابة، باقيهم قراءة فقط
      if (name.includes('شات')) {
        // شات عادي
      } else {
        readOnlyRooms.add(ch.id);
      }
    } else {
      // ضيف للـ set لو كان موجود
      if (!exists.name.includes('شات')) readOnlyRooms.add(exists.id);
    }
  }
}

// ===================== إنشاء بيت للعضو =====================
async function createHome(member) {
  if (homes.has(member.id)) return;
  const guild = member.guild;
  await ensureBaseCategories(guild);

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
    `> مرحباً بك يا <@${member.id}> 👋\n> إذا كنت تود أن تكتشف المدينة يرجا كتب أمر **!انتقال**\n> اكتب **!مسح** لمسح رسائل بيتك`
  );
  startDirtyTimer(channel);
}

// ===================== مؤقت الوسخ =====================
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
  await ch.permissionOverwrites.edit(userId, { ViewChannel: false }).catch(() => {});
}

async function showHome(guild, userId) {
  const ch = guild.channels.cache.get(homes.get(userId));
  if (!ch) return;
  await ch.permissionOverwrites.edit(guild.roles.everyone.id, { ViewChannel: false });
  await ch.permissionOverwrites.edit(userId, { ViewChannel: true, SendMessages: true });
}

// ===================== إظهار المدينة للعضو =====================
async function showCity(guild, userId, catId) {
  const rooms = guild.channels.cache.filter(c => c.parentId === catId && c.type === ChannelType.GuildText);
  for (const [, ch] of rooms) {
    // روم قراءة فقط = يشوف بس ما يكتب
    if (readOnlyRooms.has(ch.id)) {
      await ch.permissionOverwrites.edit(userId, { ViewChannel: true, SendMessages: false });
    } else {
      await ch.permissionOverwrites.edit(userId, { ViewChannel: true, SendMessages: true });
    }
  }
  // المحلات تظهر أيضاً لمن في المدينة
  await showShops(guild, userId);
}

async function hideCity(guild, userId, catId) {
  const rooms = guild.channels.cache.filter(c => c.parentId === catId && c.type === ChannelType.GuildText);
  for (const [, ch] of rooms) {
    await ch.permissionOverwrites.edit(userId, { ViewChannel: false }).catch(() => {});
  }
  // إخفاء المحلات عند مغادرة المدينة
  await hideShops(guild, userId);
}

// ===================== إظهار / إخفاء المحلات =====================
async function showShops(guild, userId) {
  const shops = guild.channels.cache.filter(c => c.parentId === CAT_SHOPS_ID && c.type === ChannelType.GuildText);
  for (const [, ch] of shops) {
    // يشوف فقط، ما يكتب إلا صاحب المحل
    const ownerOverwrite = ch.permissionOverwrites.cache.find(o =>
      o.allow.has(PermissionFlagsBits.ManageChannels)
    );
    if (ownerOverwrite && ownerOverwrite.id === userId) {
      await ch.permissionOverwrites.edit(userId, { ViewChannel: true, SendMessages: true });
    } else {
      await ch.permissionOverwrites.edit(userId, { ViewChannel: true, SendMessages: false });
    }
  }
}

async function hideShops(guild, userId) {
  const shops = guild.channels.cache.filter(c => c.parentId === CAT_SHOPS_ID && c.type === ChannelType.GuildText);
  for (const [, ch] of shops) {
    const ownerOverwrite = ch.permissionOverwrites.cache.find(o =>
      o.allow.has(PermissionFlagsBits.ManageChannels) && o.id === userId
    );
    if (!ownerOverwrite) {
      await ch.permissionOverwrites.edit(userId, { ViewChannel: false }).catch(() => {});
    }
  }
}

// ===================== حساب التأخير =====================
function getDelay(userId) {
  if (!carOwners.has(userId)) return 90_000;
  const fuel = fuelMap.get(userId);
  if (!fuel || fuel.count >= fuel.max) return 90_000;
  return 10_000;
}

// ===================== الانتقال للمدينة =====================
async function transitToCity(message, userId, catId) {
  const guild = message.guild;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;

  let delay = 90_000;

  if (carOwners.has(userId)) {
    const fuel = fuelMap.get(userId) || { count: 0, max: 25 };
    if (fuel.count >= fuel.max) {
      await message.reply('> ⚠️ سيارتك بدون بنزين! انتقالك دقيقة ونص.\n> روح لمحطة البنزين واطلب منهم `!عب @منشنك`');
      delay = 90_000;
    } else {
      delay = 10_000;
      fuel.count++;
      fuelMap.set(userId, fuel);
      const remaining = fuel.max - fuel.count;
      if (remaining === 5) await member.send('> ⚠️ بقي لك **5** انتقالات فقط، عبّ بنزين!').catch(() => {});
      if (remaining === 0) await member.send('> 🚨 البنزين خلص! التنقل صار دقيقة ونص حتى تعبئ.').catch(() => {});
    }
  }

  await message.reply(`> ⏳ جاري نقلك... انتظر **${Math.round(delay / 1000)} ثانية**`);
  setTimeout(async () => {
    await hideHome(guild, userId).catch(() => {});
    await showCity(guild, userId, catId);
  }, delay);
}

// ===================== الانتقال للبيت =====================
async function transitToHome(message, userId) {
  const guild = message.guild;
  const delay = getDelay(userId);
  await message.reply(`> ⏳ جاري العودة للبيت... انتظر **${Math.round(delay / 1000)} ثانية**`);
  setTimeout(async () => {
    // إخفاء كل المدن
    for (const [, catId] of cityCategories) {
      await hideCity(guild, userId, catId).catch(() => {});
    }
    await showHome(guild, userId);
  }, delay);
}

// ===================== عضو جديد =====================
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

  // ريسيت مؤقت الوسخ
  if (homes.get(userId) === channel.id) startDirtyTimer(channel);

  // ==================== ق / ف (قفل / فتح روم) ====================
  if (content.trim() === 'ق' || content.trim() === 'ف') {
    if (!member.roles.cache.has(ROLE_HIGH) && !member.permissions.has(PermissionFlagsBits.Administrator)) return;
    await message.delete().catch(() => {});
    const isLock = content.trim() === 'ق';
    await channel.permissionOverwrites.edit(guild.roles.everyone.id, {
      SendMessages: isLock ? false : true
    });
    const notice = await channel.send(isLock ? '> 🔒 الروم مقفول.' : '> 🔓 الروم مفتوح.');
    setTimeout(() => notice.delete().catch(() => {}), 5000);
    return;
  }

  // ==================== !أبدأ٧٧ ====================
  if (content.trim() === '!أبدأ٧٧') {
    if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply('> ❌ هذا الأمر للأدمن فقط.');
    }
    const status = await message.reply('> ⏳ جاري بناء السيرفر...');
    await ensureBaseCategories(guild);
    // مدينة رئيسية افتراضية
    const mainCatId = await createCity(guild, 'الرئيسية');
    await ensureCityRooms(guild, mainCatId);
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
    await status.edit(`> ✅ تم بناء السيرفر!\n> 🏠 تم إنشاء **${count}** بيت\n> 🌆 المدينة الرئيسية جاهزة`);
    return;
  }

  // ==================== !انتقال / !مدينة (بدون اسم) ====================
  if (cmd === '!انتقال' || (cmd === '!مدينة' && args.length === 1)) {
    const mainCat = cityCategories.get('الرئيسية');
    if (!mainCat) return message.reply('> ❌ ما في مدينة رئيسية بعد، اطلب من الأدمن `!أبدأ٧٧`');
    await transitToCity(message, userId, mainCat);
    return;
  }

  // ==================== !مدينة اسم_المدينة (انتقال لمدينة معينة) ====================
  if (cmd === '!مدينة' && args.length > 1) {
    const cityName = args.slice(1).join(' ');
    const catId = cityCategories.get(cityName);
    if (!catId) return message.reply(`> ❌ ما في مدينة اسمها **${cityName}**`);
    await transitToCity(message, userId, catId);
    return;
  }

  // ==================== !إنشاء مدينة اسم (للرتب العالية) ====================
  // مثال: !إنشاء مدينة البلابل
  if (cmd === '!إنشاء' && args[1] === 'مدينة') {
    if (!member.roles.cache.has(ROLE_HIGH) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply('> ❌ ما عندك صلاحية.');
    }
    const cityName = args.slice(2).join(' ');
    if (!cityName) return message.reply('> ⚠️ الاستخدام: `!إنشاء مدينة اسم_المدينة`');
    if (cityCategories.has(cityName)) return message.reply(`> ❌ مدينة **${cityName}** موجودة بالفعل.`);
    const catId = await createCity(guild, cityName);
    await ensureCityRooms(guild, catId);
    await message.reply(`> ✅ تم إنشاء مدينة **${cityName}**!\n> يقدر أي شخص ينتقل لها بـ \`!مدينة ${cityName}\``);
    return;
  }

  // ==================== !بيت ====================
  if (cmd === '!بيت') {
    const mentioned = message.mentions.users.first();
    if (mentioned) {
      const targetChId = homes.get(mentioned.id);
      if (!targetChId) return message.reply('> ❌ هذا الشخص ما عنده بيت.');
      const targetCh = guild.channels.cache.get(targetChId);
      if (!targetCh) return message.reply('> ❌ ما لقيت البيت.');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`visit_yes_${userId}_${mentioned.id}`).setLabel('✅ نعم').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`visit_no_${userId}_${mentioned.id}`).setLabel('❌ لا أريد').setStyle(ButtonStyle.Danger),
      );
      await targetCh.send({
        content: `> 🚪 <@${mentioned.id}> هل تريد **<@${userId}>** أن يدخل بيتك؟\n> إذا أردت إخراجه لاحقاً اكتب \`!خلاص @${(await guild.members.fetch(userId)).user.username}\``,
        components: [row]
      });
      await message.reply('> 📨 تم إرسال طلب الزيارة، انتظر الرد.');
    } else {
      await transitToHome(message, userId);
    }
    return;
  }

  // ==================== !خلاص @منشن (طرد الزائر من بيتك) ====================
  if (cmd === '!خلاص') {
    const myHomeId = homes.get(userId);
    if (!myHomeId || channel.id !== myHomeId) return message.reply('> ❌ هذا الأمر فقط داخل بيتك.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('> ⚠️ الاستخدام: `!خلاص @شخص`');
    await channel.permissionOverwrites.delete(target.id).catch(() => {});
    await message.reply(`> 👋 تم إخراج <@${target.id}> من بيتك.`);
    // يرجع لبيته
    const targetDelay = getDelay(target.id);
    await target.send(`> 🚪 تم إخراجك من البيت! جاري إعادتك لبيتك خلال ${Math.round(targetDelay / 1000)} ثانية.`).catch(() => {});
    setTimeout(async () => {
      for (const [, catId] of cityCategories) {
        await hideCity(guild, target.id, catId).catch(() => {});
      }
      await showHome(guild, target.id);
    }, targetDelay);
    return;
  }

  // ==================== !مسح (مسح رسائل البيت) ====================
  if (cmd === '!مسح') {
    const myHomeId = homes.get(userId);
    if (!myHomeId || channel.id !== myHomeId) return message.reply('> ❌ هذا الأمر فقط داخل بيتك.');
    let deleted = 1;
    let batch;
    do {
      batch = await channel.messages.fetch({ limit: 100 });
      if (batch.size === 0) break;
      await channel.bulkDelete(batch, true).catch(() => {});
      deleted += batch.size;
      await new Promise(r => setTimeout(r, 1000));
    } while (batch.size >= 2);
    const notice = await channel.send('> 🧹 تم مسح الرسائل!');
    setTimeout(() => notice.delete().catch(() => {}), 3000);
    return;
  }

  // ==================== !روم ====================
  if (cmd === '!روم') {
    if (!member.roles.cache.has(ROLE_BUILDER) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply('> ❌ ما عندك صلاحية.');
    }

    // !روم @منشن اسم_الروم → محل في المحلات
    if (message.mentions.members.size > 0) {
      const target = message.mentions.members.first();
      const shopName = args.slice(2).join(' ');
      if (!shopName) return message.reply('> ⚠️ الاستخدام: `!روم @شخص اسم_المحل`');
      await ensureBaseCategories(guild);

      const shopCh = await guild.channels.create({
        name: shopName, type: ChannelType.GuildText, parent: CAT_SHOPS_ID,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          {
            id: target.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.ManageMessages,
            ]
          },
        ]
      });

      // من في المدينة حالياً يشوف المحل
      const allMembers = guild.members.cache.filter(m => !m.user.bot && m.id !== target.id);
      for (const [, m] of allMembers) {
        // تحقق إذا هو في مدينة
        let inCity = false;
        for (const [, catId] of cityCategories) {
          const cityRooms = guild.channels.cache.filter(c => c.parentId === catId);
          for (const [, ch] of cityRooms) {
            const overwrite = ch.permissionOverwrites.cache.get(m.id);
            if (overwrite && overwrite.allow.has(PermissionFlagsBits.ViewChannel)) {
              inCity = true; break;
            }
          }
          if (inCity) break;
        }
        if (inCity) {
          await shopCh.permissionOverwrites.create(m.id, { ViewChannel: true, SendMessages: false }).catch(() => {});
        }
      }

      await message.reply(`> ✅ تم إنشاء محل **${shopName}** لـ <@${target.id}>`);
      await shopCh.send(`> 🏪 مرحباً <@${target.id}>! هذا محلك، تقدر تديره بالكامل.\n> اكتب \`ق\` لقفله و\`ف\` لفتحه.`);
      return;
    }

    // !روم اسم_المدينة اسم_الروم → روم في مدينة معينة
    const cityName = args[1];
    const roomName = args.slice(2).join(' ');
    if (!cityName || !roomName) return message.reply('> ⚠️ الاستخدام: `!روم اسم_المدينة اسم_الروم` أو `!روم @شخص اسم_المحل`');
    const catId = cityCategories.get(cityName);
    if (!catId) return message.reply(`> ❌ ما في مدينة اسمها **${cityName}**`);

    const newCh = await guild.channels.create({
      name: roomName, type: ChannelType.GuildText, parent: catId,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }
      ]
    });

    // من في هذي المدينة حالياً يشوف الروم
    const allMembers = guild.members.cache.filter(m => !m.user.bot);
    for (const [, m] of allMembers) {
      const cityRooms = guild.channels.cache.filter(c => c.parentId === catId);
      let inThisCity = false;
      for (const [, ch] of cityRooms) {
        const overwrite = ch.permissionOverwrites.cache.get(m.id);
        if (overwrite && overwrite.allow.has(PermissionFlagsBits.ViewChannel)) {
          inThisCity = true; break;
        }
      }
      if (inThisCity) {
        await newCh.permissionOverwrites.create(m.id, { ViewChannel: true, SendMessages: true }).catch(() => {});
      }
    }

    await message.reply(`> ✅ تم إضافة **${roomName}** لمدينة **${cityName}**`);
    return;
  }

  // ==================== !محل (رتبة مختار) ====================
  if (cmd === '!محل') {
    if (!member.roles.cache.has(ROLE_MUKHTAR)) return message.reply('> ❌ ما عندك صلاحية.');
    const target = message.mentions.members.first();
    const shopName = args.slice(2).join(' ');
    if (!target || !shopName) return message.reply('> ⚠️ الاستخدام: `!محل @شخص اسم_المحل`');
    await ensureBaseCategories(guild);

    const shopCh = await guild.channels.create({
      name: shopName, type: ChannelType.GuildText, parent: CAT_SHOPS_ID,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: target.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ManageMessages,
          ]
        },
      ]
    });

    await message.reply(`> ✅ تم إنشاء محل **${shopName}** لـ <@${target.id}>`);
    await shopCh.send(`> 🏪 مرحباً <@${target.id}>! هذا محلك.\n> اكتب \`ق\` لقفله و\`ف\` لفتحه.`);
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

  // ==================== !بيع ====================
  if (cmd === '!بيع') {
    if (!member.roles.cache.has(ROLE_CARSELLER)) return message.reply('> ❌ ما عندك صلاحية.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('> ⚠️ الاستخدام: `!بيع @شخص`');
    carOwners.add(target.id);
    if (!fuelMap.has(target.id)) fuelMap.set(target.id, { count: 0, max: 25 });
    await message.reply(`> 🚗 تم بيع السيارة لـ <@${target.id}>! تنقله صار 10 ثواني.`);
    await target.send('> 🚗 تهانينا! اشتريت سيارة، تنقّلك صار 10 ثواني.\n> راقب بنزينك! كل 25 انتقال تعبئ.').catch(() => {});
    return;
  }

  // ==================== !عب ====================
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
  console.log('⏳ انتظر أمر !أبدأ٧٧ من الأدمن');
});

client.login(TOKEN);
