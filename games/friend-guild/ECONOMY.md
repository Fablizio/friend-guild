# Friend Guild: economy design

Target category: **Economy Potential**, a token economy paired with $RAREFRIENDS (RF). Everything is
**simulated in the prototype**. No contract is deployed and no RF moves.

## The idea

Every hardwired Generations Friend has its own canonical wallet. Friend Guild gives that wallet a job: other
players **hire the Friend** as a mercenary, and the fee is paid **to the Friend's wallet**. Holders earn from real
demand for their Friend, not from emissions.

## Flows

```
hire fee ──► 70% hired Friend's canonical wallet (its owner)
          ├► 20% burned
          └► 10% season fund ──► weekly 50/30/20 to the top guilds by fame

workshop (upgrades, gear) ──► Shards + RF, and the RF is 100% burned
expeditions ──► Shards, fame, gear   (never RF)
```

- **No RF is ever minted.** Every RF a holder earns was paid by another player, and every transaction burns some.
- **Two currencies with separate jobs.** RF moves between players and out of supply. **Shards** pace progression
  and are never redeemable for RF, so they need no backing and can be tuned freely.
- **The sink drives the burn.** Shards are only useful combined with RF in the workshop, so the more players
  progress, the more RF they burn.

## Pricing

- **Base fee:** `1 + 0.22 × rating` RF. Rating is the sum of four stats set by family and seed, plus gear.
- **Demand multiplier:** `1.05^h`, where `h` is the hires still in the demand window. It decays continuously: half-life of 1 day in production, 2 minutes on the demo clock.
- **Why dynamic pricing:** popular Friends get pricier, which pushes players to cheaper alternatives. In the simulator this spreads earnings across the collection: the top 10% of Friends take about 15% of owner earnings with default settings.
- **Affinity:** each zone favours two counter-families, so no single family is best everywhere. Demand follows the rotating zones.
- **Gear:** crafting burns RF and raises your Friend's rating, and with it the fee other guilds pay. It's a player-funded investment in your own Friend's earning power.

## The flywheel

1. Players hire Friends to run expeditions: RF goes to holders and 20% is burned.
2. Holders earn in proportion to real demand, so hardwired Friends become productive assets.
3. More reason to hardwire Friends and to upgrade them, and both spend RF.
4. More listed Friends give more choice and lower prices, which brings more players back to step 1.

## Simulator results (default parameters)

1,000 players, 3 expeditions a day, 30 days. Reproducible in the Economy tab (seed 42).

| Metric | Value |
| --- | ---: |
| RF spent | ≈ 2.25M |
| RF burned | ≈ 720K (hire burns plus workshop burns) |
| RF to Friend owners | ≈ 1.34M |
| Average fee, day 1 → day 30 | 7.7 → 10.9 RF (demand settles) |
| Top 10% of Friends' share of owner earnings | ≈ 15% |
| Shards in circulation | levels off at about 118 per player |
| RF minted by the game | **0** (conservation check passes) |

Absolute volumes scale with player count and the fee level, which is a launch parameter. The ratios are what
matter: about a third of all RF spent is burned, and about 60% goes to holders.

## Edge cases and abuse

- **Self-hiring to farm stats:** it always costs the 20% burn and 10% to the season. A daily hire cap per guild
  and per Friend limits wash volume.
- **Cold start:** tavern NPC mercenaries have a fixed fee paid 100% to the season fund. They fill the board until
  enough real Friends are listed.
- **Concentration:** dynamic pricing plus zone affinity spread demand. The season fund rewards guild play, not
  holdings.
- **Price spikes:** the multiplier decays daily, and players can always pick a cheaper Friend from the board.

## Going live (later phase, with the Rare Friends team)

Needs custom integration beyond FriendSDK v0.1.2, which has no hire, listing, extra-currency or persistence APIs:

- **GuildHire contract** (RF and Generations through interfaces):
  - `list(friendId, on)` is callable by the Friend's owner;
  - `hire(friendId, maxFee)` sends 70% to the Friend's canonical wallet, burns 20% and adds 10% to the season;
  - `seasonClaim(...)` pays the season winners.
- **Game server** for Shards, fame and expedition results. These are off-chain soft state, with no RF payout, so
  no prize reserve is needed. The season fund pays by fame, which the server attests, with a challenge window
  before payout.
- **Runtime:** hire and upgrade confirmations through the SDK's trusted confirmation UI. Game code never sees a
  signer.
- **Compliance:** passive earnings for NFT holders could draw securities-style scrutiny in some jurisdictions.
  Framing it as payment for in-game services, plus legal review, comes before launch.

## Assumptions (stated, tunable)

- Hiring behaviour: value for money with noise, 10% prestige picks, 8-Friend boards.
- Shards: 20–40 per expedition, half of the balance spent daily in the workshop.
- Demand halves daily. Listed Friends = 80% of players.
- The model has no churn or growth. Adding them is the next step for launch planning.
