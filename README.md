# Hit Dot Clown AI Lab Online

This unranked browser edition of **AI Carnival Challenge** uses Classic progression. Each clear adds one flash while score and lives carry over. Adaptive Pace selects the next preview duration between cycles. Completed runs save to Supabase and can train a progressive decision tree. The local AI Lab also has the five-round pilot for ESP32 practice.

## Set up Supabase

1. Create or choose the Supabase project for the AI Lab. A separate project makes its credentials and playtest data independent from the carnival standings.
2. Open **SQL Editor** in that project. Run the entire [supabase/schema.sql](supabase/schema.sql) file. It creates the playtest and model tables and the training-data function. Running the script again preserves saved runs and models.
3. Copy the Project URL and a secret key from that project. Put the key directly into the hosting project's server environment variables.

## Deploy on Vercel

1. Add the contents of this folder to a new GitHub repository. Include the folder structure, `package-lock.json`, and `vercel.json`.
2. In Vercel, import that repository as a new project. Use its repository root and the Vite preset. The configuration installs with `npm ci`, builds with `npm run build`, and serves `dist`.
3. Add the following variables to **Production** in the Vercel project settings.

   | Name | Value |
   | --- | --- |
   | `AI_LAB_SUPABASE_URL` | The URL of the Supabase project where you ran the SQL |
   | `AI_LAB_SUPABASE_SECRET_KEY` | The same project's server secret key |

4. Deploy and open the production URL. On the setup screen, confirm that the Playtest database shows a browser run count. A new database starts at zero. The site can use the labeled demo model while it collects its first training runs.
5. Select **Join playtest**, play through game over, and look for the database save confirmation. Open the link in a second browser and confirm that the shared run count increased. You can use the same participant code with **I have a code**.

The Vercel API uses the Supabase key server-side. Keep private keys out of GitHub and leave the variables without a `VITE_` prefix. The browser receives aggregate status and the active decision tree. The operator uses the commands below to retrieve the dataset.

## Connect the AI challenge to the ESP32

1. Run the full updated `supabase/schema.sql` script in the AI Lab Supabase project. The added ESP32 tables store physical runs separately from browser-button runs. The script is safe to run again and preserves saved runs.
2. In Arduino IDE, open `firmware/HitTheClown_ESP32_Integrated/HitTheClown_ESP32_Integrated.ino` from this project copy and upload it to the integrated ESP32. Keep the `.ino` file and its four header files in the same folder. This AI Lab firmware reports version 1.13.0 and lets the web app set the next cycle's light duration during the cycle break.
3. Open the deployed HTTPS AI Lab in Chrome or Edge. In **Targets**, choose **ESP32 physical targets**, select **Connect ESP32**, and choose the board's USB port. Close Arduino Serial Monitor before connecting.
4. Wait until the page reports **Ready for AI pace** and the board is **READY**. Choose Adaptive Pace, Fixed medium pace, or Randomized pace, then start the challenge from the page. The physical board generates the sequence, shows it on the LEDs, and reads piezo hits. The app estimates or assigns the next pace between cycles.
5. For a randomized training run, select **Join playtest** and keep the participant code. Physical playthroughs appear in the ESP32 playtest count. The ESP32 decision tree trains after five coded randomized players reach Cycle 2 and the training group contains both clears and failures. Until then, Adaptive Pace uses its rule-based fallback.

The confirmed LED pin order is white GPIO32, blue GPIO23, green GPIO25, yellow GPIO26, and red GPIO14. The piezo inputs are white GPIO21, blue GPIO19, green GPIO18, yellow GPIO17, and red GPIO16. The firmware copy is provided for this AI Lab connection workflow.

## Continue from the current study

To carry forward existing **progressive** browser runs, first confirm that your team can transfer them to your study database. On the AI Lab computer, install Node.js 24 or later and copy `.env.example` to `.env.local` in this folder. Enter the same two server environment values configured on Vercel. The local file is ignored by Git.

Run this command with the path to the original AI Lab database. Use the `.ai-data/playtests.sqlite` file inside the local AI Lab's `web-app` folder.

```powershell
npm.cmd run import:sqlite -- "C:\path\to\web-app\.ai-data\playtests.sqlite"
```

The importer preserves each progressive browser run ID. The online Lab trains after at least five different coded players reach cycle 2 using randomized pace and the training group has both outcomes. The built-in demo tree is trained on simulated progressive playthroughs. The three-flash pilot uses a separate dataset.

## Export study evidence

With your local `.env.local` configured, run:

```powershell
npm.cmd run export:dataset -- "hit-dot-clown-progressive-dataset.json"
```

The download includes saved runs, evaluation metrics and the run IDs used for training and evaluation. Store it with your team's study files. A new export can use a new filename.
