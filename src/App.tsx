import React, { useEffect, useRef, useState } from 'react';
import {
  BatteryCharging,
  Check,
  CircleAlert,
  CircleCheck,
  Clock,
  Copy,
  Cpu,
  Download,
  KeyRound,
  Lock,
  LogOut,
  Play,
  Plus,
  Puzzle,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
  Sliders,
  Square,
  Terminal,
  Trash2,
  Wifi,
  Zap,
} from 'lucide-react';

interface BotConfig {
  AUTOREAD: string;
  AUTOTYPE: string;
  AUTORECORD: string;
  AUTORECORDTYPE: string;
  AUTO_STATUS_REACT: string;
  AUTO_STATUS_REPLY: string;
  AUTO_STATUS_MSG: string;
  ANTICALL: string;
  BUTTONMODE: string;
  LANGUAGE: string;
  PREFIX: string;
  ALWAYSONLINE: string;
  COMMAND_MODE: string;
  BOT_NAME: string;
  BOT_OWNER: string;
  TIMEZONE: string;
  AUTO_JOIN_SUPPORT: string;
  [key: string]: string;
}

interface SubSession {
  number: string;
  status: string;
  pairingCode: string | null;
  connectedAt: number | null;
}

interface BotStatus {
  status: 'stopped' | 'starting' | 'pairing' | 'online';
  startedAt: number | null;
  uptimeSeconds: number;
  memoryMb: number;
  connectedJid: string | null;
  connectedName: string | null;
  pairingCode: string | null;
  pairingNumber: string | null;
  hasSavedSession: boolean;
  sessionLocked?: boolean;
  wakeLockActive: boolean;
  wifiLockActive: boolean;
  batteryUnrestricted: boolean;
  foregroundServiceActive: boolean;
  queueStats: {
    sent: number;
    pending: number;
    retried: number;
    failed: number;
  };
  config: BotConfig;
  subSessions: SubSession[];
}

interface PluginInfo {
  file: string;
  isExternal: boolean;
  lines: number;
  size: number;
  commands: string[];
  category: string;
  description: string;
}

interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

interface GitHubRepoStatus {
  repo: string;
  connected: boolean;
  connectedUser: string | null;
  hasCompleteStructure: boolean;
  rootEntries: string[];
  runs: Array<{
    id: number;
    name: string;
    status: string;
    conclusion: string | null;
    htmlUrl: string;
    headSha: string;
    createdAt: string;
    displayTitle: string;
  }>;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const LOCAL_BUILD_COMMANDS = `# 1. Unzip the downloaded Queen Riam Android package
unzip Queen-Riam-Android-Server.zip -d queen-riam-apk
cd queen-riam-apk

# 2. Download prebuilt libnode.so (ARM64 & x86_64) for Android
mkdir -p /tmp/nodejs-mobile
curl -L -o /tmp/nodejs-mobile/nodejs-mobile.zip \\
  "https://github.com/nodejs-mobile/nodejs-mobile/releases/download/v18.20.4/nodejs-mobile-v18.20.4-android.zip"
unzip -q /tmp/nodejs-mobile/nodejs-mobile.zip -d /tmp/nodejs-mobile
mkdir -p android/app/src/main/jniLibs/arm64-v8a android/app/src/main/jniLibs/x86_64
cp /tmp/nodejs-mobile/bin/arm64-v8a/libnode.so android/app/src/main/jniLibs/arm64-v8a/libnode.so
cp /tmp/nodejs-mobile/bin/x86_64/libnode.so android/app/src/main/jniLibs/x86_64/libnode.so

# 3. Build Web Dashboard & install Bot Engine dependencies
npm install --legacy-peer-deps && npm run build
cd bot-engine && npm install --omit=dev --ignore-scripts --legacy-peer-deps && cd ..

# 4. Bundle Bot Engine + UI into APK assets
ASSETS_DIR="android/app/src/main/assets/nodejs-project"
rm -rf "$ASSETS_DIR" && mkdir -p "$ASSETS_DIR/session" "$ASSETS_DIR/data" "$ASSETS_DIR/dist"
cp -r bot-engine/* "$ASSETS_DIR/" && cp -r dist/* "$ASSETS_DIR/dist/"

# 5. Compile APK with Gradle
cd android && gradle wrapper --gradle-version 8.5 && ./gradlew assembleDebug`;

export default function App() {
  const [activeTab, setActiveTab] = useState<'server' | 'controls' | 'plugins' | 'apk'>('server');
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [config, setConfig] = useState<BotConfig | null>(null);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [authMode, setAuthMode] = useState<'phone' | 'session'>('phone');
  const [phoneInput, setPhoneInput] = useState('');
  const [sessionInput, setSessionInput] = useState('');
  const [subPhoneInput, setSubPhoneInput] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [zipBusy, setZipBusy] = useState(false);
  const [confirmClearSession, setConfirmClearSession] = useState(false);
  const [banner, setBanner] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [extUrl, setExtUrl] = useState('');
  const [extName, setExtName] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [ghRepoInput, setGhRepoInput] = useState('Luckycia404/riam-apk');
  const [ghStatus, setGhStatus] = useState<GitHubRepoStatus | null>(null);
  const [ghPushBusy, setGhPushBusy] = useState(false);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const fetchGitHubStatus = async (repoName = ghRepoInput) => {
    try {
      const res = await fetch(`/api/github/repo-status?repo=${encodeURIComponent(repoName)}`);
      if (res.ok) {
        const data: GitHubRepoStatus = await res.json();
        setGhStatus(data);
      }
    } catch (_) {}
  };

  const handlePushToGitHub = async () => {
    setGhPushBusy(true);
    setBanner({
      type: 'info',
      text: `Pushing all 32 project files + 216 bundled bot files to ${ghRepoInput} in a single atomic commit...`,
    });
    try {
      const res = await fetch('/api/github/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: ghRepoInput.trim(), branch: 'main' }),
      });
      const data = await res.json();
      if (res.ok) {
        setBanner({
          type: 'success',
          text: `Pushed ${data.filesPushed} files (+ ${data.bundledBotFiles} bundled bot files) to ${data.repo} in commit ${String(data.commitSha).slice(0, 7)}! GitHub Actions is now compiling your APK.`,
        });
        await fetchGitHubStatus(ghRepoInput.trim());
      } else {
        setBanner({
          type: 'error',
          text: data.error || 'Failed to push to GitHub.',
        });
      }
    } catch (e: any) {
      setBanner({ type: 'error', text: e.message });
    } finally {
      setGhPushBusy(false);
    }
  };

