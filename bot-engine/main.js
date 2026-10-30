const settings = require('./settings');
require('./config.js');
const { loadConfig, saveConfig } = require('./lib/config');
const { getLang } = require('./lib/lang');
const { isBanned } = require('./lib/isBanned');
const yts = require('yt-search');
const { fetchBuffer } = require('./lib/myfunc');
const fs = require('fs');
const fetch = require('node-fetch');
const ytdl = require('ytdl-core');
const path = require('path');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const { addWelcome, delWelcome, addGoodbye, delGoodBye } = require('./lib/index');
const moment = require('moment-timezone');
const { isWelcomeOn, isGoodbyeOn, getCustomWelcome, getCustomGoodbye, applyPlaceholders } = require('./lib/welcome');
// ── Bot Analytics Tracker ─────────────────────────────────────────────────────
const _crypto = require('crypto');
const TRACKER_URL    = 'https://queen-riam-tracker.officialhectormanuel.workers.dev/track';
const TRACKER_SECRET = '71bf272a3f9aaf7dcd47b500341a45bac0eac1e6e8fbec92';
function trackEvent(jid, command, isGroup) {
    try {
        const user = _crypto.createHash('sha256').update(jid || '').digest('hex').slice(0, 16);
        fetch(TRACKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-bot-secret': TRACKER_SECRET },
            body: JSON.stringify({ user, command, chatType: isGroup ? 'group' : 'private' })
        }).catch(() => {});
    } catch (_) {}
}
// ──────────────────────────────────────────────────────────────────────────────


// Command imports
const isAdmin = require('./lib/isAdmin');
const { isButtonModeOn, sendButtonMessage } = require('./lib/buttonHelper');
const { handleAntiBadwordCommand, handleBadwordDetection } = require('./lib/antibadword');
const { pluginMap, loadPlugins, downloadPlugin, loadExternalPlugins } = require("./lib/pluginLoader");
loadPlugins(); // load plugins/ and eplugins/ at startup
loadExternalPlugins().catch(err => console.error('[eplugins] startup error:', err.message));

// ── Plugin helper imports ─────────────────────────────────────────────────────
// 5 utilities / flow-control plugins kept as resilient direct imports
let viewonce2 = async () => {};        try { viewonce2 = require('./plugins/vv2').viewonce2; }            catch (e) { console.warn('[main] vv2 not loaded:', e.message); }
let saveCommand = async () => {};      try { saveCommand = require('./plugins/save').saveCommand; }        catch (e) { console.warn('[main] save not loaded:', e.message); }
let hasOwnerPrivileges = () => false;  try { ({ hasOwnerPrivileges } = require('./plugins/sudo')); }       catch (e) { console.warn('[main] sudo not loaded:', e.message); }
let handleTicTacToeMove = async () => {}; try { ({ handleTicTacToeMove } = require('./plugins/tictactoe')); } catch (e) { console.warn('[main] tictactoe not loaded:', e.message); }
let handleWcgMove = async () => false;      try { ({ handleWcgMove } = require('./plugins/wcg')); }              catch (e) { console.warn('[main] wcg not loaded:', e.message); }
let handleChatbot = async () => {};    try { ({ handleChatbot } = require('./plugins/chatbot')); }         catch (e) { console.warn('[main] chatbot not loaded:', e.message); }
// 8 passive handlers now self-register via bot({ on: ... }) — dispatched below
const { dispatchEvent } = require('./lib/pluginLoader');
const { getStats: getQueueStats } = require('./lib/messageQueue');
// Device type detection (from message ID format, mirrors Levanter)
// iOS: 20-char ID not starting with RGNK
// Android: >30 chars | Web: starts with 3EB | Win: 18 chars
const getDeviceType = id =>
    id && typeof id === 'string'
        ? id.length > 30 ? 'android'
        : id.length !== 20 || id.startsWith('RGNK') ? id.substring(0, 3) === '3EB' ? 'web' : id.length === 18 ? 'win' : 'bot'
        : 'ios'
    : 'unknown';


// ──────────────────────────────────────────────────────────────────────────────

const { addStatusContact } = require('./lib/status');
// ─── Globals ──────────────────────────────────────────────────────────────────
global.packname = settings.packname;
global.author = settings.author;
global.channelLink = 'https://whatsapp.com/channel/0029VbAsbK91Xquft4V11l1O';
global.ytch = 'Hector Manuel';


