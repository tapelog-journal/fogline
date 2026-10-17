# Legal and safety notes

- **Testnet only.** Fogline's game and wagering contract (`src/Fogline.sol`) can only be deployed to Base Sepolia (chainId 84532) or a local development chain (31337). The constructor reverts on every other chain, and `script/Deploy.s.sol` refuses to run elsewhere.
- **No real-money wagering.** Optional stakes use a valueless test token. Wagering real money on mainnet is **disabled pending a legal review by the owner**. Skill-game and gambling rules differ by jurisdiction, and this code must not be adapted for real-money wagering without that review.
- **Cosmetics are decorative.** `FoglineCosmetics` items have no effect on gameplay. Any future mainnet sale needs owner approval (`ALLOW_MAINNET_COSMETICS=yes-owner-approved`) and a separate review of consumer, tax and sales rules.
- **No warranty.** This software is experimental and unaudited, and is provided "as is" under the MIT license.
- **Original work.** Fogline's name, pieces and rules are original. It is not affiliated with, endorsed by or derived from the assets of any other game or trademark holder.
- **Not financial advice.** Game for entertainment. Not investment advice.
