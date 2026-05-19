# CLAUDE.md — handoff to Claude Code

> **Read this first.** This file is for Claude Code agents picking up work
> on skateOS. The full project memory + working rules + every decision so
> far live in `MEMORY.md` — read that next.

## What this project is
**skateOS** — operating system for skate parks. White-label product, first deployment is **2nd Nature Park** (Peekskill, NY). Single-page admin SPA + Supabase + Expo mobile. Forked from Smart Lawn NY admin on Apr 16, 2026.

Owner: Doug Brown + Jon DiCarlo (50/50). Email: info@2ntr.com.

## Read these files in order before doing anything
1. **`MEMORY.md`** — all working rules, account scope, active projects, accounts, in-progress notes. The single source of truth on Doug's working preferences.
2. **`README.md`** — project architecture overview.
3. **`RUNBOOK.md`** — auth, backups, payments, secrets, outage procedures.
4. **`AUDIT.md`** — Smart Lawn leftover strings, broken handlers, what's working vs not, status of every module.
5. **`SKATEOS_VS_SQUARE.md`** — feature scope, what we build vs skip, post-MVP priority list.
6. **`SMARTLAWN_PATTERNS.md`** — what's borrowable from the parent Smart Lawn codebase at `/Volumes/LaCie/Lawn/Claude-smartlawnny.com/`.
7. **`ORGANIZATION.md`** (in `~/Desktop/Skate/`) — file organization status, pending Phase 2 restructure.

## Working rules (the ones Doug enforces hardest)
- **Do, don't ask.** Anytime Claude can do it itself, do it. Reserve questions for things only Doug can do (logins, billing, irreversible product calls).
- **Claude is the assistant, NOT the boss.** Doug sets direction; Claude executes.
- **Never be idle.** Either doing work or asking exactly one focused question.
- **Always show real artifacts each turn**, not announcements of artifacts.
- **Background mode:** when nothing's been asked for, keep going on the next-priority TODO.
- **End with a "what's next" list** when paused for input.
- **Branch Manager / Smart Lawn = reference-only.** Read patterns, write skate-shaped equivalents in this repo. Never `import`, never copy whole files.


> **Session history offloaded.** Every session log from 2026-04-29 onward (Brivo, Vision Box, Cloudflare migration, the full ✅ completed list, and the priority-ordered in-flight TODOs) lives in `CLAUDE-skateos-history.md`. Read that when you need to know *what shipped* or *what is queued*. This file is the orientation surface only.

## How to launch
```
cd ~/Desktop/Skate/SKATE-TO-MIGRATE/Claude-2ntr-skatepark
claude
```
Or in VS Code: open this folder, then `Cmd+Esc` to start the Claude Code panel.

First instruction to give Claude Code: **"Read CLAUDE.md, MEMORY.md, AUDIT.md, SKATEOS_VS_SQUARE.md, and SMARTLAWN_PATTERNS.md, then tell me what you understand about the project."** That'll load full context in one shot.

## Key environment
- **Supabase project URL:** `https://zecurmlenxyxanqucrga.supabase.co`
- **Supabase project ref:** `zecurmlenxyxanqucrga`
- **DB password:** in 1Password as "skateos-2ntr DB password"
- **Supabase PAT:** in user's `~/.zprofile` as `SUPABASE_ACCESS_TOKEN`
- **Owner login:** `info@2ntr.com` (password in 1Password)
- **Smart Lawn parent codebase (reference):** `/Volumes/LaCie/Lawn/Claude-smartlawnny.com/`
- **Branch Manager codebase (reference):** `/Volumes/LaCie/Tree/Claude-branch-manager/` (LaCie often unmounted)
- **Branch Manager curated snapshot:** `_bm-reference/` in this project (71 files, 1.2 MB, taken 2026-04-29). Read this when LaCie isn't mounted. **Reference only — never import, never copy whole files into shipping code.** See `_bm-reference/README.md` for tier-rated index.

## Sister projects (separate codebases, don't touch from here)
- **Murray** (`well-i-got-that-pwa`) — Claude character consult PWA, blocked on `vercel login`.
- **PopCut** (`~/Desktop/popcut/`) — skateboarding video editor v0.

_Generated for Claude Code handoff: 2026-04-29 by Cowork session_
