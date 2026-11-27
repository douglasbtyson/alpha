# Working on troonooz

## How the owner likes replies

- End every reply that involves setup or next steps with a **to-do checklist** for the owner: what's done (✅), what they should do next (☐, in order, with the exact command or setting), and optional items for later. List only things the owner does themselves, not work Claude does.
- The owner is not a developer and works from an iPhone and a Windows PC. Explain in plain language and give exact clicks or commands.

## The owner's setup

- troonooz runs on their Windows PC (PowerShell). PowerShell blocks `npm`/`npx` scripts there, so always write commands as `npm.cmd` and `npx.cmd`.
- The iPhone reaches the PC through Tailscale; the Back Tap Shortcut posts screenshots to `/api/scan`.
- The PC copy can update itself from GitHub (`scripts/windows/update.cmd`, after a one-time `switch-to-git.cmd`).
- The iPhone app is in `mobile/` (Expo). It is built in Expo's cloud, so no Mac is needed; see `mobile/README.md`.
