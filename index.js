#!/usr/bin/env node

require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const readline = require('readline/promises');
const vm = require('vm');
const { exec } = require('child_process');
const { URL } = require('url');
const esbuild = require('esbuild');

/** Production API base (no trailing slash). Override with TEEIFY_GATEWAY in env or .env. */
const DEFAULT_GATEWAY = 'https://teeify.xyz/api';
const GATEWAY_URL = process.env.TEEIFY_GATEWAY || DEFAULT_GATEWAY;

const AGENT_FILE = 'agent.js';
/** Same bundle shape as deploy: CJS + browser-ish resolution for constrained runtimes. */
const AGENT_ESBUILD_BUILD_OPTIONS = {
    entryPoints: [AGENT_FILE],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser',
    target: 'es2020',
    sourcemap: 'inline'
};
const CONFIG_FILE = 'teeify.json';
const TEEIFY_DIR = path.join(os.homedir(), '.teeify');
const AUTH_CONFIG_FILE = path.join(TEEIFY_DIR, 'config.json');

const c = {
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[91m',
    dim: '\x1b[2m',
    reset: '\x1b[0m',
    bold: '\x1b[1m'
};

const command = process.argv[2];
const args = process.argv.slice(3);

function normalizeAgentName(name) {
    return name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

function agentNameRequirementMessage() {
    return 'Agent name is required (letters, numbers, hyphens only). Use: teeify init <agent-name> — e.g. teeify init my-trading-bot';
}

async function resolveAgentName(providedName) {
    if (providedName) {
        const normalized = normalizeAgentName(providedName);
        if (!normalized) {
            throw new Error(agentNameRequirementMessage());
        }
        return normalized;
    }

    if (!process.stdin.isTTY) {
        throw new Error(
            `${agentNameRequirementMessage()} In non-interactive mode you must pass the name: teeify init <agent-name>`
        );
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        const answer = await rl.question(`${c.bold}Agent name${c.reset} ${c.dim}(required): ${c.reset}`);
        const normalized = normalizeAgentName(answer);
        if (!normalized) {
            throw new Error(agentNameRequirementMessage());
        }
        return normalized;
    } finally {
        rl.close();
    }
}

function readProjectConfig() {
    if (!fs.existsSync(CONFIG_FILE)) {
        throw new Error('No teeify.json found. Run teeify init first.');
    }

    let config;
    try {
        config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (e) {
        throw new Error(
            `teeify.json is invalid JSON. Fix the file format (${e.message}). Ensure "agent_name" is set.`
        );
    }

    const raw = config.agent_name;
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        throw new Error(
            'teeify.json must include a non-empty "agent_name". Run teeify init <agent-name> or edit the file.'
        );
    }

    return config;
}

function readAuthConfig() {
    if (!fs.existsSync(AUTH_CONFIG_FILE)) {
        throw new Error('No API key found. Run teeify login <API_KEY> first.');
    }

    const config = JSON.parse(fs.readFileSync(AUTH_CONFIG_FILE, 'utf8'));
    if (!config.api_key) {
        throw new Error('No API key found. Run teeify login <API_KEY> first.');
    }

    return config;
}

function gatewayBase() {
    return String(GATEWAY_URL).replace(/\/+$/, '');
}

function writeTeeifyAuthConfig(apiKey) {
    fs.mkdirSync(TEEIFY_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(AUTH_CONFIG_FILE, `${JSON.stringify({ api_key: apiKey }, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(TEEIFY_DIR, 0o700);
    fs.chmodSync(AUTH_CONFIG_FILE, 0o600);
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Full HTML for CLI login callback pages — matches design.md (Teeify control plane).
 * Uses absolute hex/rgba values (no Tailwind). Fonts: Inter + JetBrains Mono (Geist substitutes).
 * @param {{ title: string, subtitle?: string, detailHtml?: string, variant: 'success' | 'error' }} opts
 */
function renderLoginAuthPage({ title, subtitle, detailHtml, variant }) {
    const isSuccess = variant === 'success';
    const statusGlow = isSuccess ? 'rgba(57, 255, 20, 0.45)' : 'rgba(248, 113, 113, 0.35)';

    const statusIconSvg = isSuccess
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#39ff14" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>`;

    const subtitleBlock = subtitle
        ? `<p class="subtitle">${escapeHtml(subtitle)}</p>`
        : '';
    const detailBlock = detailHtml ? `<div class="detail">${detailHtml}</div>` : '';

    return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · Teeify</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;family=JetBrains+Mono:wght@400;500&amp;display=swap" rel="stylesheet">
  <style>
    :root {
      --teeify-bg: #09090b;
      --teeify-fg: #f4f4f5;
      --teeify-heading: #fafafa;
      --teeify-muted: #a1a1aa;
      --teeify-label: #71717a;
      --teeify-card: rgba(24, 24, 27, 0.5);
      --teeify-card-inner: rgba(9, 9, 11, 0.8);
      --teeify-border: rgba(255, 255, 255, 0.1);
      --teeify-ring: rgba(255, 255, 255, 0.05);
      --teeify-cyan: #00f0ff;
      --teeify-green: #39ff14;
      --teeify-cyan-glow: 0 0 28px rgba(0, 240, 255, 0.35);
      --teeify-green-glow: 0 0 28px rgba(57, 255, 20, 0.4);
      --font-sans: "Inter", system-ui, sans-serif;
      --font-mono: "JetBrains Mono", ui-monospace, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html {
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    body {
      min-height: 100vh;
      font-family: var(--font-sans);
      font-size: 14px;
      line-height: 1.625;
      color: var(--teeify-fg);
      background-color: var(--teeify-bg);
      background-image:
        radial-gradient(ellipse 70% 50% at 50% 0%, rgba(0, 240, 255, 0.12), transparent),
        radial-gradient(ellipse 50% 40% at 80% 60%, rgba(57, 255, 20, 0.08), transparent);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px 16px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 32px;
      font-size: 15px;
      font-weight: 600;
      color: #d4d4d8;
      letter-spacing: -0.01em;
    }
    .brand-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--teeify-cyan);
      box-shadow: 0 0 12px var(--teeify-cyan);
      flex-shrink: 0;
    }
    .card {
      width: 100%;
      max-width: 28rem;
      padding: 32px 28px;
      border-radius: 16px;
      border: 1px solid var(--teeify-border);
      background: var(--teeify-card);
      box-shadow:
        0 0 60px -24px rgba(0, 240, 255, 0.2),
        inset 0 0 0 1px rgba(255, 255, 255, 0.06);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    }
    .icon-badge {
      width: 56px;
      height: 56px;
      border-radius: 16px;
      border: 1px solid var(--teeify-border);
      background: rgba(24, 24, 27, 0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 20px;
      box-shadow: 0 0 40px -8px rgba(0, 240, 255, 0.25);
    }
    .icon-badge.status {
      box-shadow: 0 0 40px -8px ${statusGlow};
    }
    .title {
      font-size: 24px;
      font-weight: 600;
      letter-spacing: -0.025em;
      color: var(--teeify-heading);
      text-wrap: balance;
      margin-bottom: 8px;
    }
    .subtitle {
      font-size: 14px;
      color: var(--teeify-muted);
      text-wrap: pretty;
      margin-bottom: 0;
    }
    .detail {
      margin-top: 20px;
      padding: 14px 16px;
      border-radius: 12px;
      border: 1px solid var(--teeify-border);
      background: var(--teeify-card-inner);
      font-size: 13px;
      color: ${isSuccess ? '#d4d4d8' : '#fca5a5'};
      line-height: 1.5;
    }
    .detail code {
      font-family: var(--font-mono);
      font-size: 12px;
      background: #27272a;
      color: #d4d4d8;
      border-radius: 4px;
      padding: 2px 6px;
    }
    .footer-hint {
      margin-top: 24px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #52525b;
      text-align: center;
    }
    .live-dot {
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--teeify-green);
      box-shadow: 0 0 8px var(--teeify-green);
      margin-right: 6px;
      vertical-align: middle;
    }
  </style>
</head>
<body>
  <div class="brand" aria-hidden="true">
    <span class="brand-dot"></span>
    <span>Teeify</span>
  </div>
  <main class="card" role="main">
    <div class="icon-badge status" aria-hidden="true">
      ${statusIconSvg}
    </div>
    <h1 class="title">${escapeHtml(title)}</h1>
    ${subtitleBlock}
    ${detailBlock}
    ${
        isSuccess
            ? '<p class="footer-hint"><span class="live-dot"></span>CLI session connected</p>'
            : '<p class="footer-hint">Return to your terminal to retry</p>'
    }
  </main>
</body>
</html>`;
}

function loginAuthSuccessHtml() {
    return renderLoginAuthPage({
        title: 'Authentication successful',
        subtitle: 'You can close this tab and return to your terminal.',
        variant: 'success'
    });
}

function loginAuthErrorHtml(title, message) {
    return renderLoginAuthPage({
        title,
        subtitle: message,
        variant: 'error'
    });
}

/**
 * Open a URL in the system default browser (darwin / win32 / Linux).
 */
function openBrowserToUrl(targetUrl) {
    const platform = process.platform;
    let cmd;
    if (platform === 'darwin') {
        cmd = `open ${JSON.stringify(targetUrl)}`;
    } else if (platform === 'win32') {
        cmd = `start "" ${JSON.stringify(targetUrl)}`;
    } else {
        cmd = `xdg-open ${JSON.stringify(targetUrl)}`;
    }

    exec(cmd, { shell: platform === 'win32' }, (err) => {
        if (err) {
            console.log(`${c.dim}Could not open the browser automatically. Open this URL manually:${c.reset}`);
            console.log(targetUrl);
        }
    });
}

function loginViaBrowser() {
    let authHandled = false;

    const server = http.createServer((req, res) => {
        if (authHandled) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(loginAuthSuccessHtml());
            return;
        }

        const addr = server.address();
        const port = addr && typeof addr === 'object' ? addr.port : 0;
        let token;
        try {
            const reqUrl = new URL(req.url, `http://127.0.0.1:${port}`);
            token = reqUrl.searchParams.get('token');
        } catch {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(loginAuthErrorHtml('Invalid callback', 'The login redirect URL could not be parsed. Run teeify login again.'));
            return;
        }

        if (!token || String(token).trim() === '') {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(
                loginAuthErrorHtml(
                    'Missing token',
                    'No API token was received. Complete sign-in in the browser or run teeify login again.'
                )
            );
            return;
        }

        try {
            writeTeeifyAuthConfig(String(token).trim());
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(
                loginAuthErrorHtml('Could not save credentials', err.message)
            );
            console.log(`\n${c.yellow}✖ Login failed.${c.reset}`);
            console.log(`${c.dim}${err.message}${c.reset}\n`);
            server.close(() => process.exit(1));
            return;
        }

        authHandled = true;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(loginAuthSuccessHtml());
        console.log(`${c.green}✔ Successfully logged in to Teeify.${c.reset}`);
        server.close(() => process.exit(0));
    });

    server.on('error', (err) => {
        console.log(`\n${c.yellow}✖ Login failed.${c.reset}`);
        console.log(`${c.dim}${err.message}${c.reset}\n`);
        process.exit(1);
    });

    server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        const authUrl = `${gatewayBase().replace('/api', '')}/cli/auth?port=${port}`;

        console.log(`${c.dim}> Opening browser to authenticate...${c.reset}`);
        openBrowserToUrl(authUrl);
    });
}