// ─── Alias map ────────────────────────────────────────────────────────────────
// Maps alternative command names → canonical name used in the switch below
const ALIASES = {
    // Help
    menu: 'help', bot: 'help', list: 'help',
    // Sticker
    s: 'sticker',
    // Delete
    del: 'delete',
    // GitHub
    git: 'github', repo: 'github',
    // Media
    mp3: 'play', song: 'play', music: 'play',
    ytmp4: 'video',
    insta: 'instagram', ig: 'instagram',
    fb: 'facebook',
    snap: 'snapchat',
    sc: 'snapchat',
    tw: 'twitter', twit: 'twitter', x: 'twitter',
    pin: 'pinterest',
    wall: 'wallpaper',
    rmbg: 'removebg', nobg: 'removebg',
    pstatus: 'poststatus', setstatus: 'poststatus',
    tt: 'tiktok',
    // AI
    flux: 'imagine', dalle: 'imagine',
    // Games
    tictactoe: 'ttt',
    // Group
    infogp: 'groupinfo', infogrupo: 'groupinfo',
    revoke: 'resetlink', anularlink: 'resetlink',
    admins: 'staff', listadmin: 'staff',
    lock: 'close', unlock: 'open',
    // Fun
    lovenight: 'goodnight', gn: 'goodnight',
    itssostupid: 'stupid', iss: 'stupid',
    // Utils
    clearsesi: 'clearsession',
    emix: 'emojimix',
    stickertelegram: 'tg', tgsticker: 'tg', telesticker: 'tg',
    scriptbot: 'script',
    trt: 'translate',
    stt: 'transcribe', speech2text: 'transcribe', voicetotext: 'transcribe',
    telegramsearch: 'tgsearch', tgfind: 'tgsearch',
    texttovideo: 'veo3', t2v: 'veo3', videogen: 'veo3', genvideo: 'veo3',
    ssweb: 'ss',
    encrypt: 'enc',
    savecontact: 'vcf', svcontact: 'vcf',
    jid: 'groupjid',
};

// Commands that require the sender to be a group admin
const ADMIN_CMDS = new Set([
    'mute', 'unmute', 'ban', 'unban', 'promote', 'demote', 'kick',
    'tagall', 'antilink', 'antigrouptag', 'close', 'open', 'vcf', 'antibadword',
    'antispam', 'anticontact', 'antiaudio', 'antiimage', 'antivideo', 'antisticker',
    'antimedia', 'antibot', 'antivirus',
]);

// Owner access is derived from plugin metadata so every owner-category
// command, including dynamically loaded plugins, gets the same guard.
function isOwnerCommand(commandName) {
    const meta = pluginMap.get(commandName)?.meta;
    return String(meta?.category || '').toLowerCase() === 'owner';
}

// ─── Message extractor helper ─────────────────────────────────────────────────
function extractText(message) {
    // ── Interactive button tap (kango-wa nativeFlowMessage) ───────────────────
    try {
        const irm = message.message?.interactiveResponseMessage;
        if (irm) {
            // Path 1: nativeFlowResponseMessage → paramsJson
            const paramsJson = irm?.nativeFlowResponseMessage?.paramsJson;
            if (paramsJson) {
                const parsed = JSON.parse(paramsJson);
                if (parsed.id) {
                    console.log(`🔘 Button tapped → id: "${parsed.id}"`);
                    return parsed.id.trim();
                }
                if (parsed.display_text) return parsed.display_text.trim();
            }
            // Path 2: body text fallback
            const bodyText = irm?.body?.text;
            if (bodyText && bodyText.trim()) {
                console.log(`🔘 Button body text → "${bodyText.trim()}"`);
                return bodyText.trim();
            }
        }
    } catch (_) {}

    // ── Template button reply (kango-wa nativeFlow buttons arrive here) ────────
    const tbr = message.message?.templateButtonReplyMessage;
    if (tbr) {
        const selId = tbr.selectedId?.trim();
        if (selId) {
            console.log(`🔘 Button tapped → selectedId: "${selId}"`);
            return selId;
        }
        const selText = tbr.selectedDisplayText?.trim();
        if (selText) return selText;
    }

    // ── List message selection ──────────────────────────────────────────────────
    const listReply = message.message?.listResponseMessage;
    if (listReply) {
        const rowId = listReply.singleSelectReply?.selectedRowId?.trim();
        if (rowId) {
            console.log(`📋 List option selected → rowId: "${rowId}"`);
            return rowId;
        }
        const listTitle = listReply.title?.trim();
        if (listTitle) return listTitle;
    }

    return (
        message.message?.conversation?.trim() ||
        message.message?.extendedTextMessage?.text?.trim() ||
        message.message?.imageMessage?.caption?.trim() ||
        message.message?.videoMessage?.caption?.trim() ||
        message.message?.documentMessage?.caption?.trim() ||
        message.message?.documentWithCaptionMessage?.message?.documentMessage?.caption?.trim() ||
        message.message?.buttonsResponseMessage?.selectedDisplayText?.trim() ||
        message.message?.viewOnceMessage?.message?.imageMessage?.caption?.trim() ||
        message.message?.viewOnceMessage?.message?.videoMessage?.caption?.trim() ||
        ''
    );
}

