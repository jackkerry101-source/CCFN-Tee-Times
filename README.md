# Weekend Tee Times

Checks seven Sydney courses for weekend tee times before 3pm. It shows them on one shared page for phones and messages a group chat when new times open up. It runs free on GitHub, with no server and nothing to install.

| Tier | Course | Holes | Booking system |
|---|---|---|---|
| 1 | Eastlake | 18 | MiClub |
| 1 | The Coast | 18 | MiClub |
| 1 | Stonecutters Ridge | 18 | MiClub |
| 2 | Moore Park | 12 | MiClub |
| 2 | Woollahra | 9 | MiClub |
| 2 | Northbridge | 18 | MiClub |
| 2 | Marrickville | 18 | TeeItUp (GolfNow) |

**How it works:** GitHub runs a check every 30 minutes on Mon, Tue, Wed and Fri, and every 3 hours on Thu, Sat and Sun (Sydney time). Each check reads the clubs' public visitor booking pages, without logging in. It updates the shared page and sends one group message listing any new times with 2 or more spots. Booking stays manual: tapping a time opens that club's booking page.

---

## One-time setup (about 20 minutes)

### 1. Put the code on GitHub
1. Create a free account at github.com if you don't have one.
2. Click **New repository**. Name it `tee-times`, set it to **Public**, and click **Create repository**. Public is needed for the free shared page. The code and tee times are visible, but your chat keys stay private.
3. On the new repo page, click **uploading an existing file**. Unzip the download and drag everything inside the `tee-time-tracker` folder into the upload box, then click **Commit changes**.
4. Check that the `.github` folder uploaded, because it holds the schedule. Macs hide folders starting with a dot. If you don't see `.github` in the repo, click **Add file → Create new file**, type `.github/workflows/check-tee-times.yml` as the name, paste in the contents of that file from the zip, and commit.

### 2. Turn on the shared page
1. In the repo, go to **Settings → Pages**.
2. Under "Build and deployment", choose **Deploy from a branch**, then branch **main**, folder **/docs**, and click **Save**.
3. After a minute or two your board will be at `https://YOUR-GITHUB-USERNAME.github.io/tee-times/`. Send that link to the boys. On iPhone, tap Share → **Add to Home Screen** and it opens like an app.

### 3. Set up the group alerts (Telegram)
Messenger and WhatsApp don't let bots post into group chats without paid business accounts or unofficial workarounds that can get a phone number banned. Telegram is free and built for this.

1. Everyone installs Telegram.
2. In Telegram, message **@BotFather** and send `/newbot`. Give it a name (e.g. "Tee Times") and a username ending in `bot`. BotFather replies with a **token** (a long string with a colon in it).
3. Create a Telegram group with the four of you and **add your bot** to it.
4. In the group, send `/start@yourbotusername`, using your bot's actual username.
5. In GitHub, go to **Settings → Secrets and variables → Actions → New repository secret**. Name it `TELEGRAM_BOT_TOKEN` and paste the token as the value.
6. Go to the **Actions** tab, click **Check tee times** → **Run workflow** → **Run workflow**. When it finishes (about a minute), open the run, click **check**, and expand **Check courses**. Look for the `TELEGRAM SETUP` section, which shows your group's chat ID (a negative number).
7. Add a second secret named `TELEGRAM_CHAT_ID` with that number.
8. Run the workflow once more. That's it. From now on it runs itself.

**Simpler alternative:** use the free **ntfy** app instead of a group chat. Everyone installs ntfy and subscribes to the same made-up topic name (something hard to guess, e.g. `jack-tee-times-7Qx2`). Add that name as a secret called `NTFY_TOPIC`. You can use both channels at once.

If the Actions tab says workflows are disabled, click **I understand my workflows, go ahead and enable them**. If a run fails at "Save results" with a permissions error, go to **Settings → Actions → General → Workflow permissions**, choose **Read and write permissions**, and save.

---

## Changing things

Everything adjustable lives in `config.json`. Open it on GitHub, click the pencil icon, edit, and commit. The next check picks it up.

| Setting | What it does | Now |
|---|---|---|
| `window.startBefore` | Latest tee-off time to include | `"15:00"` |
| `window.weekdays` | Days to search (0 = Sun, 6 = Sat) | `[6, 0]` |
| `alertMinSpots` | Minimum spots before a time is messaged (the board shows everything) | `2` |
| `daysAhead` | How far ahead to look | `14` |
| `courses[].tier` | Tier 1 or 2 | — |

Set `alertMinSpots` to `4` if you only want to hear about full four-balls.

To add another **MiClub** course, copy a course entry and change the `host` and `bookingResourceId` to the ones in that club's public booking link (`.../ViewPublicCalendar.msp?booking_resource_id=3000000`). Set `holes` to 18 to only include 18-hole fee groups, or to the course's own hole count to include everything.

## Things to know
- **Timing:** GitHub's scheduler can run 5–20 minutes late at busy times. It's fine for this, but don't rely on it to the minute.
- **Woollahra** currently has no public weekend times before 3pm. Sundays are closed to visitors and Saturdays open at 3:40pm. It stays on the list in case that changes.
- **How far ahead:** MiClub clubs usually release public times one to two weeks out, so later weekends fill in as they open.
- **If a club changes its website**, that course shows a red or amber dot at the bottom of the board and keeps its last known times. The other courses keep working.
- **Inactivity:** GitHub may pause schedules on a repo with no activity for 60 days. If you get an email saying the workflow was disabled, open the Actions tab and re-enable it.
- **Being a good neighbour:** each check makes about 40 small page requests across seven clubs, spaced a second apart. That's lighter than one person clicking around the booking pages.

## Files
- `config.json`: courses, tiers, search window and alert settings
- `src/core.mjs`: reads MiClub and TeeItUp booking pages (no dependencies)
- `src/run.mjs`: runs each check, writes the board data and sends alerts
- `src/notify.mjs`: Telegram and ntfy messages
- `src/gate.mjs`: thins the schedule on Thu, Sat and Sun
- `docs/index.html`: the shared board (`docs/data.json` is rewritten on every check)
- `.github/workflows/check-tee-times.yml`: the schedule
- `test/`: offline tests (`npm test`)
