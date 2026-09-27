---
name: Health Plan Analytics
description: A precise, calm payment-integrity workbench for governed X12 analytics.
colors:
  rail-start: "#0D1B2A"
  rail-end: "#1A2A4A"
  rail-accent: "#4FC3F7"
  action-blue: "#1565C0"
  analytic-teal: "#00838F"
  analytic-purple: "#6A1B9A"
  ink: "#1A2035"
  muted: "#5A6474"
  canvas: "#F4F6F9"
  surface: "#FBFCFE"
  divider: "#E2E6EC"
  critical: "#C62828"
  warning: "#E65100"
  success: "#2E7D32"
typography:
  display:
    fontFamily: "Inter, Roboto, Helvetica, Arial, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 800
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Inter, Roboto, Helvetica, Arial, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "Inter, Roboto, Helvetica, Arial, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, Roboto, Helvetica, Arial, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 800
    lineHeight: 1.25
    letterSpacing: "0.08em"
  mono:
    fontFamily: "DM Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
rounded:
  sm: "8px"
  md: "12px"
  card: "16px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "20px"
  xl: "24px"
  page: "32px"
components:
  button-primary:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.surface}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "10px 15px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.action-blue}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "6px 11px"
  navigation-active:
    backgroundColor: "#1A455D"
    textColor: "{colors.surface}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "12px 16px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "20px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
---

# Design System: Health Plan Analytics

## Overview

**Creative North Star: "The Investigator's Workbench"**

This interface serves a payment-integrity analyst working through evidence on a large desktop display in a well-lit operations environment. A permanent navy rail anchors the product while a quiet, cool canvas keeps dense tables and comparisons readable for long sessions. The product must feel precise, calm, and trustworthy.

Structure is deterministic. Dashboard, SIU Workbench, and Ask Genie retain the same location, hierarchy, component vocabulary, and interaction model in every deployment. Catalogs, schemas, data, and approved labels may change through configuration; the visual system must not regenerate per run.

**Key Characteristics:**

- Fixed navy navigation with a light analytical workspace.
- Dense, familiar tables with restrained semantic color.
- Rounded controls and panels without decorative softness.
- Evidence-first language that distinguishes screening signals from findings.
- State changes are responsive, never theatrical.

**The Fixed Workbench Rule.** The application shell, navigation order, component placement, and interaction hierarchy are immutable within a template version.

## Colors

The palette pairs a dark operational rail with cool near-white work surfaces. Saturated color is reserved for actions, selection, risk, and data visualization.

### Primary

- **Action Blue** (`action-blue`): Primary actions, chart marks, and interactive text.
- **Signal Cyan** (`rail-accent`): Rail identity, focus cues, and dark-surface highlights.

### Secondary

- **Analytic Teal** (`analytic-teal`): Secondary metric categories.
- **Analytic Purple** (`analytic-purple`): Distinct analytical categories that are not status.

### Neutral

- **Midnight Rail** (`rail-start`, `rail-end`): Persistent navigation and Genie workspaces.
- **Operational Ink** (`ink`): Headings, numerical values, and primary copy.
- **Evidence Gray** (`muted`): Supporting labels, captions, and explanatory copy.
- **Cool Canvas** (`canvas`): Page and table-header background.
- **Quiet Surface** (`surface`): Cards, headers, inputs, and selected controls.
- **Structural Divider** (`divider`): Low-contrast boundaries between dense regions.

### Semantic

- **Critical Red** (`critical`): High variance and errors.
- **Review Orange** (`warning`): Medium variance and review-in-progress states.
- **Resolved Green** (`success`): Low variance, ready, and successful states.

**The Evidence Color Rule.** Critical, warning, and success colors communicate status only. They are never decorative.

**The Rare Accent Rule.** Action Blue and Signal Cyan identify selection and action; inactive surfaces stay neutral.

## Typography

**Display Font:** Inter with system sans-serif fallbacks  
**Body Font:** Inter with system sans-serif fallbacks  
**Label/Mono Font:** DM Mono with system monospace fallbacks

**Character:** Inter keeps the operational interface familiar and compact. DM Mono makes provider IDs, claim IDs, member pseudonyms, and clinical codes easy to scan without making the whole product feel technical.