function login() {
    const apiKey = args[0];
    if (apiKey) {
        try {
            writeTeeifyAuthConfig(apiKey);
            console.log(`${c.green}Successfully logged in to Teeify.${c.reset}`);
        } catch (err) {
            process.exitCode = 1;
            console.log(`\n${c.yellow}✖ Login failed.${c.reset}`);
            console.log(`${c.dim}${err.message}${c.reset}\n`);
        }
        return;
    }

    loginViaBrowser();
}

/**
 * Extract PEM from gateway fields; unwrap stringified JSON; normalize newlines; verify SPKI PEM header.
 */
function normalizeGatewayPublicKeyPem(rawKey) {
    if (rawKey === undefined || rawKey === null || String(rawKey).trim() === '') {
        throw new Error('Failed to extract public key from Gateway response.');
    }

    let key;

    if (typeof rawKey === 'string' && rawKey.trimStart().startsWith('{')) {
        let parsed;
        try {
            parsed = JSON.parse(rawKey.trim());
        } catch (e) {
            throw new Error(`Failed to parse nested public_key JSON: ${e.message}`);
        }
        const inner = parsed.public_key_pem || parsed.public_key;
        if (inner === undefined || inner === null || String(inner).trim() === '') {
            throw new Error('Failed to extract public key from Gateway response.');
        }
        key = typeof inner === 'string' ? inner : String(inner);
    } else {
        key = typeof rawKey === 'string' ? rawKey.trim() : String(rawKey).trim();
    }

    const pem = String(key).replace(/\\n/g, '\n').trim();

    if (!pem.startsWith('-----BEGIN PUBLIC KEY-----')) {
        const preview = pem.length >= 20 ? pem.slice(0, 20) : pem;
        throw new Error(
            `Invalid PEM: expected -----BEGIN PUBLIC KEY-----; first 20 characters received: ${JSON.stringify(preview)}`
        );
    }

    return pem;
}

