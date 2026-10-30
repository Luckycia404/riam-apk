/**
 * Queen Riam Embedded Android Server (mobile-server.js)
 * Executed inside libnode.so by BotForegroundService.kt on port 3000.
 * Features Permanent Session Vault Protection:
 *  - Session NEVER clears on phone power-off, battery drain, reboot, or network loss.
 *  - Automatic atomic backup to creds.json.bak + Android Vault directory.
 *  - Only explicit user action (POST /api/bot/logout) can clear the session.
 */

const fs = require('fs');
const path = require('path');

// Auto-extract engine-bundle.json if plugins/ or lib/ have not been unpacked yet
try {
  if (
    !fs.existsSync(path.join(__dirname, 'plugins')) ||
    !fs.existsSync(path.join(__dirname, 'lib'))
  ) {
    const unpackerPath = path.join(__dirname, 'unpack-bundle.js');
    if (fs.existsSync(unpackerPath)) {
      require(unpackerPath).unpackEngineBundle(__dirname);
    }
  }
} catch (_) {}

// Patch whatsapp-rust-bridge export map if needed
try {
  const wrbPkgPath = path.join(__dirname, 'node_modules/whatsapp-rust-bridge/package.json');
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

const express = require('express');
const NodeCache = require('node-cache');
const pino = require('pino');
const baileys = require('@whiskeysockets/baileys');

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
  baileys.jidNormalizedUser || baileys.default?.jidNormalizedUser || ((j) => j);
const jidDecode = baileys.jidDecode || baileys.default?.jidDecode;
const Browsers =
  baileys.Browsers || baileys.default?.Browsers || { ubuntu: (b) => ['Ubuntu', b, '22.04.4'] };
const delay =
  baileys.delay || baileys.default?.delay || ((ms) => new Promise((r) => setTimeout(r, ms)));

const BOT_ENGINE_DIR = __dirname;
const DATA_DIR = path.join(BOT_ENGINE_DIR, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const SESSION_DIR = path.join(BOT_ENGINE_DIR, 'session');
const PLUGINS_DIR = path.join(BOT_ENGINE_DIR, 'plugins');
const EPLUGINS_DIR = path.join(BOT_ENGINE_DIR, 'eplugins');

// Optional Android hardware-backed vault directory passed by BotForegroundService.kt
const vaultArg = process.argv.find((a) => a.startsWith('--vault-dir='));
const VAULT_DIR = vaultArg
  ? vaultArg.split('=')[1]
  : path.join(BOT_ENGINE_DIR, 'data', '.session_vault');

function ensureSessionVaultIntegrity() {
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

function hasRegisteredSession() {
  ensureSessionVaultIntegrity();
  const credsPath = path.join(SESSION_DIR, 'creds.json');
  try {
    if (fs.existsSync(credsPath)) {
      const parsed = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
      return Boolean(parsed?.registered || parsed?.me || parsed?.noiseKey);
    }
  } catch (_) {}
  return false;
}

const logs = [];
function addLog(level, message) {
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

const messageStore = {};
const contactStore = {};

function cacheMessage(jid, id, msg) {
  if (!jid || !id || !msg) return;
  const norm = jidNormalizedUser(jid);
  messageStore[norm] = messageStore[norm] || {};
  messageStore[norm][id] = msg;
  const keys = Object.keys(messageStore[norm]);
  if (keys.length > 100) {
    for (const k of keys.slice(0, keys.length - 100)) delete messageStore[norm][k];
  }
}

function loadCachedMessage(jid, id) {
  if (!jid || !id) return undefined;
  const norm = jidNormalizedUser(jid);
  const entry = messageStore[norm]?.[id];
  return entry?.message || entry || undefined;
}

let queenRiamMain = null;
let queenRiamSmsg = null;
function getQueenRiamMain() {
  if (!queenRiamMain) {
    const prev = process.cwd();
    try {
      process.chdir(BOT_ENGINE_DIR);
      queenRiamMain = require(path.join(BOT_ENGINE_DIR, 'main.js'));
      try {
        queenRiamSmsg = require(path.join(BOT_ENGINE_DIR, 'lib/myfunc.js')).smsg;
      } catch (_) {}
      addLog('success', '[PLUGIN-LOADER] Loaded all Queen Riam plugins & command handlers.');
    } catch (err) {
      addLog('error', `[PLUGIN-LOADER] Error loading main.js: ${err.message}`);
    } finally {
      process.chdir(prev);
    }
  }
  return queenRiamMain;
}

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

function writeConfig(patch) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const next = { ...readConfig(), ...patch };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

let cachedPlugins = null;
function scanPlugins() {
  const results = [];
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
      const commands = [];
      let category = isExternal ? 'external' : 'general';
      let description = '';
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
      });
    }
  }
  cachedPlugins = results;
  return results;
}

