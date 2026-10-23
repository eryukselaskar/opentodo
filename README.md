# Todo Plus

A personal Day / Week / Month planner. English by default, Turkish available (EN/TR button in the header).

**Live demo:** https://eryukselaskar.github.io/todo-plus/

## Features

- Day, Week and Month views with weekly and monthly task pools
- Recurring routines (daily, weekly, monthly, specific weekdays) with a 30-day history
- Kanban board, Pomodoro focus timer and analytics
- Quick add with tokens: `#tag`, `!urgent`, `~45m`, `@tomorrow`, `%daily`, `14:00`
- Colored tags, reminders for timed tasks, JSON backup and automatic file backup
- Optional local AI via [Ollama](https://ollama.com) (`localhost:11434`); works without it

All data stays in your browser (localStorage). Nothing is sent to a server.

## Development

```bash
npm install
npm run dev        # dev server
npm test           # tests
npm run lint
npm run build      # production build
npm run desktop    # Electron desktop app
```

Built with Vite, React 19, TypeScript, Tailwind CSS and Zustand.
