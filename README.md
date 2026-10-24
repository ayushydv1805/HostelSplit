# HostelSplit

HostelSplit is a lightweight React + Vite expense-sharing app for hostel rooms, trips, and small groups. Add people, record shared expenses, track who paid, and calculate the transfers needed to balance the group.

## Features

- Create a group and add or manage members.
- Add, edit, search, and delete expenses.
- Split an expense equally among the selected people.
- Calculate member balances and suggest a low-payment settlement plan.
- Mark suggested settlements as paid for local tracking.
- View category totals and spending percentages.
- Export expenses to a CSV file for Excel or Google Sheets.
- Light and dark themes.
- Browser-local persistence with a recoverable backup.
- Responsive layout for desktop, tablet, and mobile screens.

## Run locally

1. Install a supported Node.js LTS release.
2. Install dependencies with `npm install`.
3. Start the development server with `npm run dev`.
4. Run checks with `npm run lint` and `npm run build`.

## Data and privacy

Group information is stored in the current browser using local storage. It is not synced between browsers or devices, and this version has no account system or shared real-time group database. Clearing browser site data may remove saved data; the app keeps a local backup to help recover from accidental storage loss. The **Clear Group** action explicitly removes both the main saved group and its backup.

The **Mark as Paid** action only updates the app's local settlement status. It does not transfer money or verify a real payment.

## Suggested roadmap

- **Shared groups and accounts:** authentication and a database so friends can see the same group on different devices.
- **Flexible splits:** unequal shares, percentages, exact shares, and payer-excluded splits.
- **Settlement history:** dates, notes, undo, and a proper record of payments.
- **Receipt attachments:** upload a receipt image and add notes to an expense.
- **Reports:** monthly summaries and PDF export.
- **Convenience:** recurring expenses, group invitations, and installable PWA support.

## Tech stack

- React
- Vite
- JavaScript
- CSS
- Browser local storage