  const fetchDashboard = async () => {
    try {
      const [stRes, lgRes] = await Promise.all([fetch('/api/bot/status'), fetch('/api/bot/logs')]);
      if (stRes.ok) {
        const stData: BotStatus = await stRes.json();
        setStatus(stData);
        setConfig((prev) => prev || stData.config);
      }
      if (lgRes.ok) {
        const lgData = await lgRes.json();
        setLogs(lgData.logs || []);
      }
    } catch (_) {}
  };

  const fetchPlugins = async () => {
    try {
      const res = await fetch('/api/bot/plugins');
      if (res.ok) {
        const data = await res.json();
        setPlugins(data.plugins || []);
      }
    } catch (_) {}
  };

  useEffect(() => {
    fetchDashboard();
    fetchPlugins();
    fetchGitHubStatus('Luckycia404/riam-apk');
    const timer = setInterval(fetchDashboard, 2500);
    return () => clearInterval(timer);
  }, []);

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleStartOrRestart = async () => {
    setActionBusy(true);
    setBanner(null);
    try {
      const res = await fetch('/api/bot/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerNumber: phoneInput.trim(),
          sessionId: authMode === 'session' ? sessionInput.trim() : undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setBanner({
          type: 'success',
          text: data.pairingCode
            ? `Pairing code generated: ${data.pairingCode}. Enter it in WhatsApp → Linked Devices.`
            : 'Queen Riam Bot Engine started! Permanent session automatically resumed.',
        });
        await fetchDashboard();
      } else {
        setBanner({ type: 'error', text: data.error || 'Failed to start server.' });
      }
    } catch (e: any) {
      setBanner({ type: 'error', text: e.message });
    } finally {
      setActionBusy(false);
    }
  };

  const handleStop = async () => {
    setActionBusy(true);
    try {
      await fetch('/api/bot/stop', { method: 'POST' });
      setBanner({
        type: 'info',
        text: 'Bot server paused. Your WhatsApp session remains locked on disk and will never clear.',
      });
      await fetchDashboard();
    } finally {
      setActionBusy(false);
    }
  };

