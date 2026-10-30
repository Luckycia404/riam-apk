/**
 * Self-extracting unpacker for Queen Riam bot-engine bundle (engine-bundle.json).
 * Automatically restores plugins/, lib/, lang/, media/, and default data/ files
 * while strictly preserving any existing session/ or user config.json.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function unpackEngineBundle(baseDir = __dirname) {
  const bundlePath = path.join(baseDir, 'engine-bundle.json');
  if (!fs.existsSync(bundlePath)) return 0;

  try {
    const raw = fs.readFileSync(bundlePath, 'utf8');
    const bundle = JSON.parse(raw);
    let files = bundle.files || {};
    if (bundle.gzBase64) {
      const unzipped = zlib.gunzipSync(Buffer.from(bundle.gzBase64, 'base64')).toString('utf8');
      files = JSON.parse(unzipped);
    }

    let extractedCount = 0;

    for (const [relPath, entry] of Object.entries(files)) {
      const targetPath = path.join(baseDir, relPath);
      const norm = relPath.replace(/\\/g, '/');

      // Never overwrite existing session credentials or user config.json
      if (
        fs.existsSync(targetPath) &&
        (norm.startsWith('session/') || norm === 'data/config.json' || norm === '.env')
      ) {
        continue;
      }

      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      const buf = Buffer.from(entry.data, entry.encoding === 'base64' ? 'base64' : 'utf8');
      fs.writeFileSync(targetPath, buf);
      extractedCount++;
    }
    return extractedCount;
  } catch (err) {
    console.error('[UNPACK-BUNDLE] Error extracting engine-bundle.json:', err.message);
    return 0;
  }
}

if (require.main === module) {
  const count = unpackEngineBundle(__dirname);
  console.log(`[UNPACK-BUNDLE] Extracted ${count} files into ${__dirname}`);
}

module.exports = { unpackEngineBundle };
