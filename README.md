# HostelSplit

**Split expenses. Stay friends.** A responsive expense-sharing app for hostel rooms, roommates and trips.

HostelSplit runs offline with browser storage or in cloud mode with Supabase authentication and shared groups. Cloud features activate only when the app is built with the Supabase environment variables configured.

## Features

### Expenses and settlement
- Create groups and manage members.
- Record expenses with a payer, category, date and shared members.
- Split by equal shares, exact amounts or percentages, with cent/paise-safe allocation.
- Calculate balances and recommend low-count settlement transfers.
- Record payments and retain settlement history; cancel a mistaken settlement without deleting its history.
- Search expenses and filter by category or month.
- Export expense lines as CSV and print a financial report to save as PDF.

### Budgets and receipts
- Set month-specific group budgets and category limits.
- See spending by category and monitor budget usage.
- Attach a receipt photo; client-side OCR can suggest an amount and show extracted text.
- Review the suggested amount before saving it. OCR is a convenience, not a guarantee; always verify totals manually.
- In cloud mode, receipt files go to a private Supabase Storage bucket and signed URLs expire.

### Login and cloud persistence
- Email/password sign-up and sign-in, session refresh and sign-out.
- Password-reset email flow.
- Create a shared group and invite other signed-in accounts using a code.
- Cloud group data, expenses, split shares, budgets and settlements persist in Supabase after the page is closed.
- Shared group data refreshes periodically while the group is open.
- Row Level Security (RLS) policies restrict group data to authenticated members.

### Offline mode
- Without the Supabase environment variables, the app works in local mode.
- Offline groups persist in the same browser's local storage and do not sync to other devices.
- Existing \`hostelsplit-data\` data is migrated when possible.

## Run locally

Use a supported Node.js 24 release.

\`\`\`bash
npm install
npm run dev
\`\`\`

Copy the environment template if you want cloud mode:

PowerShell:
\`\`\`powershell
Copy-Item .env.example .env
\`\`\`

Then replace the placeholders in \`.env\` with values from a **dedicated HostelSplit Supabase project**:

\`\`\`dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
\`\`\`

Restart the Vite server after changing environment variables.

## Enable cloud mode

1. Create or select a **dedicated Supabase project for HostelSplit**. Do not reuse databases belonging to other apps.
2. In that project's SQL Editor, run the complete \`supabase/schema.sql\` script. This creates the tables, indexes, RLS policies, invite-code function and private receipt bucket.
3. In Supabase Auth settings, set the Site URL to your deployed origin and add the local and deployed callback/redirect URLs. If email confirmation is enabled, users must verify their email before signing in.
4. Add \`VITE_SUPABASE_URL\` and \`VITE_SUPABASE_PUBLISHABLE_KEY\` to the Vercel project's Production, Preview and Development environments. Use the project URL and publishable key from the dedicated HostelSplit project. A publishable key is safe for the browser only because the database is protected by RLS; **never put a service-role key in Vite or Vercel client variables**.
5. Redeploy Vercel after adding or changing environment variables.
6. Create an account, create a shared group, and have another account join using the group's invite code.

Cloud login and shared persistence cannot work until the backend project is active, the SQL schema is applied, and both environment variables are configured. The environment variables are build-time values for Vite.

## Data persistence and privacy

| Mode | Where data is stored | Available after closing the app? | Shared across devices? |
| --- | --- | --- | --- |
| Offline | This browser's local storage | Yes, in the same browser profile | No |
| Cloud | Supabase database and private Storage | Yes, after signing back in | Yes, for accounts in the same group |

The browser stores the Supabase auth session and refresh token so a user can remain signed in. The app does not store the account password. Protect your device; clearing browser storage signs you out locally. Cloud data remains in Supabase until it is deleted from the database.

Receipt OCR may load Tesseract.js from a CDN when first used; the selected image is compressed in the browser before it is saved. In offline mode the compressed image is stored inside local storage, which is limited by the browser. Cloud mode stores it in the private Storage bucket.

Marking a settlement as paid only records the status in HostelSplit. It does not transfer money or verify a payment.

## Quality checks

\`\`\`bash
npm test
npm run lint
npm run build
\`\`\`

The tests cover currency validation, equal/exact/percentage splits, balance accounting and settlement calculation. GitHub Actions runs tests, lint and a production build on feature/fix branches and pull requests to main.

## Security notes

- All tables in the supplied SQL schema enable RLS.
- The group membership policies use private helper functions to avoid recursive policies.
- The invite-code function only adds the signed-in caller to the matching group.
- The receipt bucket is private; uploaded objects are organized by user ID and group ID.
- Never expose Supabase service-role or secret keys in the client app.

Before production launch, verify the configured Supabase project, auth email settings, API table exposure and RLS policies, then test sign-up/sign-in, a second-user group invite, a new expense, page reload, and sign-out/sign-in.

## Suggested future improvements

- Equal, exact and percentage splits, receipt OCR, budgets and history are implemented.
- Potential next upgrades: user avatars, push notifications, recurring expense templates, richer charting, scheduled monthly exports, configurable currencies and optional installable PWA support.

## Tech stack

- React 19 and Vite
- JavaScript and responsive CSS
- Supabase Auth, Postgres, REST/Data API, Row Level Security and private Storage
- Node.js built-in test runner