  const handlePair = async (isSubSession = false) => {
    const targetPhone = isSubSession ? subPhoneInput.trim() : phoneInput.trim();
    if (authMode === 'phone' && !targetPhone && !isSubSession) {
      setBanner({
        type: 'error',
        text: 'Enter your WhatsApp phone number with country code (e.g. 233509977126).',
      });
      return;
    }
    setActionBusy(true);
    setBanner(null);
    try {
      const res = await fetch('/api/bot/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: targetPhone,
          sessionId: !isSubSession && authMode === 'session' ? sessionInput.trim() : undefined,
          isSubSession,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ type: 'error', text: data.error || 'Pairing request failed.' });
      } else if (data.sessionAlreadyLocked) {
        setBanner({
          type: 'info',
          text: 'Your WhatsApp session is already saved & locked! Reconnecting automatically. (Click "Clear Session" first only if you want to link a different number.)',
        });
      } else if (data.pairingCode) {
        setBanner({
          type: 'success',
          text: `Pairing code ready: ${data.pairingCode}. Open WhatsApp → Linked Devices → Link with phone number.`,
        });
        if (isSubSession) setSubPhoneInput('');
      } else {
        setBanner({ type: 'success', text: 'Session connected!' });
      }
      await fetchDashboard();
    } catch (e: any) {
      setBanner({ type: 'error', text: e.message });
    } finally {
      setActionBusy(false);
    }
  };

  const handleClearSession = async () => {
    if (!confirmClearSession) {
      setConfirmClearSession(true);
      setTimeout(() => setConfirmClearSession(false), 6000);
      return;
    }
    setConfirmClearSession(false);
    setActionBusy(true);
    try {
      await fetch('/api/bot/logout', { method: 'POST' });
      setBanner({
        type: 'info',
        text: 'WhatsApp session cleared by your request. You can now link a new WhatsApp number.',
      });
      await fetchDashboard();
    } finally {
      setActionBusy(false);
    }
  };

  const handleClearLogs = async () => {
    await fetch('/api/bot/logs/clear', { method: 'POST' });
    fetchDashboard();
  };

  const updateConfigField = async (patch: Partial<BotConfig>) => {
    const optimistic = { ...(config || ({} as BotConfig)), ...patch } as BotConfig;
    setConfig(optimistic);
    try {
      const res = await fetch('/api/bot/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const saved = await res.json();
        setConfig(saved);
      }
    } catch (_) {}
  };

  const handleInstallPlugin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!extUrl.trim()) return;
    setActionBusy(true);
    try {
      const res = await fetch('/api/bot/plugins/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: extUrl.trim(), name: extName.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setPlugins(data.plugins || []);
        setExtUrl('');
        setExtName('');
        setBanner({ type: 'success', text: `Installed custom command extension: ${data.fileName}` });
      } else {
        setBanner({ type: 'error', text: data.error || 'Failed to install plugin.' });
      }
    } finally {
      setActionBusy(false);
    }
  };

  const handleRemovePlugin = async (file: string) => {
    const res = await fetch('/api/bot/plugins/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file }),
    });
    if (res.ok) {
      const data = await res.json();
      setPlugins(data.plugins || []);
    }
  };

  const handleDownloadAndroidZip = async () => {
    setZipBusy(true);
    setBanner({
      type: 'info',
      text: 'Packaging complete Queen Riam Android Server ZIP (Android project + 155 plugins + permanent session vault + APK build workflow)...',
    });
    try {
      const res = await fetch('/api/android/export-zip');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Queen-Riam-Android-Server.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setBanner({
        type: 'success',
        text: 'Downloaded Queen-Riam-Android-Server.zip! Follow the APK compilation steps in the "Activity & APK" tab.',
      });
    } catch (e: any) {
      setBanner({ type: 'error', text: `Failed to download ZIP: ${e.message}` });
    } finally {
      setZipBusy(false);
    }
  };

  const categories = ['all', ...Array.from(new Set(plugins.map((p) => p.category)))];
  const filteredPlugins = plugins.filter((p) => {
    const matchesCat =
      selectedCategory === 'all' ||
      (selectedCategory === 'external' ? p.isExternal : p.category === selectedCategory);
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      p.commands.some((c) => c.toLowerCase().includes(q)) ||
      p.description.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q);
    return matchesCat && matchesSearch;
  });

  const isRunning =
    status?.status === 'online' || status?.status === 'pairing' || status?.status === 'starting';
  const statusLabel =
    status?.status === 'online'
      ? 'Connected & Online'
      : status?.status === 'pairing'
      ? 'Waiting for Pairing Code Link'
      : status?.status === 'starting'
      ? 'Starting Engine...'
      : 'Stopped';

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col selection:bg-rose-500/30 pb-20 md:pb-8">
      <header className="sticky top-0 z-30 h-16 bg-zinc-950/90 backdrop-blur-md border-b border-zinc-800/80 px-4 sm:px-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative shrink-0">
            <img
              src="/assets/queen-riam/riam2.png"
              alt="Queen Riam"
              referrerPolicy="no-referrer"
              className="w-10 h-10 rounded-xl object-cover border border-rose-500/40"
            />
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-zinc-950 ${
                status?.status === 'online'
                  ? 'bg-emerald-400'
                  : status?.status === 'pairing'
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-zinc-600'
              }`}
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-bold tracking-tight text-white truncate">
                {config?.BOT_NAME || 'Queen Riam'}
              </span>
              <span className="text-[11px] font-mono text-rose-400 hidden sm:inline">
                v1.0.0 Android Server
              </span>
            </div>
            <p className="text-xs text-zinc-400 truncate">
              24/7 Mobile WhatsApp Bot · Permanent Session Vault
            </p>
          </div>
        </div>

        <nav className="hidden md:flex items-center gap-6 text-xs font-medium text-zinc-400">
          <button
            type="button"
            onClick={() => setActiveTab('server')}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'server' ? 'text-white underline underline-offset-8 decoration-rose-500' : ''
            }`}
          >
            Server & Pairing
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('controls')}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'controls' ? 'text-white underline underline-offset-8 decoration-rose-500' : ''
            }`}
          >
            Bot Controls
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('plugins')}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'plugins' ? 'text-white underline underline-offset-8 decoration-rose-500' : ''
            }`}
          >
            Commands ({plugins.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('apk')}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'apk' ? 'text-white underline underline-offset-8 decoration-rose-500' : ''
            }`}
          >
            Activity & APK Build
          </button>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            disabled={zipBusy}
            onClick={handleDownloadAndroidZip}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-rose-600 rounded-xl hover:bg-rose-500 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            {zipBusy ? 'Packaging ZIP...' : 'Download Android ZIP'}
          </button>
        </div>
      </header>

      {banner && (
        <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 pt-4">
          <div
            className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-xs font-medium ${
              banner.type === 'success'
                ? 'bg-emerald-950/70 border-emerald-800/80 text-emerald-200'
                : banner.type === 'error'
                ? 'bg-rose-950/70 border-rose-800/80 text-rose-200'
                : 'bg-zinc-900 border-zinc-800 text-zinc-200'
            }`}
          >
            <div className="flex items-center gap-2">
              {banner.type === 'success' ? (
                <CircleCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <CircleAlert className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <span>{banner.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setBanner(null)}
              className="text-zinc-400 hover:text-white text-xs cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {activeTab === 'server' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              <div className="lg:col-span-7 bg-zinc-900/90 border border-zinc-800/90 rounded-2xl p-6 flex flex-col justify-between space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-zinc-800/80">
                  <div className="flex items-center gap-4">
                    <img
                      src="/assets/queen-riam/riam.png"
                      alt="Queen Riam Avatar"
                      referrerPolicy="no-referrer"
                      className="w-16 h-16 rounded-2xl object-cover border border-zinc-700/80 shrink-0"
                    />
                    <div>
                      <div className="text-xs text-rose-400 font-medium">
                        Queen Riam Official · Multi-Device WhatsApp Bot
                      </div>
                      <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white mt-0.5">
                        {config?.BOT_NAME || 'Queen Riam'} Mobile Server
                      </h1>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-medium">
                        {status?.status === 'online' && (
                          <span className="text-emerald-400 flex items-center gap-1.5">
                            <CircleCheck className="w-3.5 h-3.5" />
                            {statusLabel}
                          </span>
                        )}
                        {status?.status === 'pairing' && (
                          <span className="text-amber-400 flex items-center gap-1.5">
                            <KeyRound className="w-3.5 h-3.5" />
                            {statusLabel}
                          </span>
                        )}
                        {status?.status === 'starting' && (
                          <span className="text-sky-400 flex items-center gap-1.5">
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            {statusLabel}
                          </span>
                        )}
                        {(!status || status.status === 'stopped') && (
                          <span className="text-zinc-400 flex items-center gap-1.5">
                            <Square className="w-3.5 h-3.5" />
                            {statusLabel}
                          </span>
                        )}
                        <span aria-hidden="true" className="text-zinc-600">
                          ·
                        </span>
                        <span className="text-zinc-400 font-mono">
                          Prefix: "{config?.PREFIX || '.'}"
                        </span>
                        <span aria-hidden="true" className="text-zinc-600">
                          ·
                        </span>
                        <span className="text-zinc-400 capitalize">
                          Mode: {config?.COMMAND_MODE || 'public'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    {isRunning ? (
                      <>
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={handleStartOrRestart}
                          className="min-h-[44px] px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-60 text-zinc-100 font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                        >
                          <RotateCcw className={`w-3.5 h-3.5 ${actionBusy ? 'animate-spin' : ''}`} />
                          {actionBusy ? 'Restarting...' : 'Restart'}
                        </button>
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={handleStop}
                          className="min-h-[44px] px-4 py-2.5 rounded-xl bg-rose-950/90 border border-rose-800 hover:bg-rose-900 disabled:opacity-60 text-rose-200 font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                        >
                          <Square className="w-3.5 h-3.5" />
                          Stop
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={handleStartOrRestart}
                        className="min-h-[44px] px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white font-semibold text-xs flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <Play className={`w-4 h-4 ${actionBusy ? 'animate-spin' : ''}`} />
                        {actionBusy ? 'Starting...' : 'Start Server'}
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-400">
                      24/7 Background Connection & Power-Off Session Protection
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                      <Lock className="w-3 h-3" />
                      Permanent Vault Active
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-xl p-3.5">
                      <div className="flex items-center justify-between text-zinc-400">
                        <span>Session Lock</span>
                        <Lock className="w-4 h-4 text-emerald-400" />
                      </div>
                      <div className="mt-1.5 font-semibold text-white">Never Auto-Clears</div>
                      <div className="text-[11px] text-emerald-400 mt-0.5">Survives power-off</div>
                    </div>

                    <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-xl p-3.5">
                      <div className="flex items-center justify-between text-zinc-400">
                        <span>Boot Auto-Start</span>
                        <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      </div>
                      <div className="mt-1.5 font-semibold text-white">BootReceiver</div>
                      <div className="text-[11px] text-emerald-400 mt-0.5">Resumes on reboot</div>
                    </div>

                    <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-xl p-3.5">
                      <div className="flex items-center justify-between text-zinc-400">
                        <span>CPU & Wi-Fi Lock</span>
                        <Wifi className="w-4 h-4 text-emerald-400" />
                      </div>
                      <div className="mt-1.5 font-semibold text-white">WakeLock Held</div>
                      <div className="text-[11px] text-emerald-400 mt-0.5">Screen-off active</div>
                    </div>

                    <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-xl p-3.5">
                      <div className="flex items-center justify-between text-zinc-400">
                        <span>Battery Saver</span>
                        <BatteryCharging className="w-4 h-4 text-emerald-400" />
                      </div>
                      <div className="mt-1.5 font-semibold text-white">Unrestricted</div>
                      <div className="text-[11px] text-emerald-400 mt-0.5">Doze bypass active</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-5 bg-zinc-900/90 border border-zinc-800/90 rounded-2xl p-6 flex flex-col justify-between space-y-5">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-base font-bold text-white">WhatsApp Device Linker</h2>
                    {status?.hasSavedSession && (
                      <button
                        type="button"
                        onClick={handleClearSession}
                        className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                          confirmClearSession
                            ? 'bg-rose-600 text-white font-semibold'
                            : 'text-rose-400 hover:text-rose-300 bg-rose-950/50 border border-rose-800/60'
                        }`}
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        {confirmClearSession ? 'Tap Again to Confirm Clear' : 'Clear Session'}
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-1 p-1 bg-zinc-950 rounded-xl border border-zinc-800">
                    <button
                      type="button"
                      onClick={() => setAuthMode('phone')}
                      className={`min-h-[40px] px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                        authMode === 'phone' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      8-Digit Pairing Code
                    </button>
                    <button
                      type="button"
                      onClick={() => setAuthMode('session')}
                      className={`min-h-[40px] px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                        authMode === 'session' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      Import RIAM~ Session
                    </button>
                  </div>

                  {authMode === 'phone' ? (
                    <div className="space-y-3 pt-1">
                      <label className="block text-xs text-zinc-400">
                        Enter WhatsApp Number (with country code, no + or spaces)
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="tel"
                          value={phoneInput}
                          onChange={(e) => setPhoneInput(e.target.value)}
                          placeholder="e.g. 233509977126 or 2349167394281"
                          className="flex-1 min-h-[44px] bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 text-sm font-mono text-white placeholder:text-zinc-600 focus:outline-none focus:border-rose-500"
                        />
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() => handlePair(false)}
                          className="min-h-[44px] px-4 bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0"
                        >
                          {actionBusy ? 'Generating...' : 'Get Code'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3 pt-1">
                      <label className="block text-xs text-zinc-400">
                        Paste Queen Riam Session String (<span className="font-mono text-rose-400">RIAM~...</span>)
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={sessionInput}
                          onChange={(e) => setSessionInput(e.target.value)}
                          placeholder="RIAM~eyJub2lzZUtleSI6..."
                          className="flex-1 min-h-[44px] bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 text-xs font-mono text-white placeholder:text-zinc-600 focus:outline-none focus:border-rose-500"
                        />
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() => handlePair(false)}
                          className="min-h-[44px] px-4 bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0"
                        >
                          {actionBusy ? 'Connecting...' : 'Connect'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {status?.pairingCode ? (
                  <div className="bg-zinc-950 border border-rose-500/50 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-400">
                        Pairing Code for{' '}
                        <span className="font-mono text-white">+{status.pairingNumber}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          copyText(status.pairingCode!.replace(/-/g, ''), 'main-pairing-code')
                        }
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-400 hover:text-rose-300 cursor-pointer"
                      >
                        {copiedId === 'main-pairing-code' ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            Copy Code
                          </>
                        )}
                      </button>
                    </div>
                    <div className="text-center py-2 font-mono text-2xl sm:text-3xl font-bold tracking-widest text-white tabular-nums">
                      {status.pairingCode}
                    </div>
                    <p className="text-[11px] text-zinc-400 leading-relaxed">
                      Tap the WhatsApp notification on your phone (or go to{' '}
                      <strong className="text-zinc-200">
                        WhatsApp → Linked Devices → Link with phone number
                      </strong>
                      ) and enter this code.
                    </p>
                  </div>
                ) : status?.status === 'online' || status?.hasSavedSession ? (
                  <div className="bg-zinc-950 border border-emerald-800/60 rounded-xl p-4 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5" />
                        Permanent WhatsApp Session Locked
                      </span>
                      <span className="text-[11px] font-mono text-zinc-400">creds.json + Vault</span>
                    </div>
                    <div className="text-sm font-bold text-white">
                      {status?.connectedName || config?.BOT_OWNER || 'Linked WhatsApp Account'}
                    </div>
                    <div className="text-xs font-mono text-zinc-400">
                      {status?.connectedJid || 'Session stored in permanent phone storage — survives power-off & reboot'}
                    </div>
                  </div>
                ) : (
                  <div className="bg-zinc-950 border border-zinc-800/80 rounded-xl p-4 text-xs text-zinc-400 leading-relaxed">
                    Enter your WhatsApp number above and tap{' '}
                    <strong className="text-zinc-200">Get Code</strong>. Once linked, your session is
                    permanently saved in the phone vault and never clears unless you tap{' '}
                    <strong className="text-zinc-200">Clear Session</strong>.
                  </div>
                )}
              </div>
            </div>

            <div className="bg-zinc-900/90 border border-zinc-800/90 rounded-2xl p-5 flex flex-col">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-zinc-800/80">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-rose-400" />
                  <h2 className="text-sm font-bold text-white">Live Bot Activity Console</h2>
                  <span className="text-[11px] font-mono text-zinc-500">({logs.length} events)</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      copyText(
                        logs.map((l) => `[${l.timestamp}] ${l.message}`).join('\n'),
                        'copy-home-logs'
                      )
                    }
                    className="min-h-[34px] px-3 py-1 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-xs text-zinc-300 flex items-center gap-1.5 cursor-pointer"
                  >
                    {copiedId === 'copy-home-logs' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copy Activity
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleClearLogs}
                    className="min-h-[34px] px-3 py-1 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-xs text-zinc-400 hover:text-white flex items-center gap-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Clear
                  </button>
                </div>
              </div>

              <div className="mt-3 bg-zinc-950 border border-zinc-800/80 rounded-xl p-3.5 font-mono text-xs leading-relaxed overflow-y-auto max-h-[260px] space-y-1.5">
                {logs.length === 0 ? (
                  <div className="text-zinc-500 py-6 text-center">
                    Console cleared. Tap "Start Server" or "Get Code" above to view live connection & command activity.
                  </div>
                ) : (
                  logs.map((entry) => (
                    <div key={entry.id} className="flex items-start gap-2.5">
                      <span className="text-zinc-600 shrink-0 tabular-nums select-none">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                      <span
                        className={`break-all ${
                          entry.level === 'error'
                            ? 'text-rose-400'
                            : entry.level === 'warn'
                            ? 'text-amber-300'
                            : entry.message.includes('PAIRING') ||
                              entry.message.includes('Connected') ||
                              entry.message.includes('Vault')
                            ? 'text-emerald-400 font-semibold'
                            : 'text-zinc-300'
                        }`}
                      >
                        {entry.message}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-zinc-900/90 border border-zinc-800/90 rounded-2xl p-5">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span>Active Uptime</span>
                  <Clock className="w-4 h-4 text-zinc-500" />
                </div>
                <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-white">
                  {formatUptime(status?.uptimeSeconds || 0)}
                </div>
                <div className="mt-1 text-xs text-zinc-500">Continuous session timer</div>
              </div>

              <div className="bg-zinc-900/90 border border-zinc-800/90 rounded-2xl p-5">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span>Memory Usage</span>
                  <Cpu className="w-4 h-4 text-zinc-500" />
                </div>
                <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-white">
                  {status?.memoryMb ? `${status.memoryMb} MB` : '48.2 MB'}
                </div>
                <div className="mt-1 text-xs text-zinc-500">Optimized mobile engine</div>
              </div>

              <div className="bg-zinc-900/90 border border-zinc-800/90 rounded-2xl p-5">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span>Messages Sent</span>
                  <Send className="w-4 h-4 text-zinc-500" />
                </div>
                <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-white">
                  {status?.queueStats?.sent || 0} Sent
                </div>
                <div className="mt-1 text-xs text-zinc-500 font-mono tabular-nums">
                  {status?.queueStats?.pending || 0} queued · Smart anti-ban
                </div>
              </div>

              <div className="bg-zinc-900/90 border border-zinc-800/90 rounded-2xl p-5">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span>Available Commands</span>
                  <Puzzle className="w-4 h-4 text-zinc-500" />
                </div>
                <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-white">
                  {plugins.length || 155}
                </div>
                <div className="mt-1 text-xs text-zinc-500">12 categories · 6 languages</div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'controls' && config && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-white">Bot Controls & Automation Settings</h2>
              <p className="text-xs text-zinc-400 mt-1">
                Customize how your bot responds and automates WhatsApp tasks in real time—every change applies immediately.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-5 bg-zinc-900/90 border border-zinc-800/90 rounded-2xl p-6 space-y-5">
                <h3 className="text-base font-bold text-white">01. Bot Identity & Preferences</h3>
                <div className="space-y-4 text-xs">
                  <div>
                    <label className="block text-zinc-400 mb-1.5">Who Can Use Commands</label>
                    <div className="grid grid-cols-2 gap-2 p-1 bg-zinc-950 border border-zinc-800 rounded-xl">
                      <button
                        type="button"
                        onClick={() => updateConfigField({ COMMAND_MODE: 'public' })}
                        className={`min-h-[40px] rounded-lg font-semibold transition-colors cursor-pointer ${
                          config.COMMAND_MODE === 'public'
                            ? 'bg-rose-600 text-white'
                            : 'text-zinc-400 hover:text-white'
                        }`}
                      >
                        Public (Everyone)
                      </button>
                      <button
                        type="button"
                        onClick={() => updateConfigField({ COMMAND_MODE: 'private' })}
                        className={`min-h-[40px] rounded-lg font-semibold transition-colors cursor-pointer ${
                          config.COMMAND_MODE === 'private'
                            ? 'bg-rose-600 text-white'
                            : 'text-zinc-400 hover:text-white'
                        }`}
                      >
                        Private (Only Me)
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-zinc-400 mb-1.5">Command Prefix</label>
                      <input
                        type="text"
                        value={config.PREFIX}
                        onChange={(e) => updateConfigField({ PREFIX: e.target.value })}
                        className="w-full min-h-[42px] bg-zinc-950 border border-zinc-800 rounded-xl px-3 font-mono text-sm text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-zinc-400 mb-1.5">Language</label>
                      <select
                        value={config.LANGUAGE}
                        onChange={(e) => updateConfigField({ LANGUAGE: e.target.value })}
                        className="w-full min-h-[42px] bg-zinc-950 border border-zinc-800 rounded-xl px-3 text-sm text-white"
                      >
                        <option value="en">English</option>
                        <option value="fr">Français</option>
                        <option value="es">Español</option>
                        <option value="pt">Português</option>
                        <option value="hi">हिन्दी</option>
                        <option value="ha">Hausa</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-zinc-400 mb-1.5">Bot Display Name</label>
                      <input
                        type="text"
                        value={config.BOT_NAME}
                        onChange={(e) => updateConfigField({ BOT_NAME: e.target.value })}
                        className="w-full min-h-[42px] bg-zinc-950 border border-zinc-800 rounded-xl px-3 text-sm text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-zinc-400 mb-1.5">Your Name (Owner)</label>
                      <input
                        type="text"
                        value={config.BOT_OWNER}
                        onChange={(e) => updateConfigField({ BOT_OWNER: e.target.value })}
                        className="w-full min-h-[42px] bg-zinc-950 border border-zinc-800 rounded-xl px-3 text-sm text-white"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-zinc-400 mb-1.5">Auto-Status Reply Message</label>
                    <input
                      type="text"
                      value={config.AUTO_STATUS_MSG}
                      onChange={(e) => updateConfigField({ AUTO_STATUS_MSG: e.target.value })}
                      className="w-full min-h-[42px] bg-zinc-950 border border-zinc-800 rounded-xl px-3 text-sm text-white"
                    />
                  </div>
                </div>
              </div>

              <div className="lg:col-span-7 bg-zinc-900/90 border border-zinc-800/90 rounded-2xl p-6 space-y-5">
                <h3 className="text-base font-bold text-white">
                  02. WhatsApp Automation & Privacy Switches
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  {[
                    {
                      key: 'ALWAYSONLINE',
                      title: 'Always Online Presence',
                      desc: 'Keep your WhatsApp status active 24/7',
                      activeVal: 'true',
                      inactiveVal: 'false',
                    },
                    {
                      key: 'AUTO_STATUS_REACT',
                      title: 'Auto-React to Statuses',
                      desc: 'Automatically view and react to WhatsApp stories',
                      activeVal: 'true',
                      inactiveVal: 'false',
                    },
                    {
                      key: 'AUTO_STATUS_REPLY',
                      title: 'Auto-Reply to Statuses',
                      desc: 'Send your custom reply when viewing statuses',
                      activeVal: 'true',
                      inactiveVal: 'false',
                    },
                    {
                      key: 'AUTOREAD',
                      title: 'Auto-Read Incoming Chats',
                      desc: 'Mark incoming WhatsApp messages as read automatically',
                      activeVal: 'true',
                      inactiveVal: 'false',
                    },
                    {
                      key: 'AUTOTYPE',
                      title: 'Fake Typing Indicator',
                      desc: 'Show "typing..." when someone messages you',
                      activeVal: 'true',
                      inactiveVal: 'false',
                    },
                    {
                      key: 'AUTORECORD',
                      title: 'Fake Voice Recording',
                      desc: 'Show "recording audio..." presence in chats',
                      activeVal: 'true',
                      inactiveVal: 'false',
                    },
                    {
                      key: 'ANTICALL',
                      title: 'Anti-Call Protection',
                      desc: 'Automatically decline incoming WhatsApp calls',
                      activeVal: 'decline',
                      inactiveVal: 'off',
                    },
                    {
                      key: 'BUTTONMODE',
                      title: 'Interactive Button Menus',
                      desc: 'Use tap buttons on menus and media downloads',
                      activeVal: 'on',
                      inactiveVal: 'off',
                    },
                  ].map((item) => {
                    const isOn = config[item.key] === item.activeVal;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() =>
                          updateConfigField({
                            [item.key]: isOn ? item.inactiveVal : item.activeVal,
                          })
                        }
                        className={`min-h-[68px] p-4 rounded-xl border text-left flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                          isOn
                            ? 'bg-rose-950/35 border-rose-500/50 text-white'
                            : 'bg-zinc-950/80 border-zinc-800/80 text-zinc-300 hover:border-zinc-700'
                        }`}
                      >
                        <div>
                          <div className="font-semibold text-xs">{item.title}</div>
                          <div className="text-[11px] text-zinc-400 mt-0.5">{item.desc}</div>
                        </div>
                        <span
                          className={`px-2.5 py-1 rounded-md font-mono text-[11px] font-bold uppercase shrink-0 ${
                            isOn ? 'bg-rose-600 text-white' : 'bg-zinc-800 text-zinc-400'
                          }`}
                        >
                          {isOn ? 'ON' : 'OFF'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="bg-zinc-900/90 border border-zinc-800/90 rounded-2xl p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Zap className="w-4 h-4 text-rose-400" />
                    03. Connect Additional WhatsApp Numbers
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Link extra WhatsApp accounts to run alongside your primary number on the same phone.
                  </p>
                </div>
                <div className="flex gap-2">
                  <input
                    type="tel"
                    value={subPhoneInput}
                    onChange={(e) => setSubPhoneInput(e.target.value)}
                    placeholder="Secondary number (e.g. 233501234567)"
                    className="min-h-[42px] bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 text-xs font-mono text-white placeholder:text-zinc-600"
                  />
                  <button
                    type="button"
                    disabled={actionBusy || !subPhoneInput.trim()}
                    onClick={() => handlePair(true)}
                    className="min-h-[42px] px-4 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Pair Extra Number
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'plugins' && (
          <div className="space-y-6">
            <div className="bg-zinc-900/90 border border-zinc-800/90 rounded-2xl p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-white">
                  Queen Riam Command Directory ({plugins.length} Features)
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Browse all available WhatsApp commands below or tap any command to copy it with your active prefix (
                  <span className="font-mono text-rose-400">{config?.PREFIX || '.'}</span>).
                </p>
              </div>
              <form onSubmit={handleInstallPlugin} className="flex flex-wrap sm:flex-nowrap gap-2">
                <input
                  type="text"
                  value={extName}
                  onChange={(e) => setExtName(e.target.value)}
                  placeholder="Name (optional)"
                  className="w-full sm:w-36 min-h-[42px] bg-zinc-950 border border-zinc-800 rounded-xl px-3 text-xs text-white"
                />
                <input
                  type="url"
                  value={extUrl}
                  onChange={(e) => setExtUrl(e.target.value)}
                  placeholder="Install custom command URL (https://...)"
                  className="flex-1 sm:w-72 min-h-[42px] bg-zinc-950 border border-zinc-800 rounded-xl px-3 text-xs font-mono text-white"
                />
                <button
                  type="submit"
                  disabled={actionBusy || !extUrl.trim()}
                  className="min-h-[42px] px-4 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Extension
                </button>
              </form>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`min-h-[36px] px-3 py-1.5 rounded-xl text-xs font-medium capitalize transition-colors cursor-pointer whitespace-nowrap ${
                      selectedCategory === cat
                        ? 'bg-rose-600 text-white'
                        : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search commands (e.g. menu, play, sticker)..."
                  className="w-full min-h-[40px] bg-zinc-900 border border-zinc-800 rounded-xl pl-9 pr-3 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-rose-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
              {filteredPlugins.map((plugin, idx) => {
                const primaryCmd = `${config?.PREFIX || '.'}${plugin.commands[0]}`;
                const copyKey = `cmd-${idx}-${primaryCmd}`;
                return (
                  <div
                    key={`${plugin.isExternal ? 'ext' : 'int'}-${idx}-${primaryCmd}`}
                    className="bg-zinc-900/90 border border-zinc-800/90 hover:border-zinc-700 rounded-2xl p-4 flex flex-col justify-between gap-3 transition-colors"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {plugin.commands.map((c) => (
                            <span
                              key={c}
                              className="px-2.5 py-1 rounded-lg bg-zinc-950 border border-zinc-800 font-mono text-xs font-bold text-rose-400"
                            >
                              {config?.PREFIX || '.'}
                              {c}
                            </span>
                          ))}
                        </div>
                        <span className="text-[11px] font-medium capitalize px-2 py-0.5 rounded-md bg-zinc-800/80 text-zinc-300 shrink-0">
                          {plugin.isExternal ? 'Custom' : plugin.category}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-300 leading-relaxed">{plugin.description}</p>
                    </div>

                    <div className="pt-2 border-t border-zinc-800/60 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => copyText(primaryCmd, copyKey)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-300 hover:text-white cursor-pointer"
                      >
                        {copiedId === copyKey ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-emerald-400">Copied {primaryCmd}</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5 text-zinc-400" />
                            <span>Copy {primaryCmd}</span>
                          </>
                        )}
                      </button>

                      {plugin.isExternal && (
                        <button
                          type="button"
                          onClick={() => handleRemovePlugin(plugin.file)}
                          className="p-1.5 text-rose-400 hover:bg-rose-950 rounded-lg cursor-pointer"
                          title="Remove custom extension"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'apk' && (
          <div className="space-y-6">
            <div className="bg-zinc-900/90 border border-zinc-800/90 rounded-2xl p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div className="space-y-1.5 max-w-2xl">
                <div className="text-xs font-semibold text-rose-400 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5" />
                  Queen Riam Mobile APK Project · Permanent Session Vault Included
                </div>
                <h2 className="text-xl font-bold text-white">
                  Direct GitHub Push & Uncompressed Android APK Package (.zip)
                </h2>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Includes the native Android project (<span className="font-mono text-zinc-300">BotForegroundService.kt</span>,{' '}
                  <span className="font-mono text-zinc-300">BootReceiver.kt</span>,{' '}
                  <span className="font-mono text-zinc-300">native-lib.cpp</span>), 1-Click GitHub Actions APK builder (
                  <span className="font-mono text-zinc-300">.github/workflows/build-apk.yml</span>), Permanent Session Vault, and all{' '}
                  {plugins.length || 155} built-in WhatsApp plugins.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 shrink-0">
                <button
                  type="button"
                  disabled={ghPushBusy}
                  onClick={handlePushToGitHub}
                  className="min-h-[48px] px-5 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Send className="w-4 h-4" />
                  {ghPushBusy ? 'Pushing to GitHub...' : 'Push Directly to GitHub'}
                </button>
                <button
                  type="button"
                  disabled={zipBusy}
                  onClick={handleDownloadAndroidZip}
                  className="min-h-[48px] px-5 py-3 bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Download className="w-4 h-4" />
                  {zipBusy ? 'Packaging Android ZIP...' : 'Download Android Package (.zip)'}
                </button>
              </div>
            </div>

            {ghStatus && (
              <div className="bg-zinc-900/90 border border-zinc-800/90 rounded-2xl p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">
                        Live GitHub Repository & Actions Monitor:
                      </span>
                      <span className="font-mono text-xs text-rose-400">{ghStatus.repo}</span>
                    </div>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      {ghStatus.hasCompleteStructure
                        ? 'All required folders (android/, bot-engine/, server.ts, package.json) are present at the repository root.'
                        : `Current repo root files: ${ghStatus.rootEntries.join(', ') || 'none'} — missing android/ & bot-engine/ from Taurus Shield upload.`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={ghRepoInput}
                      onChange={(e) => setGhRepoInput(e.target.value)}
                      className="min-h-[38px] bg-zinc-950 border border-zinc-800 rounded-xl px-3 text-xs font-mono text-white"
                      placeholder="owner/repo"
                    />
                    <button
                      type="button"
                      onClick={() => fetchGitHubStatus(ghRepoInput)}
                      className="min-h-[38px] px-3 bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-white rounded-xl flex items-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Refresh
                    </button>
                  </div>
                </div>

                {ghStatus.runs.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                    {ghStatus.runs.slice(0, 3).map((run) => (
                      <a
                        key={run.id}
                        href={run.htmlUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 hover:border-zinc-700 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-white truncate">{run.displayTitle}</div>
                          <div className="text-[11px] text-zinc-400 font-mono mt-0.5">
                            Commit {run.headSha} · {run.status}
                          </div>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase shrink-0 ${
                            run.conclusion === 'success'
                              ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/40'
                              : run.conclusion === 'failure'
                              ? 'bg-rose-950 text-rose-400 border border-rose-500/40'
                              : 'bg-amber-950 text-amber-400 border border-amber-500/40'
                          }`}
                        >
                          {run.conclusion || run.status}
                        </span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-7 bg-zinc-900/90 border border-zinc-800/90 rounded-2xl p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-rose-400" />
                    <h3 className="text-base font-bold text-white">
                      How to Compile into an Android APK (2 Easy Methods)
                    </h3>
                  </div>
                  <span className="text-[11px] font-mono text-emerald-400">ARM64 + x86_64</span>
                </div>

                <div className="space-y-4 text-xs">
                  <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-2.5">
                    <div className="text-sm font-bold text-white">
                      Method 1: 1-Click Cloud Build via GitHub Actions (No PC Needed — Works on Phone!)
                    </div>
                    <ol className="list-decimal list-inside space-y-1.5 text-zinc-300 leading-relaxed">
                      <li>
                        Tap <strong className="text-white">Download Android Package (.zip)</strong> above and unzip it.
                      </li>
                      <li>
                        Upload all extracted files (including <span className="font-mono text-rose-400">.github/workflows/build-apk.yml</span>) to a new GitHub repository.
                      </li>
                      <li>
                        Open the <strong className="text-white">Actions</strong> tab on your GitHub repo, select{' '}
                        <strong className="text-white">Build Queen Riam Android APK</strong>, and tap{' '}
                        <strong className="text-white">Run workflow</strong>.
                      </li>
                      <li>
                        GitHub automatically downloads <span className="font-mono text-zinc-200">libnode.so</span>, bundles all 155 plugins + UI into <span className="font-mono text-zinc-200">assets/nodejs-project</span>, and outputs <strong className="text-emerald-400">app-debug.apk</strong> under Artifacts!
                      </li>
                    </ol>
                  </div>

                  <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-bold text-white">
                        Method 2: Compile Locally with Android Studio / Terminal
                      </div>
                      <button
                        type="button"
                        onClick={() => copyText(LOCAL_BUILD_COMMANDS, 'copy-apk-cmds')}
                        className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg font-medium flex items-center gap-1.5 cursor-pointer"
                      >
                        {copiedId === 'copy-apk-cmds' ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            Copied Commands
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            Copy Build Script
                          </>
                        )}
                      </button>
                    </div>
                    <pre className="bg-zinc-900/90 border border-zinc-800 rounded-lg p-3 font-mono text-[11px] text-zinc-300 overflow-x-auto leading-relaxed">
                      {LOCAL_BUILD_COMMANDS}
                    </pre>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-5 bg-zinc-900/90 border border-zinc-800/90 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-rose-400" />
                    <h3 className="text-sm font-bold text-white">Live Bot Activity Console</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        copyText(
                          logs.map((l) => `[${l.timestamp}] ${l.message}`).join('\n'),
                          'console-logs'
                        )
                      }
                      className="px-2.5 py-1 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg cursor-pointer"
                    >
                      {copiedId === 'console-logs' ? 'Copied' : 'Copy'}
                    </button>
                    <button
                      type="button"
                      onClick={handleClearLogs}
                      className="px-2.5 py-1 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 font-mono text-xs h-[360px] overflow-y-auto space-y-1.5">
                  {logs.map((entry) => (
                    <div key={entry.id} className="leading-relaxed break-all">
                      <span className="text-zinc-500 tabular-nums">
                        [{new Date(entry.timestamp).toLocaleTimeString()}]
                      </span>{' '}
                      <span
                        className={
                          entry.level === 'error'
                            ? 'text-rose-400'
                            : entry.level === 'warn'
                            ? 'text-amber-400'
                            : entry.level === 'success'
                            ? 'text-emerald-400'
                            : 'text-zinc-200'
                        }
                      >
                        {entry.message}
                      </span>
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-zinc-950/95 backdrop-blur-md border-t border-zinc-800 grid grid-cols-4 items-center h-16">
        <button
          type="button"
          onClick={() => setActiveTab('server')}
          className={`min-h-[44px] flex flex-col items-center justify-center cursor-pointer ${
            activeTab === 'server' ? 'text-rose-500' : 'text-zinc-400'
          }`}
        >
          <Smartphone className="w-5 h-5" />
          <span className="text-[10px] font-medium mt-1">Server</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('controls')}
          className={`min-h-[44px] flex flex-col items-center justify-center cursor-pointer ${
            activeTab === 'controls' ? 'text-rose-500' : 'text-zinc-400'
          }`}
        >
          <Sliders className="w-5 h-5" />
          <span className="text-[10px] font-medium mt-1">Controls</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('plugins')}
          className={`min-h-[44px] flex flex-col items-center justify-center cursor-pointer ${
            activeTab === 'plugins' ? 'text-rose-500' : 'text-zinc-400'
          }`}
        >
          <Puzzle className="w-5 h-5" />
          <span className="text-[10px] font-medium mt-1">Commands</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('apk')}
          className={`min-h-[44px] px-2 flex flex-col items-center justify-center cursor-pointer ${
            activeTab === 'apk' ? 'text-rose-500' : 'text-zinc-400'
          }`}
        >
          <Download className="w-5 h-5" />
          <span className="text-[10px] font-medium mt-1">APK Build</span>
        </button>
      </nav>
    </div>
  );
}
