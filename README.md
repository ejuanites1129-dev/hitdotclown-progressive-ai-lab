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