function assertPemBeforePublicEncrypt(pubKey) {
    const s = String(pubKey);
    if (!s.startsWith('-----BEGIN PUBLIC KEY-----')) {
        const preview = s.length >= 20 ? s.slice(0, 20) : s;
        throw new Error(
            `Invalid PEM before publicEncrypt: expected -----BEGIN PUBLIC KEY-----; first 20 characters received: ${JSON.stringify(preview)}`
        );
    }
}

async function fetchEnclavePublicKey(apiKey) {
    const response = await fetch(`${GATEWAY_URL}/enclave-key`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${apiKey}`
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch enclave public key: ${response.status}: ${errorText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    let node_id;
    let publicKeyPem;

    if (contentType.includes('application/json')) {
        const keyData = await response.json();
        let rawKey = keyData.public_key || keyData.public_key_pem;
        if (rawKey === undefined || rawKey === null || String(rawKey).trim() === '') {
            throw new Error('Failed to extract public key from Gateway response.');
        }
        node_id = keyData.node_id ?? keyData.nodeId;
        publicKeyPem = normalizeGatewayPublicKeyPem(rawKey);
    } else {
        const textBody = await response.text();
        if (textBody === undefined || textBody === null || String(textBody).trim() === '') {
            throw new Error('Failed to extract public key from Gateway response.');
        }
        publicKeyPem = normalizeGatewayPublicKeyPem(textBody);
    }

    return {
        publicKeyPem,
        ...(node_id !== undefined && node_id !== null && String(node_id).trim() !== ''
            ? { node_id }
            : {})
    };
}

function encryptAgentCode(agentCode, publicKeyPem) {
    const aesKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
    const ciphertext = Buffer.concat([
        cipher.update(agentCode, 'utf8'),
        cipher.final()
    ]);
    const authTag = cipher.getAuthTag();
    const encryptedCode = Buffer.concat([ciphertext, authTag]);
    assertPemBeforePublicEncrypt(publicKeyPem);
    const encryptedAesKey = crypto.publicEncrypt(
        {
            key: publicKeyPem,
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: 'sha256'
        },
        aesKey
    );

    return {
        encrypted_code_b64: encryptedCode.toString('base64'),
        aes_iv_b64: iv.toString('base64'),
        encrypted_aes_key_b64: encryptedAesKey.toString('base64')
    };
}

function encryptSecretValueRsa(value, publicKeyPem) {
    const buf = Buffer.from(value, 'utf8');
    try {
        assertPemBeforePublicEncrypt(publicKeyPem);
        const encrypted = crypto.publicEncrypt(
            {
                key: publicKeyPem,
                padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                oaepHash: 'sha256'
            },
            buf
        );
        return encrypted.toString('base64');
    } catch (e) {
        throw new Error(
            `RSA encryption failed (secret may be too large for the enclave key, or key is invalid): ${e.message}`
        );
    }
}

/**
 * Parse optional `--data '<json>'` or `--data=<json>`.
 * Defaults to {} when no argv or no --data flag.
 * @param {string} [usageLine] - Printed in error messages (e.g. "teeify execute [--data '<json>']").
 */
function parseExecuteBodyFromArgs(argv, usageLine = `teeify execute [--data '<json>']`) {
    if (!argv || argv.length === 0) {
        return {};
    }
    if (argv[0] === '--data') {
        if (argv.length < 2) {
            throw new Error(`Missing value for --data. Usage: ${usageLine}`);
        }
        if (argv.length > 2) {
            throw new Error(`Too many arguments. Usage: ${usageLine}`);
        }
        try {
            return JSON.parse(argv[1]);
        } catch (e) {
            throw new Error(`Invalid JSON for --data: ${e.message}`);
        }
    }
    if (argv[0].startsWith('--data=')) {
        if (argv.length > 1) {
            throw new Error(`Too many arguments. Usage: ${usageLine}`);
        }
        const raw = argv[0].slice('--data='.length);
        try {
            return JSON.parse(raw);
        } catch (e) {
            throw new Error(`Invalid JSON for --data: ${e.message}`);
        }
    }
    throw new Error(`Unexpected arguments. Usage: ${usageLine}`);
}

/**
 * Parse `teeify dev [agent-name] [--data '<json>']`.
 * Optional agent name must be the first argument when present; verifies against teeify.json when given.
 */
function parseDevArgs(argv) {
    const a = argv && argv.length > 0 ? [...argv] : [];
    let optionalAgentName = null;
    if (a.length > 0 && a[0] !== '--data' && !a[0].startsWith('--data=')) {
        optionalAgentName = normalizeAgentName(a.shift());
        if (!optionalAgentName) {
            throw new Error(agentNameRequirementMessage());
        }
    }
    const teeifyRequest = parseExecuteBodyFromArgs(a, `teeify dev [agent-name] [--data '<json>']`);
    return { optionalAgentName, teeifyRequest };
}

/** Load cwd `.env` into a plain object for TEEIFY_SECRETS (no process mutation). */
function loadLocalDotenvAsSecretsObject() {
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) {
        return {};
    }
    try {
        const raw = fs.readFileSync(envPath, 'utf8');
        const parsed = require('dotenv').parse(raw);
        return { ...parsed };
    } catch (e) {
        throw new Error(`Failed to read local .env: ${e.message}`);
    }
}

async function formatEsbuildFailure(bundleErr) {
    if (bundleErr.errors && bundleErr.errors.length > 0) {
        const lines = await esbuild.formatMessages(bundleErr.errors, { kind: 'error', color: true });
        return lines.join('\n');
    }
    return bundleErr.message;
}

function formatDevRuntimeError(err) {
    if (!err || typeof err !== 'object') {
        return String(err);
    }
    const name = err.name || 'Error';
    const msg = err.message || String(err);
    if (err.stack) {
        return `${name}: ${msg}\n${err.stack}`;
    }
    return `${name}: ${msg}`;
}

/** Base64 VLQ decode (source map "mappings"), same rules as source-map-js / Mozilla. */
const VLQ_BASE_SHIFT = 5;
const VLQ_BASE = 1 << VLQ_BASE_SHIFT;
const VLQ_BASE_MASK = VLQ_BASE - 1;
const VLQ_CONTINUATION_BIT = VLQ_BASE;

function fromVLQSigned(v) {
    const isNegative = (v & 1) === 1;
    const shifted = v >> 1;
    return isNegative ? -shifted : shifted;
}

function decodeSourceMapBase64Digit(charCode) {
    const bigA = 65;
    const bigZ = 90;
    const littleA = 97;
    const littleZ = 122;
    const zero = 48;
    const nine = 57;
    if (bigA <= charCode && charCode <= bigZ) return charCode - bigA;
    if (littleA <= charCode && charCode <= littleZ) return charCode - littleA + 26;
    if (zero <= charCode && charCode <= nine) return charCode - zero + 52;
    if (charCode === 43) return 62;
    if (charCode === 47) return 63;
    return -1;
}

function decodeVLQSigned(str, index) {
    const strLen = str.length;
    let result = 0;
    let shift = 0;
    let i = index;

    while (true) {
        if (i >= strLen) {
            throw new Error('Truncated source map VLQ.');
        }

        const digitRaw = decodeSourceMapBase64Digit(str.charCodeAt(i++));
        if (digitRaw === -1) {
            throw new Error(`Invalid VLQ digit in source map (${index}).`);
        }

        const continuation = !!(digitRaw & VLQ_CONTINUATION_BIT);
        const digit = digitRaw & VLQ_BASE_MASK;
        result += digit << shift;
        shift += VLQ_BASE_SHIFT;
        if (!continuation) {
            break;
        }
    }

    return [fromVLQSigned(result), i];
}

function collectSourceMappedSegments(parsedMap) {
    const mappings = parsedMap.mappings;
    let genLine = 0;
    let genColumn = 0;
    let sourceIndex = 0;
    let originalLine = 0;
    let originalColumn = 0;

    /** @typedef {{ genLine:number, genColumn:number, originalLine:number, originalColumn:number, sourceUrl:string }} Seg */
    /** @type {Seg[]} */
    const segments = [];
    let i = 0;

    while (i < mappings.length) {
        const ch = mappings[i];
        if (ch === ';') {
            genLine++;
            genColumn = 0;
            i++;
            continue;
        }

        if (ch === ',') {
            i++;
            continue;
        }

        /** @type {number[]} */
        const group = [];

        while (i < mappings.length && mappings[i] !== ',' && mappings[i] !== ';') {
            const [v, ni] = decodeVLQSigned(mappings, i);
            group.push(v);
            i = ni;
        }

        const n = group.length;
        if (n >= 1) genColumn += group[0];

        if (n >= 4) {
            sourceIndex += group[1];
            originalLine += group[2];
            originalColumn += group[3];
            const sourceUrl = parsedMap.sources[sourceIndex] || '?';
            segments.push({
                genLine,
                genColumn,
                originalLine,
                originalColumn,
                sourceUrl
            });
        }
    }

    return segments;
}

function bestSourceSegmentForGeneratedPosition(segments, genLine0, genColumn0) {
    let best = null;
    for (const seg of segments) {
        if (seg.genLine > genLine0) continue;
        if (seg.genLine === genLine0 && seg.genColumn > genColumn0) continue;
        if (
            !best ||
            seg.genLine > best.genLine ||
            (seg.genLine === best.genLine && seg.genColumn > best.genColumn)
        ) {
            best = seg;
        }
    }
    return best;
}

function escapeRegExpPathToken(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractBundledFrameFromStack(stack, bundleLabel) {
    if (!stack || typeof stack !== 'string') return null;
    const escaped = escapeRegExpPathToken(bundleLabel);
    const reLineCol = new RegExp(`${escaped}:(\\d+)(?::(\\d+))?`);
    const lines = stack.split('\n');

    /** @returns {{ line:number, column:number|null}|null} */
    function consumeLine(lineText) {
        const m = reLineCol.exec(lineText);
        if (!m) return null;
        return {
            line: Number(m[1]),
            column: m[2] != null ? Number(m[2]) : null
        };
    }

    for (const line of lines) {
        const hit = consumeLine(line);
        if (hit) return hit;
    }

    return null;
}

function parseBundledInlineSourceMapJson(bundleText) {
    const re = /\/\/[#@]\s*sourceMappingURL=data:application\/json(?:;[^\n]*)?;base64,([^\s]+)/g;
    let m;
    let lastB64 = null;
    while ((m = re.exec(bundleText)) !== null) {
        lastB64 = m[1];
    }
    if (!lastB64) return null;
    try {
        const json = Buffer.from(lastB64, 'base64').toString('utf8');
        return JSON.parse(json);
    } catch {
        return null;
    }
}

function resolveMappedSourcePath(sourceUrlFromMap) {
    const cwd = process.cwd();
    if (!sourceUrlFromMap || sourceUrlFromMap === '?') {
        return path.join(cwd, AGENT_FILE);
    }
    const abs = path.isAbsolute(sourceUrlFromMap)
        ? sourceUrlFromMap
        : path.resolve(cwd, sourceUrlFromMap);
    if (fs.existsSync(abs)) return abs;
    const fallback = path.join(cwd, AGENT_FILE);
    return fs.existsSync(fallback) ? fallback : abs;
}

/**
 * Resolve original source snippet from an agent error stack frame (bundle filename or
 * evalmachine) using the bundle's inline source map. Works for any Error with a locator frame.
 * @returns {{ displayLine:number, sourcePath:string, sourceBasename:string, lineText:string } | null}
 */
function tryResolveDevOriginalSourceSnippet(err, bundledCode) {
    if (!err || typeof bundledCode !== 'string') {
        return null;
    }

    const stack = typeof err.stack === 'string' ? err.stack : '';
    const bundleLabel = `${AGENT_FILE} (bundled)`;
    let frame = extractBundledFrameFromStack(stack, bundleLabel);
    if (!frame) {
        frame = extractBundledFrameFromStack(stack, 'evalmachine.<anonymous>');
    }
    if (!frame) {
        return null;
    }

    const mapJson = parseBundledInlineSourceMapJson(bundledCode);
    if (!mapJson || typeof mapJson.mappings !== 'string') {
        return null;
    }

    let segments;
    try {
        segments = collectSourceMappedSegments(mapJson);
    } catch {
        return null;
    }

    const genLine0 = frame.line - 1;
    const genCol0 = frame.column == null ? Number.POSITIVE_INFINITY : Math.max(0, frame.column - 1);

    const best = bestSourceSegmentForGeneratedPosition(segments, genLine0, genCol0);
    if (!best) {
        return null;
    }

    const sourcePath = resolveMappedSourcePath(best.sourceUrl);
    let lines;
    try {
        lines = fs.readFileSync(sourcePath, 'utf8').split(/\r?\n/);
    } catch {
        return null;
    }

    const displayLine = best.originalLine + 1;
    const lineText = lines[displayLine - 1] !== undefined ? lines[displayLine - 1] : '';

    return {
        displayLine,
        sourcePath,
        sourceBasename: path.basename(sourcePath),
        lineText
    };
}

/**
 * Agent-facing dev failure report: no Teeify-internal stack traces, exit 1 for scripts.
 */
function reportDevAgentExecutionFailure(err, bundledCode) {
    console.log(`\n${c.red}${c.bold}✖ Agent Execution Failed.${c.reset}`);

    const name =
        err && typeof err === 'object' && typeof err.name === 'string' ? err.name : 'Error';
    const msg =
        err && typeof err === 'object' && err.message != null
            ? String(err.message)
            : String(err ?? 'Unknown error');

    console.log(`${c.dim}Name:${c.reset}       ${name}`);
    console.log(`${c.dim}Message:${c.reset}    ${msg}`);

    const loc = tryResolveDevOriginalSourceSnippet(err, bundledCode);
    if (loc) {
        console.log(`${c.dim}Location:${c.reset}  ${loc.sourceBasename}:${loc.displayLine}`);
        console.log('');
        console.log(`${c.bold}━━━ ${loc.sourceBasename}:${loc.displayLine} ━━━${c.reset}`);
        console.log(`${c.red}${loc.lineText || '<empty line>'}${c.reset}`);
    } else {
        console.log('');
        console.log(
            `${c.dim}(Could not map this error to a line in ${AGENT_FILE}.)${c.reset}`
        );
    }
    console.log('');
    process.exit(1);
}

function formatAgentOutputForTerminal(value) {
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'object') {
        return JSON.stringify(value, null, 2);
    }
    return String(value);
}

/** Replace strings and comments with spaces; keep newlines so line numbers stay aligned. */
function stripJsForAwaitScan(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        const c2 = src[i + 1];
        if (c === '/' && c2 === '/') {
            while (i < src.length && src[i] !== '\n') {
                out.push(' ');
                i++;
            }
            continue;
        }
        if (c === '/' && c2 === '*') {
            out.push(' ', ' ');
            i += 2;
            while (i < src.length - 1 && !(src[i] === '*' && src[i + 1] === '/')) {
                out.push(src[i] === '\n' ? '\n' : ' ');
                i++;
            }
            if (i < src.length - 1) i += 2;
            continue;
        }
        if (c === '"' || c === "'") {
            const q = c;
            out.push(' ');
            i++;
            while (i < src.length) {
                if (src[i] === '\\' && i + 1 < src.length) {
                    out.push(' ', ' ');
                    i += 2;
                    continue;
                }
                if (src[i] === q) {
                    out.push(' ');
                    i++;
                    break;
                }
                out.push(src[i] === '\n' ? '\n' : ' ');
                i++;
            }
            continue;
        }
        if (c === '`') {
            out.push(' ');
            i++;
            while (i < src.length) {
                if (src[i] === '\\' && i + 1 < src.length) {
                    out.push(' ', ' ');
                    i += 2;
                    continue;
                }
                if (src[i] === '$' && src[i + 1] === '{') {
                    out.push(' ', ' ');
                    i += 2;
                    let d = 1;
                    while (i < src.length && d > 0) {
                        if (src[i] === '{') d++;
                        else if (src[i] === '}') d--;
                        out.push(src[i] === '\n' ? '\n' : ' ');
                        i++;
                    }
                    continue;
                }
                if (src[i] === '`') {
                    out.push(' ');
                    i++;
                    break;
                }
                out.push(src[i] === '\n' ? '\n' : ' ');
                i++;
            }
            continue;
        }
        out.push(c);
        i++;
    }
    return out.join('');
}

