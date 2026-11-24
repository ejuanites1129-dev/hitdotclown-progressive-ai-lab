# Hit Dot Clown AI Lab Online

The app uses the original Hit Dot Clown carnival theme and one game mode, with Adaptive Pace built into the regular game. It supports browser buttons and physical ESP32 targets. Each cleared cycle adds a flash while score and lives carry over. The lobby includes player name/email, an optional live leaderboard, and a settings panel for pace and ESP32 controls. Player consent is asked before each game; players can play without saving, save a score to the public leaderboard, and separately opt in to share Adaptive gameplay data for AI training. Email stays private; the public leaderboard shows each player's best score and date played.

## Human-playtest-only training

The decision tree is trained only from real, consented Adaptive Pace playthroughs. Browser-button and ESP32 sessions share one training pool. Synthetic seed data and simulated models are not used. Players can choose to save only their leaderboard score, or also share round outcomes, pace, sequence lengths, and timing with the AI Lab. The email address is sent only to the separate leaderboard database and is not included in the AI training data. Until enough human data is available, Adaptive Pace uses the built-in rule-based pacing fallback; consenting Adaptive runs save automatically at game over.

Training requires at least five distinct usernames with consented Adaptive runs reaching Cycle 2, plus both cleared and failed outcomes in the training split. The participant-grouped evaluation keeps each player's rounds together, so a player's data does not appear in both training and evaluation.

## Set up Supabase

1. Create or choose the Supabase project for the AI Lab. A separate project makes its credentials and playtest data independent from the carnival standings.
2. Open **SQL Editor** in that project. Run the entire [supabase/schema.sql](supabase/schema.sql) file. It creates the playtest and model tables and the human-only training-data function. Running it again preserves saved runs and models.
3. To remove previously inserted synthetic examples and any model trained with them, run [supabase/remove-synthetic-playtests.sql](supabase/remove-synthetic-playtests.sql). It deletes only rows marked as synthetic seeds; human playthroughs remain.
4. Copy the Project URL and a secret key from that project. Put the key directly into the hosting project's server environment variables.

## Deploy on Vercel

1. Add the contents of this folder to a new GitHub repository. Include the folder structure, `package-lock.json`, and `vercel.json`.
2. In Vercel, import that repository as a new project. Use its repository root and the Vite preset. The configuration installs with `npm ci`, builds with `npm run build`, and serves `dist`.
3. Add the following variables to the Vercel project settings for **Production** (and Preview if you use preview deployments).

   | Name | Value |
   | --- | --- |
   | `AI_LAB_SUPABASE_URL` | The AI Lab Supabase project URL where you ran `supabase/schema.sql` |
   | `AI_LAB_SUPABASE_SECRET_KEY` | The AI Lab project's server secret key |
   | `LEADERBOARD_SUPABASE_URL` | The original Hit Dot Clown Supabase URL where the player/attempt tables and leaderboard RPC are installed |
   | `LEADERBOARD_SUPABASE_SECRET_KEY` | The original project's server secret key; keep it server-side only |
   | `PUBLIC_LEADERBOARD_URL` | `https://hitdotclown-leaderboard.vercel.app/` |
   | `SMTP_USER` | Project Gmail address (optional; enables the opted-in link email) |
   | `SMTP_PASS` | Gmail App Password (optional; server-side only) |
   | `SMTP_HOST` / `SMTP_PORT` | `smtp.gmail.com` / `465` (optional) |
   | `SMTP_FROM_NAME` | `Hit Dot Clown` (optional) |

4. The leaderboard server variables must point to the original carnival database, not the AI Lab database. Confirm that the original Supabase project has `supabase/schema.sql` and `supabase/public-leaderboard-and-email.sql` installed. The leaderboard API returns only the safe public standings; the secret key never reaches browser code.
5. Deploy and open the production URL. In **Settings & ESP32**, choose Browser buttons or connect the board, and select Adaptive Pace or Fixed medium pace.
6. Enter the player's name and email on the lobby page, choose **Start game**, and review the consent choices. A saved game records the score and timestamps in the original leaderboard database; opting in to AI sharing separately sends the gameplay measurements to the AI Lab database. The leaderboard refreshes automatically and the link email is sent only when the player selects that option and SMTP is configured.

The Vercel API uses both Supabase secret keys server-side. Keep them out of GitHub and do not add a `VITE_` prefix. SMTP values are optional and must also remain server-only. The browser receives the live public leaderboard and aggregate AI status/model; it never receives emails or database secret keys.

## Connect the AI challenge to the ESP32

1. Run the full updated `supabase/schema.sql` script in the AI Lab Supabase project. The added ESP32 tables store physical runs separately from browser-button runs. The script is safe to run again and preserves saved runs.
2. In Arduino IDE, open `firmware/HitTheClown_ESP32_Integrated/HitTheClown_ESP32_Integrated.ino` from this project copy and upload it to the integrated ESP32. Keep the `.ino` file and its four header files in the same folder. This AI Lab firmware reports version 1.13.0 and lets the web app set the next cycle's light duration during the cycle break.
3. Open the deployed HTTPS AI Lab in Chrome or Edge. In **Targets**, choose **ESP32 physical targets**, select **Connect ESP32**, and choose the board's USB port. Close Arduino Serial Monitor before connecting.
4. Wait until the page reports **Ready for AI pace** and the board is **READY**. Choose Adaptive Pace or Fixed medium pace, then start the challenge from the page. The physical board generates the sequence, shows it on the LEDs, and reads piezo hits. Adaptive Pace chooses the next preview duration between cycles.
5. Start an Adaptive Pace game. The player enters their name once on the lobby screen. If they separately opt in to AI sharing in the consent dialog, physical runs join the same human-only model-training pool as browser runs. Model training begins after five distinct consenting usernames reach Cycle 2 and the training group contains both clears and failures. Until then, Adaptive Pace uses the rule-based fallback.

The confirmed LED pin order is white GPIO32, blue GPIO23, green GPIO25, yellow GPIO26, and red GPIO14. The piezo inputs are white GPIO21, blue GPIO19, green GPIO18, yellow GPIO17, and red GPIO16. The firmware copy is provided for this AI Lab connection workflow.

## Continue from the current study

To carry forward existing **progressive** browser runs, first confirm that your team can transfer them to your study database. On the AI Lab computer, install Node.js 24 or later and copy `.env.example` to `.env.local` in this folder. Enter the same two server environment values configured on Vercel. The local file is ignored by Git.

Run this command with the path to the original AI Lab database. Use the `.ai-data/playtests.sqlite` file inside the local AI Lab's `web-app` folder.

```powershell
npm.cmd run import:sqlite -- "C:\path\to\web-app\.ai-data\playtests.sqlite"
```

The importer preserves each progressive browser run ID. The online Lab trains after at least five different coded players reach cycle 2 using Adaptive Pace and the training group has both outcomes. The three-flash pilot uses a separate dataset.

## Export study evidence

With your local `.env.local` configured, run:

```powershell
npm.cmd run export:dataset -- "hit-dot-clown-progressive-dataset.json"
```

The download includes saved runs, evaluation metrics and the run IDs used for training and evaluation. Store it with your team's study files. A new export can use a new filename.
