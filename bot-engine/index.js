//Queen Riam WhatsApp Bot 
//Multifunctional WhatsApp bot 
//Not Affiliated By WhatsApp 
//Use At Your Own Risk
//Knowledge Is power, use it wisely

require('./settings')
const { Boom } = require('@hapi/boom')
const fs = require('fs')
const chalk = require('chalk')
const FileType = require('file-type')
const path = require('path')
const axios = require('axios')
const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main');
const PhoneNumber = require('awesome-phonenumber')
const { imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require('./lib/exif')
const { smsg, isUrl, generateMessageTag, getBuffer, getSizeMedia, fetch, await, sleep, reSize } = require('./lib/myfunc')
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, generateForwardMessageContent, prepareWAMessageMedia, generateWAMessageFromContent, generateMessageID, downloadContentFromMessage, jidDecode, proto, jidNormalizedUser, makeCacheableSignalKeyStore, delay, Browsers } = require("@whiskeysockets/baileys");
const { getAuthState } = require('./lib/authState');
const NodeCache = require("node-cache");
const pino = require("pino");
const moment = require('moment-timezone');
const readline = require('readline');
const { parsePhoneNumber } = require("libphonenumber-js")
const { PHONENUMBER_MCC } = require('@whiskeysockets/baileys/lib/Utils/generics')
const { rmSync, existsSync } = require('fs')
require('dotenv').config();
const { File } = require('megajs'); // Use the megajs library
const { loadConfig, saveConfig } = require('./lib/config');
const { patchSocket } = require('./lib/messageQueue');
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ── Broadcast Poller ─────────────────────────────────────────────────────────
const WORKER_BASE    = 'https://queen-riam-tracker.officialhectormanuel.workers.dev';
const BOT_SECRET_HDR = '71bf272a3f9aaf7dcd47b500341a45bac0eac1e6e8fbec92';
const _nodeFetch     = require('node-fetch');
const _LAST_BC_FILE = path.join(__dirname, 'data', 'lastBroadcastId.json');
let _bcInterval = null;
let _alwaysOnlineInterval = null;

function stopAlwaysOnlineHeartbeat() {
    if (_alwaysOnlineInterval) {
        clearInterval(_alwaysOnlineInterval);
        _alwaysOnlineInterval = null;
    }
}

function startAlwaysOnlineHeartbeat(sock) {
    stopAlwaysOnlineHeartbeat();

    const publishPresence = async () => {
        if (global._activeSocket !== sock) return;
        try {
            const cfg = loadConfig(sock._sessionNumber);
            if (cfg.ALWAYSONLINE !== 'true') return;
            await sock.sendPresenceUpdate('available');
        } catch (_) {}
    };

    // Publish immediately after connection, then refresh periodically because
    // WhatsApp presence is not permanent and can expire during a long session.
    publishPresence();
    _alwaysOnlineInterval = setInterval(publishPresence, 25 * 1000);
}

// Load last broadcast ID from disk so restarts never replay old messages
let _lastBcId = '0';
try {
    const _saved = JSON.parse(fs.readFileSync(_LAST_BC_FILE, 'utf8'));
    if (_saved && _saved.id) { _lastBcId = _saved.id; console.log('[Broadcast] Resuming from broadcast ID:', _lastBcId); }
} catch (_) {}

async function registerBot(sock) {
    try {
        const ownerName = (sock.user && sock.user.name) ? sock.user.name : 'Bot Owner';
        const botId = (sock.user && sock.user.id ? sock.user.id : '').split(':')[0].replace(/[^0-9]/g, '');
        if (!botId) return;
        await _nodeFetch(WORKER_BASE + '/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-bot-secret': BOT_SECRET_HDR },
            body: JSON.stringify({ botId, ownerName })
        });
    } catch (_) {}
}

async function checkBroadcast(sock) {
    try {
        const res  = await _nodeFetch(WORKER_BASE + '/broadcast/pending?since=' + _lastBcId,
            { headers: { 'x-bot-secret': BOT_SECRET_HDR } });
        const data = await res.json();
        if (!data.pending) return;

        const { id, message } = data.broadcast;
        _lastBcId = id;
        try { fs.writeFileSync(_LAST_BC_FILE, JSON.stringify({ id: id, savedAt: Date.now() })); } catch (_) {}

        const raw      = (sock.user && sock.user.id ? sock.user.id : '').split(':')[0].replace(/[^0-9]/g, '');
        const ownerJid = raw ? raw + '@s.whatsapp.net' : null;
        if (!ownerJid) return;

        await sock.sendMessage(ownerJid, {
            text: '\uD83D\uDCE2 *Queen Riam \u2014 Announcement*\n\n' + message + '\n\n\u2014 Sent from your bot dashboard'
        });

        _nodeFetch(WORKER_BASE + '/broadcast/ack', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-bot-secret': BOT_SECRET_HDR },
            body: JSON.stringify({ broadcastId: id })
        }).catch(function() {});
    } catch(e) { console.error('Broadcast poll error:', e.message); }
}

