# Development validation

Release 0.1.0 · Checked 12 September 2026

## Automated checks

| Check | Result | Scope |
| --- | --- | --- |
| API tests | **17 passed** | Search, budgets, compatible pooling, supplier pair distance, authentication, document access, reviewer permissions, idempotency, reservation cancellation, concurrent acceptance, positive / partial handover, buyer review eligibility, and the model adapter's fallback and output validation |
| Website build | **Passed** | TypeScript and Vite production bundle |
| Mobile TypeScript | **Passed** | React Native application and shared API client |
| Expo exports | **Passed** | Android, iOS and web JavaScript / Hermes bundles |
| Browser integration | **Passed** | Demand search, multi-supplier PET request, each supplier acceptance, whole-plan readiness, trust dialog and 390 px layout |
| Mobile web smoke | **Passed** | Discovery, supply plans and login sheet through the exported React Native web target |
| Visual review | **Checked** | Desktop marketplace, evidence/trust dialog, responsive website and mobile web discovery |

The browser integration recorded no JavaScript page errors. API tests emit dependency deprecation warnings around Starlette's httpx TestClient integration; no tests fail. The test module clears `OPENAI_API_KEY`, so the suite describes behaviour with no model configured whatever the shell holds.

## Acceptance tests

`python scripts/uat.py` walks the API as a buyer, a supplier and a reviewer would,
and states each expectation as a promise to a user rather than an assertion about
code. **96 of 96 kept** against a throwaway local database with the model enabled,
covering: signing in and the impossibility of self-promotion to reviewer; demand
search, parsing, filters and budgets; publishing material and its validation; the
full exchange lifecycle including idempotency, reservation, partial handover and
cancellation; disputes through to a reviewer's settlement; review eligibility;
evidence upload and who may read it; GST review earning points only after a person
approves it; upload size and type limits; and multilingual search.

`python scripts/uat.py --url <deployment> --read-only` skips everything that
writes, so it is safe to point at production. **32 of 32 kept** against the live
deployment.

## Builds produced

| Artefact | Result | Notes |
| --- | --- | --- |
| Android APK | **Built** | EAS `preview` profile, installable by direct download. Signed by EAS; not a Play Store release |
| iOS simulator build | **Built** | EAS `ios-simulator` profile, four and a half minutes. Confirms the native iOS build compiles |
| iOS device build | **Not executed** | Requires a paid Apple Developer account and signing credentials |

## Deployment checked against the running services

| Check | Result |
| --- | --- |
| Website on Vercel | **Live**, HTTP 200 |
| API on Render (Singapore) | **Live**, health endpoint 200 |
| PostgreSQL on Supabase | **Connected**, 7 application tables in a private `app` schema |
| Schema isolation | **Verified** — the project's publishable key is refused: `Invalid schema: app`, and `anon` has no `USAGE` on the schema |
| Demo account passwords | **Verified unusable** — the seeded password no longer authenticates |
| Multilingual demand extraction | **Verified live** in Hindi and Gujarati, and on everyday English wording |
| Photo category suggestion | **Verified live** — a pallet photograph returns wooden pallets at high confidence; a photograph of a document correctly returns no match |
| Evidence storage | **Verified live** — an upload through the deployed site lands in the private Supabase bucket, is readable by its owner and a reviewer, and returns 401 to anyone else |

Search against the deployed stack answers in roughly 0.9 s. The API is in Singapore and the database in Tokyo, so most of that is the distance between them rather than query cost: a single round trip to the database measures about 137 ms, and one search issues a fixed 8 statements.

## Limits

Screenshots in `docs/screenshots` are taken from the running application using fictional demo records. `native-web-*` images are the React Native **web rendering**, not screenshots from an iOS or Android device.

Not executed: an App Store or Play Store submission, physical device camera / secure-store verification, GST provider integration, payments, or external logistics. These are not represented as completed.

Known gaps in the deployment rather than the code: the model adapter has no per-account quota, though both of its routes require a signed-in account; there is no rate limit on sign-in; and the database is in Tokyo while the API is in Singapore, which is most of the 0.9 s a search costs.

## Reproduce

Use the commands in the README. Backend tests create an isolated temporary SQLite database and files. The browser smoke script also starts its own temporary backend; stop an existing development server on ports 8000 / 5173 / 8081 before running it, and run `npx expo export` in `apps/mobile` first if you want its mobile-web half to run rather than be skipped. Its checks deliberately exercise a request through supplier acceptance; final handover, review eligibility and dispute reconciliation are covered in API tests.
