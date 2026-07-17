# Step-by-Step Implementation Plan - Quiet Pages (Notion Clone)

To build **Quiet Pages** efficiently and ensure high quality, we will build the application in **9 incremental milestones**. You will be able to run and test the application at the end of each step before we proceed to the next.

---

## The 9-Step Implementation Schedule

### Milestone 1: SvelteKit Project Setup & Visual Shell
*   **Goal**: Create the foundation, directory structures, and the responsive desktop/mobile layout.
*   **Tasks**:
    *   Initialize SvelteKit with Svelte 5/runes, TypeScript, and pnpm.
    *   Set up vanilla CSS variables for themes (Quiet light mode, warm dark mode).
    *   Build the main responsive container: Collapsible Sidebar + Centered Editor Canvas (max-width `720px`).
*   **Verification**: Run `npm run dev`, verify the layout is fully responsive on mobile and desktop, and test theme toggles.

### Milestone 2: SQLite & Page Persistence Layer
*   **Goal**: Connect SQLite, configure Drizzle ORM, and create page CRUD APIs.
*   **Tasks**:
    *   Configure SQLite database with WAL mode enabled.
    *   Write the Drizzle schema for `pages` (columns: `id`, `parent_id`, `position`, `title`, `icon`, `content_json`, `content_text`, `is_in_trash`, `updated_at`).
    *   Implement server-side page mutations (CRUD, nesting relationships, moving, ordering, trash/restore).
*   **Verification**: Run automated Drizzle migration scripts and unit tests verifying document tree relations (child, sibling, parent movements).

### Milestone 3: Sidebar Page Tree
*   **Goal**: Build a dynamic, interactive sidebar displaying the document hierarchy.
*   **Tasks**:
    *   Create a recursive Svelte tree component to display nested child pages with collapsible disclosure arrows.
    *   Implement CRUD UI in the sidebar: Add sibling page, Add child page, rename title, delete (move to trash bin), and page icon picker.
    *   Build a "Trash Bin" list allowing restore and permanent deletion.
*   **Verification**: Build, rename, nest, delete, and restore pages directly from the sidebar. Verify the sidebar list updates instantly.

### Milestone 4: Core Tiptap Integration & Autosave
*   **Goal**: Set up the basic text editor and establish the autosave cycle.
*   **Tasks**:
    *   Install `@tiptap/core`, `@tiptap/starter-kit`, and bind the editor container inside the Svelte editor component.
    *   Fetch page `content_json` on page selection and mount it to the editor.
    *   Implement debounced autosaving (e.g., wait 2 seconds after typing stops or save on editor focus blur) using SvelteKit server endpoints.
*   **Verification**: Type paragraphs and headings in the editor. Reload the page and verify that your text persists exactly as written.

### Milestone 5: Notion Gutter, Block Handles, and Drag-and-Drop
*   **Goal**: Replicate the Notion block selection and movement behavior.
*   **Tasks**:
    *   Install Tiptap's Drag Handle extension.
    *   Implement a Svelte component that positions the `+` and `::` drag handle inside the left gutter of the block currently under cursor hover.
    *   Implement the Block Settings popup on handle click (Duplicate, Delete, "Turn into...").
*   **Verification**: Verify the drag handle appears correctly on hover. Delete, duplicate, and drag blocks to verify they rearrange correctly in the JSON structure.

### Milestone 6: Slash Commands & Formatting Bubble Menu
*   **Goal**: Replicate the floating slash menu and context styling controls.
*   **Tasks**:
    *   Implement the Slash Command (`/`) menu using Tiptap's Suggestion framework. Make a popup that filters blocks (H1, H2, Bullet List, Code Block, etc.) and is keyboard navigable (arrows + Enter).
    *   Build the floating Bubble Menu that appears when selecting text (Bold, Italic, Code formatting, Link insertion, and Text color selection with highlight colors).
*   **Verification**: Type `/` and select items using arrow keys to transform paragraphs. Select text to apply formatting and text colors, and verify changes persist after reload.

### Milestone 7: Custom Toggles & Advanced Blocks
*   **Goal**: Build nested toggles and checklists.
*   **Tasks**:
    *   Implement a custom Tiptap Toggle node view that supports collapsible nested blocks.
    *   Configure lists, task check-lists, dividers, and basic tables.
*   **Verification**: Create a toggle block, nest a paragraph inside it, collapse it, write text, and verify nested content remains intact and hidden.

### Milestone 8: Authentication, Search, and Markdown Export
*   **Goal**: Finalize the core feature set.
*   **Tasks**:
    *   Configure single-user password protection via the `APP_PASSWORD` environment variable in SvelteKit server hooks.
    *   Integrate SQLite FTS5 for instant title and content search.
    *   Add a "Markdown Export" button to compile and download pages or the entire workspace as standard Markdown.
*   **Verification**: Test authentication flows, search by text snippet, and export a workspace to confirm it imports cleanly into Obsidian.

### Milestone 9: Docker Deployment & Backups
*   **Goal**: Package the app for production hosting.
*   **Tasks**:
    *   Write a multi-stage `Dockerfile` and `docker-compose.yml` with a persistent SQLite `/data` mount.
    *   Test manual backup execution using `sqlite3 app.db ".backup backup.db"`.
*   **Verification**: Build and deploy the Docker container on local port, access it, configure `APP_PASSWORD`, test a backup run, and perform a full data restore test.

---

## Verification Plan

### Automated Verification
*   `pnpm check` and `pnpm lint` to verify code sanity.
*   Playwright browser tests for critical flows: page creation, block editing, dragging, and markdown export.

### Manual Verification
*   We will run verification checkpoints at the end of each milestone.
