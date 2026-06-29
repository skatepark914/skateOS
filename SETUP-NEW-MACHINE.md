# skateOS — SETUP prompt for the new machine (park MacBook Air)

Two prompts exist, don't mix them up:
- **SETUP prompt (below)** — run ONCE on the new Mac to migrate everything over.
- **Continue prompt** (in `MIGRATION-HANDOFF.md`) — run AFTER setup, to resume the Brivo work.

---

## Prerequisites (do these by hand first — Claude can't bootstrap itself)
1. **Plug LaCie into the new Mac** (holds secrets + Jarvis bundle).
2. **Install Claude Code** if it's not already there — open Terminal and run:
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   brew install node git
   npm install -g @anthropic-ai/claude-code
   ```
3. Run `claude` in Terminal, then paste the SETUP PROMPT below.

---

## THE SETUP PROMPT (paste into Claude on the new Mac)

> I'm setting up a brand-new Mac (MacBook Air at the skate park) to take over the skateOS
> project from my old failing Mac. Drive the whole migration for me — run what you can in
> the terminal and tell me the manual steps. Speak progress aloud with `say -r 180`.
>
> Do these in order, verifying each:
>
> 1. **Tools:** ensure `brew`, `node`, `git`, `supabase` CLI, and `claude` are installed
>    (`brew install supabase/tap/supabase` if missing).
> 2. **skateOS code:** clone to the canonical path so session-resume works —
>    `mkdir -p ~/Desktop/Skate/SKATE-TO-MIGRATE && cd ~/Desktop/Skate/SKATE-TO-MIGRATE && git clone https://github.com/skatepark914/skateOS.git Claude-2ntr-skatepark`,
>    then `cd Claude-2ntr-skatepark && git checkout draft`.
> 3. **PopCut code:** `cd ~/Desktop && git clone https://github.com/skatepark914/popcut.git`.
> 4. **Secrets:** `cp /Volumes/LaCie/MIGRATION-MINI/dot-zprofile.txt ~/.zprofile && source ~/.zprofile`.
>    Confirm `echo $SUPABASE_ACCESS_TOKEN` is non-empty.
> 5. **Claude sessions + memory:** `cd ~ && git clone https://github.com/skatepark914/claude-sessions.git`,
>    then follow its README to gunzip the sessions into
>    `~/.claude/projects/-Users-<ME>-Desktop-Skate-SKATE-TO-MIGRATE-Claude-2ntr-skatepark/`
>    and copy the `memory/` folder in. (Adjust `<ME>` to this Mac's username.)
> 6. **Jarvis voice assistant (optional):** `mkdir -p ~/jarvis && cp -R /Volumes/LaCie/MIGRATION-MINI/jarvis/* ~/jarvis/`,
>    `chmod +x ~/jarvis/*.sh ~/jarvis/*.command`, `pip3 install openwakeword numpy sounddevice requests`.
>    Then tell me to: enable **System Settings → Privacy & Security → Microphone → Terminal**,
>    and add `~/jarvis/Jarvis.command` as a **Login Item** (System Settings → General → Login Items).
> 7. **MCP connectors:** my connectors (skateOS, Gmail, Calendar, Drive, etc.) need re-adding
>    on this machine — tell me which ones to reconnect and how (they re-auth per machine).
> 8. **Verify:** `claude --version`; `cd ~/Desktop/Skate/SKATE-TO-MIGRATE/Claude-2ntr-skatepark && git log --oneline -3`;
>    confirm sessions appear with `claude --resume`.
>
> Working rules to follow from now on: speak recaps with `say -r 180`; never send outbound
> (draft and stop for my approval); ask one question at a time; this project stays separate
> from my other projects (Branch Manager / Smart Lawn are reference-only).
>
> When done, give me the recap + the "continue prompt" from MIGRATION-HANDOFF.md so I can
> start finishing the Brivo door lock.

---

## About "the speech thing"
Two different things:
- **Spoken recaps** (what Claude's been doing this session) = the built-in macOS `say` command
  (`say -r 180 "..."`). **Nothing to install** — every Mac has it. To keep it, the setup
  prompt above tells the new Claude to use it. That's all.
- **Jarvis** = the separate "Hey Jarvis" wake-word voice assistant in `~/jarvis` (openWakeWord +
  ElevenLabs STT/TTS + a Haiku brain). That one DOES need setup — step 6 above. Optional.

## Anything else to bring over
- **Connectors/MCP** (skateOS data tools, Gmail, Calendar) — re-auth per machine (step 7).
- **Helper scripts** I made on the old Mac (`~/backup-video.sh`, `~/backup-new-videos.sh`) —
  minor; recreate only if you still need drive backups.
- **Cleanup reminder:** once the new Mac works, delete `MIGRATION-MINI` from LaCie + both Macs
  (it holds live API keys).