function matchingParenLeft(s, closeIdx) {
    let depth = 1;
    let k = closeIdx - 1;
    while (k >= 0 && depth > 0) {
        if (s[k] === ')') depth++;
        else if (s[k] === '(') depth--;
        k--;
    }
    return k + 1;
}

function isFunctionBodyBrace(s, braceIdx) {
    let j = braceIdx - 1;
    while (j >= 0 && /\s/.test(s[j])) j--;
    if (j < 0) return false;

    if (s[j] === '>' && j > 0 && s[j - 1] === '=') {
        return true;
    }
    if (s[j] !== ')') return false;
    const openParen = matchingParenLeft(s, j);
    if (openParen < 0) return false;
    let k = openParen - 1;
    while (k >= 0 && /\s/.test(s[k])) k--;
    if (k > 0 && s[k] === '>' && s[k - 1] === '=') {
        return true;
    }
    const beforeParen = s.slice(0, openParen).trimEnd();
    return /(^|[\s;}])(async\s+)?function\s*(\*\s*)?[\w$]*\s*$/.test(beforeParen);
}

function isAwaitKeywordAt(s, i) {
    if (i > 0) {
        const prev = s[i - 1];
        if (prev === '$' || /[\w$]/.test(prev)) return false;
    }
    if (!s.startsWith('await', i)) return false;
    const after = s[i + 5];
    if (after !== undefined && /[\w$]/.test(after)) return false;
    if (/^await\s*:/.test(s.slice(i, i + 32))) return false;
    return true;
}

