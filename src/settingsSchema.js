// Declarative description of what each plugin exposes in the Settings UI.
// The UI renders generically from this — no per-plugin UI code.
//
// field types: "text" | "number" | "list" (comma/newline separated → array)
// secrets are rendered as masked password inputs and saved to settings.secrets
// connect: an OAuth-style button that opens `url`, enabled once `requires` secrets exist
export const SETTINGS_SCHEMA = [
  {
    id: "news",
    label: "News",
    blurb: "Headlines from Google News + any custom RSS feeds. No account needed.",
    secrets: [],
    config: [
      { key: "topics", type: "list", label: "Topics", help: "Search terms — press Enter to add" },
      { key: "feeds", type: "list", label: "Custom RSS feed URLs" },
      { key: "maxArticles", type: "number", label: "Max articles" },
    ],
  },
  {
    id: "kanban",
    label: "Kanban Board",
    blurb: "A drag-and-drop board with your own columns. No account needed — define columns and cards right on the board.",
    secrets: [],
    config: [],
  },
  {
    id: "apple-reminders",
    label: "Apple Reminders",
    macOnly: true,
    blurb: "Reads & writes Reminders.app. Syncs across your Apple devices. macOS only.",
    secrets: [],
    config: [
      { key: "maxItems", type: "number", label: "Max items" },
      { key: "defaultList", type: "text", label: "Default list (blank = inbox)" },
    ],
  },
  {
    id: "calendar",
    label: "Google Calendar",
    blurb: "Upcoming events across your calendars.",
    secrets: [
      {
        key: "GOOGLE_CLIENT_ID",
        label: "Google Client ID",
        help: "console.cloud.google.com → APIs & Services → Credentials → OAuth client. Redirect URI: http://localhost:3737/auth/google/callback",
      },
      { key: "GOOGLE_CLIENT_SECRET", label: "Google Client Secret" },
    ],
    config: [{ key: "calendarIds", type: "list", label: "Calendar IDs" }],
    connect: {
      label: "Connect Google",
      url: "/auth/google",
      requires: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    },
  },
  {
    id: "notion",
    label: "Notion Tasks",
    blurb: "Your task database, with full create / edit / complete.",
    secrets: [
      {
        key: "NOTION_TOKEN",
        label: "Notion Integration Token",
        help: "notion.so/my-integrations → New integration. Then share your DB with it.",
      },
      { key: "NOTION_DATABASE_ID", label: "Tasks Database ID" },
    ],
    config: [
      { key: "excludeStatuses", type: "list", label: "Hide these statuses" },
      { key: "maxTasks", type: "number", label: "Max tasks" },
    ],
  },
  {
    id: "gitlab",
    label: "GitLab MRs",
    blurb: "Your open merge requests with unresolved-thread counts.",
    secrets: [
      { key: "GITLAB_TOKEN", label: "GitLab Access Token", help: "scope: read_api" },
      { key: "GITLAB_URL", label: "GitLab Base URL", help: "e.g. https://gitlab.yourcompany.com" },
    ],
    config: [{ key: "maxMRs", type: "number", label: "Max MRs" }],
  },
];
