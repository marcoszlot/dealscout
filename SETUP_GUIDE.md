# DealScout — Setup Guide

Follow these 4 steps to deploy DealScout to the cloud. Total time: ~15 minutes.

---

## Step 1: Push Code to GitHub

Open a terminal, navigate to the `dealscout` folder, and run:

```bash
cd dealscout
git init -b main
git add -A
git commit -m "Initial commit: DealScout app"
git remote add origin https://github.com/marcoszlot/dealscout.git
git push -u origin main
```

After pushing, verify at: https://github.com/marcoszlot/dealscout — you should see all the files.

---

## Step 2: Set Up Supabase

### 2a. Create a new project

1. Go to https://supabase.com/dashboard
2. Click **New Project**
3. Name: `dealscout`
4. Database password: choose something strong (save it somewhere)
5. Region: pick the closest one to your users
6. Click **Create new project** — wait ~2 minutes for it to provision

### 2b. Run the database migration

1. In your Supabase project, go to **SQL Editor** (left sidebar)
2. Click **New Query**
3. Copy and paste the entire contents of `supabase/migrations/001_initial_schema.sql` from your project
4. Click **Run** (or Ctrl+Enter)
5. You should see "Success. No rows returned" — that means the tables were created

### 2c. Enable Realtime

1. Go to **Database** → **Replication** in the left sidebar
2. Under "Supabase Realtime", make sure both `projects` and `companies` tables are enabled
3. The SQL migration already handles this, but verify the toggles are on

### 2d. Copy your keys

1. Go to **Settings** → **API** (left sidebar)
2. Copy these 3 values (you'll need them in Step 4):

| What | Where to find it |
|------|-----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL (starts with `https://`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon` `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` `secret` key (click "Reveal") |

---

## Step 3: Get Anthropic API Key

1. Go to https://console.anthropic.com
2. Sign up or log in
3. Go to **API Keys** → **Create Key**
4. Name: `dealscout`
5. Copy the key (starts with `sk-ant-...`)
6. **Important**: Add credits to your account at https://console.anthropic.com/settings/billing
   - The app uses Claude Sonnet 4 with `web_search` — each company costs ~$0.02-0.05
   - For a list of 100 companies, budget ~$5

---

## Step 4: Deploy to Vercel

### 4a. Import the project

1. Go to https://vercel.com/new
2. Click **Import Git Repository**
3. Select `marcoszlot/dealscout`
4. Framework: it should auto-detect **Next.js**

### 4b. Add environment variables

Before clicking "Deploy", expand **Environment Variables** and add these 4:

| Key | Value |
|-----|-------|
| `ANTHROPIC_API_KEY` | `sk-ant-...` (from Step 3) |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxx.supabase.co` (from Step 2d) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` (from Step 2d) |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` (from Step 2d) |

### 4c. Adjust build settings

Under **Build & Development Settings**, set:
- **Build Command**: `npm run build`
- **Install Command**: `npm install`

### 4d. Deploy

1. Click **Deploy**
2. Wait 1-2 minutes for the build
3. Once done, click the URL (e.g., `dealscout-xxx.vercel.app`)
4. You should see the DealScout landing page!

### 4e. Important: Increase function timeout

The research worker needs longer than the default 10s timeout:

1. In your Vercel project, go to **Settings** → **Functions**
2. Set **Max Duration** to `300` seconds (5 minutes) — requires Vercel Pro plan
3. If you're on the free plan, the max is 60 seconds, which still works but may timeout on slow searches

---

## You're Done!

Your app is now live at your Vercel URL. To use it:

1. Prepare an Excel (.xlsx) with sheets named "Strategic Buyers" and "Financial Buyers"
2. Upload it on the landing page
3. Click "Start Research" on the dashboard
4. Watch contacts appear in real-time
5. Export when done

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Build fails on Vercel | Check that all env vars are set correctly |
| "Failed to create project" | Verify Supabase URL and keys are correct |
| Research hangs or errors | Check Anthropic API key has credits |
| No realtime updates | Make sure Realtime is enabled for both tables in Supabase |
| 504 timeout on Vercel | Upgrade to Pro for 300s function timeout |
