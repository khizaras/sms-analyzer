# LedgerSMS

LedgerSMS turns a personal SMS export into a private financial ledger: accounts, balances, spending, categories, and an optional narrative. Each signed-in user sees only their own rows.

There is one `package.json` and one `node_modules`, both at the repository root. Install once from that directory.

## Stack

React, Ant Design, Webpack, Redux Toolkit, Express, MySQL.

## Setup

Requires Node.js 18 or newer and MySQL 8.

```bash
npm install
copy .env.example .env
```

On macOS or Linux, use `cp .env.example .env`. Set `DB_*` and replace `JWT_SECRET` with a long random string.

Create the database with the mysql client, or with Node once `DB_*` can log in:

```bash
mysql -u root -p < sql/schema.sql
node server/src/ensure-schema.js
```

Or start MySQL with Docker (first boot loads the schema):

```bash
docker compose up -d
```

The compose file uses root password `root`, database `sms_analyzer`, port `3306`, matching `.env.example`.

## Run

Two processes in development:

```bash
npm run dev
```

- App: http://localhost:8080
- API: http://localhost:4000

Either side alone:

```bash
npm run dev:server
npm run dev:client
```

Production build, then one process that serves the API and `client/dist`:

```bash
npm run build
npm start
```

Open http://localhost:4000 after `npm start`.

## First ledger

1. Create an account on the sign-up screen.
2. Open Imports and download a sample (`/api/fixtures/sample-sms.json`, `.csv`, or `.xml`).
3. Drop that file on the importer.
4. Overview, Transactions, Accounts, Review, and Insights fill from that file.

The sample is Indian bank SMS (HDFC, ICICI, SBI, Axis, Kotak) plus a few messages the parser leaves for review.

## Environment

| Variable | Purpose |
| --- | --- |
| `PORT` | API port. Default `4000`. |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MySQL connection. |
| `JWT_SECRET` | Signs session tokens. Required in production. |
| `JWT_EXPIRES_IN` | Token lifetime. Default `7d`. |
| `CLIENT_ORIGIN` | Browser origin allowed to call the API directly. |
| `LLM_BASE_URL` | OpenAI-compatible API root, default `https://api.openai.com/v1`. |
| `LLM_API_KEY` | Optional. Empty means Insights uses the local summary. |
| `LLM_MODEL` | Model name sent to that endpoint. |
| `UPLOAD_MAX_MB` | Max SMS file size. Default `8`. |

The API key stays on the server. Settings shows only whether a model is configured, plus the host and model name.

## Tenant isolation

`requireAuth` verifies the bearer JWT and sets `req.user.id` from the `sub` claim. It drops any `userId` field on the query or body.

Every ledger read and write then binds that id:

- Imports, messages, transactions, accounts, balance snapshots, and LLM summaries are inserted with `user_id`.
- List, get-by-id, update, export, review, stats, account timelines, and insight queries add `user_id = ?`.
- A row id owned by someone else returns 404.
- Stats, charts, merchants, banks, and balances aggregate only the caller’s rows.
- The category catalog is a shared label list. Overrides are stored on the caller’s transactions.
- Redux holds one session. Sign-in and sign-out clear the RTK Query cache so the next account does not render the previous numbers.

There is no admin or shared dashboard.

Transactions can be analyzed one at a time, as a selection of up to 25, or as the current filter (the server reads at most 25). Reviews are stored on that user’s transaction. The review queue can request a category suggestion and accept it explicitly. `/summary` ranks spend, income, and repeated charges for the signed-in user. `npm run check:summary` confirms another account cannot see those aggregates.

Check the parser and, when MySQL is up, the two-user proof:

```bash
npm run check
```

`npm run check:isolation` signs up two temporary users, imports the sample as user A, and asserts user B gets 404s and zero totals. Those users are deleted afterward.

## Layout

```
package.json          root dependencies and scripts
client/               React UI and webpack.config.js
server/src            Express API
sql/schema.sql        MySQL schema
fixtures/             Sample SMS exports
```

Passwords are hashed with bcrypt. SQL uses placeholders. Uploads stay in memory, are limited by type and size, and are stored against the authenticated user. Production logs record the path and status, not message bodies.
