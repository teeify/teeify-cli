# Teeify CLI 🚀

**Teeify is the [Vercel for TEEs](https://teeify.xyz): the orchestration layer for the autonomous economy.** 

The CLI delivers a complete **init → login → deploy → execute** loop. Author JavaScript locally, ship it to a hardware-secured AWS Nitro Enclave, and manage sovereign AI agents with mathematical certainty.

---

## 🛠 Features

### 🔐 End-to-End Privacy
Your code and secrets (API keys) are encrypted on your Mac using **RSA-OAEP (SHA-256)** before they ever touch the internet. They are only decrypted inside the physical CPU of the vault.

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

## 🚀 Quick Start

### 1. Authenticate
Get your API key from the [Teeify Dashboard](https://teeify.xyz/dashboard).
```bash
teeify login <YOUR_API_KEY>
```

### 2. Initialize a Project
```bash
teeify init my-oracle-bot
```
This creates **`agent.js`** and **`teeify.json`**. 

### 3. Set Secure Secrets
Store sensitive API keys (e.g., for Gemini or OpenAI) without Teeify or AWS ever seeing them in plaintext.
```bash
teeify secrets set GEMINI_API_KEY "sk-..."
```

### 4. Deploy and Run
```bash
teeify deploy
```
The CLI validates your syntax locally, encrypts your code, and injects it into a secure Nitro Enclave in Frankfurt.

---

## 💻 Example Agent (`agent.js`)

Teeify embeds the high-performance **Boa JS Engine** inside the vault. Return a value or use `console.log` to capture output.

```javascript
async function run() {
    // Access E2EE secrets
    const apiKey = TEEIFY_SECRETS.GEMINI_API_KEY;
    
    // Fetch live data via secure proxy
    const res = await teeify.fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot");
    const price = JSON.parse(res).data.amount;

    return `BTC is currently $${price}. Vault signature ready.`;
}

run();
```

---

## ⌨️ Command Reference

| Command | Description |
|--------|-------------|
| `teeify login <key>` | Authenticate the CLI with your account. |
| `teeify init [name]` | Initialize a new agent project directory. |
| `teeify secrets set <K> <V>` | Encrypt and store a secret in the hardware vault. |
| `teeify deploy` | Encrypt and deploy code to the enclave fleet. |
| `teeify execute [--data 'JSON']` | Trigger an execution via webhook with dynamic data. |

---

## 🛡️ Trust, but Verify
Every deployment generates an **AWS Hardware Attestation**. Use our public portal to verify that your agent is running un-tampered code on genuine Nitro hardware:

**[https://teeify.xyz/verify](https://teeify.xyz/verify)**

---

*© 2026 Teeify Labs. Built for the autonomous economy.*