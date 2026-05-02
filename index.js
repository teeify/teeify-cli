#!/usr/bin/env node

require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline/promises');
const vm = require('vm');

// TEEIFY_GATEWAY: .env in the current working directory, process env, or localhost
// Example .env: TEEIFY_GATEWAY=http://3.120.x.x:3000
const GATEWAY_URL = process.env.TEEIFY_GATEWAY || 'http://localhost:3000';
const AGENT_FILE = 'agent.js';
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

function randomAgentName() {
    return `secure-bot-${crypto.randomBytes(2).toString('hex')}`;
}

function normalizeAgentName(name) {
    return name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

async function resolveAgentName(providedName) {
    if (providedName) {
        return normalizeAgentName(providedName) || randomAgentName();
    }

    if (!process.stdin.isTTY) {
        return randomAgentName();
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        const answer = await rl.question(`${c.bold}Agent name${c.reset} ${c.dim}(press enter for a random name): ${c.reset}`);
        return normalizeAgentName(answer) || randomAgentName();
    } finally {
        rl.close();
    }
}

function readProjectConfig() {
    if (!fs.existsSync(CONFIG_FILE)) {
        throw new Error('No teeify.json found. Run teeify init first.');
    }

    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (!config.agent_name) {
        throw new Error('teeify.json is missing agent_name. Run teeify init first.');
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

function login() {
    const apiKey = args[0];
    if (!apiKey) {
        console.log(`${c.dim}Usage: teeify login <API_KEY>. Get your key at https://teeify.xyz/dashboard${c.reset}`);
        process.exitCode = 1;
        return;
    }

    try {
        fs.mkdirSync(TEEIFY_DIR, { recursive: true, mode: 0o700 });
        fs.writeFileSync(AUTH_CONFIG_FILE, `${JSON.stringify({ api_key: apiKey }, null, 2)}\n`, { mode: 0o600 });
        fs.chmodSync(TEEIFY_DIR, 0o700);
        fs.chmodSync(AUTH_CONFIG_FILE, 0o600);
        console.log(`${c.green}Successfully logged in to Teeify.${c.reset}`);
    } catch (err) {
        process.exitCode = 1;
        console.log(`\n${c.yellow}✖ Login failed.${c.reset}`);
        console.log(`${c.dim}${err.message}${c.reset}\n`);
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
    let publicKeyPem;

    if (contentType.includes('application/json')) {
        const data = await response.json();
        publicKeyPem = data.public_key_pem || data.public_key || data.enclave_public_key || data.pem;
    } else {
        publicKeyPem = await response.text();
    }

    if (!publicKeyPem || !publicKeyPem.includes('BEGIN') || !publicKeyPem.includes('PUBLIC KEY')) {
        throw new Error('Gateway returned an invalid enclave public key.');
    }

    return publicKeyPem.trim();
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
    const encryptedAesKey = crypto.publicEncrypt(
        {
            key: publicKeyPem,
            padding: crypto.constants.RSA_PKCS1_PADDING
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
        const encrypted = crypto.publicEncrypt(
            {
                key: publicKeyPem,
                padding: crypto.constants.RSA_PKCS1_PADDING
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

function gatewayBase() {
    return String(GATEWAY_URL).replace(/\/+$/, '');
}

/**
 * Parse `teeify execute` argv: optional `--data '<json>'` or `--data=<json>`.
 * Defaults to {} when no --data is present.
 */
function parseExecuteBodyFromArgs(argv) {
    if (!argv || argv.length === 0) {
        return {};
    }
    if (argv[0] === '--data') {
        if (argv.length < 2) {
            throw new Error('Missing value for --data. Example: teeify execute --data \'{"price": 3000}\'');
        }
        if (argv.length > 2) {
            throw new Error('Too many arguments. Usage: teeify execute [--data \'<json>\']');
        }
        try {
            return JSON.parse(argv[1]);
        } catch (e) {
            throw new Error(`Invalid JSON for --data: ${e.message}`);
        }
    }
    if (argv[0].startsWith('--data=')) {
        if (argv.length > 1) {
            throw new Error('Too many arguments. Usage: teeify execute [--data \'<json>\']');
        }
        const raw = argv[0].slice('--data='.length);
        try {
            return JSON.parse(raw);
        } catch (e) {
            throw new Error(`Invalid JSON for --data: ${e.message}`);
        }
    }
    throw new Error(`Unexpected arguments. Usage: teeify execute [--data \'<json>\']`);
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

        const agentCode = fs.readFileSync(AGENT_FILE, 'utf8');

        console.log(`${c.dim}> Validating ${AGENT_FILE}...${c.reset}`);
        validateAgentBeforeDeploy(agentCode, AGENT_FILE);

        const authConfig = readAuthConfig();

        console.log(`${c.dim}> Packaging ${config.agent_name} from ${AGENT_FILE} (${agentCode.length} bytes)...${c.reset}`);
        console.log(`${c.dim}> Fetching enclave encryption key...${c.reset}`);

        const publicKeyPem = await fetchEnclavePublicKey(authConfig.api_key);
        console.log(`${c.dim}> Encrypting agent code for enclave-only execution...${c.reset}`);
        const encryptedPayload = encryptAgentCode(agentCode, publicKeyPem);

        const response = await fetch(`${GATEWAY_URL}/deploy`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authConfig.api_key}`
            },
            body: JSON.stringify({
                agent_name: config.agent_name,
                encrypted_code_b64: encryptedPayload.encrypted_code_b64,
                aes_iv_b64: encryptedPayload.aes_iv_b64,
                encrypted_aes_key_b64: encryptedPayload.encrypted_aes_key_b64
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Gateway returned ${response.status}: ${errorText}`);
        }

        const data = await response.json();

        console.log(`\n${c.green}✔ Agent successfully deployed and executed in TEE!${c.reset}\n`);
        console.log(`${c.dim}─${c.reset}`.repeat(50));
        console.log(`${c.bold}📍 Wallet Address:${c.reset}  ${c.cyan}${data.wallet_address}${c.reset}`);
        console.log(`${c.bold}💻 Agent Output:${c.reset}    ${c.yellow}${data.execution_output ?? ''}${c.reset}`);
        const att = data.attestation_b64;
        console.log(`${c.bold}🔐 Attestation:${c.reset}     ${att ? `${att.substring(0, 30)}...` : 'No attestation returned'}`);
        console.log(`${c.dim}─${c.reset}`.repeat(50));
        
        console.log(`\n${c.yellow}Verify hardware proof at:${c.reset} https://teeify.xyz/verify\n`);
        const webhookUrl = `${gatewayBase()}/agent/${encodeURIComponent(config.agent_name)}/execute`;
        console.log(`${c.bold}🔗 Webhook URL:${c.reset} ${c.cyan}${webhookUrl}${c.reset}`);
        console.log(`${c.bold}🔑 Add header:${c.reset} ${c.dim}Authorization: Bearer <YOUR_API_KEY>${c.reset}\n`);

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

function readSecretsProjectContext() {
    if (!fs.existsSync(CONFIG_FILE)) {
        throw new Error('No teeify.json found. Run this command inside your agent project folder.');
    }

    let config;
    try {
        config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch {
        throw new Error('No teeify.json found. Run this command inside your agent project folder.');
    }

    const agentName = config.agent_name;
    if (agentName === undefined || agentName === null || String(agentName).trim() === '') {
        throw new Error('No teeify.json found. Run this command inside your agent project folder.');
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
        const publicKeyPem = await fetchEnclavePublicKey(authConfig.api_key);
        console.log(`${c.dim}> Encrypting value with RSA (PKCS#1 v1.5)...${c.reset}`);
        const encrypted_value_b64 = encryptSecretValueRsa(value, publicKeyPem);

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
            `${c.green}✔ Secret ${c.cyan}${secretKey}${c.green} set for agent ${c.cyan}${agentName}${c.green} (RSA-encrypted for enclave).${c.reset}\n`
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
} else if (command === 'secrets') {
    secretsSet();
} else {
    console.log(`\n${c.bold}▲ Teeify CLI${c.reset}`);
    console.log(
        `Usage: teeify [login <API_KEY> | init [agent-name] | deploy | execute [--data '<json>'] | secrets set <KEY> <VALUE>]\n`
    );
}