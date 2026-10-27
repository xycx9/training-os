# Training OS

A staff training app for a money-services business. Admins upload a training deck as a PDF, attach a multiple-choice question bank, assign it to staff and track who has passed, when, and on which version. Staff sign in with a username and password, read the PDF page by page, then take the assessment.

Every attempt is kept as evidence for BNM examinations and audits, including fails.

## What it does

**Admin**
- Modules: upload a PDF, import questions from CSV or write them one by one, review and approve each question, then publish.
- Versions: fix a mistake as a logged **correction**, or publish a **new version** (v1.0 → v1.1). Past results stay linked to the version that was taken. You can ask everyone to retake the new version.
- Assignment: assign by person or by job role, with a due date. New joiners get every published module in one step.
- Refreshers, set per module: a **yearly round** with a fixed deadline for everyone, a **rolling** refresher 12 months after each person's last pass (assigned automatically), or **one-off**.
- Session duration: entered by you, credited as training hours on a pass.
- Accounts: create staff sign-ins with a temporary password (no email needed), reset passwords, deactivate leavers. Their record is kept.
- Training records: filter by period (quarter, year, custom) and module. Export CSV, or open a printable training log and save it as PDF.

**Staff**
- My training: what is due, overdue, done, and when the next refresher is.
- Read the PDF page by page. The assessment unlocks at the last page.
- Take the quiz: questions drawn at random from the bank, answers shuffled, scored on the server. Results show the correct answer and the page to revisit. Three attempts by default, then it locks and they see the compliance officer.

**Security**
- Staff can never read the question bank or the answer key. They receive questions without answers, and scoring happens in the database.
- Attempts cannot be edited or deleted by anyone through the app.
- PDFs sit in private storage. Only signed-in users can open them, through links that expire.
- Self-registration is off. Only an admin can create accounts.

## How it is built

| Part | What it is |
|---|---|
| Web app | React + Vite (this folder) |
| Database, login, file storage | Supabase (a new project, separate from Compliance OS) |
| Account management | A small Supabase Edge Function: `supabase/functions/admin-users` |
| Hosting | Cloudflare Pages (free, business use allowed) |

Staff sign in with a username. Behind the scenes it becomes `username@training-os.local`. No email is ever sent, and nobody needs an email address.

---

## Setup guide

About 30–45 minutes, all in the browser. No coding needed. Do the steps in order.

### Step 1. Create the Supabase project