### Hierarchy

- **Display** (800, 26px, 1.25): Page titles only.
- **Title** (700, 16px, 1.3): Panels, analytical sections, and provider context.
- **Body** (400, 14px, 1.5): Interface copy and data-table content. Explanatory prose stays below 75 characters per line when the layout permits.
- **Label** (800, 12px, 0.08em): Table headings, control labels, and compact metadata; uppercase only where scanning benefits.
- **Mono** (500, 12px, 1.5): Identifiers, codes, and tabular query results.

**The Identifier Rule.** Use DM Mono only for source-backed identifiers and codes. Never use it as a decorative display face.

## Elevation

The system is flat by default. Depth comes from the navy-to-navy rail transition, tonal surface changes, and low-contrast borders. A small ambient shadow is permitted only for a selected segmented control or a temporary overlay; cards at rest have no drop shadow.

### Shadow Vocabulary

- **Selected Control** (`0 1px 2px rgba(13, 27, 42, 0.08)`): The active option inside a segmented control.
- **Temporary Overlay** (`0 14px 34px rgba(13, 27, 42, 0.18)`): Tooltips and transient elevated content only.

**The Flat-by-Default Rule.** If several resting panels appear to float independently, elevation is too strong.

## Components

### Buttons

- **Shape:** Fully rounded actions (`pill`) for primary and compact secondary actions.
- **Primary:** Action Blue with Quiet Surface text and compact horizontal padding.
- **Hover / Focus:** Darken one step on hover; use a visible Signal Cyan focus ring. Movement is limited to a one-pixel lift.
- **Secondary:** Quiet Surface or transparent background, structural border, and Action Blue text.

### Chips

- **Style:** Fully rounded, compact, and text-forward.
- **State:** Critical Red, Review Orange, and Resolved Green appear with low-opacity tonal backgrounds and matching text. Color is always paired with a written state.

### Cards / Containers

- **Corner Style:** Gently rounded analytical panels (`card`).
- **Background:** Quiet Surface over Cool Canvas.
- **Shadow Strategy:** Flat at rest; use structural borders instead of shadows.
- **Border:** One-pixel Structural Divider.
- **Internal Padding:** Twenty pixels on standard panels.

### Inputs / Fields

- **Style:** Quiet Surface, one-pixel structural border, and a compact radius (`sm`).
- **Focus:** Signal Cyan ring or border shift with no layout movement.
- **Error / Disabled:** Written status plus semantic color; disabled actions retain readable contrast.

### Navigation

The desktop shell uses a 260px navy rail. Navigation items are pill-shaped with icon, label, hover, focus, and active states. The order is always Dashboard, SIU Workbench, Ask Genie. Below 760px the rail becomes a sticky horizontal product bar; below 520px the brand block collapses and navigation remains horizontally available.

### Data Tables

Headers use Label typography on Cool Canvas. Numbers align right with tabular figures; identifiers use Mono. Tables scroll horizontally before columns are removed. Loading rows use skeletons, empty states explain the missing condition, and row hover never changes meaning.

### Genie Workspace

Genie uses the same Midnight Rail surface as navigation to distinguish conversation from deterministic analytics. Suggested questions, messages, result tables, ready/thinking states, and failure text all remain inside the governed conversation panel.

## Do's and Don'ts

### Do:

- **Do** preserve the fixed navigation, page hierarchy, API contract, and responsive breakpoints for the complete template version.
- **Do** expose screening evidence, peer context, and provenance without presenting variance as confirmed fraud.
- **Do** use skeletons, instructive empty states, visible focus, semantic tables, and written status labels.
- **Do** keep raw X12, parser JSON, names, addresses, exact birth dates, and direct member identifiers outside the App.
- **Do** disable unsupported features explicitly instead of fabricating data or functionality.

### Don't:

- **Don't** introduce marketing-page decoration.
- **Don't** introduce clinical imagery.
- **Don't** introduce gratuitous AI motifs.
- **Don't** create generic card walls.
- **Don't** perform per-run visual regeneration.
- **Don't** use gradient text, decorative glass effects, colored side-stripe borders, or decorative motion.
- **Don't** change visual tokens, navigation order, layout, or interaction behavior through deployment configuration.
