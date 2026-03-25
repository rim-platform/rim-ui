# RIM UI Implementation Plan

This document defines the implementation plan for the RIM UI client.

The goal is to build one shared application for desktop, web, and mobile, while allowing desktop to
support the full runtime feature set such as plugins, richer keybind handling, and local desktop
behavior.

## Core Strategy

- Build one shared React application.
- Share product concepts across all platforms.
- Gate runtime behavior by capabilities, not scattered platform checks.
- Treat desktop as the full-featured target.
- Treat web and mobile as the same app with reduced or adapted features.

## Product Concepts To Keep Shared

These concepts should mean the same thing on every platform:

- `workspace`
- `conversation`
- `thread`
- `message`
- `command`
- `context`
- `plugin`
- `capability`

The shell and interactions may differ by platform, but the product model should stay consistent.

## Platform Model

Use a shared runtime model instead of hardcoding `isDesktop` or `isMobile` checks all over the app.

```ts
type AppPlatform = "desktop" | "web" | "mobile";

type RuntimeCapabilities = {
  multiPaneShell: boolean;
  dockedThreadPane: boolean;
  pluginHost: boolean;
  deviceLocalKeybinds: boolean;
  globalShortcuts: boolean;
  localProcess: boolean;
  filesystemAccess: boolean;
  nativeNotifications: boolean;
};
```

Use one runtime provider that exposes:

- current platform
- capability matrix
- platform services
- future host bridges such as plugin host or notifications

## Initial Capability Matrix

### Desktop

- `multiPaneShell: true`
- `dockedThreadPane: true`
- `pluginHost: true`
- `deviceLocalKeybinds: true`
- `globalShortcuts: true`
- `localProcess: true`
- `filesystemAccess: true`
- `nativeNotifications: true`

### Web

- `multiPaneShell: true`
- `dockedThreadPane: false` initially
- `pluginHost: false`
- `deviceLocalKeybinds: false`
- `globalShortcuts: false`
- `localProcess: false`
- `filesystemAccess: false`
- `nativeNotifications: limited`

### Mobile

- `multiPaneShell: false`
- `dockedThreadPane: false`
- `pluginHost: false`
- `deviceLocalKeybinds: false`
- `globalShortcuts: false`
- `localProcess: false`
- `filesystemAccess: false`
- `nativeNotifications: optional later`

For implementation, the capability type should stay boolean-only. The notes above are planning notes.

## Recommended Frontend Stack

### Core App

- `react`
- `react-dom`
- `typescript`
- `vite`
- `tauri`

### Styling And UI

- `tailwindcss`
- `postcss`
- `autoprefixer`
- `clsx`
- `tailwind-merge`
- `lucide-react`

### Routing And State

- `react-router-dom`
- `@tanstack/react-query`
- `zustand`

### GraphQL

- `graphql`
- `graphql-request`

### GraphQL Code Generation

- `@graphql-codegen/cli`
- `@graphql-codegen/typescript`
- `@graphql-codegen/typescript-operations`
- `@graphql-codegen/typescript-graphql-request`

### Validation And Runtime Safety

- `zod`

### Likely Add Soon, But Not Required On Day 1

- `@tanstack/react-virtual` for large lists
- `cmdk` for a polished command palette shell
- `graphql-ws` when subscriptions or realtime GraphQL transport become relevant

## Why This Stack

- Tailwind is fast for building a custom shell across desktop, web, and mobile.
- React Query is a strong fit for async state, cache invalidation, pagination, and loading states.
- `graphql-request` stays lightweight and works cleanly with React Query.
- GraphQL codegen lets `.graphql` files become the source of truth for typed operations.
- Zustand is small and well suited for shell-local UI state.
- Zod gives runtime validation where contracts are still evolving.

## State Ownership Rules

### Server State

Use React Query for:

- workspaces
- conversations
- messages
- threads
- command metadata from the backend
- mutation lifecycle
- pagination and invalidation

### Runtime-Local UI State

Use Zustand for:

- side rail state
- active tool panel
- thread visibility mode
- command palette open state
- focused surface
- selected message or messages
- selected text
- temporary desktop runtime state

### Local Component State

Use component state for:

- form input drafts
- hover state
- temporary local interactions that do not need app-wide coordination

## Folder Structure

Recommended target structure for `src/`:

