# teeify-cli — The TEE Deployment Toolchain

**Deploy autonomous AI agents to hardware-isolated silicon in one command.**

[`@teeify/cli`](https://www.npmjs.com/package/@teeify/cli) bundles your agent, encrypts it on your machine, and ships it to AWS Nitro Enclave hardware. Run **`teeify init` → `teeify deploy` → `teeify execute`** with OAuth login, deterministic builds, and verifiable compute artifacts on every deployment.

---

## Features

### Seamless Auth
**`teeify login`** opens the Teeify control plane in your browser (OAuth). A local callback receives your **`api_key`** and **`user_id`**, saved to **`~/.teeify/credentials`**. No manual key copy-paste required.

### Deterministic Builds
Before encryption, **`teeify deploy`** runs **esbuild** with **minification**, **tree-shaking**, and **CJS** output tuned for the enclave loader. Node-only modules (`node:*`) are excluded. Bundles over **2 MB** are rejected before they reach hardware.

### Verifiable Compute
Every deploy surfaces:

- **🧬 Logic Hash** — Keccak256 of the optimized bundle (see [Audit](#audit-logic-hash--hardware-attestation))
- **🔐 Hardware Attestation** — AWS Nitro attestation document for independent verification at [teeify.xyz/verify](https://teeify.xyz/verify)

---

## Installation

```bash
npm install -g @teeify/cli
```

Requires **Node.js ≥ 18**.

---

## Quickstart

### 1. Authenticate

```bash
teeify login
```

### 2. Initialize a project

```bash
teeify init my-trading-bot
```

Creates **`agent.js`** and **`teeify.json`**.

### 3. Set secrets (encrypted for the enclave)

```bash
teeify secrets set GEMINI_API_KEY "sk-..."
```

### 4. Deploy to Nitro hardware

```bash
teeify deploy
```

Bundles, validates, encrypts (RSA-OAEP + AES-GCM), and executes in the TEE. Prints bundle size, logic hash, wallet address, agent output, attestation, and namespaced webhook URL.

### 5. Execute via webhook

```bash
teeify execute [--data '{"price":3000}']
```

---

## Local development (optional)

Simulate the enclave locally with the same bundled pipeline:

```bash
teeify dev [--data '{"signal":"buy"}']
```

- **`TEEIFY_SECRETS`** — loaded from project **`.env`**
- **`TEEIFY_REQUEST`** — from **`--data`**
- **`teeify.fetch` / `teeify.signMessage`** — mocked or real (set **`TEEIFY_DEV_PRIVATE_KEY`** in `.env` for local signing)

---

## Command reference

| Command | Description |
|--------|-------------|
| `teeify login` | Browser OAuth; saves `api_key` + `user_id` to `~/.teeify/credentials` |
| `teeify init [agent-name]` | Scaffold `agent.js` + `teeify.json` |
| `teeify dev [agent-name] [--data '<json>']` | Local vm simulation with enclave-like globals |
| `teeify secrets set <KEY> <VALUE>` | RSA-OAEP encrypt and store a secret for the agent |
| `teeify deploy` | Minify, bundle, encrypt, deploy, and run in the TEE |
| `teeify execute [--data '<json>']` | POST to the namespaced agent webhook |

Agent URLs follow **`/api/agent/{user_id}/{agent_name}/execute`**.

---

## Audit: Logic Hash & Hardware Attestation

Teeify binds **what ran** to **where it ran**:

1. **Build** — Your `agent.js` and dependencies are bundled into a single minified CJS script. The CLI computes **Keccak256** over the exact UTF-8 bytes of that bundle. This **Logic Hash** is printed on every successful deploy (e.g. `0xabc123…`).

2. **Deploy** — The same byte string is encrypted client-side and injected into the Nitro Enclave. Only that optimized bundle can execute inside the vault.

3. **Attest** — AWS Nitro produces a **hardware attestation** (PCR measurements, enclave identity). The CLI prints the full attestation blob after deploy and execute.

4. **Verify** — Paste the attestation at **[teeify.xyz/verify](https://teeify.xyz/verify)** to confirm genuine Nitro hardware. Cross-check the **Logic Hash** against your local **`agent-audit-bundle.js`** (written during deploy) to prove the attested enclave executed *your* exact code—not a substitute binary.

Together, the **Logic Hash** (software identity) and **Hardware Attestation** (platform identity) give you a reproducible audit trail from laptop to silicon.

---

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `TEEIFY_GATEWAY` | `https://teeify.xyz/api` | API base URL (see `.env.example`) |

---

## Example agent

```javascript
async function run() {
    const apiKey = TEEIFY_SECRETS.GEMINI_API_KEY;
    const res = await teeify.fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot');
    const price = JSON.parse(res).data.amount;
    return `BTC is currently $${price}.`;
}

run();
```

---

*© 2026 Teeify Labs.*
