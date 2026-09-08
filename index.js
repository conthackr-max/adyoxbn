require('dotenv').config();

const { Client } = require('discord.js-selfbot-v13');
const {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus
} = require('@discordjs/voice');

const client = new Client();
let connection = null;
let reconnectAttempts = 0;
let memoryCleanInterval = null;

// ============ إعدادات من .env ============
const CONFIG = {
  selfMute: process.env.SELF_MUTE === 'true',
  selfDeaf: process.env.SELF_DEAF === 'true'
};

console.log(`[CONFIG] Mute: ${CONFIG.selfMute} | Deaf: ${CONFIG.selfDeaf}`);

// ============ دوال مساعدة ============

// دالة إعداد معالجات الاتصال الصوتي
function setupVoiceHandlers(conn, channel, guildId) {
  if (!conn) return;

  conn.on('stateChange', (oldState, newState) => {
    console.log(`[VOICE] تغير الحالة: ${oldState?.status} -> ${newState.status}`);

    // إعادة اتصال تلقائية عند القطع
    if (newState.status === VoiceConnectionStatus.Disconnected) {
      
      // سبب القطع
      if (newState.reason === 3 || newState.reason === 4) {
        console.log('[VOICE] تم الطرد أو حظر مؤقت... انتظار أطول');
        setTimeout(() => attemptReconnect(channel, guildId), 30000);
        return;
      }

      console.log('[VOICE] تم القطع... جاري إعادة الاتصال');
      setTimeout(() => attemptReconnect(channel, guildId), 5000);
    }

    // إذا دمر الاتصال بالكامل
    if (newState.status === VoiceConnectionStatus.Destroyed) {
      console.log('[VOICE] تم تدمير الاتصال... إعادة إنشاء');
      setTimeout(() => attemptReconnect(channel, guildId), 5000);
    }
  });

  // معالجة أخطاء الاتصال
  conn.on('error', (error) => {
    console.error('[VOICE] خطأ:', error.message);
    connection = null;
    setTimeout(() => attemptReconnect(channel, guildId), 5000);
  });
}

// دالة محاولة إعادة الاتصال مع تحديد عدد المحاولات
function attemptReconnect(channel, guildId) {
  if (reconnectAttempts >= 5) {
    console.log('[VOICE] وصلت للحد الأقصى للمحاولات. توقف.');
    return;
  }

  try {
    // التأكد من عدم وجود اتصال قديم
    const oldConnection = getVoiceConnection(guildId);
    if (oldConnection) {
      oldConnection.removeAllListeners();
      oldConnection.destroy();
    }

    reconnectAttempts++;
    console.log(`[VOICE] محاولة إعادة الاتصال (${reconnectAttempts}/5)`);

    connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guildId,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfMute: CONFIG.selfMute,
      selfDeaf: CONFIG.selfDeaf,
    });

    setupVoiceHandlers(connection, channel, guildId);
    console.log('[VOICE] تم الاتصال بنجاح ✅');
    reconnectAttempts = 0; // تصفير العداد عند نجاح الاتصال
  } catch (error) {
    console.error('[VOICE] فشل الاتصال:', error.message);
    
    // تأخير متزايد بين المحاولات
    const delay = Math.min(5000 * reconnectAttempts, 60000);
    setTimeout(() => attemptReconnect(channel, guildId), delay);
  }
}

// دالة تنظيف الذاكرة
function cleanMemory() {
  if (global.gc) {
    global.gc();
    console.log('[MEMORY] تم تنظيف الذاكرة يدوياً');
  }
  
  const used = process.memoryUsage();
  console.log(`[MEMORY] رام: ${Math.round(used.rss / 1024 / 1024)}MB | هيب: ${Math.round(used.heapUsed / 1024 / 1024)}MB/${Math.round(used.heapTotal / 1024 / 1024)}MB`);

  // إذا زاد استخدام الرام عن 500MB، إعادة تشغيل البوت
  if (used.heapUsed > 500 * 1024 * 1024) {
    console.log('[MEMORY] تحذير: استخدام رام عالي جداً!');
    restartBot();
  }
}

// دالة إعادة تشغيل البوت بأمان
function restartBot() {
  console.log('[SYSTEM] جاري إعادة تشغيل البوت...');
  
  if (connection) {
    connection.removeAllListeners();
    connection.destroy();
    connection = null;
  }
  
  client.destroy();
  
  setTimeout(() => {
    client.login(process.env.TOKEN).catch(console.error);
  }, 10000);
}

// دالة الحفاظ على الاتصال (Heartbeat)
function startKeepAlive(channel, guildId) {
  setInterval(async () => {
    try {
      const currentConnection = getVoiceConnection(guildId);
      if (!currentConnection || currentConnection.state.status === VoiceConnectionStatus.Disconnected) {
        console.log('[KEEPALIVE] الاتصال مفقود، جاري الاستعادة...');
        connection = null;
        attemptReconnect(channel, guildId);
      }
    } catch (error) {
      console.error('[KEEPALIVE] خطأ:', error.message);
    }
  }, 60000); // فحص كل دقيقة
}

// ============ معالجات العمليات ============

// إغلاق آمن
process.on('SIGINT', async () => {
  console.log('[SYSTEM] جاري إغلاق البوت...');
  if (memoryCleanInterval) clearInterval(memoryCleanInterval);
  if (connection) {
    connection.removeAllListeners();
    connection.destroy();
  }
  client.destroy();
  process.exit(0);
});

// معالجة الأخطاء غير المتوقعة
process.on('unhandledRejection', (error) => {
  console.error('[ERROR] رفض غير معالج:', error?.message || error);
});

process.on('uncaughtException', (error) => {
  console.error('[ERROR] استثناء غير ممسوك:', error.message);
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
    console.log('[ERROR] خطأ شبكة، سيتم التعافي تلقائياً');
  }
});

// ============ البوت الأساسي ============

client.on('ready', async () => {
  console.log(`[BOT] ${client.user.username} جاهز ✅`);

  const channelId = process.env.CHANNEL_ID;
  const guildId = process.env.GUILD_ID;

  if (!channelId || !guildId) {
    console.error('[ERROR] CHANNEL_ID أو GUILD_ID مفقود في .env');
    process.exit(1);
  }

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) {
      console.error('[ERROR] الروم غير موجود');
      process.exit(1);
    }

    // الاتصال الأول
    await attemptReconnect(channel, guildId);
    
    // بدء مراقبة الاتصال
    startKeepAlive(channel, guildId);
    
    // بدء تنظيف الذاكرة الدوري
    memoryCleanInterval = setInterval(cleanMemory, 300000); // كل 5 دقائق

    console.log('[SYSTEM] جميع الأنظمة تعمل ✅');
  } catch (error) {
    console.error('[ERROR]', error.message);
  }
});

// معالجة أخطاء العميل
client.on('error', (error) => {
  console.error('[CLIENT] خطأ:', error.message);
});

client.on('warn', (warning) => {
  console.warn('[CLIENT] تحذير:', warning);
});

// ============ تشغيل البوت ============

if (!process.env.TOKEN) {
  console.error('[ERROR] TOKEN مفقود في .env');
  process.exit(1);
}

// تشغيل مع جمع القمامة يدوياً إن أمكن
client.login(process.env.TOKEN).catch((error) => {
  console.error('[LOGIN] فشل تسجيل الدخول:', error.message);
  process.exit(1);
});

// تشغيل مع فلاج تنظيف الذاكرة
console.log('[SYSTEM] للتشغيل الأمثل: node --expose-gc bot.js');