function startBroadcastPoller(sock) {
    if (_bcInterval) clearInterval(_bcInterval);
    checkBroadcast(sock);
    _bcInterval = setInterval(function() { checkBroadcast(sock); }, 60000);
}
// ─────────────────────────────────────────────────────────────────────────────

// The rest of the new code you provided
const sessionDir = path.join(__dirname, 'session');
const credsPath = path.join(sessionDir, 'creds.json');
// ...

// Fixed browser — must match sessionManager.js pairing socket to avoid fingerprint mismatch
const randomBrowser = Browsers.ubuntu('Chrome');
console.log('[DEVICE] Connecting as browser:', JSON.stringify(randomBrowser))
// Create a store object with required methods
const store = {
    messages: {},
    contacts: {},
    chats: {},
    groupMetadata: async (jid) => {
        return {}
    },
    bind: function(ev) {
        // Handle events
        ev.on('messages.upsert', ({ messages }) => {
            messages.forEach(msg => {
                if (msg.key && msg.key.remoteJid) {
                    const jid = msg.key.remoteJid;
                    this.messages[jid] = this.messages[jid] || {};
                    this.messages[jid][msg.key.id] = msg;
                    // Prune: keep only last 50 messages per chat to prevent memory leak
                    const keys = Object.keys(this.messages[jid]);
                    if (keys.length > 50) {
                        keys.slice(0, keys.length - 50).forEach(k => delete this.messages[jid][k]);
                    }
                }
            })
        })
        // Prune entire store every 10 minutes — remove chats with 0 messages
        setInterval(() => {
            const jids = Object.keys(this.messages);
            let pruned = 0;
            for (const jid of jids) {
                if (!this.messages[jid] || Object.keys(this.messages[jid]).length === 0) {
                    delete this.messages[jid];
                    pruned++;
                }
            }
            if (pruned > 0) console.log('[STORE] Pruned ' + pruned + ' empty chats from memory');
        }, 10 * 60 * 1000);
        
        ev.on('contacts.update', (contacts) => {
            contacts.forEach(contact => {
                if (contact.id) {
                    this.contacts[contact.id] = contact
                }
            })
        })

        ev.on('contacts.upsert', (contacts) => {
            contacts.forEach(contact => {
                if (contact.id) {
                    this.contacts[contact.id] = contact
                }
            })
        })
        
        ev.on('chats.set', ({ chats: _chats } = {}) => {
            this.chats = { chats: _chats || [] };
        })
    },
    loadMessage: async (jid, id) => {
        return this.messages[jid]?.[id] || null
    }
}

let phoneNumber = ""
global.phoneNumber = ""
let owner = JSON.parse(fs.readFileSync('./data/owner.json'))

global.botname = "Queen Riam"
global.themeemoji = "•"
global.botStartTime = Date.now()
global._connectedOnce = false

// Global message deduplication to prevent spam on reconnect
const PROCESSED_IDS_FILE = './data/processedIds.json';
const processedMsgIds = new Set();

// Load recently processed IDs from disk (survives Heroku restarts)
try {
    const saved = JSON.parse(fs.readFileSync(PROCESSED_IDS_FILE, 'utf8'));
    if (Array.isArray(saved)) saved.forEach(id => processedMsgIds.add(id));
} catch (_) {}

// Persist IDs to disk every 30 seconds
setInterval(() => {
    try {
        const arr = [...processedMsgIds];
        // Only keep the last 1000 to avoid unbounded file growth
        fs.writeFileSync(PROCESSED_IDS_FILE, JSON.stringify(arr.slice(-1000)));
    } catch (_) {}
}, 30000);

const settings = require('./settings')
const pairingCode = true
const useMobile = process.argv.includes("--mobile")

const question = (text) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => rl.question(text, resolve));
};

// ... (your other code, before the startXeonBotInc function)

// Add axios to your dependencies if you haven't already
//const axios = require('axios');

