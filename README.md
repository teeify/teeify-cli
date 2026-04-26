# Teeify CLI

**Teeify is the [Vercel for TEEs](https://teeify.xyz): the orchestration layer for the autonomous economy.** The CLI delivers a full **init → deploy → execute** loop: you author JavaScript locally, ship it to a **hardware-secured AWS Nitro Enclave**, and receive provable, hardware-backed results—not promises.

---

## Vision

- **For Web3 teams:** On-chain and agent-driven systems need execution that is **isolated**, **attestable**, and **key-safe**. Teeify turns that into a deployment surface you can use like any other cloud workflow.
- **For AI engineers:** Model and agent logic often requires **secrets**, **proprietary code**, and **auditable runs**. Teeify runs that logic where the **host OS, hypervisor, and public internet are not in the trust boundary**—and gives you a receipt you can verify.

---

## How it works

### Embedded JavaScript in silicon

Every enclave includes a **high-performance, pure-Rust JavaScript engine ([Boa](https://github.com/boa-dev/boa), `boa_engine`)**. Your `agent.js` is evaluated **inside the enclave**—a **silicon vault** with **no dependency on the host** for that execution. Logic runs in a measured, attested environment, not on a shared app server or in a browser you do not control.

### Hardware wallets

**Each deployment yields a unique Ethereum address.** The corresponding **private key is generated and held inside the Nitro enclave**; it **never** leaves the hardware-backed boundary exposed to typical cloud paths. Wallets are **per-deployment artifacts**, not shared secrets on a control plane you have to take on trust alone.

### Trust, but verify

**Every run produces a cryptographic attestation (Base64)** tied to the enclave and its configuration. You do not have to trust a dashboard sentence—you can **verify the proof** yourself:

**[https://teeify.xyz/verify](https://teeify.xyz/verify)**

This is the heart of the model: **attested compute** for the next generation of agents and on-chain automations.

---

## Installation

```bash
npm install -g @teeify/cli
```

---

## Quick start: init to execute

### 1. Initialize a project

```bash
teeify init my-secure-bot
```

This creates **`agent.js`** and **`teeify.json`** in the current directory. The config stores your `agent_name`, which is sent with every deployment. If you omit the name, the CLI prompts for one; in non-interactive environments, it generates a random hyphenated name.

### 2. Author your agent

Edit `agent.js`. Example: a small **secret** calculation and a **greeting** (values exist only in the enclave for that execution):

```javascript
// agent.js — runs inside the TEE; host never sees the secret factor
const secretFactor = 0x2b7e1516;
const publicInput = 42;
const result = (publicInput * secretFactor) & 0xffffffff;

console.log(`Hello from the Enclave — sealed computation: ${result}`);
```

### 3. Point the CLI at your gateway (optional)

The CLI reads **`TEEIFY_GATEWAY`** from your environment or a **`.env`** file in the working directory (see `.env.example`). If unset, it defaults to `http://localhost:3000`.

```bash
# .env
TEEIFY_GATEWAY=https://your-gateway.example.com
```

### 4. Deploy and run

```bash
teeify deploy
```

The CLI **packages** your file, **POSTs** it to the gateway, and prints the **live execution** summary.

### 5. Example output (illustrative)

```text
✔ Agent successfully deployed and executed in TEE!

──────────────────────────────────────────────────
📍 Wallet Address:  0x71C7656EC7ab88b098defB751B7401B5f6d8976F
💻 Agent Output:    Hello from the Enclave — sealed computation: 1234567890
🔐 Attestation:     eyJraWQiOiJuaXRyby1pcy0xMi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4u...
──────────────────────────────────────────────────

Verify hardware proof at: https://teeify.xyz/verify
```

*Replace the sample values with what your deployment returns. The attestation is truncated in the terminal; the full Base64 value is what you verify.*

---

## Command reference

| Command | Description |
|--------|-------------|
| `teeify init [agent-name]` | Create `agent.js` and `teeify.json` in the current directory. |
| `teeify deploy` | Read `teeify.json`, deploy `agent.js`, and execute it in the TEE. |

---

## Security posture (summary)

- **Isolation:** Enclave memory is **separate** from the host; your JS runtime and secrets are not "just another process" on a shared instance.
- **Attestation:** Each execution yields **verifiable** evidence of **what** ran and **in what** hardware context—ground truth for integrators and auditors.
- **Verification:** **Don't trust, verify**—use **[teeify.xyz/verify](https://teeify.xyz/verify)** with the attestation you receive.

---

## Links

| Resource | URL |
|----------|-----|
| **Product** | [teeify.xyz](https://teeify.xyz) |
| **Attestation verification** | [teeify.xyz/verify](https://teeify.xyz/verify) |
| **X (Twitter)** | [@teeify_xyz](https://x.com/teeify_xyz) |

**Status:** Closed alpha.

---

*© 2026 Teeify Labs. Built for the autonomous economy.*