// ─── Main handler ─────────────────────────────────────────────────────────────
async function handleMessages(sock, messageUpdate, printLog, sessionNumber = null) {
    try {
        sock._sessionNumber = sessionNumber;
        const { messages, type } = messageUpdate;

        if (type !== 'notify' && type !== 'append') return;
        if (type === 'append' && !messages[0]?.key?.fromMe) return;

        const message = messages[0];

        if (!message?.message) return;

        await dispatchEvent('message.pre', { sock, message, sessionNumber });

        if (message.message?.protocolMessage?.type === 0) {
            await dispatchEvent('message.revoke', { sock, message });
            return;
        }

        // Resolve @lid privacy JIDs to real phone JIDs so sendMessage reaches the right chat.
        // remoteJidAlt is only populated on INCOMING messages; for outgoing (fromMe=true) messages
        // we fall back to searching the in-memory contact store by lid field.
        let chatId = message.key.remoteJid;
        if (chatId && chatId.endsWith('@lid')) {
            if (message.key.remoteJidAlt && !message.key.remoteJidAlt.endsWith('@lid')) {
                chatId = message.key.remoteJidAlt;
            } else {
                const _contacts = Object.values(sock.store && sock.store.contacts || {});
                const _match = _contacts.find(c => c.lid === chatId);
                if (_match && _match.id) chatId = _match.id;
            }
        }
        // Prefer the real phone-number JID (participantAlt/remoteJidAlt) over a @lid
        // pseudonymous id - WhatsApp's privacy feature can make participant/remoteJid
        // a @lid whose digits don't match the user's actual number, breaking sudo/owner checks.
        const senderId = message.key.participantAlt || message.key.participant || message.key.remoteJidAlt || message.key.remoteJid;
        // Passively grow the status contact cache from every incoming message
        if (senderId && senderId.endsWith('@s.whatsapp.net')) addStatusContact(senderId, sessionNumber);
        const isGroup  = chatId.endsWith('@g.us');
        const deviceType = getDeviceType(message.key?.id);
        const isBot = typeof message.key?.id === 'string' && (
            (message.key.id.startsWith('3EB0') && message.key.id.length === 12) ||
            (message.key.id.startsWith('BAAE') && message.key.id.length === 16)
        );
        const isChannel = chatId.endsWith('@newsletter');

        // Capture main owner JID once
        if (!sessionNumber && sock.user && sock.user.id && !global.mainOwnerJid) {
            global.mainOwnerJid = sock.user.id;
        }

        // Per-session prefix
        const _sfxCfg = loadConfig(sessionNumber);
        const effectivePrefix = _sfxCfg.PREFIX ? _sfxCfg.PREFIX : settings.prefix;

        // ── Presence update (autotype / autorecord) ───────────────────────────
        if (!isChannel) {
            try {
                const cfg = loadConfig(sessionNumber);
                if (cfg.AUTORECORDTYPE === 'true') {
                    const types = ['composing', 'recording'];
                    await sock.sendPresenceUpdate(types[Math.floor(Math.random() * types.length)], chatId);
                } else if (cfg.AUTORECORD === 'true') {
                    await sock.sendPresenceUpdate('recording', chatId);
                } else if (cfg.AUTOTYPE === 'true') {
                    await sock.sendPresenceUpdate('composing', chatId);
                }
            } catch (_) {}
        }

        // ── Extract message text ───────────────────────────────────────────────
        const rawText    = extractText(message);
        const userMessage = rawText.toLowerCase().replace(/\.\s+/g, '.').trim();

        // ── Antilink detection ────────────────────────────────────────────────
        if (isGroup && userMessage) {
            await dispatchEvent('message.group_text', { sock, chatId, message, userMessage, senderId, isBot });
        }

        // ── Anti Group Tag detection (runs even with no text) ─────────────────
        if (isGroup) {
            await dispatchEvent('message.group', { sock, chatId, message, senderId, sessionNumber, isBot });
        }

        // ── Emoji-react → save / view-once ───────────────────────────────────
        const EMOJI_SAVEALL = [
            '❤️','💖','💘','💝','💗','💓','💕','💞','💜','💙',
            '💚','🧡','💛','🤎','🖤','🤍','💟','❣️','💌','💋',
            '😂','🤣','😅','😁','😆','😃','😄','😀','😊','😎',
            '🤩','🥳','😇','😉','🥰','😘','😍','😚','😙','😗',
            '😮','😲','😯','😱','😳','🙀','😵','🤯','🙈','🙉',
            '🙊','🤭','🤔','🤨','😐','😶','😏','😬','🙄','🫣',
            '👍','👎','👌','🙌','👏','🙏','🤝','✌️','🤟','🤘',
            '🤞','🫶','✋','🤲','👐','☝️','👊','🤛','🤜','👉',
            '📥','💾','📌','🔖','⭐','🌟','✨','💎','🎁','📝',
            '📂','🗂️','📒','📕','📗','📘','📙','📔','📄','📃',
            '👁️','👀','🕵️','🔍','🔎','🔓','🔒','🫣','🧐','😶‍🌫️',
            '🔥','💯','🎉','🎊','🎶','🎵','🎼','🥂','🍾','⚡'
        ];
        const quotedMsg = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (quotedMsg && EMOJI_SAVEALL.includes(rawText.trim())) {
            const isViewOnce = !!(
                quotedMsg?.viewOnceMessage ||
                quotedMsg?.viewOnceMessageV2 ||
                quotedMsg?.viewOnceMessageV2Extension ||
                quotedMsg?.imageMessage?.viewOnce ||
                quotedMsg?.videoMessage?.viewOnce ||
                quotedMsg?.audioMessage?.viewOnce
            );
            if (isViewOnce) {
                const sessionRaw = (sock.user?.id || '').split(':')[0].replace(/[^0-9]/g, '');
                let shouldSave = false;
                if (isGroup) {
                    // In groups, message.key.participant = the JID of who sent the emoji.
                    // Only the session whose number matches the sender does the save.
                    const participantRaw = (message.key.participant || '').split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
                    shouldSave = !!(sessionRaw && participantRaw && participantRaw === sessionRaw);
                } else {
                    // In DMs, fromMe is true only on the session whose user sent the emoji.
                    shouldSave = !!message.key.fromMe;
                }
                if (shouldSave && sessionRaw) {
                    const selfJid = sessionRaw + '@s.whatsapp.net';
                    await viewonce2(sock, chatId, message, true, selfJid);
                }
            }
            return;
        }

        // ── Log commands ──────────────────────────────────────────────────────
        if (userMessage.startsWith(effectivePrefix)) {
            console.log(`📝 Command used in ${isGroup ? 'group' : isChannel ? 'channel' : 'private'}: ${userMessage}`);
        }

        // ── Ban check ─────────────────────────────────────────────────────────
        if (isBanned(senderId, sessionNumber) && !userMessage.startsWith(`${effectivePrefix}unban`)) {
            if (Math.random() < 0.1) {
                await sock.sendMessage(chatId, { text: '❌ You are banned from using the bot.' });
            }
            return;
        }

        // ── TicTacToe move (digits 1-9 or "surrender") ────────────────────────
        if (/^[1-9]$/.test(userMessage) || userMessage === 'surrender') {
            await handleTicTacToeMove(sock, chatId, senderId, userMessage);
            return;
        }

        // ── Word Chain Game move (any plain word while a game is active) ───────
        if (!userMessage.startsWith(effectivePrefix) && await handleWcgMove(sock, chatId, senderId, userMessage)) {
            return;
        }

        await dispatchEvent('message.count', { chatId, senderId, sessionNumber, fromMe: message.key.fromMe });

        if (isGroup && userMessage) {
            await handleBadwordDetection(sock, chatId, message, userMessage, senderId);
        }

        // ── Auto-reply: fire on first DM before prefix check ─────────────────
        if (!isGroup && !isChannel) {
            await dispatchEvent('message.dm', { sock, chatId, message, senderId });
        }

        // ── AI Chatbot: auto-reply using AI when enabled ─────────────────────
        if (!userMessage.startsWith(effectivePrefix)) {
            await handleChatbot(sock, chatId, message, senderId, userMessage);
            return;
        }

        await dispatchCommand(sock, message, chatId, senderId, isGroup, sessionNumber, effectivePrefix, userMessage, rawText);

    } catch (error) {
        console.error('❌ Error in message handler:', error.message);
    }
}

