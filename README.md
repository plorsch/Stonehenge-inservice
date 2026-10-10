# Stonehenge Micro In-Service

A small website for a daily micro in-service on the iPad mini kiosk. Staff complete it every time they clock in, and you manage everything from the admin page on your own computer.

**On the iPad (staff):**
1. Type the last 4 digits of their Workday ID on the keypad.
2. Tap their name to confirm it's them. If two people share the same last 4, both names show and each person taps their own.
3. Read a short lesson and answer one question. The answers are shuffled every time.
4. If the answer is wrong, they see a hint, the wrong choice is removed, the rest are reshuffled, and they try again until they get it right. You can see who missed it on the first try.

**On the admin page (you):**
- **Topic of the week.** Schedule one topic for a date range. Each person gets a different question from that topic on each shift.
- **Department topics.** Give Dietary, Housekeeping, CNAs and Nursing their own topics, scheduled or in the rotation.
- **Required education.** After an incident, require a topic for everyone or for chosen departments. Each person gets it the next time they clock in, even weeks later (PRN staff). If someone has several pending, they complete all of them in a row, oldest first.
- **Topic library** with question banks, select-all-that-apply questions, hints, copy, retire, and import from Excel.
- **Staff roster** with import from Excel, plus responses you can download as CSV and a usage history.

It runs on Node.js with nothing else to install and no database to set up. Everything is saved in one data file.

## 1. Running it

### On a hosting service (recommended: Render)

Set these environment variables on the service:

- `DATA_DIR`: a folder on the persistent disk, e.g. `/var/data`
- `ADMIN_PASSWORD`: the admin password
- `PORT`: usually set automatically

The start command is `node server.js`. The iPad opens the service's web address, and the admin page is the same address with `/admin` on the end.

### On a facility computer (for trying it out)

1. Install **Node.js** (the "LTS" version) from https://nodejs.org.
2. Copy this whole folder onto the computer.
3. Double-click `start-windows.bat` (Windows) or `start-mac.command` (Mac). If the Mac refuses, open Terminal, type `chmod +x ` (with a space), drag the file into the window, and press Enter.
4. The window shows the address for the iPad, e.g. `http://192.168.1.25:8080/`. Leave the window open.

The first time it starts, it loads sample topics and five sample staff so you can try it: IDs **1111** (two people share it), **2222** (Nursing), **3333** (Dietary) and **4444** (Housekeeping). Mark the sample staff inactive once your real roster is in.

## 2. Setting up the iPad mini

1. Open the site address in Safari and use **Share > Add to Home Screen**.
2. Open it from the Home Screen icon and turn on **Guided Access** (Settings > Accessibility > Guided Access) to lock it to the in-service.
3. Set Auto-Lock to "Never" and keep the iPad plugged in.

It works in portrait or landscape. After 1 minute without a touch it returns to the keypad, and it never shows other people's answers.

## 3. The admin page

Sign in with username `admin` and your password. The default for a facility-computer install is `changeme`, so change it on the Settings tab.

| Tab | What it's for |
| --- | --- |
| **Today** | What each department gets today, required items waiting, and how many completed or missed today. |
| **Schedule** | Run a topic for a date range ("This week" / "Next week" buttons), for all staff or chosen departments. Also sets what happens when nothing is scheduled: one topic of the day per department, or random. |
| **Required education** | Require a topic after an incident. Shows who has done it and who still needs to; close it when you're finished. |
| **Topic library** | Add, edit, preview, copy, retire. Import from Excel. Topics marked "Needs work" stay off the iPad until they're complete. |
| **Staff** | The roster: name, Workday last 4, department, active or inactive. Import from Excel or paste from a spreadsheet. |
| **Responses** | Every answer, filterable by date, department, topic, or "missed first try". Download as CSV. |
| **Clock-in check** | Choose a Workday time clock export (Excel or CSV) to see who clocked in but didn't finish an in-service. Download the list as CSV. |
| **Usage history** | Each day each topic was used. |
| **Settings** | Facility name, departments, whether staff who aren't on the roster can type their name, password, backup and restore. |

### What a person gets when they clock in

1. **Required education** that applies to them and that they haven't finished yet, all of it, oldest first. Their regular topic is skipped on that visit.
2. Otherwise, their department's **scheduled topic**. A department-specific schedule beats an all-staff one.
3. Otherwise, a topic from the **rotation** that applies to their department.

Within a topic they always get the question they've seen the least, never the same one twice in a row.

### Writing topics