function findTopLevelAwaitIssue(agentCode) {
    const s = stripJsForAwaitScan(agentCode);
    const braceStack = [];
    let line = 1;
    for (let i = 0; i < s.length; ) {
        const ch = s[i];
        if (ch === '\n') {
            line++;
            i++;
            continue;
        }
        if (ch === '{') {
            braceStack.push(isFunctionBodyBrace(s, i));
            i++;
            continue;
        }
        if (ch === '}') {
            braceStack.pop();
            i++;
            continue;
        }
        if (isAwaitKeywordAt(s, i)) {
            const inFunctionBody = braceStack.some(Boolean);
            if (!inFunctionBody) {
                const lines = agentCode.split('\n');
                const snippet = lines[line - 1] !== undefined ? lines[line - 1].trim() : '';
                return { line, snippet };
            }
            i += 5;
            continue;
        }
        i++;
    }
    return null;
}

function printAgentSyntaxError(err, filePath) {
    let line = err.lineNumber;
    let col = err.columnNumber;
    if (line == null && err.stack) {
        const base = path.basename(filePath);
        const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const m = new RegExp(`${escaped}:(\\d+)(?::(\\d+))?`).exec(err.stack);
        if (m) {
            line = Number(m[1]);
            col = m[2] != null ? Number(m[2]) : col;
        }
    }
    const loc = line != null ? `${line}${col != null ? `:${col}` : ''}` : 'unknown';
    const rule = `${c.red}${c.bold}━━━ Invalid JavaScript — deploy aborted ━━━${c.reset}`;
    console.log(`\n${rule}`);
    console.log(`${c.dim}File:${c.reset}       ${filePath}`);
    console.log(`${c.dim}Location:${c.reset}   ${c.red}${loc}${c.reset}`);
    console.log(`${c.dim}Reason:${c.reset}     ${c.red}${err.message}${c.reset}`);
    if (/await/i.test(err.message) && /async|module/i.test(err.message)) {
        console.log(
            `\n${c.dim}Tip:${c.reset} Wrap ${c.bold}await${c.reset}${c.dim} usage in ${c.reset}` +
            `${c.bold}async function run() { ... }${c.reset}${c.dim} and call ${c.reset}${c.bold}run()${c.reset}${c.dim}.${c.reset}`
        );
    }
    console.log(`\n${c.dim}Fix the error in your agent source and try again.${c.reset}\n`);
}

