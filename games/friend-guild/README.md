# Friend Guild

Builder: Fablizio · [GitHub @Fablizio](https://github.com/Fablizio) · [X @FabrizioCottone](https://x.com/FabrizioCottone) · [Telegram @Fablizio](https://t.me/Fablizio) · FriendSDK **v0.1.2** · Rare Friends Vibeathon (**Economy Potential**)

A guild-management game where Rare Friends work for each other. Your verified Generations Friend runs a guild and
hires real Friends as mercenaries for expeditions. **Every fee pays the hired Friend's own wallet (70%), burns 20%
and funds the weekly season (10%).** Expeditions never create RF. They bring Shards, a soft currency that is
spent, together with RF (burned), on upgrades and gear. An in-game **economy simulator** runs the whole economy
for 30 days with adjustable parameters. **All RF, balances, hires, other guilds and earnings are simulated.**
Full design: [ECONOMY.md](ECONOMY.md).

## Run it

From the repository root (Node.js 22+):

```sh
npm ci
npm run build
npm run dev:game -- games/friend-guild
```

Open `http://localhost:4173`, connect a wallet on **Robinhood mainnet (4663)** holding a hardwired Generations
Friend (generation ≥ 1) and select it. The SDK runtime handles connection, selection and the fresh ownership
check. No transaction or signature is requested. Static build: `npx friendsdk build games/friend-guild`.

## How to play

Tap or click. Everything is also reachable with the keyboard (Tab / Enter).

- **Guild:** your Friend's stats (from its family and seed), rating, hire fee and gear.
  - Toggle **Listed in the tavern** to let other (simulated) guilds hire it. 70% of each fee lands in your Friend's wallet.
  - The live feed shows every hire across the tavern, and the season board ranks guilds by fame.
- **Tavern:** eight real Friends with stats, family trait and current fee.
  - Hire up to 2 for your next expedition. Each hire raises that Friend's price by 5%, and demand fades over time (half-life of 2 minutes on the demo clock).
  - **Refresh board** shows other Friends.
- **Expedition:** pick one of four family zones (tier 1–4). Each zone favours two counter-families (+7% each).
  - Success chance comes from team power, guild level and affinity, and is shown before launch.
  - The run plays out as a short animation with four encounters against real Friends (12–24 s demo speed, **Skip** available).
  - Rewards: Shards, fame and sometimes gear. **Never RF.**
- **Workshop:**
  - Guild upgrade: level L costs ◆ 40·L + 8·L RF, and gives +3% success per level, up to level 5.
  - Craft gear: ◆ 30 + 4 RF for +2 to one stat. Up to 3 items equipped.
  - **All workshop RF is burned.** Gear raises your Friend's rating, and with it its hire fee.
  - A table shows where your session's RF went.
- **Economy:** the 30-day agent-based simulator (see below).

Settings include **Mute** and **Reduce motion** (still frames, no scrolling). Everything pauses while the runtime's
menus are open.

## Economy terms (simulated)

| | |
| --- | --- |
| Starting balance | 150 RF (simulated, per session) |
| Mercenary fee | (1 + 0.22 × rating) RF × 1.05^recent hires, rounded to 0.1 |
| Fee split | **70% hired Friend's wallet · 20% burned · 10% season fund** |
| Guild upgrade | ◆ 40·L + 8·L RF (RF 100% burned) |
| Gear craft | ◆ 30 + 4 RF (RF 100% burned) |
| Expedition rewards | Shards (◆), fame, occasional gear. **No RF** |
| Season fund | Paid weekly 50/30/20 to the top guilds by fame (simulated) |

- **No redemption:** Shards and gear are never redeemable for RF, so no prize backing applies. The game mints no RF.
- **Chance-game API:** this prototype does not use the SDK chance-game actions. The required `game.json` carries
  **unused schema-only terms** (1 RF, a single 10,000 bps reward of 1 RF, both `1000000000000000000` base units).

## Economy simulator

In-game **Economy** tab and `engine/econ.ts`:
- **Model:** N players (100 / 1,000 / 5,000) run expeditions each day and hire two mercenaries from random 8-Friend boards by value for money (10% pick on prestige). They spend half their Shards in the workshop, which burns RF. Fees rise 5% per hire and demand halves daily.
- **Charts:** RF burned per day, cumulative RF to owners, average fee and Shards in circulation, with hover values.
- **Tiles:** RF spent, burned, paid to owners, the top-10% share of owner earnings, and "RF minted: 0" with a conservation check.
- **Parameters:** players, expeditions per day, burn %, owner %, price step.

## Checks

- `npx friendsdk check games/friend-guild` and strict `npx tsc -p games/friend-guild/tsconfig.json`.
- `node games/friend-guild/tests/run-econ.mjs`: 9 checks.
  - Fee splits and the ledger conserve RF.
  - The 30-day model conserves RF, never mints it and is deterministic.
  - A higher burn share burns more.
  - The top 10% of Friends earn well under half.
  - Shard supply stays bounded.
- `node games/friend-guild/tests/browser.mjs`: the real SDK runtime in headless Chromium with SDK mock fixtures (extended for the artwork registry). It walks guild → hire two → launch → skip → result → workshop → economy on desktop and phone layouts, with no browser errors.
- Known issue: the stock `npx friendsdk test` fixture only answers artwork reads for sample Friend #7730, so it rejects the tavern's roster reads by design.

## Limitations

- **Simulated agents:** other guilds, their hires of your Friend and their fame are simulated in the browser. Hires are non-exclusive: a Friend can be on several contracts at once.
- **No persistence:** the sandbox has no storage and the SDK has no save API, so the session resets on reload.
- **Model scope:** the simulator is a model, not a forecast. Player behaviour, prices and demand are assumptions listed in ECONOMY.md.
- **RPC dependency:** tavern Friends come from the public Robinhood RPC. If artwork can't be read, the game shows Retry.

## Credits

Code and design by Fablizio (AI-assisted). Scenery is drawn in code. Character art: canonical Rare Friends Generations
sprites via the FriendSDK sprite reader. Sounds come from the FriendSDK sound kit (see `NOTICE.md`). Shares
Friend-loading code with the builder's other entries, *The Binding of RareFriend* and *Daily Crypt*.
