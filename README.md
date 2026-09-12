# MaterialSetu

**A local materials exchange for businesses.** Find surplus packaging, combine nearby compatible supply and build trust through reviewed evidence and completed handovers.

Development release **0.1.0** · HackOut’26 · Team Tech Titans

This repository includes a working React website, an Expo React Native application targeting Android and iOS, and a shared FastAPI backend. It is an initial development release, not a deployed marketplace or a signed App Store / Play Store release.

## What is implemented

- Business registration, login and account switching in an explicitly labelled demo mode.
- Listings for PET, HDPE, LDPE, PP, corrugated cardboard and wooden pallets, with condition, price, available quantity, intended use and seller location.
- Demand-first search such as **“50 kg plastic within 30 km”**, material filters and suggested potential uses.
- Pooling across nearby suppliers, grouped by identical material, condition, intended destination and unit. PET and HDPE are separate alternatives, never one mixed pool.
- Estimated material, transport and landed cost, with editable transport assumptions and buyer budgets.
- A transparent 100-point trust score: GST review, material photos, weighing slips, confirmed transactions and eligible buyer reviews.
- Photo / document uploads, a web reviewer queue and private access to weighing slips and GST documents.
- Supplier acceptance reserves stock; cancellation releases it; both parties confirm the same actual handed-over quantity. Completed buyers can submit one review per exchange item.
- Web dispute review and stock reconciliation.
- Camera and image-library photo attachment on mobile, document attachment and native secure token storage.
- Optional model assistance: a search phrase the keyword rules cannot read — another language, an unusual wording — is passed to a server-side model, and a seller can photograph material to get suggested categories. Both only ever suggest; the seller confirms the category that is published.

**Honest boundaries:** GST verification is manual review, not a live GST registry API. Classification and query extraction use transparent keyword rules; a model is consulted only for phrases the rules cannot read and for photo category suggestions, and its output is validated against the material list and confirmed by a person. It never touches trust scores, GST status or inventory. Transport is an estimate, not a live road route or booking. Demo evidence, businesses and reviews are fictional and labelled. No payments, delivery tracking or carbon-credit claims are implemented.

## Run the website and API

Prerequisites: **Node.js 22.13+** (Node 24 used for this build), **Python 3.11+**, npm. The mobile dependency versions follow the [Expo SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/). Run commands from the repository root unless shown otherwise. Internet is needed to install dependencies.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r services/api/requirements.txt
npm ci
python scripts/dev.py
```

On Windows, use `python` instead of `python3` and activate with `.venv\Scripts\Activate.ps1` in PowerShell.

Open **http://localhost:5173**. Interactive API documentation is at **http://localhost:8000/docs**.

The development runner sets `DEMO_MODE=1`. Choose **Setu Packaging Studio** from the demo account selector to act as the buyer. Choose **North Gujarat Polymers** or **Umiya Packaging Works** to act as suppliers, and **MaterialSetu Reviewer** to review evidence. Demo accounts intentionally do not require passwords. All of them are disabled as quick-login targets when `DEMO_MODE=0`.

SQLite creates `services/api/materialsetu.db`; uploads go to `services/api/uploads/`. Both survive restarts. They are local runtime data and are excluded from the source archive. Starting the API without the runner defaults to a clean non-demo mode:

```bash
cd services/api
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Environment variables are read from the process. The root `.env.example` documents them; it is **not automatically loaded** by the Python API. Export variables in your shell or supply them through your deployment environment.

## Run Android and iOS

Keep the API running. The mobile app has its own lockfile and dependency installation to keep Expo's native versions together.

```bash
cd apps/mobile
npm ci
npx expo start --go
```

Use a compatible Expo Go release for SDK 57, or create a development build. For a **physical phone**, copy `apps/mobile/.env.example` to `apps/mobile/.env`, then set `EXPO_PUBLIC_API_URL` to your computer's LAN address, for example `http://192.168.1.42:8000/api`. Use the same network and allow inbound port 8000. Restart Expo after changing it.

Default API addresses when that variable is absent:

| Target | API address |
| --- | --- |
| Android emulator | `http://10.0.2.2:8000/api` |
| iOS simulator | `http://localhost:8000/api` |
| Mobile web preview | `http://localhost:8000/api` |

The desktop website is a separate React UI. Both interfaces use the same accounts, materials and exchanges through the API. The mobile web target is useful for smoke checks; native camera and secure storage need actual device testing.

For local development builds, install Android Studio / Android SDK or Xcode on macOS, then run:

```bash
npx expo run:android
# On macOS with Xcode:
npx expo run:ios
```

For EAS builds, log in to your own Expo account, initialize the project and set a reachable HTTPS `EXPO_PUBLIC_API_URL` for its build environment. The included `eas.json` has development, preview and production profiles.

```bash
npx eas-cli login
npx eas-cli init
npx eas-cli build --platform android --profile preview
npx eas-cli build --platform ios --profile production
```

Cloud builds need your Expo project and platform signing credentials; distribution also needs the relevant store accounts. Package identifiers `in.materialsetu.app` are placeholders to confirm before your first store submission. No signing credentials or project ownership are supplied in this repository. JavaScript export validation does not replace native compilation or device testing.

## Project layout

```text
apps/web/          React + Vite website, including the reviewer dashboard
apps/mobile/       Expo React Native application for Android and iOS
packages/shared/   TypeScript API client, models and formatting
services/api/      FastAPI, database models, matching rules and API tests
docs/              Architecture, scoring, demo guide and validation notes
scripts/dev.py     Local API + website runner
```

The first release intentionally uses one backend and one relational database. SQLite makes the demo easy to start. Set `DATABASE_URL=postgresql+psycopg://...` to use PostgreSQL. `Base.metadata.create_all` creates an initial schema; versioned migrations and a data migration are needed before changing a deployed schema. Supabase could host PostgreSQL, but Supabase Auth and Storage are not integrated here.

## Verify a change

```bash
# Repository root: web type checking and production build
npm run build

# API behaviour and concurrency
cd services/api
python -m pytest -q

# Mobile TypeScript and bundle exports
cd ../../apps/mobile
npm run typecheck
npx expo export --platform all
```

See [docs/validation.md](docs/validation.md) for the checks performed and their limits.

A browser smoke test is in `scripts/browser-smoke.cjs`. Install Chromium with `npx playwright install chromium`, then run `node scripts/browser-smoke.cjs` from the root with the Python environment active. It starts isolated API and web processes, uses a temporary demo database, and saves screenshots to `docs/screenshots/`.

## Trust and pooling rules

See [docs/architecture.md](docs/architecture.md) for the scoring formula, state transitions, cost assumptions, data model and extension points. See [docs/demo.md](docs/demo.md) for a walkthrough your team can present.

## What to connect before a real pilot

1. A GST verification provider or an accountable reviewer process with documented checks. A correctly shaped GSTIN is not verified registration.
2. A deployed PostgreSQL database, durable private document storage, HTTPS, backups and database migrations.
3. Account recovery, email verification, abuse throttling, operational monitoring and production authentication review. Web tokens currently use local storage; native tokens use SecureStore.
4. A geocoder / address picker and real transport quotes. Current business coordinates are entered during registration; distances are straight-line estimates.
5. A budget and rate limit for the model adapter if `OPENAI_API_KEY` is set. Both model paths already require a signed-in account, and ordinary English searches never reach the model, but there is no per-account quota yet.
6. Real-device camera, upload and notification testing, accessibility review, and platform signing / store release work. Push notifications, chat, payments and automatic reservation expiry are future work.

For a clean pilot, use a **new database** with `DEMO_MODE=0`; changing the flag does not delete previously seeded records. Register a reviewer normally, then an operator can run `python create_reviewer.py reviewer@example.com` from `services/api`. Users cannot assign themselves that role through registration.

## Team

Dhruvil Prajapati · Yovan Sanghvi · Vishwa Patel · Mittal Prajapati  
Tech Titans · Ganpat University, Department of Computer Science
