# Velocity Discord Owner Bot

Discord slash commands for your Velocity OGFN server — matching Project Velocity style commands.

## Setup

1. Create a bot at [Discord Developer Portal](https://discord.com/developers/applications)
2. Copy `config.example.json` → `config.json` and fill in token, clientId, guildId, ownerUserIds
3. `npm install`
4. `npm run register` — register slash commands
5. Start Velocity, then `npm start`

## Commands

### Everyone
| Command | Description |
|---------|-------------|
| `/create username:` | Create OGFN account (links to your Discord) |
| `/appeal reason:` | Submit a ban appeal |
| `/buy item:` | Buy from today's item shop |
| `/change-username new_username:` | Rename your account |
| `/check-user user:` | View account info |
| `/claimvbucks` | Daily 250 V-Bucks |
| `/leaderboard` | Top 10 Arena hype |
| `/custom-match-code-list` | List custom match codes |

### Owners / staff
| Command | Description |
|---------|-------------|
| `/add pack: user:` | Grant all/vbucks/bp/level/item |
| `/ban user: reason:` | Ban player |
| `/unban user:` | Unban player |
| `/remove user: item:` | Remove locker item |
| `/delete user:` | Delete account |
| `/create-test-acc` | Test account + all cosmetics |
| `/createhostaccount` | Host account |
| `/createsac code:` | Support A Creator code |
| `/deletesac code:` | Remove SAC |
| `/create-custom-match-code code:` | Custom match code |
| `/status` `/players` `/kick` `/bans` `/motd` | Admin tools |

## Notes

- Run `/create` once so `/claimvbucks` and `/buy` know your username
- Set `panelToken` in both backend `config.json` and bot `config.json` for security
- Arena leaderboard uses `arena_hype` on player profiles (increases as you add arena scoring later)
