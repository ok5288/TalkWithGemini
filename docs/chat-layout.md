# Chat layout

Open **Settings → System settings → Interface → Chat layout** to choose:

- **Document** (default): the existing full-width reading layout.
- **Conversation**: user messages appear in right-aligned bubbles and AI messages
  in left-aligned bubbles. Text stays left-aligned inside both.

The preference is saved with system settings, included in backups and settings
sync, and applies to the main chat timeline. Existing settings without a layout
continue to use Document. Reading mode, shared conversations and exports keep
their existing document presentation.

Code, tables and display formulas scroll within their own containers. Message
editing uses the bubble's available width. Switching layouts preserves the
visible message and its offset; a viewport already at the bottom stays there.

## Manual visual acceptance

Use synthetic content without private chat logs. These checks are manual review
scenarios, not evidence of an automated browser or E2E run.

| Viewport and theme                     | Content and action                                           | Expected result                                                    |
| -------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------ |
| Desktop, light and dark                | Short user text followed by a long AI reply                  | User right, AI left; readable contrast and left-aligned paragraphs |
| 320px and 390px mobile, light and dark | Long URL, fenced code, wide table and display formula        | No page-wide horizontal overflow; wide blocks scroll locally       |
| Desktop and mobile                     | Images, document attachments, tool cards and reasoning       | Cards fit the bubble; expansion updates row height without overlap |
| Desktop and mobile                     | Edit a user message and open the AI Artifact editor          | Editor and controls fit; controls wrap without clipping            |
| Long conversation                      | Scroll midway, toggle layouts twice                          | Same first visible message and offset remain in view               |
| Long conversation                      | Stay at bottom, toggle layout during streamed output         | Bottom remains anchored; text and rows do not overlap              |
| Either layout                          | Navigate to a quoted message, a branch, or pending tool call | The intended message remains reachable and focused                 |
| Conversation                           | Open reading mode, share, export Markdown/PDF/image          | Existing document presentation is retained                         |
