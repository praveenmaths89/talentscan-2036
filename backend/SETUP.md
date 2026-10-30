# Backend setup

KhelTara works with **no backend**. Leave `js/env.js` empty and the app keeps profiles, checks, invites, and nominations in `localStorage`. That is the GitHub Pages demo.

When you want a shared database, use the SQL in `schema.sql`. It is ordinary Postgres with row-level security written for Supabase Auth (`auth.uid()`). Supabase has a free project tier. Any Postgres you already run is enough. Do not put raw video or camera frames in this database. Trials store feature summaries only (flight time, counts, sway, heart-rate numbers).

## Supabase (free project)

1. Create a project in the region you want. For children in India, pick a region you are allowed to use under the DPDP Act.
2. Open the SQL editor and run `schema.sql`.
3. In Authentication, turn on the sign-in method you will use later. The shipped web app does not send data until `js/env.js` has both values below, and row-level security still refuses anonymous writes.
4. Copy the project URL and the anon key into `js/env.js`:

```js
export const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
export const SUPABASE_ANON_KEY = "YOUR-ANON-KEY";
```

5. Serve the site again. If a sync fails, the check still stays on the phone.

The anon key is not a service role. Do not put the service role key in the frontend.

## What the tables are for

| Table | Holds |
| --- | --- |
| `users` | Account, language, casual or athlete mode, invite code, who invited them |
| `guardians` / `guardian_athletes` | Parent link and the consent statement for under-18s |
| `athletes` | Age, body size, sport, `self-tested` or `centre-verified` |
| `organisations` / `org_members` | School, club, or federation and staff roles |
| `sessions` / `tests` / `trials` | One check, its tests, and per-trial feature JSON |
| `invites` | Who invited whom |
| `nominations` | Spot-a-talent. Inserts require `consent_attested` |
| `badges` | Community Builder and related badges |

A coach, teacher, or federation admin can read athletes in their organisation. A guardian can read linked children. Everyone else sees only their own rows.

## Local Postgres

```bash
createdb talentscan
psql talentscan -f backend/schema.sql
```

`auth.uid()` exists only on Supabase. On plain Postgres, create a stand-in before the policies, or skip the policy section and use the app in demo mode.

```sql
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
```

That stand-in denies every row, which is safe. Wire a real user id before you expect cloud reads to succeed.
