# Layout Components

Layout components define app navigation, workspace structure, and global shell behavior.

## Files

- `Sidebar.tsx` renders session navigation, workspace navigation, pinned sessions, and primary app actions. Each session list shows the ten most recently updated chats initially and loads up to ten more per click. The load-more count shows the total number of remaining hidden chats. Older chats remain in the recent list without automatic archive grouping; temporary chats stay excluded from history.
- `WorkspaceSettingsModal.tsx` manages workspace metadata, preset files, workspace-level settings, active plugin presets, and active skill presets.

## Guidelines

- Keep layout state separate from chat-domain mutations when possible.
- Preserve keyboard and focus behavior in navigation and modal flows.
- Keep workspace file logic aligned with `src/lib/utils/workspaceFiles.ts`.
- Normalize workspace skill presets against the installed skill list before saving.
