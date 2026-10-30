import express from 'express';
import { createServer as createViteServer } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require2 = createRequire(import.meta.url);

// Ensure whatsapp-rust-bridge export map works under both CJS and ESM loaders
for (const baseDir of [__dirname, path.join(__dirname, 'bot-engine')]) {
  try {
    const wrbPkgPath = path.join(baseDir, 'node_modules/whatsapp-rust-bridge/package.json');
    if (fs.existsSync(wrbPkgPath)) {
      const wrbPkg = JSON.parse(fs.readFileSync(wrbPkgPath, 'utf8'));
      if (wrbPkg.exports?.['.'] && !wrbPkg.exports['.'].default) {
        wrbPkg.main = './dist/index.js';
        wrbPkg.exports['.'].default = './dist/index.js';
        wrbPkg.exports['.'].require = './dist/index.js';
        fs.writeFileSync(wrbPkgPath, JSON.stringify(wrbPkg, null, 2) + '\n', 'utf8');
      }
    }
  } catch (_) {}
}

const NodeCache = require2('node-cache');
const pino = require2('pino');
const PhoneNumber = require2('awesome-phonenumber');
const baileys = require2('@whiskeysockets/baileys');

const makeWASocket =
  typeof baileys === 'function'
    ? baileys
    : baileys.default?.default || baileys.default || baileys.makeWASocket;
const useMultiFileAuthState =
  baileys.useMultiFileAuthState || baileys.default?.useMultiFileAuthState;
const DisconnectReason =
  baileys.DisconnectReason || baileys.default?.DisconnectReason;
const fetchLatestBaileysVersion =
  baileys.fetchLatestBaileysVersion || baileys.default?.fetchLatestBaileysVersion;
const makeCacheableSignalKeyStore =
  baileys.makeCacheableSignalKeyStore || baileys.default?.makeCacheableSignalKeyStore;
const jidNormalizedUser =
  baileys.jidNormalizedUser || baileys.default?.jidNormalizedUser || ((jid: string) => jid);
const jidDecode = baileys.jidDecode || baileys.default?.jidDecode;
const Browsers =
  baileys.Browsers ||
  baileys.default?.Browsers || {
    ubuntu: (browser: string) => ['Ubuntu', browser, '22.04.4'],
  };
const delay =
  baileys.delay ||
  baileys.default?.delay ||
  ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

async function resolveWaVersion(): Promise<[number, number, number]> {
  try {
    if (typeof fetchLatestBaileysVersion === 'function') {
      const res = await fetchLatestBaileysVersion();
      if (res?.version) return res.version;
    }
  } catch (_) {}
  return [2, 3000, 1019707846];
}

const messageStore: Record<string, Record<string, any>> = {};
const contactStore: Record<string, { id: string; name?: string; subject?: string; verifiedName?: string }> = {};

function cacheMessage(jid: string, id: string, msg: any) {
  if (!jid || !id || !msg) return;
  const norm = typeof jidNormalizedUser === 'function' ? jidNormalizedUser(jid) : jid;
  messageStore[norm] = messageStore[norm] || {};
  messageStore[norm][id] = msg;
  const keys = Object.keys(messageStore[norm]);
  if (keys.length > 100) {
    for (const k of keys.slice(0, keys.length - 100)) {
      delete messageStore[norm][k];
    }
  }
}

function loadCachedMessage(jid?: string, id?: string) {
  if (!jid || !id) return undefined;
  const norm = typeof jidNormalizedUser === 'function' ? jidNormalizedUser(jid) : jid;
  const entry = messageStore[norm]?.[id];
  return entry?.message || entry || undefined;
}

const BOT_ENGINE_DIR = path.join(__dirname, 'bot-engine');
const DATA_DIR = path.join(BOT_ENGINE_DIR, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const SESSION_DIR = path.join(BOT_ENGINE_DIR, 'session');
const VAULT_DIR = path.join(DATA_DIR, '.session_vault');
const PLUGINS_DIR = path.join(BOT_ENGINE_DIR, 'plugins');
const EPLUGINS_DIR = path.join(BOT_ENGINE_DIR, 'eplugins');

/**
 * Permanent Session Vault Protection:
 * Keeps an atomic backup copy of creds.json in both session/creds.json.bak
 * and data/.session_vault/creds.json so sudden phone power-off or battery drain
 * can never corrupt or clear the linked WhatsApp session.
 */
function ensureSessionVaultIntegrity(): boolean {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  fs.mkdirSync(VAULT_DIR, { recursive: true });
  const credsPath = path.join(SESSION_DIR, 'creds.json');
  const bakPath = path.join(SESSION_DIR, 'creds.json.bak');
  const vaultCredsPath = path.join(VAULT_DIR, 'creds.json');

  let validMain = false;
  if (fs.existsSync(credsPath)) {
    try {
      const raw = fs.readFileSync(credsPath, 'utf8').trim();
      if (raw.length > 20) {
        const parsed = JSON.parse(raw);
        if (parsed && (parsed.noiseKey || parsed.me || parsed.registered)) {
          validMain = true;
          fs.copyFileSync(credsPath, bakPath);
          fs.copyFileSync(credsPath, vaultCredsPath);
        }
      }
    } catch (_) {
      validMain = false;
    }
  }

  if (!validMain) {
    for (const candidate of [bakPath, vaultCredsPath]) {
      if (fs.existsSync(candidate)) {
        try {
          const raw = fs.readFileSync(candidate, 'utf8').trim();
          if (raw.length > 20) {
            JSON.parse(raw);
            fs.copyFileSync(candidate, credsPath);
            validMain = true;
            break;
          }
        } catch (_) {}
      }
    }
  }
  return validMain;
}

function hasRegisteredSession(): boolean {
  ensureSessionVaultIntegrity();
  const credsPath = path.join(SESSION_DIR, 'creds.json');
  try {
    if (fs.existsSync(credsPath)) {
      const parsed = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
      return Boolean(parsed?.registered || parsed?.me);
    }
  } catch (_) {}
  return false;
}

interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

const logs: LogEntry[] = [];
function addLog(level: LogEntry['level'], message: string) {
  const clean = String(message).replace(/\x1b\[[0-9;]*m/g, '').trim();
  if (!clean) return;
  logs.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    level,
    message: clean,
  });
  if (logs.length > 250) logs.shift();
}

let queenRiamMain: any = null;
let queenRiamSmsg: any = null;
function getQueenRiamMain() {
  if (!queenRiamMain) {
    const prevCwd = process.cwd();
    try {
      process.chdir(BOT_ENGINE_DIR);
      queenRiamMain = require2(path.join(BOT_ENGINE_DIR, 'main.js'));
      try {
        queenRiamSmsg = require2(path.join(BOT_ENGINE_DIR, 'lib/myfunc.js')).smsg;
      } catch (_) {}
      addLog('success', '[PLUGIN-LOADER] Loaded all Queen Riam plugins & command handlers from main.js');
    } catch (err: any) {
      addLog('error', `[PLUGIN-LOADER] Error loading main.js: ${err.message}`);
    } finally {
      process.chdir(prevCwd);
    }
  }
  return queenRiamMain;
}