/**
 * Parses a (already prefix-checked) message into command + args, runs admin/
 * owner/public-mode guards, and dispatches to the matching plugin handler.
 * Shared by the normal prefix-command path and by AI Mode's synthetic
 * "<prefix><command> <query>" messages, so both go through identical guards.
 */
async function dispatchCommand(sock, message, chatId, senderId, isGroup, sessionNumber, effectivePrefix, userMessage, rawText) {
    // ── Parse command + args ──────────────────────────────────────────────
    const body  = userMessage.slice(effectivePrefix.length).trim();
    const cmd   = body.split(' ')[0];
    const args  = body.split(' ').slice(1);
    const query = rawText.slice(effectivePrefix.length + cmd.length).trim(); // original casing

    // Resolve aliases → canonical command name
    const c = ALIASES[cmd] || cmd;

    // ── Admin guard ───────────────────────────────────────────────────────
    let isSenderAdmin = false;
    let isBotAdmin    = false;

    if (isGroup && ADMIN_CMDS.has(c)) {
        const status = await isAdmin(sock, chatId, senderId, message);
        isSenderAdmin = status.isSenderAdmin;
        isBotAdmin    = status.isBotAdmin;

        if (!isBotAdmin) {
            await sock.sendMessage(chatId, { text: 'Please make the bot an admin to use admin commands.' });
            return;
        }
        const strictGroupAdminCommands = [
            'antilink', 'antispam', 'anticontact', 'antiaudio', 'antiimage',
            'antivideo', 'antisticker', 'antimedia', 'antibot', 'antivirus',
        ];
        if (strictGroupAdminCommands.includes(c) && !isSenderAdmin) {
            await sock.sendMessage(chatId, { text: 'Sorry, only group admins can use this command.' });
            return;
        }
        if (['mute', 'unmute', 'ban', 'unban', 'promote', 'demote'].includes(c)) {
            if (!isSenderAdmin && !message.key.fromMe) {
                await sock.sendMessage(chatId, { text: 'Sorry, only group admins can use this command.' });
                return;
            }
        }
    }

    // ── Owner guard ───────────────────────────────────────────────────────
    if (isOwnerCommand(c) && !hasOwnerPrivileges(senderId, message, sock.user?.id, sessionNumber)) {
        await sock.sendMessage(chatId, { text: '❌ This command is only for the owner and sudo users!' });
        return;
    }

    // ── Public / private mode check ───────────────────────────────────────
    try {
        const _mcPath = sessionNumber ? `./data/messageCount_${sessionNumber}.json` : './data/messageCount.json';
        const _mcData = fs.existsSync(_mcPath) ? JSON.parse(fs.readFileSync(_mcPath)) : {};
        // isPublic may be undefined if .mode was never run — fall back to COMMAND_MODE env var
        // so the bot works out of the box without needing .mode public after every restart.
        const _envPublic = (process.env.COMMAND_MODE || 'public').toLowerCase() === 'public';
        const _isPublic  = typeof _mcData.isPublic === 'boolean' ? _mcData.isPublic : _envPublic;
        if (!_isPublic && !hasOwnerPrivileges(senderId, message, sock.user?.id, sessionNumber)) return;
    } catch (_) {}

    // ── Command dispatch ──────────────────────────────────────────────────
    trackEvent(senderId, c, isGroup);


    // ── Queue stats command (owner only) ─────────────────────────────────
    if (c === 'queuestats') {
        if (!hasOwnerPrivileges(senderId, message, sock.user?.id, sessionNumber)) return;
        const all = getQueueStats();
        if (!all || !all.length) {
            await sock.sendMessage(chatId, { text: '📭 No active queues yet.' });
            return;
        }
        const lines = all.map(q =>
            '*Session:* ' + q.session + '\n' +
            'Sent: ' + q.sent + '  Failed: ' + q.failed + '  Retried: ' + q.retried + '  Pending: ' + q.pending
        ).join('\n\n');
        await sock.sendMessage(chatId, { text: '*Queue Stats*\n\n' + lines });
        return;
    }

    // -- Plugin system: run plugin if registered --
    if (pluginMap.has(c)) {
        const { handler } = pluginMap.get(c);
        await handler(sock, chatId, message, args, query, { senderId, isGroup, effectivePrefix, c, userMessage, sessionNumber });
    }
}

