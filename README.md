# Teeify CLI 🚀

**Teeify is the [Vercel for TEEs](https://teeify.xyz): the orchestration layer for the autonomous economy.**

The CLI delivers an **init → login → dev → deploy → execute** loop. Author JavaScript locally, simulate the vault on your machine with `teeify dev`, then ship a bundled script to a hardware-secured AWS Nitro Enclave and run agents with mathematical certainty.

---

## 🛠 Features

### 🔐 End-to-End Privacy
Your code and secrets (API keys) are encrypted on your machine using **RSA-OAEP (SHA-256)** before they touch the network. They are only decrypted inside the physical CPU of the vault.

### 📦 Bundled deploys
**Deploy** runs **esbuild** over `agent.js` and npm dependencies, producing a single **CommonJS** bundle (same shape locally and in the vault) before encryption. Use `import` / `require` for shared modules and published packages where compatible with the enclave runtime.

### 💾 Persistent Sovereign Identities
Unlike ephemeral containers, Teeify agents have permanent identities. We utilize **AWS KMS envelope encryption** to seal private keys, allowing agent wallets to survive server restarts and migrations across the global fleet.

### 📡 Secure Egress Proxy
Agents can securely access the internet (OpenAI, Coinbase, Stripe) via a hardware-isolated **TLS-passthrough proxy**. The host server acts as a blind courier and cannot inspect your sensitive data or API keys.

---

## 📦 Installation

```bash
npm install -g @teeify/cli
```

---

## 🌐 Gateway URL

The CLI talks to **`https://teeify.xyz/api`** by default. Override with **`TEEIFY_GATEWAY`** (environment variable or a `.env` file in the current working directory). The value should be the full API base URL with no trailing slash issues—see `.env.example`.

---

## 🚀 Quick Start

### 1. Authenticate
Get your API key from the [Teeify Dashboard](https://teeify.xyz/dashboard).

```bash
teeify login <YOUR_API_KEY>
```

### 2. Initialize a project
Provide an agent name (letters, numbers, hyphens). Interactive mode will prompt if you omit it in a TTY.

```bash
teeify init my-oracle-bot
```

This creates **`agent.js`** and **`teeify.json`** with `agent_name`.

### 3. Simulate locally (optional)
Run the same **bundled** pipeline as deploy inside Node’s **`vm`**, with mocks for the enclave globals:

- **`TEEIFY_SECRETS`** — populated from a local **`.env`** file (key/value pairs)
- **`TEEIFY_REQUEST`** — JSON from **`--data`**
- **`teeify.fetch`** — uses the host’s **`fetch`**
- **`teeify.signMessage`** — resolves to **`0xMOCK_SIGNATURE_LOCAL_DEV`**

```bash
teeify dev [agent-name] [--data '{"signal":"buy"}']
```

Use the optional **`agent-name`** only to confirm it matches `teeify.json`.

### 4. Set secure secrets
Secrets are RSA-OAEP encrypted for the enclave before upload.

```bash
teeify secrets set GEMINI_API_KEY "sk-..."
```

### 5. Deploy and run

```bash
teeify deploy
```

The CLI bundles `agent.js`, validates the bundle, encrypts it, and sends it to your configured gateway.

### 6. Execute via webhook

```bash
teeify execute [--data '{"price":3000}']
```

---

## 💻 Example Agent (`agent.js`)

The vault runs bundled JavaScript with **Boa**-style constraints. Use an async **`run()`** (or equivalent), return a value, and use **`console.log`** where helpful.

```javascript
async function run() {
    const apiKey = TEEIFY_SECRETS.GEMINI_API_KEY;

    const res = await teeify.fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot");
    const price = JSON.parse(res).data.amount;

    return `BTC is currently $${price}. Vault signature ready.`;
}

run();
```

In **`teeify dev`**, `TEEIFY_SECRETS` comes from `.env`; in production it reflects secrets you set with **`teeify secrets set`**.

---

## ⌨️ Command Reference

| Command | Description |
|--------|-------------|
| `teeify login <API_KEY>` | Save your API key to `~/.teeify/config.json`. |
| `teeify init [agent-name]` | Create `agent.js` + `teeify.json`. Name required (arg or prompt). |
| `teeify dev [agent-name] [--data '<json>']` | Bundle and run the agent in a local `vm` with enclave-like globals. |
| `teeify secrets set <KEY> <VALUE>` | Encrypt and store a secret for the agent in `teeify.json`. |
| `teeify deploy` | Bundle, encrypt, and deploy to the enclave fleet. |
| `teeify execute [--data '<json>']` | POST execution payload to the agent webhook. |

---

## 🛡️ Trust, but Verify
Every deployment can surface **AWS hardware attestation**. Verify that your agent is running on genuine Nitro hardware:

**[https://teeify.xyz/verify](https://teeify.xyz/verify)**

---

*© 2026 Teeify Labs. Built for the autonomous economy.*