let activeSock: any = null;
let alwaysOnlineTimer: NodeJS.Timeout | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let waitingForPairing = false;
const subSessions = new Map<string, { sock: any; state: any }>();

const serverState = {
  status: 'stopped' as 'stopped' | 'starting' | 'pairing' | 'online',
  startedAt: null as number | null,
  connectedJid: null as string | null,
  connectedName: null as string | null,
  pairingCode: null as string | null,
  pairingNumber: null as string | null,
  sessionLocked: true,
  wakeLockActive: true,
  wifiLockActive: true,
  batteryUnrestricted: true,
  foregroundServiceActive: true,
  queueStats: { sent: 0, pending: 0, retried: 0, failed: 0 },
};

function readConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (_) {}
  return {
    AUTOREAD: 'false',
    AUTOTYPE: 'false',
    AUTORECORD: 'false',
    AUTORECORDTYPE: 'false',
    AUTO_STATUS_REACT: 'true',
    AUTO_STATUS_REPLY: 'false',
    AUTO_STATUS_MSG: 'Viewed By Queen Riam',
    ANTICALL: 'off',
    BUTTONMODE: 'off',
    LANGUAGE: 'en',
    PREFIX: '.',
    ALWAYSONLINE: 'true',
    COMMAND_MODE: 'public',
    BOT_NAME: 'Queen Riam',
    BOT_OWNER: 'Hector Manuel',
    TIMEZONE: 'Africa/Accra',
    AUTO_JOIN_SUPPORT: 'true',
  };
}

function writeConfig(patch: Record<string, any>) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const current = readConfig();
  const next = { ...current, ...patch };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2) + '\n', 'utf8');
  try {
    const mcPath = path.join(DATA_DIR, 'messageCount.json');
    const mc = fs.existsSync(mcPath) ? JSON.parse(fs.readFileSync(mcPath, 'utf8')) : {};
    mc.isPublic = (next.COMMAND_MODE || 'public').toLowerCase() === 'public';
    fs.writeFileSync(mcPath, JSON.stringify(mc, null, 2) + '\n', 'utf8');
  } catch (_) {}
  try {
    const envLines = [
      `BOT_NAME=${next.BOT_NAME || 'Queen Riam'}`,
      `BOT_OWNER=${next.BOT_OWNER || 'Hector Manuel'}`,
      `PACK_NAME=${next.BOT_NAME || 'Queen Riam'}`,
      `PACK_AUTHOR=${next.BOT_OWNER || 'Hector Manuel'}`,
      `PREFIX=${next.PREFIX || '.'}`,
      `TIMEZONE=${next.TIMEZONE || 'Africa/Accra'}`,
      `COMMAND_MODE=${next.COMMAND_MODE || 'public'}`,
      `AUTO_STATUS_REACT=${next.AUTO_STATUS_REACT || 'false'}`,
      `AUTO_STATUS_REPLY=${next.AUTO_STATUS_REPLY || 'false'}`,
      `AUTO_STATUS_MSG=${next.AUTO_STATUS_MSG || 'Viewed By Queen Riam'}`,
      `AUTOREAD=${next.AUTOREAD || 'false'}`,
      `AUTOTYPE=${next.AUTOTYPE || 'false'}`,
      `AUTORECORD=${next.AUTORECORD || 'false'}`,
      `AUTORECORDTYPE=${next.AUTORECORDTYPE || 'false'}`,
      `DB_TYPE=`,
    ];
    fs.writeFileSync(path.join(BOT_ENGINE_DIR, '.env'), envLines.join('\n') + '\n', 'utf8');
  } catch (_) {}
  return next;
}

let cachedPlugins: any[] | null = null;
function scanPlugins() {
  const results: any[] = [];
  const dirs = [
    { dir: PLUGINS_DIR, isExternal: false },
    { dir: EPLUGINS_DIR, isExternal: true },
  ];
  for (const { dir, isExternal } of dirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n').length;
      const size = fs.statSync(fullPath).size;
      const botBlocks = [...content.matchAll(/bot\s*\(\s*\{([\s\S]*?)\}\s*,/g)];
      const commands: string[] = [];
      let category = isExternal ? 'external' : 'general';
      let description = '';
      let eventHook: string | null = null;

      for (const b of botBlocks) {
        const inner = b[1];
        const cmdArray = inner.match(/command\s*:\s*\[([^\]]+)\]/);
        if (cmdArray) {
          const items = [...cmdArray[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
          commands.push(...items);
        } else {
          const cmdStr = inner.match(/command\s*:\s*["']([^"']+)["']/);
          if (cmdStr) commands.push(cmdStr[1]);
        }
        const catM = inner.match(/category\s*:\s*["']([^"']+)["']/);
        if (catM) category = catM[1].toLowerCase();
        const descM = inner.match(/description\s*:\s*["']([^"']+)["']/);
        if (descM && !description) description = descM[1];
        const onM = inner.match(/on\s*:\s*["']([^"']+)["']/);
        if (onM) eventHook = onM[1];
      }
      if (!commands.length) commands.push(file.replace('.js', ''));
      results.push({
        file,
        isExternal,
        lines,
        size,
        commands: [...new Set(commands)],
        category,
        description: description || `Use .${commands[0]} in WhatsApp`,
        eventHook,
      });
    }
  }
  cachedPlugins = results;
  return results;
}

function createQueenRiamSocket(version: [number, number, number], state: any) {
  const msgRetryCounterCache = new NodeCache();
  const userDevicesCache = new NodeCache();
  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' })),
    },
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: true,
    getMessage: async (key: any) => loadCachedMessage(key?.remoteJid, key?.id),
    msgRetryCounterCache,
    userDevicesCache,
    shouldSyncHistoryMessage: () => false,
    syncFullHistory: false,
    defaultQueryTimeoutMs: undefined,
  });

  sock.decodeJid = (jid: string) => {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid) && typeof jidDecode === 'function') {
      const decode = jidDecode(jid) || {};
      return (decode.user && decode.server && `${decode.user}@${decode.server}`) || jid;
    }
    return jid;
  };

  sock.getName = (jid: string, withoutContact = false) => {
    const id = sock.decodeJid(jid);
    if (id === '0@s.whatsapp.net') return 'WhatsApp';
    if (id === sock.decodeJid(sock.user?.id)) return sock.user?.name || 'Queen Riam';
    const c = contactStore[id] || {};
    return (withoutContact ? '' : c.name) || c.subject || c.verifiedName || id.replace('@s.whatsapp.net', '');
  };

  sock.store = {
    messages: messageStore,
    contacts: contactStore,
    chats: {},
    loadMessage: async (jid: string, id: string) => {
      const m = loadCachedMessage(jid, id);
      return m ? { message: m } : null;
    },
  };

  if (queenRiamSmsg) {
    sock.serializeM = (m: any) => queenRiamSmsg(sock, m, sock.store);
  }
  return sock;
}