function printTopLevelAwaitError(issue, filePath) {
    const rule = `${c.red}${c.bold}━━━ Top-level await — deploy aborted ━━━${c.reset}`;
    console.log(`\n${rule}`);
    console.log(`${c.dim}File:${c.reset}       ${filePath}`);
    console.log(`${c.dim}Line:${c.reset}       ${c.red}${issue.line}${c.reset}`);
    if (issue.snippet) {
        console.log(`${c.dim}Source:${c.reset}     ${c.dim}${issue.snippet}${c.reset}`);
    }
    console.log(`\n${c.red}The Teeify enclave does not support top-level ${c.bold}await${c.reset}${c.red}.${c.reset}`);
    console.log(`${c.dim}Put async logic inside an async entrypoint, for example:${c.reset}`);
    console.log(`${c.dim}  async function run() {${c.reset}`);
    console.log(`${c.dim}    // … your code using await …${c.reset}`);
    console.log(`${c.dim}  }${c.reset}`);
    console.log(`${c.dim}  run();${c.reset}\n`);
}

function validateAgentBeforeDeploy(agentCode, filePath) {
    try {
        new vm.Script(agentCode, { filename: path.basename(filePath) || 'agent.js' });
    } catch (e) {
        if (e instanceof SyntaxError) {
            printAgentSyntaxError(e, filePath);
            process.exit(1);
        }
        throw e;
    }
    const awaitIssue = findTopLevelAwaitIssue(agentCode);
    if (awaitIssue) {
        printTopLevelAwaitError(awaitIssue, filePath);
        process.exit(1);
    }
}