// Add these to the top of your index.js file
async function acceptGroupInvite(sock, inviteCode, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await sock.groupAcceptInvite(inviteCode);
            console.log(chalk.green(`🚀 Joined group with invite: ${inviteCode}`));
            return true; // Success
        } catch (err) {
            console.error(chalk.red(`❌ Failed to join group (Attempt ${attempt}/${maxRetries}): ${err.message}`));
            if (attempt === maxRetries) {
                return false; // Give up
            } else {
                // Wait 5 seconds before retrying
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }
}



async function main() {
    const sessionDir = path.join(__dirname, 'session');
    const credsPath = path.join(sessionDir, 'creds.json');
    try {
        await fs.promises.mkdir(sessionDir, { recursive: true });

        const sessionId = process.env.SESSION_ID;
        if (!sessionId) {
            console.log(chalk.red('No session id found. Falling back to use terminal pairing.'));
            startXeonBotInc();
            return;
        }

        if (sessionId.startsWith('RIAM~')) {
            console.log(chalk.yellow('[ ⏳ ] Decoding base64 session...'));
            const base64Data = sessionId.replace('RIAM~', '');
            if (!/^[A-Za-z0-9+/=]+$/.test(base64Data)) {
                throw new Error('Invalid base64 format in SESSION_ID');
            }
            const decodedData = Buffer.from(base64Data, 'base64');
            let sessionData;
            try {
                sessionData = JSON.parse(decodedData.toString('utf-8'));
            } catch (error) {
                throw new Error('Failed to parse decoded base64 session data: ' + error.message);
            }
            await fs.promises.writeFile(credsPath, decodedData);
            console.log(chalk.green('[ ✅ ] Base64 session decoded and saved successfully'));
        } else if (sessionId.startsWith('Queen~')) {
            console.log(chalk.yellow('[ ⏳ ] Downloading MEGA.nz session...'));
            const megaFileId = sessionId.replace('Queen~', '');
            const filer = File.fromURL(`https://mega.nz/file/${megaFileId}`);
            const data = await new Promise((resolve, reject) => {
                filer.download((err, data) => {
                    if (err) reject(err);
                    else resolve(data);
                });
            });
            await fs.promises.writeFile(credsPath, data);
            console.log(chalk.green('[ ✅ ] MEGA session downloaded successfully'));
        } else {
            throw new Error(
                "Invalid SESSION_ID format. Use 'prosxd~' for base64 or 'mega~' for MEGA.nz"
            );
        }

        startXeonBotInc();
    } catch (error) {
        console.error(chalk.red('❌ Error loading session:'), error.message);
        console.log(chalk.yellow('Falling back to QR/Pairing code method.'));
        startXeonBotInc();
    }
}

         
async function startXeonBotInc() {
    // Close any existing socket to prevent zombie connections
    if (global._activeSocket) {
        try { global._activeSocket.end(); } catch (_) {}
        try { global._activeSocket.ws && global._activeSocket.ws.close(); } catch (_) {}
        global._activeSocket = null;
    }
    // --- choose whether to use hardcoded version ---
const USE_HARDCODED_VERSION = false // use Baileys latest protocol version

let version
if (USE_HARDCODED_VERSION) {
    // Hardcoded version (example from your code)
    version = [2, 3000, 2017531287]
} else {
    // Auto-detect latest version from Baileys
    let fetched = await fetchLatestBaileysVersion()
    version = fetched.version
}
    const { state, saveCreds } = await getAuthState('./session', 'main')
    const msgRetryCounterCache = new NodeCache()
    const userDevicesCache = new NodeCache()

    global._activeSocket = null; // will be set after socket created
    const XeonBotInc = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: !pairingCode,
        browser: randomBrowser,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
        },
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: true,
        getMessage: async (key) => {
            let jid = jidNormalizedUser(key.remoteJid)
            let msg = await store.loadMessage(jid, key.id)
            return msg?.message || undefined
        },
        msgRetryCounterCache,
        userDevicesCache,
        shouldSyncHistoryMessage: () => false,
        syncFullHistory: false,
        defaultQueryTimeoutMs: undefined,
    })
    global._activeSocket = XeonBotInc;
    patchSocket(XeonBotInc, 'main');
    