async function stopBotSocket() {
  waitingForPairing = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (alwaysOnlineTimer) {
    clearInterval(alwaysOnlineTimer);
    alwaysOnlineTimer = null;
  }
  if (activeSock) {
    try {
      activeSock.ev.removeAllListeners();
      activeSock.end(undefined);
    } catch (_) {}
    try {
      if (activeSock.ws) activeSock.ws.close();
    } catch (_) {}
    activeSock = null;
  }
  serverState.status = 'stopped';
  serverState.startedAt = null;
}

function attachSocketHandlers(
  sock: any,
  saveCreds: () => Promise<void>,
  cleanPhone: string,
  sendWelcomeOnOpen: boolean
) {
  const cfg = readConfig();
  sock.public = (cfg.COMMAND_MODE || 'public').toLowerCase() === 'public';

  const origSend = sock.sendMessage.bind(sock);
  sock.sendMessage = async (jid: string, content: any, opts?: any) => {
    serverState.queueStats.pending++;
    try {
      await delay(800);
      const result = await origSend(jid, content, opts);
      if (result?.key?.id && result?.message) {
        cacheMessage(jid, result.key.id, result.message);
      }
      serverState.queueStats.sent++;
      return result;
    } catch (err) {
      serverState.queueStats.failed++;
      throw err;
    } finally {
      serverState.queueStats.pending = Math.max(0, serverState.queueStats.pending - 1);
    }
  };

  sock.ev.on('creds.update', async () => {
    try {
      await saveCreds();
      ensureSessionVaultIntegrity();
    } catch (e: any) {
      addLog('error', `[CREDS] Failed saving creds: ${e.message}`);
    }
  });

  sock.ev.on('contacts.update', (updates: any[]) => {
    for (const contact of updates || []) {
      const id = sock.decodeJid(contact.id);
      if (id) contactStore[id] = { id, name: contact.notify || contact.name };
    }
  });

  sock.ev.on('connection.update', async (update: any) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'open') {
      waitingForPairing = false;
      serverState.status = 'online';
      serverState.pairingCode = null;
      serverState.connectedJid = sock.user?.id || null;
      serverState.connectedName = sock.user?.name || cfg.BOT_OWNER || 'Queen Riam User';
      ensureSessionVaultIntegrity();
      addLog('success', `🌿 Connected to => ${serverState.connectedName} (${serverState.connectedJid})`);
      addLog('success', '🔒 Permanent Session Vault Active — session will NEVER clear even if phone powers off!');

      if (alwaysOnlineTimer) clearInterval(alwaysOnlineTimer);
      const publishPresence = async () => {
        if (activeSock !== sock) return;
        try {
          const latestCfg2 = readConfig();
          if (latestCfg2.ALWAYSONLINE === 'true') {
            await sock.sendPresenceUpdate('available');
          }
        } catch (_) {}
      };
      publishPresence();
      alwaysOnlineTimer = setInterval(publishPresence, 25000);

      if (sendWelcomeOnOpen && sock.user?.id) {
        sendWelcomeOnOpen = false;
        try {
          await delay(1000);
          const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
          await sock.sendMessage(botNumber, {
            text:
              `👑 *${cfg.BOT_NAME || 'Queen Riam'}* is Online!\n\n` +
              `> 📌 User: ${serverState.connectedName}\n` +
              `> ⚡ Prefix: ${cfg.PREFIX || '.'}\n` +
              `> 🚀 Mode: ${cfg.COMMAND_MODE || 'public'}\n` +
              `> 🔒 Session: Permanent Vault (Never Auto-Clears)\n` +
              `> 👑 Owner: ${cfg.BOT_OWNER || 'Hector Manuel'}\n\n` +
              `✅ᴮᵒᵗ ᶜᵒⁿⁿᵉᶜᵗᵉᵈ ˢᵘᶜᶜᵉˢˢᶠᵘˡˡʸ`,
          });
        } catch (_) {}
      }

      const latestCfg = readConfig();
      if (latestCfg.AUTO_JOIN_SUPPORT !== 'false') {
        try {
          await sock.groupAcceptInvite('Bz0ixNd92xVCMefqWeRZHZ');
          addLog('success', '✅ Auto-joined WhatsApp group using invite code: Bz0ixNd92xVCMefqWeRZHZ');
        } catch (err: any) {
          const msg = err?.message || '';
          if (msg.includes('already') || msg === 'conflict') {
            addLog('info', '✅ Already a member of the Queen Riam WhatsApp group.');
          }
        }
        const channels = [
          { jid: '120363404284793169@newsletter', name: 'Queen Riam' },
          { jid: '120363176667494186@newsletter', name: 'Official Kango Channel' },
        ];
        for (const ch of channels) {
          try {
            if (typeof sock.newsletterFollow === 'function') {
              await sock.newsletterFollow(ch.jid);
            }
            addLog('success', `✅ Auto-followed channel: ${ch.name}`);
          } catch (_) {}
          try {
            if (typeof sock.subscribeNewsletterUpdates === 'function') {
              await sock.subscribeNewsletterUpdates(ch.jid);
            }
          } catch (_) {}
        }
      }
    }

    if (connection === 'close') {
      if (activeSock !== sock) return;
      if (alwaysOnlineTimer) {
        clearInterval(alwaysOnlineTimer);
        alwaysOnlineTimer = null;
      }
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const hasLinkedIdentity = Boolean(sock.authState?.creds?.me || sock.authState?.creds?.registered);

      // CRITICAL: NEVER delete session files on 401 or any disconnect!
      // Even if phone loses power or network drops, keep session files safe and auto-reconnect.
      if (
        statusCode === 515 ||
        statusCode === DisconnectReason?.restartRequired ||
        (waitingForPairing && hasLinkedIdentity)
      ) {
        addLog(
          'success',
          `[PAIRING] Restart required after code entry (${statusCode || 515}), waiting 6s for creds to save then reconnecting...`
        );
        waitingForPairing = false;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          startBotSocket({ ownerNumber: cleanPhone, requestNewCode: false, sendWelcome: true });
        }, 6000);
        return;
      }

      if (waitingForPairing) {
        addLog('info', '[PAIRING] Holding reconnect loop — waiting for user to enter code in WhatsApp.');
        return;
      }

      if (serverState.status !== 'stopped') {
        const retryMs = statusCode === 401 ? 8000 : 3500;
        addLog(
          'warn',
          `🔄 Connection interrupted (${statusCode || 'network'}). Session preserved in Permanent Vault — reconnecting in ${retryMs / 1000}s...`
        );
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          startBotSocket({ ownerNumber: cleanPhone, requestNewCode: false, sendWelcome: false });
        }, retryMs);
      }
    }
  });

  sock.ev.on('messages.upsert', async (chatUpdate: any) => {
    const m = chatUpdate.messages?.[0];
    if (!m?.message) return;
    if (m.key?.remoteJid && m.key?.id) {
      cacheMessage(m.key.remoteJid, m.key.id, m);
    }

    // Status broadcast auto-react & auto-reply
    if (
      m.key &&
      m.key.remoteJid === 'status@broadcast' &&
      m.key.participant &&
      m.key.participant !== sock.user?.id
    ) {
      try {
        const latestCfg = readConfig();
        if (latestCfg.AUTO_STATUS_REACT === 'true') {
          const statusJidList = [m.key.participant, m.key.participantAlt].filter(
            (jid, index, list) => jid && list.indexOf(jid) === index
          );
          const emojis = ['❤️', '💸', '😇', '🔥', '💯', '💎', '💗', '👑', '✨', '💜', '💚'];
          const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
          await sock.sendMessage(
            m.key.remoteJid,
            { react: { text: randomEmoji, key: m.key } },
            { statusJidList }
          );
        }
        if (latestCfg.AUTO_STATUS_REPLY === 'true') {
          await sock.sendMessage(
            m.key.participant,
            { text: latestCfg.AUTO_STATUS_MSG || 'Viewed By Queen Riam' },
            { quoted: m }
          );
        }
      } catch (_) {}
      const mainHandlers = getQueenRiamMain();
      if (mainHandlers?.handleStatus) {
        const prev = process.cwd();
        try {
          process.chdir(BOT_ENGINE_DIR);
          await mainHandlers.handleStatus(sock, chatUpdate);
        } catch (_) {} finally {
          process.chdir(prev);
        }
      }
      return;
    }

    const latestCfg = readConfig();
    if (latestCfg.AUTOREAD === 'true' && m.key) {
      try {
        await sock.readMessages([m.key]);
      } catch (_) {}
    }

    const text =
      m.message.conversation ||
      m.message.extendedTextMessage?.text ||
      m.message.imageMessage?.caption ||
      '';
    const prefix = latestCfg.PREFIX || '.';
    if (text.startsWith(prefix)) {
      const cmd = text.slice(prefix.length).trim().split(/\s+/)[0]?.toLowerCase();
      addLog('info', `[CMD] Executing ${prefix}${cmd} from ${m.key.remoteJid}`);
    }

    const mainHandlers = getQueenRiamMain();
    if (mainHandlers?.handleMessages) {
      const prev = process.cwd();
      try {
        process.chdir(BOT_ENGINE_DIR);
        await mainHandlers.handleMessages(sock, chatUpdate, true);
      } catch (err: any) {
        addLog('error', `[HANDLER] ${err.message}`);
      } finally {
        process.chdir(prev);
      }
    }
  });

  sock.ev.on('group-participants.update', async (update: any) => {
    const mainHandlers = getQueenRiamMain();
    if (mainHandlers?.handleGroupParticipantUpdate) {
      const prev = process.cwd();
      try {
        process.chdir(BOT_ENGINE_DIR);
        await mainHandlers.handleGroupParticipantUpdate(sock, update);
      } catch (_) {} finally {
        process.chdir(prev);
      }
    }
  });

  sock.ev.on('status.update', async (status: any) => {
    const mainHandlers = getQueenRiamMain();
    if (mainHandlers?.handleStatus) {
      const prev = process.cwd();
      try {
        process.chdir(BOT_ENGINE_DIR);
        await mainHandlers.handleStatus(sock, status);
      } catch (_) {} finally {
        process.chdir(prev);
      }
    }
  });
}