// ─── Utility functions ────────────────────────────────────────────────────────

const DEFAULT_USER_PIC  = 'https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_960_720.png';
const DEFAULT_GROUP_PIC = 'https://i.ibb.co/RBx5SQC/avatar-group-large-v2.png';

async function getUserPicture(sock, userId) {
    try { return await sock.profilePictureUrl(userId, 'image'); } catch { return DEFAULT_USER_PIC; }
}

async function getGroupPicture(sock, groupId) {
    try { return await sock.profilePictureUrl(groupId, 'image'); } catch { return DEFAULT_GROUP_PIC; }
}

async function getGroupThumbnailBuffer(url) {
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        return Buffer.from(response.data, 'binary');
    } catch { return null; }
}

async function getMemberThumbnail(sock, userJid) {
    try {
        const sharp  = require('sharp');
        const picUrl = await sock.profilePictureUrl(userJid, 'image');
        const raw    = await fetchBuffer(picUrl);
        return await sharp(raw).resize(200, 200, { fit: 'cover', position: 'centre' }).jpeg({ quality: 80 }).toBuffer();
    } catch (_) { return null; }
}

async function sendWelcomeMessage(sock, groupId, participant, groupName, memberCount) {
    const userNumber = participant.split('@')[0];
    const time = moment().tz('Asia/Kolkata').format('HH:mm:ss');
    const date = moment().tz('Asia/Kolkata').format('DD/MM/YYYY');
    const custom = getCustomWelcome(groupId, sock);
    const text = custom
        ? applyPlaceholders(custom, { userNumber, groupName, memberCount, time, date })
        : getLang(sock).welcome_default.replace('{group}', groupName).replace('{user}', userNumber).replace('{count}', memberCount).replace('{time}', time).replace('{date}', date);
    const thumbnail = await getMemberThumbnail(sock, participant);
    await sock.sendMessage(groupId, {
        text,
        contextInfo: {
            mentionedJid: [participant],
            ...(thumbnail && { externalAdReply: { title: '👋 New Member!', body: groupName, mediaType: 1, thumbnail, renderLargerThumbnail: true, sourceUrl: '' } })
        }
    });
}