1. Sign in at [supabase.com](https://supabase.com) with the same account you use for Compliance OS.
2. Click **New project**. Name it `training-os`. Choose region **Southeast Asia (Singapore)**. Set a strong database password and keep it somewhere safe.
3. Wait until the project finishes setting up (a minute or two).

### Step 2. Turn off self sign-up

1. In the project, go to **Authentication → Sign In / Providers** (on some versions: **Authentication → Providers → Email**).
2. Turn **off** "Allow new users to sign up". Leave the Email provider itself **on**. This means only you can create accounts.

### Step 3. Create the database

1. Go to **SQL Editor → New query**.
2. Open `supabase/migrations/0001_training_os.sql` from this project, copy all of it, paste it in, and click **Run**.
3. You should see "Success. No rows returned". It creates the tables, the security rules, the scoring functions and a private file bucket called `materials`.

### Step 4. Add the account-management function

1. Go to **Edge Functions → Deploy a new function → Via Editor**.
2. Name it exactly `admin-users`.
3. Delete the sample code, paste the whole of `supabase/functions/admin-users/index.ts`, and click **Deploy function**.
4. Leave "Enforce JWT verification" (Verify JWT) **on**.

The function uses keys Supabase already provides to it. You don't need to add any secrets.

### Step 5. Create your own admin account

1. Go to **Authentication → Users → Add user → Create new user**.
2. Email: `admin@training-os.local`. Replace `admin` with the username you want, using lowercase letters, numbers, dots or dashes. Choose a password, tick **Auto Confirm User**, and click **Create user**.
3. Go back to **SQL Editor → New query**, paste this, change the username, email and name, and click **Run**:

```sql
insert into public.profiles (id, username, full_name, role, must_change_password)
select id, 'admin', 'Your Name', 'admin', false
from auth.users where email = 'admin@training-os.local';
```

You'll sign in with that username (`admin`) and password. Create everyone else from inside the app.

### Step 6. Note the two connection values

Go to **Project Settings → API** (or **Data API**) and copy:
- **Project URL**, which looks like `https://abcd1234.supabase.co`
- **anon public** key, a long text starting with `eyJ`

These two are safe to put in the web app. **Never** put the `service_role` key anywhere in the web app.

### Step 7. Put the code on GitHub

If the project is already in your GitHub repo, skip this step. Otherwise:
1. On [github.com](https://github.com), click **New repository**, name it `training-os`, keep it **Private**, and create it.
2. Click **uploading an existing file**, drag in everything from this project folder except `node_modules`, and click **Commit changes**.

### Step 8. Publish the app on Cloudflare Pages

Cloudflare Pages is free and allows business use.

1. Sign in at [dash.cloudflare.com](https://dash.cloudflare.com), using the same account where you bought the domain if you did.
2. Go to **Workers & Pages → Create → Pages → Connect to Git**. Connect your GitHub account and pick the `training-os` repository.
3. Build settings:

| Setting | Value |
|---|---|
| Framework preset | **Vite** (or "None") |
| Build command | `npm run build` |
| Build output directory | `dist` |

4. Under **Environment variables**, add:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | the Project URL from step 6 |
| `VITE_SUPABASE_ANON_KEY` | the anon public key from step 6 |
| `VITE_ORG_NAME` | `INCO Licensed Money Changer` (or whatever should appear in the header and on printed logs) |
| `NODE_VERSION` | `20` |

5. Click **Save and Deploy**. After a minute or two you get a link like `https://training-os.pages.dev`. That is your app.

If the build fails, copy the red error lines from the build log and send them to whoever maintains the code.

Prefer Vercel? It works the same way (Import project, same environment variables), but its free Hobby plan is for non-commercial use, so a business needs Vercel Pro.

### Step 9. Connect your own domain (optional)

1. In the Pages project, open **Custom domains → Set up a custom domain**.
2. Enter `training.incolmc.com` (your domain) and confirm.
3. If the domain is on Cloudflare, the DNS record is added for you. If it's with another seller, Cloudflare shows a CNAME record. Add it in that seller's DNS settings.
4. Within minutes to a few hours, the app opens at the new address with HTTPS. The `pages.dev` address keeps working too.

Nothing changes in Supabase or for staff logins.

### Step 10. First use

1. Open the link and sign in with your admin username and password.
2. **Staff → + Add staff**: create each person. The app shows the username and a temporary password to hand over. They choose their own password at first sign-in.
3. **Modules → + New module**: upload a PDF, add the questions, choose who must complete it, and publish.

---

## Writing question banks

Import questions as CSV with these seven columns, in this order:

```
question,option_a,option_b,option_c,option_d,correct,source_page
What must happen before a transaction is completed?,Nothing,Customer due diligence,Ask a colleague,Call the bank,B,1
```

- `correct` is A, B, C or D.
- `source_page` is the PDF page the answer comes from. Staff are pointed there if they get it wrong.
- Put any text that contains a comma inside double quotes.
- Write two to five times as many questions as each attempt uses, so retakes aren't the same quiz.

A quick way to write them: give Claude the PDF in a normal chat and ask for "25 multiple-choice questions in this CSV format, with the source page". Then review every question in the app before approving it.

## Good to know

- **PDF only.** In PowerPoint, use File → Save As → PDF. Animations, videos and speaker notes don't carry over.
- **Fixing a slide.** Correct it in PowerPoint, save as PDF again, then use **Edit module → Replace file**. Choose *Correction* for small fixes, or *New version* when the content changes.
- **Free plan pausing.** Supabase pauses free projects after about a week with no activity. Open the app at least weekly, or move to the Pro plan once staff rely on it.
- **Storage.** The free plan includes 1 GB of file storage, which is plenty for PDF decks.
- **Backups.** Supabase Pro includes daily backups. On the free plan, export a CSV of training records from the app every quarter and keep it with your compliance files.
- **Dates** are recorded in Malaysia time.

## Running it on your own computer (optional)

You need Node.js 18 or newer.

```bash
npm install
cp .env.example .env.local   # then fill in the two Supabase values
npm run dev
```

## Project layout

```
supabase/migrations/0001_training_os.sql   database, security rules, scoring and refresher functions
supabase/functions/admin-users/index.ts    create accounts, reset passwords, deactivate
src/lib/                                   connection, sign-in, shared rules (due dates, status)
src/pages/admin/                           Modules, module page, editor, Staff, Training records, print log
src/pages/staff/                           My training, reader, quiz
```
