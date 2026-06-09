# mathijsvermaat.github.io

## TL;DR — Quick links

| Page | Live URL |
| --- | --- |
| App Blocked Page | https://mathijsvermaat.github.io/app-blocked.html |
| Monitored App Page | https://mathijsvermaat.github.io/monitored.html |
| Generic Blocked Page | https://mathijsvermaat.github.io/blocked.html |
| Sentinel Maturity Assessment Checklist | https://mathijsvermaat.github.io/sentinel-maturity-assessment.html |
| WisselApp | https://mathijsvermaat.github.io/WisselApp/ |

## Pages

### App Blocked Page (`app-blocked.html`)

**Live page:** https://mathijsvermaat.github.io/app-blocked.html

A professional user-facing page that displays when access to a restricted application is attempted.

**Purpose:** Inform users that a specific application (in this case, Gemini) is not allowed in the organization and provide them with approved alternatives.

**Features:**
- Clear visual indication that access is restricted
- Explanation of why the application is blocked
- Highlighted alternative with direct action button
- Contact guidance for administrators
- Responsive design that works on mobile and desktop
- Professional styling with gradient background

**Current Configuration:**
- **Blocked Application:** Google Gemini
- **Approved Alternative:** Microsoft Copilot with direct URL
- **Target URL:** `https://copilot.microsoft.com`

**Usage:**
Navigate to `app-blocked.html` in your browser to view the page, or integrate it into your web filtering/proxy system to serve when users attempt to access restricted GenAI applications.

### Monitored App Page (`monitored.html`)

**Live page:** https://mathijsvermaat.github.io/monitored.html

A professional user-facing page that displays when access to a monitored application is attempted.

**Purpose:** Inform users that a specific application (in this case, Gemini) is not allowed in the organization and provide them with approved alternatives.

**Features:**
- Clear visual indication that access is restricted
- Explanation of why the application is blocked
- Highlighted alternative with direct action button
- Contact guidance for administrators
- Responsive design that works on mobile and desktop
- Professional styling with gradient background

**Current Configuration:**
- **Blocked Application:** Google Gemini
- **Approved Alternative:** Microsoft Copilot with direct URL
- **Target URL:** `https://copilot.microsoft.com`

**Usage:**
Navigate to `monitored.html` in your browser to view the page, or integrate it into your web filtering/proxy system to serve when users attempt to access restricted GenAI applications.

### Generic Blocked Page (`blocked.html`)

**Live page:** https://mathijsvermaat.github.io/blocked.html

A generic blocking page for all restricted applications and services.

**Purpose:** Display a universal access restriction message for any blocked application without mentioning a specific app.

**Features:**
- Generic access denied message suitable for all applications
- Explanation of organizational policy compliance
- Professional, reusable design
- Responsive layout for all devices
- IT administrator contact guidance

**Usage:**
Configure your web filtering or proxy system to serve `blocked.html` as the default response when users attempt to access any restricted application. This is the recommended page to use as a general-purpose blocking page.

### Sentinel Maturity Assessment Checklist (`sentinel-maturity-assessment.html`)

**Live page:** https://mathijsvermaat.github.io/sentinel-maturity-assessment.html

An interactive assessment checklist for the [Sentinel Maturity Model](https://github.com/mathijsvermaat/Sentinel-Maturity). Used during customer engagements to document data connector onboarding, retention configuration, and detection readiness across all tiers.

**Purpose:** Provide an audit trail of what was checked and configured during a Sentinel deployment assessment, with rationale and comments.

**Features:**
- Checkboxes per connector, table, retention setting, and validation step
- Comment field per connector section for rationale and notes
- Assessor name, customer name, date, and workspace metadata
- Real-time progress tracking (overall and per connector)
- Collapsible sections per tier and connector
- **Export to PDF** via browser print
- **Export to Excel** via SheetJS (structured spreadsheet with all check items and comments)
- **Save/Load progress** to JSON (resume later or share between assessors)
- Tier 1 fully built, Tier 2/3 prepared for future content
- No backend or server required — fully client-side

**Usage:**
Navigate to `https://mathijsvermaat.github.io/sentinel-maturity-assessment.html` or open the file locally. Fill in the assessment metadata, work through each connector's checklist, add comments, and export the results.

### WisselApp (`WisselApp/`)

**Live page:** https://mathijsvermaat.github.io/WisselApp/

A substitution and playing-time planner for youth football (jeugdvoetbal), delivered as a fully offline Progressive Web App. See [WisselApp/README.md](WisselApp/README.md) for the full Dutch documentation.

**Purpose:** Help coaches fairly distribute playing time, goalkeeper rotations, and substitutions across matches, with a live match screen that survives screen lock.

**Features:**
- Player roster (first names only — privacy-friendly)
- Matches per date with configurable format, halves, quarters, and substitution interval
- Goalkeeper-per-quarter selection with suggestions based on historical goalkeeper time
- Fair substitution schedule that accounts for prior playing time across matches
- Live match screen with large clock, current field/bench/goalkeeper, countdown to next substitution, and audible/visual/vibration alarm 30 seconds before and at the moment of switching
- Lock-screen-proof timestamp-based timer (locking the phone does not reset the match)
- Playing-time statistics across all matches
- JSON backup export/import
- Installable as a PWA on iOS and Android, works offline via service worker

**Privacy:**
All data (players, matches, playing time) is stored locally in IndexedDB on the device. No backend, no cloud — the only network traffic is downloading the static app files from GitHub Pages.

**Usage:**
Navigate to `https://mathijsvermaat.github.io/WisselApp/` and add it to your home screen (iOS Safari: Share → *Add to Home Screen*; Android Chrome: menu → *Install app*).