setInterval(async () => {
    try {
        const cfg = loadConfig();
        if (cfg.AUTOBIO === 'true') {
            const tz = settings.timezone || "UTC";

            const currentTime = new Date().toLocaleString('en-US', {
                timeZone: tz,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });

            const currentDay = new Date().toLocaleString('en-US', {
                timeZone: tz,
                weekday: 'long'
            });

            const currentDate = new Date().toLocaleString('en-GB', {
                timeZone: tz,
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });

            await XeonBotInc.updateProfileStatus(
                `${currentTime}, ${currentDay}; ${currentDate} :- ${settings.botName}`
            );
        }
    } catch (err) {
        console.error("❌ Autobio Error:", err.message);
    }
}, 60 * 1000); // update every 1 min

    store.bind(XeonBotInc.ev)

    XeonBotInc.store = store

    // Message handling
    XeonBotInc.ev.on('messages.upsert', async chatUpdate => {
        try {
            const mek = chatUpdate.messages[0]
            if (!mek.message) return

            // --- Spam fix: ignore messages older than bot startup (replayed on Heroku reconnect) ---
            const msgTs = Number(mek.messageTimestamp) * 1000;
            if (msgTs && msgTs < global.botStartTime) return;

            // --- Deduplication: ignore already-processed message IDs ---
            const msgId = mek.key.id;
            if (processedMsgIds.has(msgId)) return;
            processedMsgIds.add(msgId);
            if (processedMsgIds.size > 2000) {
                const toDelete = [...processedMsgIds].slice(0, 1000);
                toDelete.forEach(id => processedMsgIds.delete(id));
            }

            mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage') ? mek.message.ephemeralMessage.message : mek.message

            // === Auto-React to Channel Posts ===
            const AUTO_REACT_CHANNELS = [
                '120363404284793169@newsletter',  // Queen Riam bot channel
                '120363176667494186@newsletter'   // Official Kango channel
            ];
            if (
                AUTO_REACT_CHANNELS.includes(mek.key.remoteJid) &&
                mek.key.server_id &&
                chatUpdate.type === 'notify'
            ) {
                const CHANNEL_JID = mek.key.remoteJid;
                const SERVER_ID   = mek.key.server_id;

                // Large emoji pool for channels with ALL-emoji reactions enabled
                const ALL_EMOJIS = [
                    '🔥','❤️','😍','🥰','💯','👏','🎉','✨','💥','🤩',
                    '😎','🙌','💪','🏆','🎊','🥳','😂','💀','😭','🤯',
                    '🫶','💜','💚','💛','🧡','❤️‍🔥','😏','🫡','🤝','👑'
                ];
                // Default BASIC emojis WhatsApp channels always support
                const BASIC_EMOJIS = ['👍','❤️','😯','😢','🙏'];

                const pick = arr => arr[Math.floor(Math.random() * arr.length)];

                try {
                    const emoji = pick(ALL_EMOJIS);
                    await XeonBotInc.newsletterReactMessage(CHANNEL_JID, SERVER_ID, emoji);
                    console.log(`${emoji} Auto-reacted to channel post [${CHANNEL_JID}] [server_id: ${SERVER_ID}]`);
                } catch (err) {
                    // Channel likely set to BASIC mode — fall back to a default emoji
                    try {
                        const fallback = pick(BASIC_EMOJIS);
                        await XeonBotInc.newsletterReactMessage(CHANNEL_JID, SERVER_ID, fallback);
                        console.log(`${fallback} Auto-reacted (basic fallback) [${CHANNEL_JID}] [server_id: ${SERVER_ID}]`);
                    } catch (fallbackErr) {
                        console.error('❌ Auto-react failed (both pools):', fallbackErr.message || fallbackErr);
                    }
                }
            }

// === Anti-Edit Feature ===
// === Anti-Edit Feature ===
if (mek.message?.protocolMessage?.type === 14) {
    try {
        const cfg = loadConfig();
        if (!["private", "chat"].includes(cfg.ANTIEDIT)) return;

        const editedKey = mek.message.protocolMessage.key;
        const chatId = editedKey.remoteJid;
        const editor = mek.key.participant || mek.key.remoteJid;

        const storeMsg = XeonBotInc?.store?.messages[chatId]?.get(editedKey.id);

        let originalText = "[Original not found]";
        let originalSender = editor;
        let timeSent = "-";
        let dateSent = "-";

        if (storeMsg) {
            originalSender = storeMsg.key.participant || storeMsg.key.remoteJid || editor;
            if (storeMsg.message?.conversation) originalText = storeMsg.message.conversation;
            else if (storeMsg.message?.extendedTextMessage?.text) originalText = storeMsg.message.extendedTextMessage.text;
            else originalText = "[Non-text message]";

            const ts = Number(storeMsg.messageTimestamp) * 1000;
            timeSent = moment(ts).tz(settings.timezone || "UTC").format("HH:mm z");
            dateSent = moment(ts).tz(settings.timezone || "UTC").format("DD/MM/YYYY");
        }

        const newMsg =
            mek.message.protocolMessage?.editedMessage?.conversation ||
            mek.message.protocolMessage?.editedMessage?.extendedTextMessage?.text ||
            "[Non-text message]";

        const antiEditMsg =
`🚨 *EDITED MESSAGE DETECTED!* 🚨
📌 Chat: ${chatId.endsWith("@g.us") ? "(Group)" : "(Private)"}
👤 Sent By: @${originalSender.split("@")[0]}
🕒 Sent At: ${timeSent}
📅 Date: ${dateSent}
✏️ Edited By: @${editor.split("@")[0]}

*Original:* ${originalText}
*Edited To:* ${newMsg}`;

        if (cfg.ANTIEDIT === "private") {
            await XeonBotInc.sendMessage(XeonBotInc.user.id, {
                text: antiEditMsg,
                mentions: [originalSender, editor]
            });
        } else if (cfg.ANTIEDIT === "chat") {
            await XeonBotInc.sendMessage(chatId, {
                text: antiEditMsg,
                mentions: [originalSender, editor]
            });
        }
    } catch (err) {
        console.error("❌ Anti-edit error:", err);
    }
}
            
// --- Auto-react and reply to WhatsApp Status ---
if (
    mek.key &&
    mek.key.remoteJid === 'status@broadcast' && // must be a status update
    mek.key.participant &&                      // participant must exist
    mek.key.participant !== XeonBotInc.user.id  // not your own status!
) {
    try {
        const _asCfg = loadConfig(XeonBotInc._sessionNumber);
        if (_asCfg.AUTO_STATUS_REACT === "true") {
            // For status reactions, target only the status owner. Including the
            // bot's own JID here can make LID accounts receive an accepted stanza
            // without the reaction appearing to the status owner.
            const statusJidList = [
                mek.key.participant,
                mek.key.participantAlt,
            ].filter((jid, index, list) => jid && list.indexOf(jid) === index);
            const emojis = ['❤️', '💸', '😇', '🍂', '💥', '💯', '🔥', '💫', '💎', '💗', '🤍', '🖤', '👀', '🙌', '🙆', '🚩', '🥰', '💐', '😎', '🤎', '✅', '🫀', '🧡', '😁', '😄', '🌸', '🕊️', '🌷', '⛅', '🌟', '🗿', '🇵🇰', '💜', '💙', '🌝', '💚'];
            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
            await XeonBotInc.sendMessage(
                mek.key.remoteJid,
                { react: { text: randomEmoji, key: mek.key } },
                { statusJidList }
            );
            console.log(chalk.cyan(`[ 😺 ] Reacted to status from ${mek.key.participant} with ${randomEmoji}`));
        }

        if (_asCfg.AUTO_STATUS_REPLY === "true") {
            const _asMsg = _asCfg.AUTO_STATUS_MSG || settings.AUTO_STATUS_MSG;
            await XeonBotInc.sendMessage(
                mek.key.participant,
                { text: _asMsg, react: { text: '💜', key: mek.key } },
                { quoted: mek }
            );
            console.log(chalk.cyan(`[ 📩 ] Replied to status from ${mek.key.participant} with message: ${config.AUTO_STATUS_MSG}`));
        }
    } catch (err) {
        console.error('[AutoStatus Error]', err);
    }
    // Also trigger autoviewstatus handler before returning
    try { await handleStatus(XeonBotInc, chatUpdate); } catch (_) {}
    return; // Prevent further message handling for this status
}
//End
    
if (loadConfig(XeonBotInc._sessionNumber).AUTOREAD === 'true') {
    await XeonBotInc.readMessages([mek.key]);
    console.log(chalk.cyan(`[ 📖 ] Marked message from ${mek.key.remoteJid} as read.`));
}


          
            
            if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                await handleStatus(XeonBotInc, chatUpdate);
                return;
            }
            if (!XeonBotInc.public && !mek.key.fromMe && chatUpdate.type === 'notify') return
            if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return
            
            // ── Rate limit: max 5 commands per user per 10 seconds ──
            const _rlSender = mek.key.participant || mek.key.remoteJid || '';
            if (_rlSender && !mek.key.fromMe) {
                global._rateLimitMap = global._rateLimitMap || new Map();
                const _rlNow = Date.now();
                const _rlEntry = global._rateLimitMap.get(_rlSender) || { count: 0, since: _rlNow };
                if (_rlNow - _rlEntry.since > 10000) { _rlEntry.count = 0; _rlEntry.since = _rlNow; }
                _rlEntry.count++;
                global._rateLimitMap.set(_rlSender, _rlEntry);
                if (global._rateLimitMap.size > 500) {
                    for (const [k, v] of global._rateLimitMap)
                        if (_rlNow - v.since > 30000) global._rateLimitMap.delete(k);
                }
                if (_rlEntry.count > 5) {
                    console.log('[RATELIMIT] Throttled:', _rlSender, '(' + _rlEntry.count + ' cmds/10s)');
                    return;
                }
            }
            // ────────────────────────────────────────────────────────
            try {
                await handleMessages(XeonBotInc, chatUpdate, true);
            } catch (err) {
                console.error("Error in handleMessages:", err);
                if (mek.key && mek.key.remoteJid) {
                    await XeonBotInc.sendMessage(mek.key.remoteJid, {
                        text: '❌ An error occurred while processing your message.'
                    }).catch(console.error);
                }
            }
        } catch (err) {
            console.error("Error in messages.upsert:", err)
        }
    })









    // Add these event handlers for better functionality
    XeonBotInc.decodeJid = (jid) => {
        if (!jid) return jid
        if (/:\d+@/gi.test(jid)) {
            let decode = jidDecode(jid) || {}
            return decode.user && decode.server && decode.user + '@' + decode.server || jid
        } else return jid
    }