async function resolveWaVersion() {
  try {
    if (typeof fetchLatestBaileysVersion === 'function') {
      const res = await fetchLatestBaileysVersion();
      if (res?.version) return res.version;
    }
  } catch (_) {}
  return [2, 3000, 1019707846];
}

let activeSock = null;
let alwaysOnlineTimer = null;
let reconnectTimer = null;
let waitingForPairing = false;
const subSessions = new Map();

const serverState = {
  status: 'stopped',
  startedAt: null,
  connectedJid: null,
  connectedName: null,
  pairingCode: null,
  pairingNumber: null,
  sessionLocked: true,
  wakeLockActive: true,
  wifiLockActive: true,
  batteryUnrestricted: true,
  foregroundServiceActive: true,
  queueStats: { sent: 0, pending: 0, retried: 0, failed: 0 },
};

function createQueenRiamSocket(version, state) {
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
    getMessage: async (key) => loadCachedMessage(key?.remoteJid, key?.id),
    msgRetryCounterCache,
    userDevicesCache,
    shouldSyncHistoryMessage: () => false,
    syncFullHistory: false,
    defaultQueryTimeoutMs: undefined,
  });

  sock.decodeJid = (jid) => {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid) && typeof jidDecode === 'function') {
      const decode = jidDecode(jid) || {};
      return (decode.user && decode.server && `${decode.user}@${decode.server}`) || jid;
    }
    return jid;
  };

  sock.getName = (jid, withoutContact = false) => {
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
    loadMessage: async (jid, id) => {
      const m = loadCachedMessage(jid, id);
      return m ? { message: m } : null;
    },
  };

  if (queenRiamSmsg) {
    sock.serializeM = (m) => queenRiamSmsg(sock, m, sock.store);
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

function attachSocketHandlers(sock, saveCreds, cleanPhone, sendWelcomeOnOpen) {
  const cfg = readConfig();
  sock.public = (cfg.COMMAND_MODE || 'public').toLowerCase() === 'public';

  sock.ev.on('creds.update', async () => {
    try {
      await saveCreds();
      ensureSessionVaultIntegrity();
    } catch (e) {
      addLog('error', `[CREDS] Failed saving creds: ${e.message}`);
    }
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'open') {
      waitingForPairing = false;
      serverState.status = 'online';
      serverState.pairingCode = null;
      serverState.connectedJid = sock.user?.id || null;
      serverState.connectedName = sock.user?.name || cfg.BOT_OWNER || 'Queen Riam User';
      ensureSessionVaultIntegrity();
      addLog('success', `🌿 Connected to => ${serverState.connectedName} (${serverState.connectedJid})`);
      addLog('success', '🔒 Session locked in Permanent Storage Vault (survives power-off & reboot)');

      if (sendWelcomeOnOpen && sock.user?.id) {
        sendWelcomeOnOpen = false;
        try {
          await delay(1000);
          const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
          await sock.sendMessage(botNumber, {
            text: `👑 *${cfg.BOT_NAME || 'Queen Riam'}* is Online!\n> 📌 User: ${serverState.connectedName}\n> ⚡ Prefix: ${cfg.PREFIX || '.'}\n> 🔒 Session: Permanent Vault Active\n✅ Bot connected successfully`,
          });
        } catch (_) {}
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
      // Always preserve session on disk and retry reconnecting automatically.
      if (statusCode === 515 || statusCode === DisconnectReason?.restartRequired || (waitingForPairing && hasLinkedIdentity)) {
        waitingForPairing = false;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          startBotSocket({ ownerNumber: cleanPhone, requestNewCode: false, sendWelcome: true });
        }, 6000);
        return;
      }

      if (waitingForPairing) {
        return;
      }

      if (serverState.status !== 'stopped') {
        const delayMs = statusCode === 401 ? 8000 : 3500;
        addLog('warn', `🔄 Connection interrupted (${statusCode || 'network'}). Session preserved in vault — reconnecting in ${delayMs / 1000}s...`);
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          startBotSocket({ ownerNumber: cleanPhone, requestNewCode: false, sendWelcome: false });
        }, delayMs);
      }
    }
  });

  sock.ev.on('messages.upsert', async (chatUpdate) => {
    const m = chatUpdate.messages?.[0];
    if (!m?.message) return;
    if (m.key?.remoteJid && m.key?.id) cacheMessage(m.key.remoteJid, m.key.id, m);
    const mainHandlers = getQueenRiamMain();
    if (mainHandlers?.handleMessages) {
      const prev = process.cwd();
      try {
        process.chdir(BOT_ENGINE_DIR);
        await mainHandlers.handleMessages(sock, chatUpdate, true);
      } catch (_) {} finally {
        process.chdir(prev);
      }
    }
  });
}