async function deploy() {
    console.log(`\n${c.bold}▲ Teeify${c.reset} Deploying secure agent to AWS Nitro Enclave...\n`);

    try {
        const config = readProjectConfig();
        if (!fs.existsSync(AGENT_FILE)) {
            throw new Error(`File ${AGENT_FILE} not found. Please create it first.`);
        }

        console.log(`${c.dim}> Bundling ${AGENT_FILE} and dependencies...${c.reset}`);
        let buildResult;
        try {
            buildResult = await esbuild.build(AGENT_ESBUILD_BUILD_OPTIONS);
        } catch (bundleErr) {
            process.exitCode = 1;
            console.log(`\n${c.yellow}✖ Bundle failed.${c.reset}`);
            console.log(await formatEsbuildFailure(bundleErr));
            console.log('');
            return;
        }

        const out = buildResult.outputFiles && buildResult.outputFiles[0];
        if (!out || typeof out.text !== 'string') {
            process.exitCode = 1;
            console.log(`\n${c.yellow}✖ Bundle failed.${c.reset}`);
            console.log(`${c.dim}esbuild produced no output.${c.reset}\n`);
            return;
        }
        const agentCode = out.text;

        const bundledLabel = `${AGENT_FILE} (bundled)`;
        console.log(`${c.dim}> Validating ${bundledLabel}...${c.reset}`);
        validateAgentBeforeDeploy(agentCode, bundledLabel);

        const authConfig = readAuthConfig();

        console.log(`${c.dim}> Packaging ${config.agent_name} (${agentCode.length} bytes bundled from ${AGENT_FILE})...${c.reset}`);
        console.log(`${c.dim}> Fetching enclave encryption key...${c.reset}`);

        const enclaveKey = await fetchEnclavePublicKey(authConfig.api_key);
        console.log(`${c.dim}> Encrypting agent code for enclave-only execution...${c.reset}`);
        const encryptedPayload = encryptAgentCode(agentCode, enclaveKey.publicKeyPem);

        const deployBody = {
            agent_name: config.agent_name,
            encrypted_code_b64: encryptedPayload.encrypted_code_b64,
            aes_iv_b64: encryptedPayload.aes_iv_b64,
            encrypted_aes_key_b64: encryptedPayload.encrypted_aes_key_b64,
            ...(enclaveKey.node_id !== undefined ? { node_id: enclaveKey.node_id } : {})
        };

        const response = await fetch(`${GATEWAY_URL}/deploy`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authConfig.api_key}`
            },
            body: JSON.stringify(deployBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Gateway returned ${response.status}: ${errorText}`);
        }

        const data = await response.json();

        console.log(`\n${c.green}✔ Agent successfully deployed and executed in TEE!${c.reset}\n`);
        console.log(`${c.dim}─${c.reset}`.repeat(50));

        const deployLabelCol = 26;
        const deployDetailRow = (labelText, valueRendered) => {
            const pad = Math.max(1, deployLabelCol - labelText.length);
            console.log(`${c.bold}${labelText}${c.reset}${' '.repeat(pad)}${valueRendered}`);
        };
        deployDetailRow('📍 Wallet Address:', `${c.cyan}${data.wallet_address}${c.reset}`);
        deployDetailRow('💻 Agent Output:', `${c.yellow}${data.execution_output ?? ''}${c.reset}`);
        const att = data.attestation_b64;
        deployDetailRow(
            '🔐 Attestation:',
            att ? `${att.substring(0, 30)}...` : `${c.dim}No attestation returned${c.reset}`
        );
        console.log(`${c.dim}─${c.reset}`.repeat(50));

        console.log(`\n${c.yellow}Verify hardware proof at:${c.reset} https://teeify.xyz/verify\n`);
        const webhookUrl = `${gatewayBase()}/agent/${encodeURIComponent(config.agent_name)}/execute`;
        deployDetailRow('🔗 Webhook URL:', `${c.cyan}${webhookUrl}${c.reset}`);
        deployDetailRow('🔑 Add header:', `${c.dim}Authorization: Bearer <YOUR_API_KEY>${c.reset}\n`);

    } catch (err) {
        process.exitCode = 1;
        console.log(`\n${c.yellow}✖ Deployment failed.${c.reset}`);
        
        // Native fetch handles connection refused differently than axios
        if (err.cause && err.cause.code === 'ECONNREFUSED') {
            console.log(`${c.dim}Could not connect to Teeify Gateway at ${GATEWAY_URL}. Is your EC2 Axum server running on port 3000?${c.reset}\n`);
        } else {
            console.log(`${c.dim}${err.message}${c.reset}\n`);
        }
    }
}

async function execute() {
    console.log(`\n${c.bold}▲ Teeify${c.reset} Executing agent via webhook...\n`);

    try {
        const body = parseExecuteBodyFromArgs(args);
        const config = readProjectConfig();
        const authConfig = readAuthConfig();

        const url = `${gatewayBase()}/agent/${encodeURIComponent(config.agent_name)}/execute`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authConfig.api_key}`
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Gateway returned ${response.status}: ${errorText}`);
        }

        const contentType = response.headers.get('content-type') || '';
        let agentOutput;
        if (contentType.includes('application/json')) {
            const data = await response.json();
            agentOutput = data.execution_output ?? data.output ?? '';
        } else {
            agentOutput = await response.text();
        }

        const display = formatAgentOutputForTerminal(agentOutput);
        console.log(`${c.bold}💻 Agent Output${c.reset}`);
        console.log(`${c.yellow}${display}${c.reset}\n`);
    } catch (err) {
        process.exitCode = 1;
        console.log(`\n${c.yellow}✖ Execute failed.${c.reset}`);
        if (err.cause && err.cause.code === 'ECONNREFUSED') {
            console.log(`${c.dim}Could not connect to Teeify Gateway at ${GATEWAY_URL}. Is your server running?${c.reset}\n`);
        } else {
            console.log(`${c.dim}${err.message}${c.reset}\n`);
        }
    }
}

