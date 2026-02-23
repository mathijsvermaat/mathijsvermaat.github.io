# mathijsvermaat.github.io

## Pages

### App Blocked Page (`app-blocked.html`)

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

### Generic Blocked Page (`blocked.html`)

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