```text
src/
  app/
    providers/
    router/
    config/
  core/
    api/
    graphql/
    query/
    runtime/
    commands/
    context/
    pagination/
    types/
    utils/
  shell/
    components/
    layouts/
    state/
  features/
    workspaces/
    conversations/
    messages/
    threads/
    composer/
    commands/
    keybinds/
    plugins/
    settings/
    activity/
  components/
    ui/
    layout/
  styles/
    globals.css
    tokens.css
  graphql/
    fragments/
    queries/
    mutations/
```

This structure can evolve, but the key boundary is:

- `core/` for shared infrastructure and product primitives
- `shell/` for app-shell layout and navigation behavior
- `features/` for product slices

## GraphQL Strategy

GraphQL is the main backend transport, so we should formalize the workflow early.

### Source Of Truth

- `.graphql` files in the repo are the source of truth for operations
- the server endpoint is the source of truth for schema generation
- generated client types should never be hand-edited

### Recommended Flow

1. write `.graphql` documents
2. run codegen against the GraphQL endpoint
3. generate TypeScript types and a typed `graphql-request` SDK
4. use the generated SDK inside React Query hooks

### Recommended Output Shape

- GraphQL documents live in `src/graphql/` or feature-local folders
- generated files live under `src/core/graphql/generated/`
- feature hooks wrap generated SDK calls instead of embedding query strings in components

### Query Layer Responsibilities

- request wrapper and auth-aware fetcher live in `src/core/graphql/`
- React Query keys live in `src/core/query/`
- feature hooks live near the feature using them

### Schema Access

Recommended plan:

- generate from the live GraphQL endpoint in local development
- optionally add a checked-in schema snapshot later if stability or CI needs it

## Routing Strategy

Use `react-router-dom` for app-level navigation.

Routing should represent durable navigation, such as:

- active workspace
- active conversation
- thread route when needed on narrow/mobile layouts
- settings and major top-level destinations

Do not route everything.

Keep ephemeral UI state out of routing when possible:

- palette open state
- selected text
- focused message
- active tooltip
- temporary search inputs

## Shell Strategy

### Desktop

- persistent side rail
- persistent tool panel
- central workspace
- docked thread pane when active

### Web

- same general shell where space allows
- no desktop-only runtime surfaces
- reduced local-runtime capabilities

### Mobile

- stacked navigation model
- conversation list as its own screen or drawer
- thread shown as route, sheet, or overlay instead of a docked pane
- side rail behavior adapts to tabs or a drawer

## Feature Availability Strategy

Each feature should be classified as:

- shared everywhere
- shared but adapted
- desktop-only

### Shared Everywhere

- workspace selection
- conversation list
- message timeline
- thread model
- composer
- basic command metadata display

### Shared But Adapted

- command palette
- thread presentation
- panel behavior
- notifications UX

### Desktop-Only

- plugin host
- device-local keybind runtime
- dangerous local commands
- local filesystem and process surfaces

## Feature Module Priorities

### Messaging Core

Build first and keep shared:

- workspace switching
- conversation browsing
- message timeline
- composer
- thread experience
- cursor pagination support

### Command Substrate

Build as shared infrastructure, even before all command execution is implemented:

- command descriptor model
- command palette shell
- typed runtime context collector
- trust and source badges
- capability-aware availability display

### Plugin Support

Treat as a desktop runtime subsystem:

- shared plugin UI contracts
- desktop-only runtime bridge
- capability prompts
- plugin panel registration and display

### Keybind Support

Split into:

- shared keybind metadata and settings UI
- desktop-only keypress runtime and device-local precedence layer

## Phased Delivery Plan

## Phase 0 - Architecture And Tooling Decisions

Goals:

- lock the stack
- lock the platform strategy
- lock app boundaries
- document codegen workflow

Tasks:

- confirm libraries and architecture plan
- define capability matrix
- define folder structure
- define routing boundaries
- define state ownership rules
- define GraphQL codegen workflow

Exit criteria:

- implementation plan approved
- stack approved
- shell and runtime architecture approved

## Phase 1 - Project Setup And Tooling

Goals:

- prepare the repo for real app development

Tasks:

- add Tailwind setup
- add router and app providers
- add React Query provider
- add Zustand store scaffolding
- add GraphQL request client scaffolding
- add codegen config and initial scripts
- define environment/config access for GraphQL endpoint

