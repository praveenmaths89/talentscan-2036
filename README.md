# KhelTara

KhelTara is a free, phone-only screening for sporting talent. A person holds the phone to the chest, or ties it with a dupatta or scarf. There is nothing else to buy.

The English name lives in `APP_NAME` in `js/config.js`. The install manifest uses that same word. In Hindi the screen title is खेलतारा (`app.name` in `locales/hi.json`).

**Screening for referral, not selection.** The app does not pick or drop anyone. Comparison charts use **provisional norms, not validated**. They are placeholders until a new ethics-approved study compares the phone with a force plate, timing gates, a stadiometer, and a lab heart-rate monitor. Do not use a score here as the only reason to select or cut an athlete.

## What you can do

- Two modes: a casual public check, or a budding athlete with a sport and repeat tests.
- A profile is **self-tested** until someone records a centre retest. Then it can show **centre-verified**.
- Core check, about five minutes, no equipment:
  1. Countermovement jump, two valid tries (flight time to jump height, plus the physics-informed force anchor). The best try is kept.
  2. 15 s repeated jumps: count, mean height, contact time, RSI, fatigue slope.
  3. Single-leg balance, 20 s each leg (sway from the accelerometer; gyro reported beside it).
  4. 30 s sit-ups.
  5. Touch reaction time and 10 s tapping.
  6. 3-minute step with fingertip heart rate before and after. Frames stay in memory. No video is stored.
- Optional outdoor tests (30 m sprint, 4×10 m shuttle) when `ENABLE_OUTDOOR_TESTS` is true in `js/config.js`.
- Each test has three numbered steps, a looping demo, one practice, a countdown, live cues, and plain-language fixes. Voice uses recorded lines for English and Hindi, then the best speechSynthesis voice.
- iPhone: the motion permission prompt is requested from the button tap.
- Age, sex, and optional height, weight, and sitting height. Sitting height plus the other body fields produces a Mirwald maturity offset. You can skip body size.
- Under 18: a parent or guardian must agree before the check is saved (India DPDP Act). A parent can add children.
- Results: metrics, a percentile against the provisional chart, a progress timeline, and a share card. Share uses the Web Share API (WhatsApp appears there when the phone has it).
- Invite link, code, and QR. The app records who invited whom on this phone, and Community Builder badges. Spot a talent stores a nomination only after consent. It does not create a score for the other person.
- Languages: English and Hindi are complete (Hindi scripts follow the research brief). The other 21 Eighth Schedule languages ship as stubs that fall back to English. Urdu and Kashmiri use RTL layout. Packs load when chosen. The phone language is picked up on first launch when it matches a pack.
- Online-first PWA with a small cache so a refresh mid-check can continue. GitHub Pages needs no server.

The older single-test PINN lab page is still at `talentscan_pinn_standalone.html`. The jump math used by the Core check is in `js/signal.js`.

## Design tokens

Light UI. Text and buttons meet WCAG AA contrast on the surfaces below. Spacing follows an 8px grid. Type is Inter, with Noto Sans (and Indic Noto families) for other scripts.

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#F4F7F6` | Page background, soft off-white |
| `--surface` | `#FFFFFF` | Cards |
| `--ink` | `#1B2430` | Primary text |
| `--muted` | `#5E6A75` | Secondary text |
| `--primary` | `#0F5E5A` | Deep teal buttons and links. White text on this colour |
| `--accent` | `#E07A3D` | Saffron highlight, focus ring, phone in the demos |
| `--accent-ink` | `#9A3412` | Warning text |
| `--good` | `#1F7A4D` | Good quality badge |
| `--danger` | `#B42318` | Errors |
| `--line` | `#E2E8E6` | Borders |
| `--radius` | `16px` | Cards and buttons |
| `--shadow` | `0 8px 24px rgba(27, 36, 48, 0.08)` | Soft card shadow |
| `--space` | `8px` | Base spacing step |

The same primary, background, and accent live in `THEME` in `js/config.js` and in the install manifest.

Type is Inter at 18px body, 32px titles, and 18–20px buttons that are at least 56px tall. Line height is 1.5. A **Normal / Large** control (also the A / A+ button) is remembered on the phone. Indic languages use Noto Sans and render about 8% larger so Devanagari, Tamil, Bengali, and the other scripts stay readable.

## Phone check

Each core test asks for one practice, then two valid tries where a second try makes sense (jump, repeated jumps, sit-ups, sprint, shuttle). The saved number is the best try. If the two tries disagree by more than 25%, the card says **Retry advised**. Balance needs both feet. Reaction keeps the middle of several taps. The step test is one three-minute bout, with a heart-rate check before and after.

Motion uses the size of acceleration-including-gravity, so the phone can face the chest or the sky. A Sensor check screen shows live numbers. iPhone asks for motion permission from the button tap. If the browser hides gravity or samples too slowly, the screen says what to do. The screen stays awake during a test.

Voice uses a recorded Indian English or Hindi line when one is in `assets/voice/`, and otherwise the best `speechSynthesis` voice for that language (about 0.9 speed). A **Stuck?** button on every screen can replay the demo, repeat the voice, restart, or skip.

Weather is optional. If allowed, the app saves city, district, and state plus temperature, humidity, feels-like, heat index, wind, UV, air quality, and altitude. It does not save the exact map point. Heat and poor air show a warning before hard tests.

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