async function dev() {
    console.log(`\n${c.bold}▲ Teeify${c.reset} Local vault simulation (vm)...\n`);

    let bundledCode;
    try {
        const { optionalAgentName, teeifyRequest } = parseDevArgs(args);

        const config = readProjectConfig();
        const configNameNorm = normalizeAgentName(String(config.agent_name));
        if (optionalAgentName && optionalAgentName !== configNameNorm) {
            throw new Error(
                `Agent name mismatch: teeify.json has "${config.agent_name}" but dev was started for "${optionalAgentName}".`
            );
        }

        if (!fs.existsSync(AGENT_FILE)) {
            throw new Error(`File ${AGENT_FILE} not found. Create it or run teeify init first.`);
        }

        console.log(`${c.dim}> Bundling ${AGENT_FILE} and dependencies...${c.reset}`);
        let buildResult;
        try {
            buildResult = await esbuild.build(AGENT_ESBUILD_BUILD_OPTIONS);
        } catch (bundleErr) {
            process.exitCode = 1;
            console.log(`\n${c.yellow}✖ Bundle failed.${c.reset}`);
            console.log(await formatEsbuildFailure(bundleErr));
            console.log('');
            return;
        }

        const out = buildResult.outputFiles && buildResult.outputFiles[0];
        if (!out || typeof out.text !== 'string') {
            process.exitCode = 1;
            console.log(`\n${c.yellow}✖ Bundle failed.${c.reset}`);
            console.log(`${c.dim}esbuild produced no output.${c.reset}\n`);
            return;
        }
        bundledCode = out.text;

        const teeifySecrets = loadLocalDotenvAsSecretsObject();

        const mockSandbox = {
            TEEIFY_SECRETS: { ...teeifySecrets },
            TEEIFY_REQUEST: teeifyRequest,
            teeify: {
                fetch: async (...fetchArgs) => {
                    const res = await fetch(...fetchArgs);
                    return await res.text();
                },
                signMessage: async () => '0xMOCK_SIGNATURE_LOCAL_DEV'
            },
            fetch: (...fetchArgs) => fetch(...fetchArgs),
            crypto: require('node:crypto').webcrypto,
            console
        };

        try {
            const completion = vm.runInNewContext(bundledCode, mockSandbox, {
                filename: `${AGENT_FILE} (bundled)`,
                timeout: 120_000
            });
            let finalResult = completion;
            if (finalResult != null && typeof finalResult.then === 'function') {
                finalResult = await finalResult;
            }

            const display = formatAgentOutputForTerminal(finalResult);
            console.log(`${c.bold}💻 Local Sim Output:${c.reset}`);
            console.log(`${c.yellow}${display}${c.reset}\n`);
        } catch (agentErr) {
            reportDevAgentExecutionFailure(agentErr, bundledCode);
        }
    } catch (err) {
        process.exitCode = 1;
        console.log(`\n${c.yellow}✖ Local dev failed.${c.reset}`);
        console.log(`${c.dim}${formatDevRuntimeError(err)}${c.reset}\n`);
    }
}

function readSecretsProjectContext() {
    if (!fs.existsSync(CONFIG_FILE)) {
        throw new Error('No teeify.json found. Run this command inside your agent project folder.');
    }

    let config;
    try {
        config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (e) {
        throw new Error(
            `teeify.json is invalid JSON. Fix the file format (${e.message}). Ensure "agent_name" is set.`
        );
    }

    const agentName = config.agent_name;
    if (agentName === undefined || agentName === null || String(agentName).trim() === '') {
        throw new Error(
            'teeify.json must include a non-empty "agent_name". Run teeify init <agent-name> or edit the file.'
        );
    }

    return agentName;
}

async function secretsSet() {
    if (args[0] !== 'set') {
        console.log(`\n${c.dim}Usage: teeify secrets set <KEY> <VALUE>${c.reset}\n`);
        process.exitCode = 1;
        return;
    }

    console.log(`\n${c.bold}▲ Teeify${c.reset} Storing encrypted secret...\n`);

    try {
        const secretKey = args[1];
        const valueParts = args.slice(2);
        if (!secretKey || valueParts.length === 0) {
            console.log(
                `${c.dim}Usage: teeify secrets set <KEY> <VALUE>${c.reset}\n`
            );
            process.exitCode = 1;
            return;
        }

        const value = valueParts.join(' ');
        const agentName = readSecretsProjectContext();
        const authConfig = readAuthConfig();

        console.log(`${c.dim}> Fetching enclave public key...${c.reset}`);
        const enclaveKey = await fetchEnclavePublicKey(authConfig.api_key);
        console.log(`${c.dim}> Encrypting value with RSA-OAEP (SHA-256)...${c.reset}`);
        const encrypted_value_b64 = encryptSecretValueRsa(value, enclaveKey.publicKeyPem);

        const url = `${gatewayBase()}/agent/${encodeURIComponent(agentName)}/secrets`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authConfig.api_key}`
            },
            body: JSON.stringify({ name: secretKey, encrypted_value_b64 })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Gateway returned ${response.status}: ${errorText}`);
        }

        console.log(
            `${c.green}✔ Secret ${c.cyan}${secretKey}${c.green} set for agent ${c.cyan}${agentName}${c.green} (RSA-OAEP encrypted for enclave).${c.reset}\n`
        );
    } catch (err) {
        process.exitCode = 1;
        console.log(`\n${c.yellow}✖ secrets set failed.${c.reset}`);
        if (err.cause && err.cause.code === 'ECONNREFUSED') {
            console.log(
                `${c.dim}Could not connect to Teeify Gateway at ${GATEWAY_URL}.${c.reset}\n`
            );
        } else {
            console.log(`${c.dim}${err.message}${c.reset}\n`);
        }
    }
}

async function init() {
    try {
        const agentName = await resolveAgentName(args[0]);

        console.log(`\n${c.bold}▲ Teeify${c.reset} Initializing ${c.cyan}${agentName}${c.reset}...`);

        const stub = `// Welcome to Teeify!
// Any string returned at the end of this script will be captured as 'Agent Output'.

const message = "Hello from the hardware-secured vault!";
const math = 20 + 22;

\`Message: \${message} | Secret Result: \${math}\`;
`;
        fs.writeFileSync(AGENT_FILE, stub);
        fs.writeFileSync(CONFIG_FILE, `${JSON.stringify({ agent_name: agentName }, null, 2)}\n`);

        console.log(`${c.green}✔ Created ${AGENT_FILE}${c.reset}`);
        console.log(`${c.green}✔ Created ${CONFIG_FILE}${c.reset}`);
        console.log(`${c.dim}Run 'teeify deploy' to push to hardware.${c.reset}\n`);
    } catch (err) {
        process.exitCode = 1;
        console.log(`\n${c.yellow}✖ Initialization failed.${c.reset}`);
        console.log(`${c.dim}${err.message}${c.reset}\n`);
    }
}

// Simple Router
if (command === 'deploy') {
    deploy();
} else if (command === 'init') {
    init();
} else if (command === 'login') {
    login();
} else if (command === 'execute') {
    execute();
} else if (command === 'dev') {
    dev();
} else if (command === 'secrets') {
    secretsSet();
} else {
    console.log(`\n${c.bold}▲ Teeify CLI${c.reset}`);
    console.log(
        `Usage: teeify [login [API_KEY] | init [agent-name] | deploy | dev [agent-name] [--data '<json>'] | execute [--data '<json>'] | secrets set <KEY> <VALUE>]\n`
    );
}