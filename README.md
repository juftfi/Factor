<img width="1500" height="500" alt="image" src="https://github.com/user-attachments/assets/7f1e8144-9bbd-4c99-8a1a-f6129c35ac93" />


# 🚀 factorAI

**AI workers for your crypto office**

factorAI is an interactive 3D crypto workspace where autonomous AI workers help you operate, research, trade, and build, all in one place.

Instead of switching between tools, dashboards, and tabs, factorAI brings everything into a single environment where you can delegate tasks and stay focused on execution.

---

## 🧠 Overview

factorAI is a browser-based 3D office powered by AI agents that handle:

- 📰 Crypto news aggregation  
- 🧵 Social content generation  
- 📊 Market analysis & signals  
- 🧠 Skill discovery & AI workflows  
- 🔎 Web research  
- 🚀 On-chain token launches  

Built for traders, builders, and crypto-native operators.

---

## ⚙️ Core Concept

You interact with a **team of AI workers** inside a real-time 3D office.

Each worker has a role, a UI panel, and real functionality.

Instead of using tools separately, you **click a worker and execute**.

---

## 👥 The Workers

### 🟦 Scoop Crypto News
- Fetches real-time crypto news via `/api/ethan-news`
- AI summaries of relevant headlines
- Curated information, no noise

---

### 🟨 Buzz Social Content
- Generates tweet ideas via `/api/liam-tweets`
- Market-aware, non-generic content
- Tracks used ideas to avoid repetition

---

### 🟩 Forge Token Launcher (Core Feature)
- Connects to **MetaMask (BNB Chain)**
- Authenticates with **four.meme**
- Launches tokens fully on-chain

Includes:
- Image upload to CDN  
- Token metadata creation  
- Smart contract execution  

Also supports **agent task mode** via `/api/olivia-agent`

---

### 🟥 Sage Skill Explorer
- Discover Web3 AI tools and workflows
- Categorized skill system (DeFi, AI, Trading, etc.)
- AI chat to recommend build stacks

---

### 🟪 Quant — Market Signals
- BTC / ETH / SOL overview
- AI directional bias
- Mini charts + news context
- Powered by `/api/ethan-market`

---

### 🟧 Scout — Web Research
- In-app browser-style search
- Research without leaving the environment
- Context stays inside the workspace

---

## 🏢 Office Controls

Global controls affect all workers simultaneously:

- **Go Work** → workers go to desks  
- **Meeting** → generates activity summaries  
- **Break** → idle / casual mode  
- **Documentation** → opens docs  

---

## 🚀 Forge Flow (Token Launch)

1. Connect MetaMask (BNB Chain)
2. Sign authentication message (four.meme)
3. Fill token details
4. Upload image to CDN
5. Create token via API
6. Execute on-chain transaction

**Transaction includes:**
```
launchFee + devBuy + tradingFee
```

- Launch fee: 0 BNB (currently)
- Trading fee: 1%
- Dev Buy: optional initial buy

---

## 🔗 Blockchain

- Network: **BNB Chain (BSC)**
- Chain ID: `56`
- Wallet: MetaMask required

---

## 🧩 Features

- Real-time 3D environment  
- AI-powered workflows  
- On-chain execution  
- Integrated research + content + trading  
- Persistent session (localStorage)  

---

## 🎮 Extra: Arcade

Inside the office there's an arcade game:

**Roach Agents**
- Racing game based on live BTC futures PnL  
- Uses real BTC/USDT data  
- 100x leverage simulation  

---

## ❓ FAQ (Quick)

**How do I launch a token?**  
Use Forge → connect wallet → fill details → launch

**Do I need BNB?**  
Only for dev buy + small gas fee

**Why sign a message?**  
Authentication with four.meme (no gas)

**Does it save progress?**  
Yes, via localStorage

---

## 🧱 Tech Stack

- Three.js (3D rendering)
- Web-based UI
- ethers.js (on-chain interactions)
- OpenAI APIs (content & agents)
- BNB Chain (execution layer)
- four.meme (token infra)

---

## 📌 Vision

factorAI turns crypto workflows into a **coordinated AI system**, not a set of disconnected tools.

You don’t open apps.  
You **run an office.**

- Never commit `.env` with real credentials.
- Rotate any key immediately if it was exposed before.
- Add secrets only in local `.env` or your cloud provider secret manager (for example Vercel Environment Variables).