Exit criteria:

- app boots with providers and base styling
- codegen can run successfully
- shared runtime provider exists

## Phase 2 - Shared Shell Foundation

Goals:

- replace the starter UI with the real shell skeleton

Tasks:

- implement side rail
- implement tool panel container
- implement main workspace container
- implement thread surface abstraction
- implement narrow/mobile-aware shell switching
- define design tokens and shell primitives

Exit criteria:

- desktop shell renders
- shell adapts to narrow layout
- no starter template UI remains

## Phase 3 - GraphQL Data Layer

Goals:

- establish the real data-access pattern

Tasks:

- create first `.graphql` documents
- generate typed SDK and operation types
- define query key conventions
- create authenticated request wrapper
- create feature hooks for first backend reads
- define cursor pagination helper patterns

Exit criteria:

- typed GraphQL operations work end to end
- feature hooks use generated SDK
- pagination support has a clear pattern

## Phase 4 - Messaging Core

Goals:

- deliver the first useful product slice

Tasks:

- implement workspace selection flows
- implement conversation list
- implement message timeline shell
- implement composer shell
- implement thread UI with docked and narrow modes
- add loading, error, and empty states

Exit criteria:

- users can navigate workspaces and conversations
- timeline and thread flows exist in UI
- shell feels like a chat workspace, not a starter app

## Phase 5 - Command And Context Foundation

Goals:

- establish the workflow substrate in the client

Tasks:

- define command descriptor types
- implement command palette shell
- implement typed runtime context model
- show command trust/source badges
- implement command availability rules in the UI

Exit criteria:

- command palette exists
- command UI understands context and trust/source
- shared command model is in place for later keybinds and plugins

## Phase 6 - Capability Gating And Cross-Platform Behavior

Goals:

- make the shared app platform-aware in a clean way

Tasks:

- implement feature gating helpers
- define unsupported-feature UX
- finalize desktop/web/mobile shell differences
- verify thread and panel behavior across layouts

Exit criteria:

- unsupported features fail clearly
- mobile and web use the same app model with reduced capability
- platform logic remains centralized

## Phase 7 - Desktop Runtime Features

Goals:

- add the main desktop differentiators

Tasks:

- implement device-local keybind runtime substrate
- add plugin panel slots and registration surfaces
- add plugin install/enable/disable UI shell
- add capability prompts and trust UI
- add dangerous-action confirmation patterns

Exit criteria:

- desktop-only features are integrated behind runtime interfaces
- plugin and keybind surfaces fit the shared command model
- trust and capability UX is visible

## Phase 8 - Hardening And Performance

Goals:

- make the app stable and scalable

Tasks:

- add linting and formatter tooling
- add targeted tests for shared logic
- add virtualization for heavy lists
- improve error boundaries and loading UX
- review bundle size and route splitting

Exit criteria:

- core flows are stable
- large lists are prepared for scale
- tooling supports ongoing work safely

## Suggested Dependency Adoption Order

Add first:

- `react-router-dom`
- `@tanstack/react-query`
- `zustand`
- `graphql`
- `graphql-request`
- `zod`
- `tailwindcss`
- `postcss`
- `autoprefixer`
- `clsx`
- `tailwind-merge`
- `lucide-react`
- GraphQL codegen packages

Add later when needed:

- `@tanstack/react-virtual`
- `cmdk`
- `graphql-ws`

## What To Avoid Early

- heavy UI kits such as MUI or Ant
- Apollo unless the product proves it necessary later
- Redux unless app state complexity outgrows the current plan
- plugin-specific runtime dependencies before the shell and contracts are ready
- platform-specific forks of the app structure

## Initial Engineering Rules

- Build shared product concepts first.
- Keep runtime-local state separate from server state.
- Use capability checks instead of scattered platform checks.
- Keep GraphQL queries in `.graphql` files.
- Use generated types and SDKs instead of hand-written GraphQL request shapes.
- Keep desktop-only features behind runtime interfaces.
- Do not let mobile or web become separate products.

## Immediate Next Steps

Recommended next execution sequence:

1. install and configure the chosen stack
2. set up Tailwind and provider scaffolding
3. add runtime capability provider
4. add GraphQL client and codegen config
5. replace starter `App.tsx` with the shell skeleton
6. start Phase 2 shell implementation