async function sendGoodbyeMessage(sock, groupId, participant, groupName, memberCount) {
    const userNumber = participant.split('@')[0];
    const time = moment().tz('Asia/Kolkata').format('HH:mm:ss');
    const date = moment().tz('Asia/Kolkata').format('DD/MM/YYYY');
    const custom = getCustomGoodbye(groupId, sock);
    const text = custom
        ? applyPlaceholders(custom, { userNumber, groupName, memberCount, time, date })
        : getLang(sock).goodbye_default.replace('{group}', groupName).replace('{user}', userNumber).replace('{count}', memberCount).replace('{time}', time).replace('{date}', date);
    const thumbnail = await getMemberThumbnail(sock, participant);
    await sock.sendMessage(groupId, {
        text,
        contextInfo: {
            mentionedJid: [participant],
            ...(thumbnail && { externalAdReply: { title: '🚪 Member Left', body: groupName, mediaType: 1, thumbnail, renderLargerThumbnail: true, sourceUrl: '' } })
        }
    });
}

async function handleGroupParticipantUpdate(sock, update) {
    try {
        const { id, action, author } = update;
        if (!id.endsWith('@g.us')) return;

        const participants = (update.participants || []).map(p => {
            if (typeof p === 'string') return p;
            return p.phoneNumber || p.id;
        });

        if (action === 'promote' || action === 'demote') { await dispatchEvent('group_update', { sock, id, participants, action, author }); return; }

        const meta       = await sock.groupMetadata(id);
        const groupName  = meta.subject;
        const groupCount = meta.participants.length;

        for (const participant of participants) {
            if (action === 'add'    && await isWelcomeOn(id)) await sendWelcomeMessage(sock, id, participant, groupName, groupCount);
            if (action === 'remove' && await isGoodbyeOn(id)) await sendGoodbyeMessage(sock, id, participant, groupName, groupCount);
        }
    } catch (error) {
        console.error('Error in handleGroupParticipantUpdate:', error.message);
    }
}


module.exports = {
    handleMessages,
    handleGroupParticipantUpdate,
    handleStatus: async (sock, status) => { await dispatchEvent('status', { sock, status }); }
};