async function startBotSocket(options = {}) {
  await stopBotSocket();
  const cfg = readConfig();
  writeConfig(cfg);
  getQueenRiamMain();
  ensureSessionVaultIntegrity();

  if (options.sessionId && options.sessionId.trim().startsWith('RIAM~')) {
    const b64 = options.sessionId.trim().replace(/^RIAM~/, '');
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    JSON.parse(decoded);
    fs.writeFileSync(path.join(SESSION_DIR, 'creds.json'), decoded, 'utf8');
    ensureSessionVaultIntegrity();
  }

  serverState.status = 'starting';
  serverState.startedAt = Date.now();
  const cleanPhone = String(options.ownerNumber || '').replace(/[^0-9]/g, '');
  if (cleanPhone) serverState.pairingNumber = cleanPhone;

  const version = await resolveWaVersion();
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

  const wrappedSaveCreds = async () => {
    await saveCreds();
    ensureSessionVaultIntegrity();
  };

  let sock = createQueenRiamSocket(version, state);
  activeSock = sock;
  const hasExistingSession = Boolean(state.creds?.registered || state.creds?.me);
  attachSocketHandlers(sock, wrappedSaveCreds, cleanPhone, Boolean(options.sendWelcome));

  if (options.requestNewCode && cleanPhone && !hasExistingSession) {
    await delay(3000);
    let code = await sock.requestPairingCode(cleanPhone);
    code = code?.match(/.{1,4}/g)?.join('-') || code;
    serverState.pairingCode = code;
    serverState.status = 'pairing';
    waitingForPairing = true;
    addLog('success', `🔑 Your Pairing Code : ${code}`);
    return code;
  }
  return null;
}

const app = express();
app.use(express.json());

app.get('/api/bot/status', (_req, res) => {
  const mem = process.memoryUsage();
  res.json({
    ...serverState,
    uptimeSeconds: serverState.startedAt ? Math.floor((Date.now() - serverState.startedAt) / 1000) : 0,
    memoryMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
    hasSavedSession: hasRegisteredSession(),
    sessionLocked: true,
    config: readConfig(),
    subSessions: Array.from(subSessions.values()).map((s) => s.state),
  });
});

app.post('/api/bot/start', async (req, res) => {
  const { ownerNumber, sessionId } = req.body || {};
  const clean = String(ownerNumber || '').replace(/[^0-9]/g, '');
  const alreadySaved = hasRegisteredSession();
  const shouldRequestCode = !alreadySaved && !sessionId && Boolean(clean);
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
  addLog('warn', '[ANDROID-FGS] Bot paused by user (WhatsApp session remains safely stored on disk).');
  res.json({ ok: true, status: serverState.status });
});

app.post('/api/bot/pair', async (req, res) => {
  const { phoneNumber, sessionId } = req.body || {};
  const clean = String(phoneNumber || '').replace(/[^0-9]/g, '');
  const alreadySaved = hasRegisteredSession();
  // If a registered session already exists and no new sessionId was pasted, reconnect existing session without wiping!
  if (alreadySaved && !sessionId) {
    addLog('info', '[SESSION-LOCK] Existing linked WhatsApp session found — reconnecting without clearing credentials.');
    await startBotSocket({ ownerNumber: clean, requestNewCode: false, sendWelcome: false });
    res.json({
      ok: true,
      status: serverState.status,
      pairingCode: null,
      pairingNumber: clean,
    });
    return;
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

// ONLY endpoint allowed to delete session credentials (explicit user action)
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
  addLog('warn', '[SESSION] User explicitly cleared WhatsApp session from phone storage & vault.');
  res.json({ ok: true });
});

app.get('/api/bot/config', (_req, res) => res.json(readConfig()));
app.post('/api/bot/config', (req, res) => res.json(writeConfig(req.body || {})));
app.get('/api/bot/plugins', (_req, res) => res.json({ plugins: cachedPlugins || scanPlugins() }));
app.get('/api/bot/logs', (_req, res) => res.json({ logs }));
app.post('/api/bot/logs/clear', (_req, res) => {
  logs.length = 0;
  res.json({ ok: true, logs });
});

const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

app.listen(3000, '0.0.0.0', () => {
  if (hasRegisteredSession()) {
    addLog('info', '[AUTO-RESUME] Restoring permanent WhatsApp session after boot...');
    startBotSocket({ requestNewCode: false, sendWelcome: false });
  }
});
