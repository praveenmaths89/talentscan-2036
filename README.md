# KhelTara

KhelTara is a free, phone-only screening for sporting talent. A person holds the phone to the chest, or ties it with a dupatta or scarf. There is nothing else to buy.

The English name lives in `APP_NAME` in `js/config.js`. The install manifest uses that same word. In Hindi the screen title is खेलतारा (`app.name` in `locales/hi.json`).

**Screening for referral, not selection.** The app does not pick or drop anyone. Comparison charts use **provisional norms, not validated**. They are placeholders until a new ethics-approved study compares the phone with a force plate, timing gates, a stadiometer, and a lab heart-rate monitor. Do not use a score here as the only reason to select or cut an athlete.

## What you can do

- Two modes: a casual public check, or a budding athlete with a sport and repeat tests.
- A profile is **self-tested** until someone records a centre retest. Then it can show **centre-verified**.
- Core check, about five minutes, no equipment:
  1. Countermovement jump ×3 (flight time to jump height, plus the existing physics-informed force anchor).
  2. 15 s repeated jumps: count, mean height, contact time, RSI, fatigue slope.
  3. Single-leg balance, 20 s each leg (sway from the accelerometer; gyro reported beside it).
  4. 30 s sit-ups.
  5. Touch reaction time and 10 s tapping.
  6. 3-minute step with fingertip heart rate before and after. Frames stay in memory. No video is stored.
- Optional outdoor tests (30 m sprint, 4×10 m shuttle) when `ENABLE_OUTDOOR_TESTS` is true in `js/config.js`.
- Each test has Get ready / Do it / Done, one practice, a countdown with beeps, a short animation, and plain-language QC. Voice uses the Web Speech API in the chosen language.
- iPhone: the motion permission prompt is requested from the button tap.
- Age, sex, and optional height, weight, and sitting height. Sitting height plus the other body fields produces a Mirwald maturity offset. You can skip body size.
- Under 18: a parent or guardian must agree before the check is saved (India DPDP Act). A parent can add children.
- Results: metrics, a percentile against the provisional chart, a progress timeline, and a share card. Share uses the Web Share API (WhatsApp appears there when the phone has it).
- Invite link, code, and QR. The app records who invited whom on this phone, and Community Builder badges. Spot a talent stores a nomination only after consent. It does not create a score for the other person.
- Languages: English and Hindi are complete (Hindi scripts follow the research brief). The other 21 Eighth Schedule languages ship as stubs that fall back to English. Urdu and Kashmiri use RTL layout. Packs load when chosen. The phone language is picked up on first launch when it matches a pack.
- Online-first PWA with a small cache so a refresh mid-check can continue. GitHub Pages needs no server.

The older single-test PINN lab page is still at `talentscan_pinn_standalone.html`. The jump math used by the Core check is in `js/signal.js`.

## Run it

```bash
npm test
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173` on a phone, or in a narrow browser window. Motion sensors need a secure context (`https://` or `localhost`). On a desktop with no useful motion sensor, each test has **Use a practice sample**. That runs the same math on sample motion and is labelled as a sample, not your body.

`npm test` checks jump height, rep counting, RSI, fatigue slope, sway, the impulse anchor, heart-rate estimation, consent, and invites.

## Backend

Demo mode is the default. See `backend/SETUP.md` and `backend/schema.sql` for a free Postgres / Supabase layout with row-level security. Empty `js/env.js` means nothing is uploaded.

## Disclaimer

KhelTara is a screening tool to help someone find a next step, such as a club or a talent centre. It is not a medical device, not a selection test, and not a prediction of who will become an elite athlete. Provisional norms are not validated.
