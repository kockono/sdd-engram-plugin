# Model Selection Plugin 🚀

Interactive SDD model selection and profile management for [opencode](https://opencode.ai).

## Features

### 1. SDD Profile Management
This plugin allows you to manage [SDD (Spec-Driven Development)](https://github.com/Gentleman-Programming/gentle-ai) profiles from [gentle-ai](https://github.com/Gentleman-Programming/gentle-ai) efficiently.

- **Create, Edit, & Delete:** Manage profiles linked to specific models for quick switching.
- **Real-time Activation:** Activate profiles instantly. Changes are applied to `opencode.json` and the active runtime in real-time without needing to restart opencode, ensuring an uninterrupted workflow.
- **Per-Agent Fallbacks:** Configure fallback models per `sdd-*` base agent (except `sdd-orchestrator`). On activation, the plugin ensures `sdd-*-fallback` agents exist and are synchronized with their base agent configuration (same config, different model).

#### Profile Format

Profiles are stored as JSON files under `~/.config/opencode/profiles`:

```json
{
  "models": {
    "sdd-init": "openai/gpt-5.3-codex",
    "sdd-spec": "anthropic/claude-sonnet-4-6"
  },
  "fallback": {
    "sdd-init": "google/gemini-3-flash-preview"
  }
}
```

- `models`: primary models for base `sdd-*` agents.
- `fallback`: optional fallback model overrides by base agent name.
- If a fallback model is not defined for a base agent, fallback will inherit the base agent model.

### 2. Engram Project Memories
Full integration with the Engram memory system.

- **List & Read:** Easily browse and read through your project's stored memories.
- **Logical Deletion:** Remove memories (logically) to prevent them from affecting your current project context.

---

## Installation

To install the plugin, add it to your `tui.json` configuration file.

### Configuration Path
If the file doesn't exist, create it at:
`~/.config/opencode/tui.json`

### Content
Add `"opencode-sdd-engram-manage"` to the `plugin` array:

```json
{
   "$schema": "https://opencode.ai/tui.json",
   "plugin": ["opencode-sdd-engram-manage"]
}
```

---

## Usage

You can open the plugin using either:

- **Shortcut:** `Alt + K`
- **Slash command:** `/sdd-model`

### Orchestrator Fallback Policy Script

This repository includes a TypeScript script to ensure the `sdd-orchestrator` prompt contains the fallback policy block required to use `sdd-*-fallback` agents when a primary sub-agent fails or returns no usable response.

- Script: `scripts/ensure-orchestrator-fallback-policy.ts`
- Supported prompt formats:
  - Inline prompt text in `opencode.json`
  - External prompt file reference via `{file:...}`

Run in check mode:

```bash
node ./scripts/ensure-orchestrator-fallback-policy.ts --check
```

Apply changes:

```bash
node ./scripts/ensure-orchestrator-fallback-policy.ts
```

Optional custom config path:

```bash
node ./scripts/ensure-orchestrator-fallback-policy.ts --config /path/to/opencode.json
```

You can also run the script through npm:

```bash
npm run orchestrator:fallback:check
npm run orchestrator:fallback:apply
```

### Example Fixtures and Smoke Validation

The repository includes realistic fixtures under `examples/`:

- `examples/opencode-inline.json` (inline orchestrator prompt)
- `examples/opencode-external.json` + `examples/sdd-orchestrator-example.md` (external prompt file)
- `examples/profiles/*.json` (profile payloads in new and legacy formats)

Run the smoke validation script:

```bash
npm run examples
```

This validates:

1. Fallback policy injection for inline prompt configs.
2. Fallback policy injection for external file prompt configs.
3. Profile fixture readability for new (`models` + `fallback`) and legacy profile formats.

---

## Technical Details

- **Name:** `opencode-sdd-engram-manage`
- **Engines:** Requires `opencode >= 1.3.13`
- **Peer Dependencies:** `@opencode-ai/plugin`, `@opentui/core`, `@opentui/solid`, `solid-js`.

Developed by [j0k3r-dev-rgl](https://github.com/j0k3r-dev-rgl).
