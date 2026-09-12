# Development validation

Release 0.1.0 · Checked 12 September 2026

| Check | Result | Scope |
| --- | --- | --- |
| API tests | **15 passed** | Search, budgets, compatible pooling, supplier pair distance, authentication, document access, reviewer permissions, idempotency, reservation cancellation, concurrent acceptance, positive / partial handover and buyer review eligibility |
| Website build | **Passed** | TypeScript and Vite production bundle |
| Mobile TypeScript | **Passed** | React Native application and shared API client |
| Expo exports | **Passed** | Android, iOS and web JavaScript / Hermes bundles |
| Browser integration | **Passed** | Demand search, multi-supplier PET request, each supplier acceptance, whole-plan readiness, trust dialog and 390 px layout |
| Mobile web smoke | **Passed** | Discovery, supply plans and login sheet through the exported React Native web target |
| Visual review | **Checked** | Desktop marketplace, evidence/trust dialog, responsive website and mobile web discovery |

The browser integration recorded no JavaScript page errors. API tests emitted dependency deprecation warnings around Starlette's httpx TestClient integration; no tests failed. The environment's standard Playwright browser download timed out, so the smoke test used a Chromium executable supplied through its `CHROMIUM_EXECUTABLE` override. The packaged script defaults to normal Playwright Chromium for your machine.

Screenshots in `docs/screenshots` are taken from the running application using fictional demo records. `native-web-*` images are the React Native **web rendering**, not screenshots from an iOS or Android device.

Not executed: a signed Android APK/AAB build, Xcode/iOS native compilation, physical device camera / secure-store verification, a live PostgreSQL deployment, GST provider integration, AI model integration, payments, or external logistics. These are not represented as completed.

## Reproduce

Use the commands in the README. Backend tests create an isolated temporary SQLite database and files. The browser smoke script also starts its own temporary backend; stop an existing development server on ports 8000 / 5173 / 8081 before running it. Its checks deliberately exercise a request through supplier acceptance; final handover, review eligibility and dispute reconciliation are covered in API tests.