- Lesson: a blank line starts a new paragraph, a line starting with `- ` is a bullet, and `**words**` are bold.
- Add several questions to a topic so people see a different one each shift.
- Tick **Select all that apply** for questions with more than one right answer, and put one correct answer per line.
- **Hint** is shown after a wrong answer. **Explanation** is shown after the right answer.
- **For** sets which departments the topic is for. Leave it empty for all staff.

### Importing topics from Excel

Use one row per question with these column headings: **Topic title**, **Question**, **Correct answer**, **Wrong answers**. Optional columns: Lesson text, Department, Hint, Explanation, Category, Last-used date. Put several answers in one cell with `|` between them. Rows with the same topic title become one topic. A question containing "select all" becomes select-all-that-apply. Importing again updates topics with the same title, so you can fill in lessons in Excel and re-import.

### Importing staff from Excel

You need columns for the name, the Workday ID (the full ID or the last 4) and the department. Staff already on the roster with the same name and last 4 are updated instead of duplicated. New departments are added automatically.

### Catching clock-ins without an in-service

The kiosk can't see the time clock, so the check works from your export. Export the time clock from Power BI or Workday for the period you want (a day, a week, a pay period) and choose the file on the **Clock-in check** tab. If the workbook has a "Time Clock" tab, that tab is read. The page picks the Employee ID, name, Start Shift Date, Start Time, Paycode and Job Profile columns, and you can change them if it guesses wrong.

- Each person's first punch of a day counts as one shift, so lunch and clock-out punches aren't counted twice.
- A shift is covered when the person finished an in-service that day. For clock-ins at 6 pm or later, the next morning before noon also counts.
- People are matched by the last 4 digits of their Workday ID. If two staff share the same last 4, the name in the export decides.
- Results are **Done**, **Missed**, or **Started, didn't finish**. IDs that aren't on the Staff tab are flagged so you can add them.
- Rows for time off (sick, vacation, PTO, bereavement and similar paycodes, or rows with no start time) are skipped. Orientation and In Service hours count as shifts.
- Clock-ins before the iPad's first in-service aren't counted.
- The default view lists people to follow up with, grouped by leader: shifts missed, dates, and who never did it. Set leaders on the Settings tab ("Dietary: Andi"), or import the roster from a sheet with a Leader column.
- The export is only compared, never saved.

### Announcements, birthdays and anniversaries

The **Announcements** tab is for news that needs no question, like an all-staff meeting reminder. Each one has dates and, if you like, departments. Announcements add no taps: all-staff ones rotate in a line above the keypad, and after an in-service the last screen lists that person's announcements for a few extra seconds.

Add a birthday (month and day only) and hire date on the Staff tab, or as Birthday and Hire date columns in a staff import. On the day, the iPad shows "Happy birthday, Ada L.!" or "3 years with us today!", and the person gets their own message after their in-service. This can be turned off on the Announcements tab.

### Home screen decor and forgotten codes

- **Settings → Home screen decor** sets decorations, a message and a background color for each month. The color and the first decoration stay on every screen (the color as the background, the decoration in the header). The iPad switches on the 1st. Use **Preview** to see any month.
- **Forgot your code?** under the keypad lets staff type their first and last name to see their last 4, then tap their name to start. It needs both names and shows at most 3 people.

## 4. Data and backups

Everything is in `data/db.json` (or in `DATA_DIR` on a hosting service). A copy is saved automatically once a day in `backups/`, and the last 60 days are kept. On the Settings tab you can:

- **Download full backup:** one file with everything. Save it weekly to a facility OneDrive or SharePoint folder.
- **Download all responses (CSV):** opens in Excel.
- **Restore from a backup:** replaces everything with a backup file. A copy of the current data is saved first.

## Privacy

The site stores staff training records only: name, Workday last 4, department and answers. Never put resident names or details in lessons or questions. The kiosk shows only a first name and last initial when someone confirms who they are.

## Files

```
server.js              the web server (all logic and storage)
seed-topics.json       sample topics, loaded the first time only
seed-staff.json        sample staff, loaded the first time only
public/index.html      the iPad kiosk page
public/admin.html      the admin page
public/admin.js        admin page behavior
public/format.js       lesson text formatting
public/xlsx.full.min.js  Excel file reader (SheetJS, Apache 2.0 license) used by the import buttons
start-windows.bat      double-click to start on Windows
start-mac.command      double-click to start on a Mac
data/                  created on first run: your data, backups and settings
```