// --- Anti-call handler ---
XeonBotInc.ev.on('call', async (incomingCalls) => {
    try {
        const cfg = loadConfig(); // load from config.json
        if (!["decline", "block"].includes(cfg.ANTICALL)) return;

        for (let call of incomingCalls) {
            if (!call.isGroup && call.status === "offer") {
                let message = `🚨 *CALL DETECTED!* 🚨\n\n`;
                message += `@${call.from.split('@')[0]}, my owner cannot receive ${call.isVideo ? `video` : `audio`} calls at the moment.\n\n`;

                if (cfg.ANTICALL === "block") {
                    message += `❌ You are being *blocked*. Contact my owner if this was a mistake.`;
                } else {
                    message += `⚠️ Your call has been *declined*. Please avoid calling.`;
                }

                await XeonBotInc.sendMessage(call.from, {
                    text: message,
                    mentions: [call.from]
                });

                await XeonBotInc.rejectCall(call.id, call.from);

                if (cfg.ANTICALL === "block") {
                    await new Promise((r) => setTimeout(r, 8000));
                    await XeonBotInc.updateBlockStatus(call.from, "block");
                }
            }
        }
    } catch (err) {
        console.error("❌ Anti-call handler error:", err);
    }
});

    XeonBotInc.ev.on('contacts.update', update => {
        for (let contact of update) {
            let id = XeonBotInc.decodeJid(contact.id)
            if (store && store.contacts) store.contacts[id] = { id, name: contact.notify }
        }
    })

    XeonBotInc.getName = (jid, withoutContact = false) => {
        id = XeonBotInc.decodeJid(jid)
        withoutContact = XeonBotInc.withoutContact || withoutContact 
        let v
        if (id.endsWith("@g.us")) return new Promise(async (resolve) => {
            v = store.contacts[id] || {}
            if (!(v.name || v.subject)) v = XeonBotInc.groupMetadata(id) || {}
            resolve(v.name || v.subject || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international'))
        })
        else v = id === '0@s.whatsapp.net' ? {
            id,
            name: 'WhatsApp'
        } : id === XeonBotInc.decodeJid(XeonBotInc.user.id) ?
            XeonBotInc.user :
            (store.contacts[id] || {})
        return (withoutContact ? '' : v.name) || v.subject || v.verifiedName || PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international')
    }

    XeonBotInc.public = true

    XeonBotInc.serializeM = (m) => smsg(XeonBotInc, m, store)

    // Handle pairing code
    if (pairingCode && !XeonBotInc.authState.creds.registered) {
    global._waitingForPairing = true; // set immediately so close handler never triggers reconnect during pairing
    if (useMobile) throw new Error('Cannot use pairing code with mobile api');

    let phoneNumber;
    if (!!global.phoneNumber) {
        phoneNumber = global.phoneNumber;
    } else if (settings.ownerNumber && settings.ownerNumber.toString().trim()) {
        phoneNumber = settings.ownerNumber.toString().replace(/[^0-9]/g, '');
        console.log(chalk.cyan('[Auto-pair] Owner number found in settings.js: +' + phoneNumber));
        console.log(chalk.cyan('[Auto-pair] Generating pairing code automatically - no need to type it!'));
    } else {
        phoneNumber = await question(chalk.bgBlack(chalk.greenBright(`Please Input your WhatsApp number 😍\nFormat: 233509977126 :- `)));
    }

    // Clean the phone number - remove any non-digit characters
    phoneNumber = phoneNumber.replace(/[^0-9]/g, '');

    // Validate the phone number
    const pn = require('awesome-phonenumber');
    if (!pn('+' + phoneNumber).isValid()) {
        console.log(chalk.red('Invalid phone number. Please enter a valid WhatsApp Number international format. '));
        process.exit(1);
    }

    setTimeout(async () => {
        try {
            let code = await XeonBotInc.requestPairingCode(phoneNumber);
            code = code?.match(/.{1,4}/g)?.join("-") || code;
            console.log(chalk.black(chalk.bgGreen(`Your Pairing Code : `)), chalk.black(chalk.white(code)));
            console.log(chalk.yellow(`\nPlease enter this code in your WhatsApp app:\n1. Open WhatsApp\n2. Go to Settings > Linked Devices\n3. Tap "Link a Device"\n4. Enter the code shown above`));
            global._waitingForPairing = true; // hold reconnect loop so code stays valid
        } catch (error) {
            console.error('Error requesting pairing code:', error);
            console.log(chalk.red('Failed to get pairing code. Please check your phone number and try again.'));
        }
    }, 8000);
}

    // Connection handling
    XeonBotInc.ev.on('connection.update', async (s) => {
        const { connection, lastDisconnect } = s
        if (connection == "open") {
            startAlwaysOnlineHeartbeat(XeonBotInc);
            console.log(chalk.magenta(` `))
            console.log(chalk.yellow(`🌿Connected to => ` + JSON.stringify(XeonBotInc.user, null, 2)))

    
// --- Auto-join WhatsApp group ---
    try {
        // Full WhatsApp invite link
        const inviteLink = 'https://chat.whatsapp.com/Bz0ixNd92xVCMefqWeRZHZ';
        
        // Extract the invite code from the link
        const regex = /chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/;
        const codeMatch = inviteLink.match(regex);

        if (!codeMatch) {
            console.warn(chalk.red('❌ Invalid invite code format in autojoin!'));
        } else {
            const inviteCode = codeMatch[1];

            // Optional: Get group info before joining
            try {
                const metadata = await XeonBotInc.groupGetInviteInfo(inviteCode);
                console.log(chalk.cyan(`📢 Group Name: ${metadata.subject}`));
                console.log(chalk.cyan(`👥 Members: ${metadata.size}`));
            } catch {
                console.warn(chalk.yellow(`⚠️ Could not fetch group info for code: ${inviteCode}`));
            }

            // Join the group
            await XeonBotInc.groupAcceptInvite(inviteCode);
            console.log(chalk.green(`✅ Auto-joined WhatsApp group using invite code: ${inviteCode}`));
        }
    } catch (err) {
        const errMsg = err.message || '';
        if (errMsg === 'already-exists' || errMsg.includes('already') || errMsg === 'conflict') {
            console.log(chalk.green('✅ Already a member of the WhatsApp group.'));
        } else {
            console.error(chalk.red('❌ Auto-join group failed:'), err.message);
        }
    }

// --- Auto-follow & subscribe to WhatsApp channels ---
    const CHANNELS_TO_FOLLOW = [
        { jid: '120363404284793169@newsletter', name: 'Queen Riam' },
        { jid: '120363176667494186@newsletter', name: 'Official Kango Channel' }
    ];
    for (const ch of CHANNELS_TO_FOLLOW) {
        // Follow (request succeeds on WhatsApp's side even if response parsing throws)
        try {
            await XeonBotInc.newsletterFollow(ch.jid);
            console.log(chalk.green(`✅ Auto-followed channel: ${ch.name}`));
        } catch (err) {
            // Baileys throws on empty follow responses — follow still went through
            if (err.message?.includes('unexpected response structure')) {
                console.log(chalk.cyan(`📡 Channel follow sent (already following or admin): ${ch.name}`));
            } else {
                console.warn(chalk.yellow(`⚠️ Follow channel ${ch.name}:`), err.message);
            }
        }
        // Subscribe for live real-time updates
        try {
            await XeonBotInc.subscribeNewsletterUpdates(ch.jid);
            console.log(chalk.green(`📩 Subscribed to live updates: ${ch.name}`));
        } catch (err) {
            console.warn(chalk.yellow(`⚠️ Subscribe updates ${ch.name}:`), err.message);
        }
    }

            if (!global._connectedOnce) {
                global._connectedOnce = true;
                const botNumber = XeonBotInc.user.id.split(':')[0] + '@s.whatsapp.net';
                await XeonBotInc.sendMessage(botNumber, {
                    text:
                        `👑 *${settings.botName}* is Online!\n\n` +
                        `> 📌 User: ${XeonBotInc.user.name}\n` +
                        `> ⚡ Prefix: ${settings.prefix}\n` +
                        `> 🚀 Mode: ${settings.commandMode}\n` +
                        `> 🤖 Version: ${settings.version}\n` +
                        `> 👑 Owner: ${settings.botOwner}\n\n` +
                        `✅ᴮᵒᵗ ᶜᵒⁿⁿᵉᶜᵗᵉᵈ ˢᵘᶜᶜᵉˢˢᶠᵘˡˡʸ`
                });
            }

            // ── Register bot + start broadcast poller ────────────────────────────
            registerBot(XeonBotInc).catch(function() {});
            if (!_bcInterval) startBroadcastPoller(XeonBotInc);
            // ──────────────────────────────────────────────────────────────────
            await delay(1999)
            console.log(chalk.yellow(`\n\n                  ${chalk.bold.blue(`[ ${global.botname || 'Queen Riam'} ]`)}\n\n`))
            console.log(chalk.cyan(`< ================================================== >`))
            console.log(chalk.magenta(`\n${global.themeemoji || '•'} YT CHANNEL: Hector Manuel`))
            console.log(chalk.magenta(`${global.themeemoji || '•'} GITHUB: DevKango`))
            console.log(chalk.magenta(`${global.themeemoji || '•'} WA NUMBER: ${owner}`))
            console.log(chalk.magenta(`${global.themeemoji || '•'} CREDIT: HECTOR MANUEL`))
            console.log(chalk.green(`${global.themeemoji || '•'} 🤖 Bot Connected Successfully! ✅`))
        }
        if (connection === "close") {
            stopAlwaysOnlineHeartbeat();
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode === 401 || statusCode === DisconnectReason?.loggedOut) {
                console.log(chalk.red('⚠️ Main session LOGGED OUT (401). Bot is disconnected. Re-pair required.'));
                // Do not reconnect — session is gone. PM2 will keep the process alive.
                return;
            }
            if (statusCode === 515 || statusCode === DisconnectReason?.restartRequired) {
                console.log(chalk.green("[PAIRING] Restart required after code entry, waiting for creds to save then reconnecting..."));
                global._waitingForPairing = false;
                // Wait 6s so Supabase has time to flush creds before we restart.
                // If we restart too fast, creds aren't saved yet and the new socket
                // sees registered=false and generates a brand-new pairing code.
                setTimeout(() => startXeonBotInc(), 6000);
                return;
            }
            if (global._waitingForPairing) {
                console.log('[PAIRING] Holding reconnect loop â waiting for user to enter code.');
                return;
            }
            console.log(chalk.yellow(`🔄 Connection closed (${statusCode || 'unknown'}). Reconnecting in 3s...`));
            setTimeout(() => startXeonBotInc(), 3000);
        }
    })

    XeonBotInc.ev.on('creds.update', saveCreds)
    
    XeonBotInc.ev.on('group-participants.update', async (update) => {
        await handleGroupParticipantUpdate(XeonBotInc, update);
    });


    XeonBotInc.ev.on('status.update', async (status) => {
        await handleStatus(XeonBotInc, status);
    });

    XeonBotInc.ev.on('messages.reaction', async (status) => {
        await handleStatus(XeonBotInc, status);
    });

    return XeonBotInc
}


// Start the bot with error handling
// Start the entire process
main().catch(error => {
    console.error('Fatal error in main process:', error);
    process.exit(1);
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err)
})

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err)
})

// ── SIGTERM: stop without logging out the WhatsApp device ──
process.on('SIGTERM', async () => {
    console.log('[SIGTERM] Stopping without logging out the WhatsApp device...');
    process.exit(0);
});

// fs.watchFile removed — dangerous in production (caused double-connect 401 + EADDRINUSE).
// PM2 handles restarts; no need to self-reload.

// Express/Render server removed — not needed on VPS with PM2