async function startBotSocket(options?: {
  ownerNumber?: string;
  sessionId?: string;
  requestNewCode?: boolean;
  sendWelcome?: boolean;
}): Promise<string | null> {
  await stopBotSocket();
  const cfg = readConfig();
  writeConfig(cfg);
  getQueenRiamMain();
  ensureSessionVaultIntegrity();

  if (options?.sessionId && options.sessionId.trim().startsWith('RIAM~')) {
    try {
      const b64 = options.sessionId.trim().replace(/^RIAM~/, '');
      const decoded = Buffer.from(b64, 'base64').toString('utf8');
      JSON.parse(decoded);
      fs.writeFileSync(path.join(SESSION_DIR, 'creds.json'), decoded, 'utf8');
      ensureSessionVaultIntegrity();
      addLog('success', '[SESSION] Decoded and saved RIAM~ base64 session to Permanent Vault.');
    } catch (err: any) {
      addLog('error', `[SESSION] Invalid RIAM~ session string: ${err.message}`);
    }
  }

  serverState.status = 'starting';
  serverState.startedAt = Date.now();
  const rawPhone = options?.ownerNumber || '';
  const cleanPhone = rawPhone.replace(/[^0-9]/g, '');
  if (cleanPhone) serverState.pairingNumber = cleanPhone;

  try {
    const version = await resolveWaVersion();
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const wrappedSaveCreds = async () => {
      await saveCreds();
      ensureSessionVaultIntegrity();
    };

    let sock = createQueenRiamSocket(version, state);
    activeSock = sock;

    const hasExistingSession = Boolean(state.creds?.registered || state.creds?.me);
    const shouldPairWithCode = Boolean(options?.requestNewCode && cleanPhone && !hasExistingSession);

    attachSocketHandlers(sock, wrappedSaveCreds, cleanPhone, Boolean(options?.sendWelcome));

    if (shouldPairWithCode) {
      const pn = new PhoneNumber('+' + cleanPhone);
      if (typeof pn.isValid === 'function' && !pn.isValid()) {
        addLog('error', `[PAIRING] Invalid international phone number format: +${cleanPhone}`);
        return null;
      }

      const MAX_ATTEMPTS = 3;
      let lastErr: any = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (attempt > 1) {
          addLog('warn', `[PAIRING] Retry attempt ${attempt}/${MAX_ATTEMPTS} for +${cleanPhone}...`);
          try {
            sock.ev.removeAllListeners();
            sock.end(undefined);
          } catch (_) {}
          await delay(5000);
          const freshAuth = await useMultiFileAuthState(SESSION_DIR);
          const freshSave = async () => {
            await freshAuth.saveCreds();
            ensureSessionVaultIntegrity();
          };
          sock = createQueenRiamSocket(version, freshAuth.state);
          activeSock = sock;
          attachSocketHandlers(sock, freshSave, cleanPhone, true);
        }

        await delay(3000);
        if (activeSock !== sock) return null;

        try {
          const codePromise = sock.requestPairingCode(cleanPhone);
          const timeoutPromise = new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error('Pairing code request timed out after 30s')), 30000)
          );
          let code = await Promise.race([codePromise, timeoutPromise]);
          code = code?.match(/.{1,4}/g)?.join('-') || code;
          serverState.pairingCode = code;
          serverState.status = 'pairing';
          waitingForPairing = true;
          addLog('success', `🔑 Your Pairing Code : ${code}`);
          addLog(
            'info',
            `👉 Open WhatsApp > Settings > Linked Devices > Link a Device > Enter ${code} (keep this server running while linking)`
          );
          return code;
        } catch (err: any) {
          lastErr = err;
          addLog('warn', `[PAIRING] Attempt ${attempt}/${MAX_ATTEMPTS} failed for +${cleanPhone}: ${err.message}`);
        }
      }
      waitingForPairing = false;
      addLog('error', `[PAIRING] All ${MAX_ATTEMPTS} pairing attempts failed: ${lastErr?.message || 'Unknown error'}`);
      return null;
    } else if (hasExistingSession) {
      addLog('info', '[SESSION] Found permanent credentials in /session/creds.json — completing WhatsApp connection...');
    }
    return null;
  } catch (err: any) {
    addLog('error', `[ENGINE] Failed to initialize socket: ${err.message}`);
    serverState.status = 'stopped';
    return null;
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());

  addLog('info', '👑 Queen Riam Android Server Environment Initialized (Node.js v20 ARM64 target)');
  addLog('info', '🔒 Permanent Session Vault Enabled: Session NEVER clears unless you click Clear Session');

  app.get('/api/bot/status', (_req, res) => {
    const mem = process.memoryUsage();
    const credsExists = hasRegisteredSession();
    res.json({
      ...serverState,
      uptimeSeconds: serverState.startedAt ? Math.floor((Date.now() - serverState.startedAt) / 1000) : 0,
      memoryMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
      hasSavedSession: credsExists,
      sessionLocked: true,
      config: readConfig(),
      subSessions: Array.from(subSessions.values()).map((s) => s.state),
    });
  });

  app.post('/api/bot/start', async (req, res) => {
    const { ownerNumber, sessionId } = req.body || {};
    const clean = String(ownerNumber || '').replace(/[^0-9]/g, '');
    const hasRegisteredCreds = hasRegisteredSession();
    const shouldRequestCode = !hasRegisteredCreds && !sessionId && Boolean(clean);

    // Only clean incomplete unlinked temp files if there is NO registered session
    if (shouldRequestCode && !hasRegisteredCreds) {
      try {
        if (fs.existsSync(SESSION_DIR)) {
          for (const f of fs.readdirSync(SESSION_DIR)) {
            const full = path.join(SESSION_DIR, f);
            if (fs.statSync(full).isFile()) fs.unlinkSync(full);
          }
        }
      } catch (_) {}
    }

    const code = await startBotSocket({
      ownerNumber: clean,
      sessionId,
      requestNewCode: shouldRequestCode,
      sendWelcome: true,
    });
    res.json({
      ok: true,
      status: serverState.status,
      pairingCode: code || serverState.pairingCode,
      pairingNumber: serverState.pairingNumber,
    });
  });

  app.post('/api/bot/stop', async (_req, res) => {
    await stopBotSocket();
    addLog('warn', '[ANDROID-FGS] Queen Riam bot paused by user (WhatsApp session remains safely locked in storage).');
    res.json({ ok: true, status: serverState.status });
  });

  app.post('/api/bot/pair', async (req, res) => {
    const { phoneNumber, sessionId, isSubSession } = req.body || {};
    const clean = String(phoneNumber || '').replace(/[^0-9]/g, '');
    if (!clean && !sessionId) {
      res.status(400).json({ error: 'Please enter a valid WhatsApp phone number with country code (digits only).' });
      return;
    }

    if (isSubSession && clean) {
      const subDir = path.join(SESSION_DIR, clean);
      fs.mkdirSync(subDir, { recursive: true });
      const subState = {
        number: clean,
        status: 'pairing',
        pairingCode: null as string | null,
        connectedAt: null as number | null,
      };
      addLog('info', `[SUB-SESSION] Requesting pairing code for secondary number +${clean} (3x retry enabled)...`);
      try {
        const version = await resolveWaVersion();
        const { state, saveCreds } = await useMultiFileAuthState(subDir);
        const subSock = createQueenRiamSocket(version, state);
        subSock.ev.on('creds.update', saveCreds);
        let handedOff = false;
        subSock.ev.on('connection.update', async (update: any) => {
          const { connection, lastDisconnect } = update;
          if (connection === 'open') {
            subState.status = 'online';
            subState.connectedAt = Date.now();
            addLog('success', `✅ [SUB-SESSION] Secondary number +${clean} connected!`);
          }
          if (connection === 'close' && !handedOff) {
            const code3 = lastDisconnect?.error?.output?.statusCode;
            if (code3 === 515 || code3 === DisconnectReason?.restartRequired || subSock.authState?.creds?.me) {
              handedOff = true;
              addLog('info', `[SUB-SESSION] Pairing socket closed (${code3}) for +${clean} → starting persistent sub-session...`);
              setTimeout(async () => {
                try {
                  const freshAuth = await useMultiFileAuthState(subDir);
                  const liveSock = createQueenRiamSocket(version, freshAuth.state);
                  liveSock.ev.on('creds.update', freshAuth.saveCreds);
                  subSessions.set(clean, { sock: liveSock, state: subState });
                  liveSock.ev.on('connection.update', (u: any) => {
                    if (u.connection === 'open') {
                      subState.status = 'online';
                      subState.connectedAt = Date.now();
                      addLog('success', `✅ [SUB-SESSION] +${clean} is now ONLINE!`);
                    }
                  });
                } catch (_) {}
              }, 4000);
            }
          }
        });
        subSessions.set(clean, { sock: subSock, state: subState });
        await delay(3000);
        let code2 = await subSock.requestPairingCode(clean);
        code2 = code2?.match(/.{1,4}/g)?.join('-') || code2;
        subState.pairingCode = code2;
        addLog('success', `🔑 [SUB-SESSION] Pairing code for +${clean}: ${code2}`);
        res.json({ ok: true, pairingCode: code2, subSession: subState });
        return;
      } catch (err: any) {
        addLog('error', `[SUB-SESSION] Error pairing +${clean}: ${err.message}`);
        res.status(500).json({ error: err.message });
        return;
      }
    }

    const alreadyLinked = hasRegisteredSession();
    if (alreadyLinked && !sessionId) {
      addLog(
        'info',
        '[SESSION-LOCK] Active WhatsApp session is already saved & locked! Reconnecting existing session (tap Unlink / Clear Session first if you want to link a different number).'
      );
      await startBotSocket({ ownerNumber: clean, requestNewCode: false, sendWelcome: false });
      res.json({
        ok: true,
        status: serverState.status,
        pairingCode: null,
        pairingNumber: clean,
        sessionAlreadyLocked: true,
      });
      return;
    }

    if (!sessionId && !alreadyLinked) {
      try {
        if (fs.existsSync(SESSION_DIR)) {
          for (const f of fs.readdirSync(SESSION_DIR)) {
            const full = path.join(SESSION_DIR, f);
            if (fs.statSync(full).isFile()) fs.unlinkSync(full);
          }
        }
      } catch (_) {}
    }

    const code = await startBotSocket({
      ownerNumber: clean,
      sessionId,
      requestNewCode: !sessionId && Boolean(clean),
      sendWelcome: true,
    });
    res.json({
      ok: true,
      status: serverState.status,
      pairingCode: code || serverState.pairingCode,
      pairingNumber: clean,
    });
  });

  // ONLY endpoint that can ever clear the session (explicit user action)
  app.post('/api/bot/logout', async (_req, res) => {
    await stopBotSocket();
    for (const dir of [SESSION_DIR, VAULT_DIR]) {
      try {
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
          fs.mkdirSync(dir, { recursive: true });
        }
      } catch (_) {}
    }
    serverState.connectedJid = null;
    serverState.connectedName = null;
    serverState.pairingCode = null;
    addLog('warn', '[SESSION] User explicitly cleared primary WhatsApp session credentials from phone storage & vault.');
    res.json({ ok: true });
  });

  app.get('/api/bot/config', (_req, res) => {
    res.json(readConfig());
  });

  app.post('/api/bot/config', (req, res) => {
    const updated = writeConfig(req.body || {});
    addLog('success', `[CONFIG] Saved settings: ${Object.keys(req.body || {}).join(', ')}`);
    res.json(updated);
  });

  app.get('/api/bot/plugins', (_req, res) => {
    const list = cachedPlugins || scanPlugins();
    res.json({ plugins: list });
  });

  app.post('/api/bot/plugins/install', async (req, res) => {
    const { url, name } = req.body || {};
    if (!url || !String(url).startsWith('http')) {
      res.status(400).json({ error: 'Please provide a valid http/https plugin or GitHub Gist URL.' });
      return;
    }
    try {
      let rawUrl = String(url).trim();
      if (rawUrl.includes('gist.github.com') && !rawUrl.includes('raw')) {
        rawUrl = rawUrl.replace('gist.github.com', 'gist.githubusercontent.com').replace(/\/?$/, '/raw/');
      }
      const response = await fetch(rawUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} fetching plugin from URL`);
      }
      const code = await response.text();
      fs.mkdirSync(EPLUGINS_DIR, { recursive: true });
      const cleanName =
        (name ? String(name).replace(/[^a-zA-Z0-9_-]/g, '') : path.basename(rawUrl.split('?')[0], '.js')) ||
        `eplugin-${Date.now()}`;
      const fileName = `${cleanName}.js`;
      fs.writeFileSync(path.join(EPLUGINS_DIR, fileName), code, 'utf8');
      const regPath = path.join(BOT_ENGINE_DIR, 'eplugins-registry.json');
      const reg = fs.existsSync(regPath) ? JSON.parse(fs.readFileSync(regPath, 'utf8')) : { plugins: [] };
      reg.plugins = reg.plugins.filter((p: any) => p.name !== cleanName);
      reg.plugins.push({ name: cleanName, url: rawUrl });
      fs.writeFileSync(regPath, JSON.stringify(reg, null, 2) + '\n', 'utf8');
      const refreshed = scanPlugins();
      addLog('success', `[EPLUGIN] Installed external plugin "${fileName}" (${refreshed.length} total plugins)`);
      res.json({ ok: true, fileName, plugins: refreshed });
    } catch (err: any) {
      addLog('error', `[EPLUGIN] Failed to install URL plugin: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/bot/plugins/remove', (req, res) => {
    const { file } = req.body || {};
    const target = path.join(EPLUGINS_DIR, path.basename(String(file || '')));
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
      addLog('warn', `[EPLUGIN] Removed external plugin ${file}`);
    }
    const refreshed = scanPlugins();
    res.json({ ok: true, plugins: refreshed });
  });

  app.get('/api/bot/logs', (_req, res) => {
    res.json({ logs });
  });

  app.post('/api/bot/logs/clear', (_req, res) => {
    logs.length = 0;
    addLog('info', '[CONSOLE] Logs cleared.');
    res.json({ ok: true, logs });
  });

  const EXPORT_ORDERED_REL_PATHS = [
    'server.ts',
    'package.json',
    'tsconfig.json',
    'vite.config.ts',
    'index.html',
    'metadata.json',
    '.gitignore',
    'BUILD_APK_GUIDE.md',
    'src/main.tsx',
    'src/App.tsx',
    'src/index.css',
    'android/settings.gradle',
    'android/build.gradle',
    'android/gradle.properties',
    'android/app/build.gradle',
    'android/app/src/main/AndroidManifest.xml',
    'android/app/src/main/cpp/CMakeLists.txt',
    'android/app/src/main/cpp/native-lib.cpp',
    'android/app/src/main/cpp/include/node/node.h',
    'android/app/src/main/java/com/kango/queenriam/MainActivity.kt',
    'android/app/src/main/java/com/kango/queenriam/BotForegroundService.kt',
    'android/app/src/main/java/com/kango/queenriam/BootReceiver.kt',
    'bot-engine/package.json',
    'bot-engine/mobile-server.js',
    'bot-engine/index.js',
    'bot-engine/main.js',
    'bot-engine/config.js',
    'bot-engine/settings.js',
    'bot-engine/eplugins-registry.json',
    'bot-engine/unpack-bundle.js',
    'bot-engine/engine-bundle.json',
    '.github/workflows/build-apk.yml',
  ];

  const refreshEngineBundleOnDisk = (): number => {
    const zlib = require2('zlib');
    const bundleFiles: Record<string, { encoding: 'utf8' | 'base64'; data: string }> = {};
    const collectBundleDir = (relSubDir: string) => {
      const absSubDir = path.join(BOT_ENGINE_DIR, relSubDir);
      if (!fs.existsSync(absSubDir)) return;
      const walk = (dir: string, relPrefix: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const name = entry.name;
          if (
            name === '.session_vault' ||
            name === '_backup_category_files' ||
            name === 'status_jids.json' ||
            name === 'processedIds.json' ||
            name.endsWith('.mp3') ||
            name.startsWith('ban-files-before-clear') ||
            name.includes('_2349167394281') ||
            name.includes('_256707934960')
          ) {
            continue;
          }
          const full = path.join(dir, name);
          const rel = `${relPrefix}/${name}`;
          if (entry.isDirectory()) {
            walk(full, rel);
          } else if (entry.isFile()) {
            const buf = fs.readFileSync(full);
            const isText = /\.(js|json|txt|md|html|css|ts|yml|yaml|env|gitignore|nvmrc)$/i.test(name);
            bundleFiles[rel] = {
              encoding: isText ? 'utf8' : 'base64',
              data: isText ? buf.toString('utf8') : buf.toString('base64'),
            };
          }
        }
      };
      walk(absSubDir, relSubDir);
    };

    for (const folder of ['lib', 'plugins', 'lang', 'media', 'data', 'eplugins']) {
      collectBundleDir(folder);
    }
    bundleFiles['session/.gitkeep'] = { encoding: 'utf8', data: '' };

    const gzPayload = zlib
      .gzipSync(Buffer.from(JSON.stringify(bundleFiles), 'utf8'), { level: 9 })
      .toString('base64');

    const totalBundled = Object.keys(bundleFiles).length;
    const engineBundleJson = JSON.stringify(
      {
        version: '1.0.0',
        generatedAt: new Date().toISOString(),
        totalFiles: totalBundled,
        gzBase64: gzPayload,
      },
      null,
      2
    );
    fs.writeFileSync(path.join(BOT_ENGINE_DIR, 'engine-bundle.json'), engineBundleJson, 'utf8');
    return totalBundled;
  };

  // Full Android APK Project ZIP Export (supports both /api/android/export-zip and /api/export/android-project)
  const handleExportZip = (_req: express.Request, res: express.Response) => {
    try {
      const ROOT_WRAPPER = 'Queen-Riam-Server';
      const totalBundled = refreshEngineBundleOnDisk();

      // Build uncompressed STORE (method = 0) ZIP archive so both standard extractors AND mobile GitHub uploaders (like Taurus Shield) read raw UTF-8 bytes without DEFLATE corruption
      const crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
          c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        crcTable[n] = c >>> 0;
      }
      const crc32 = (buf: Buffer): number => {
        let c = 0xffffffff;
        for (let i = 0; i < buf.length; i++) {
          c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
        }
        return (c ^ 0xffffffff) >>> 0;
      };

      const localChunks: Buffer[] = [];
      const centralChunks: Buffer[] = [];
      let offset = 0;
      let entryCount = 0;

      for (const relPath of EXPORT_ORDERED_REL_PATHS) {
        const absPath = path.join(__dirname, relPath);
        if (!fs.existsSync(absPath)) continue;
        const dataBuf = fs.readFileSync(absPath);
        const zipEntryName = `${ROOT_WRAPPER}/${relPath}`;
        const nameBuf = Buffer.from(zipEntryName, 'utf8');
        const crc = crc32(dataBuf);
        const size = dataBuf.length;

        // Local file header (30 bytes) - compressionMethod = 0 (STORE / uncompressed)
        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0); // signature
        localHeader.writeUInt16LE(20, 4); // version needed
        localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
        localHeader.writeUInt16LE(0, 8); // method = 0 (STORE - uncompressed!)
        localHeader.writeUInt16LE(0, 10); // mod time
        localHeader.writeUInt16LE(0x595e, 12); // mod date
        localHeader.writeUInt32LE(crc, 14); // crc32
        localHeader.writeUInt32LE(size, 18); // compressed size === uncompressed size
        localHeader.writeUInt32LE(size, 22); // uncompressed size
        localHeader.writeUInt16LE(nameBuf.length, 26); // filename length
        localHeader.writeUInt16LE(0, 28); // extra field length

        localChunks.push(localHeader, nameBuf, dataBuf);

        // Central directory header (46 bytes) - compressionMethod = 0 (STORE)
        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0); // signature
        centralHeader.writeUInt16LE(20, 4); // version made by
        centralHeader.writeUInt16LE(20, 6); // version needed
        centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 flag
        centralHeader.writeUInt16LE(0, 10); // method = 0 (STORE - uncompressed!)
        centralHeader.writeUInt16LE(0, 12); // mod time
        centralHeader.writeUInt16LE(0x595e, 14); // mod date
        centralHeader.writeUInt32LE(crc, 16); // crc32
        centralHeader.writeUInt32LE(size, 20); // compressed size
        centralHeader.writeUInt32LE(size, 24); // uncompressed size
        centralHeader.writeUInt16LE(nameBuf.length, 28); // filename length
        centralHeader.writeUInt16LE(0, 30); // extra length
        centralHeader.writeUInt16LE(0, 32); // comment length
        centralHeader.writeUInt16LE(0, 34); // disk number
        centralHeader.writeUInt16LE(0, 36); // internal attrs
        centralHeader.writeUInt32LE(0, 38); // external attrs
        centralHeader.writeUInt32LE(offset, 42); // local header offset

        centralChunks.push(centralHeader, nameBuf);
        offset += 30 + nameBuf.length + size;
        entryCount++;
      }

      const centralDirBuf = Buffer.concat(centralChunks);
      const eocd = Buffer.alloc(22);
      eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
      eocd.writeUInt16LE(0, 4); // disk number
      eocd.writeUInt16LE(0, 6); // central dir disk
      eocd.writeUInt16LE(entryCount, 8); // entries on disk
      eocd.writeUInt16LE(entryCount, 10); // total entries
      eocd.writeUInt32LE(centralDirBuf.length, 12); // central dir size
      eocd.writeUInt32LE(offset, 16); // central dir offset
      eocd.writeUInt16LE(0, 20); // comment length

      const zipBuffer = Buffer.concat([...localChunks, centralDirBuf, eocd]);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="Queen-Riam-Android-Server.zip"');
      res.setHeader('Content-Length', String(zipBuffer.length));
      addLog(
        'success',
        `[APK-EXPORT] Packaged uncompressed STORE Queen-Riam-Android-Server.zip (${entryCount} top-level files + ${totalBundled} bundled bot files, ${(zipBuffer.length / 1024 / 1024).toFixed(2)} MB)`
      );
      res.send(zipBuffer);
    } catch (err: any) {
      console.error('Zip archive error:', err);
      addLog('error', `[APK-EXPORT] Failed to build zip: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  };

  app.get('/api/android/export-zip', handleExportZip);
  app.get('/api/export/android-project', handleExportZip);

  // GitHub OAuth & Atomic Repository Push State
  let githubConnectedToken: string | null = process.env.GITHUB_TOKEN || null;
  let githubConnectedUser: string | null = null;

  app.get('/api/auth/github/url', (req, res) => {
    const clientId = process.env.GITHUB_CLIENT_ID || process.env.CLIENT_ID || '';
    const baseUrl = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const redirectUri = `${baseUrl}/auth/github/callback`;
    if (!clientId) {
      return res.status(400).json({
        error:
          'GITHUB_CLIENT_ID is not configured in environment variables yet. Share your GitHub token in chat or configure GITHUB_CLIENT_ID & GITHUB_CLIENT_SECRET.',
        redirectUri,
      });
    }
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'repo workflow',
    });
    res.json({
      url: `https://github.com/login/oauth/authorize?${params.toString()}`,
      redirectUri,
    });
  });

  const handleGitHubOAuthCallback = async (req: express.Request, res: express.Response) => {
    try {
      const code = String(req.query.code || '');
      const clientId = process.env.GITHUB_CLIENT_ID || process.env.CLIENT_ID || '';
      const clientSecret = process.env.GITHUB_CLIENT_SECRET || process.env.CLIENT_SECRET || '';
      if (code && clientId && clientSecret) {
        const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code,
          }),
        });
        const tokenData: any = await tokenRes.json();
        if (tokenData?.access_token) {
          githubConnectedToken = tokenData.access_token;
          const userRes = await fetch('https://api.github.com/user', {
            headers: {
              Authorization: `Bearer ${githubConnectedToken}`,
              'User-Agent': 'Queen-Riam-Server',
            },
          });
          if (userRes.ok) {
            const userJson: any = await userRes.json();
            githubConnectedUser = userJson.login || null;
          }
          addLog('success', `[GITHUB-OAUTH] Connected GitHub account: ${githubConnectedUser || 'authorized'}`);
        }
      }
    } catch (err: any) {
      addLog('error', `[GITHUB-OAUTH] Callback error: ${err.message}`);
    }

    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>GitHub authentication complete. This window will close automatically.</p>
        </body>
      </html>
    `);
  };

  app.get(['/auth/github/callback', '/auth/github/callback/'], handleGitHubOAuthCallback);

  app.get('/api/github/repo-status', async (req, res) => {
    const repo = String(req.query.repo || process.env.GITHUB_REPO || 'Luckycia404/riam-apk').trim();
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Queen-Riam-Server',
    };
    if (githubConnectedToken) {
      headers.Authorization = `Bearer ${githubConnectedToken}`;
    }
    try {
      const [runsRes, contentsRes] = await Promise.all([
        fetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=5`, { headers }),
        fetch(`https://api.github.com/repos/${repo}/contents`, { headers }),
      ]);
      const runsData: any = runsRes.ok ? await runsRes.json() : { workflow_runs: [] };
      const contentsData: any = contentsRes.ok ? await contentsRes.json() : [];
      const rootEntries = Array.isArray(contentsData) ? contentsData.map((item: any) => item.name) : [];
      const hasCompleteStructure =
        rootEntries.includes('android') &&
        rootEntries.includes('bot-engine') &&
        rootEntries.includes('package.json') &&
        rootEntries.includes('server.ts');

      res.json({
        repo,
        connected: Boolean(githubConnectedToken),
        connectedUser: githubConnectedUser,
        hasCompleteStructure,
        rootEntries,
        runs: (runsData.workflow_runs || []).slice(0, 5).map((r: any) => ({
          id: r.id,
          name: r.name,
          status: r.status,
          conclusion: r.conclusion,
          htmlUrl: r.html_url,
          headSha: String(r.head_sha || '').slice(0, 7),
          createdAt: r.created_at,
          displayTitle: r.display_title,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/github/push', async (req, res) => {
    const repo = String(req.body?.repo || process.env.GITHUB_REPO || 'Luckycia404/riam-apk').trim();
    const branch = String(req.body?.branch || 'main').trim();
    const token = String(req.body?.token || githubConnectedToken || process.env.GITHUB_TOKEN || '').trim();
    if (!token) {
      return res.status(400).json({
        error:
          'No GitHub authorization token is active yet. Connect GitHub OAuth or share your GitHub Personal Access Token in chat so the server can push directly.',
      });
    }

    try {
      githubConnectedToken = token;
      const totalBundled = refreshEngineBundleOnDisk();
      addLog('info', `[GITHUB-PUSH] Preparing single-commit atomic push to ${repo} (${branch})...`);

      const ghHeaders = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'Queen-Riam-Server',
      };

      // 1. Get current branch HEAD commit SHA
      const refRes = await fetch(`https://api.github.com/repos/${repo}/git/ref/heads/${branch}`, {
        headers: ghHeaders,
      });
      if (!refRes.ok) {
        const errText = await refRes.text();
        throw new Error(`Failed to read branch ${branch} on ${repo} (${refRes.status}): ${errText}`);
      }
      const refData: any = await refRes.json();
      const parentCommitSha = refData?.object?.sha;

      // 2. Create Git blobs for all 32 project files
      const treeItems: Array<{ path: string; mode: string; type: string; sha: string }> = [];
      for (const relPath of EXPORT_ORDERED_REL_PATHS) {
        const absPath = path.join(__dirname, relPath);
        if (!fs.existsSync(absPath)) continue;
        const buf = fs.readFileSync(absPath);
        const blobRes = await fetch(`https://api.github.com/repos/${repo}/git/blobs`, {
          method: 'POST',
          headers: ghHeaders,
          body: JSON.stringify({
            content: buf.toString('base64'),
            encoding: 'base64',
          }),
        });
        if (!blobRes.ok) {
          const errText = await blobRes.text();
          throw new Error(`Failed creating blob for ${relPath} (${blobRes.status}): ${errText}`);
        }
        const blobData: any = await blobRes.json();
        treeItems.push({
          path: relPath,
          mode: '100644',
          type: 'blob',
          sha: blobData.sha,
        });
      }

      // 3. Create a clean root Git tree (omitting base_tree so broken Taurus Shield files at app/ are wiped cleanly)
      const treeRes = await fetch(`https://api.github.com/repos/${repo}/git/trees`, {
        method: 'POST',
        headers: ghHeaders,
        body: JSON.stringify({ tree: treeItems }),
      });
      if (!treeRes.ok) {
        const errText = await treeRes.text();
        throw new Error(`Failed creating Git tree (${treeRes.status}): ${errText}`);
      }
      const treeData: any = await treeRes.json();

      // 4. Create a single atomic commit
      const commitRes = await fetch(`https://api.github.com/repos/${repo}/git/commits`, {
        method: 'POST',
        headers: ghHeaders,
        body: JSON.stringify({
          message: 'Deploy complete Queen Riam Android APK project & 155 plugins (atomic single commit)',
          tree: treeData.sha,
          parents: parentCommitSha ? [parentCommitSha] : [],
        }),
      });
      if (!commitRes.ok) {
        const errText = await commitRes.text();
        throw new Error(`Failed creating Git commit (${commitRes.status}): ${errText}`);
      }
      const commitData: any = await commitRes.json();

      // 5. Update refs/heads/main to point to the new commit
      const updateRefRes = await fetch(`https://api.github.com/repos/${repo}/git/refs/heads/${branch}`, {
        method: 'PATCH',
        headers: ghHeaders,
        body: JSON.stringify({
          sha: commitData.sha,
          force: true,
        }),
      });
      if (!updateRefRes.ok) {
        const errText = await updateRefRes.text();
        throw new Error(`Failed updating branch ref (${updateRefRes.status}): ${errText}`);
      }

      addLog(
        'success',
        `[GITHUB-PUSH] Pushed ${treeItems.length} files (+ ${totalBundled} bundled bot files) to ${repo}@${branch} in commit ${String(commitData.sha).slice(0, 7)}!`
      );

      res.json({
        ok: true,
        repo,
        branch,
        commitSha: commitData.sha,
        filesPushed: treeItems.length,
        bundledBotFiles: totalBundled,
        actionsUrl: `https://github.com/${repo}/actions`,
      });
    } catch (err: any) {
      addLog('error', `[GITHUB-PUSH] Error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        watch: {
          ignored: [
            '**/bot-engine/**',
            '**/android/**',
            '**/android-project/**',
            '**/dist/**',
          ],
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Queen Riam Android Server Controller running on http://0.0.0.0:${PORT}`);
    setTimeout(() => {
      try {
        if (hasRegisteredSession()) {
          addLog('info', '[AUTO-RESUME] Found permanent WhatsApp session on disk — reconnecting automatically...');
          startBotSocket({ requestNewCode: false, sendWelcome: false });
        }
      } catch (_) {}
    }, 1500);
  });
}

process.on('uncaughtException', (err: any) => {
  addLog('error', `[UNCAUGHT] ${err?.message || err}`);
});

process.on('unhandledRejection', (reason: any) => {
  addLog('error', `[UNHANDLED] ${reason?.message || reason}`);
});

startServer();
