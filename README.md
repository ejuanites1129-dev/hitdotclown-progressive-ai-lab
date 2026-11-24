# Hit Dot Clown AI Lab Online

This unranked **AI Carnival Challenge** supports browser buttons and physical ESP32 targets. It uses Classic progression: each clear adds one flash while score and lives carry over. Adaptive Pace selects the next preview duration between cycles. Coded, anonymous Adaptive Pace runs from either input feed one combined decision-tree training pool, so normal browser games can train the model before the ESP32 is available. Each run retains its input type; the shared model can serve both modes. It adjusts memory-preview pace and does not model piezo sensor sensitivity.

## Human-playtest-only training

The decision tree is trained only from real, coded Adaptive Pace playthroughs. Browser-button and ESP32 sessions share one training pool. Synthetic seed data and simulated models are not used. Until enough human data is available, Adaptive Pace uses the built-in rule-based pacing fallback; new human playthroughs are saved and the model is trained automatically when the requirements are met.

Training requires at least five distinct participant codes with Adaptive runs reaching Cycle 2, plus both cleared and failed outcomes in the training split. The participant-grouped evaluation keeps each participant’s rounds together, so a player’s data does not appear in both training and evaluation.

## Set up Supabase

1. Create or choose the Supabase project for the AI Lab. A separate project makes its credentials and playtest data independent from the carnival standings.
2. Open **SQL Editor** in that project. Run the entire [supabase/schema.sql](supabase/schema.sql) file. It creates the playtest and model tables and the human-only training-data function. Running it again preserves saved runs and models.
3. To remove previously inserted synthetic examples and any model trained with them, run [supabase/remove-synthetic-playtests.sql](supabase/remove-synthetic-playtests.sql). It deletes only rows marked as synthetic seeds; human playthroughs remain.
4. Copy the Project URL and a secret key from that project. Put the key directly into the hosting project's server environment variables.

## Deploy on Vercel

1. Add the contents of this folder to a new GitHub repository. Include the folder structure, `package-lock.json`, and `vercel.json`.
2. In Vercel, import that repository as a new project. Use its repository root and the Vite preset. The configuration installs with `npm ci`, builds with `npm run build`, and serves `dist`.
3. Add the following variables to **Production** in the Vercel project settings.

   | Name | Value |
   | --- | --- |
   | `AI_LAB_SUPABASE_URL` | The URL of the Supabase project where you ran the SQL |
   | `AI_LAB_SUPABASE_SECRET_KEY` | The same project's server secret key |

4. Deploy and open the production URL. On the setup screen, confirm that the Playtest database shows the human playthrough count. If there is no human-trained model yet, Adaptive Pace uses the rule-based fallback while it collects human runs.
5. Select **Join and contribute**, then play normally with **Adaptive pace**. Completed coded Adaptive runs save automatically for model training. Keep the anonymous participant code to link repeat games; guest and Fixed pace runs are not training examples, and no name or email is collected. Open the link in a second browser and confirm that the shared run count increased.

The Vercel API uses the Supabase key server-side. Keep private keys out of GitHub and leave the variables without a `VITE_` prefix. The browser receives aggregate status and the active decision tree. The operator uses the commands below to retrieve the dataset.

## Connect the AI challenge to the ESP32

1. Run the full updated `supabase/schema.sql` script in the AI Lab Supabase project. The added ESP32 tables store physical runs separately from browser-button runs. The script is safe to run again and preserves saved runs.
2. In Arduino IDE, open `firmware/HitTheClown_ESP32_Integrated/HitTheClown_ESP32_Integrated.ino` from this project copy and upload it to the integrated ESP32. Keep the `.ino` file and its four header files in the same folder. This AI Lab firmware reports version 1.13.0 and lets the web app set the next cycle's light duration during the cycle break.
3. Open the deployed HTTPS AI Lab in Chrome or Edge. In **Targets**, choose **ESP32 physical targets**, select **Connect ESP32**, and choose the board's USB port. Close Arduino Serial Monitor before connecting.
4. Wait until the page reports **Ready for AI pace** and the board is **READY**. Choose Adaptive Pace or Fixed medium pace, then start the challenge from the page. The physical board generates the sequence, shows it on the LEDs, and reads piezo hits. Adaptive Pace chooses the next preview duration between cycles.
5. Select **Join and contribute** and keep the participant code. Play normally in Adaptive Pace; physical runs automatically join the same human-only model-training pool as browser runs. Model training begins after five coded Adaptive players reach Cycle 2 and the training group contains both clears and failures. Until then, Adaptive Pace uses the rule-based fallback.

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
