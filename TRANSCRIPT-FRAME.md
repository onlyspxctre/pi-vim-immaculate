# Fullscreen transcript-frame feasibility probe

A rounded, fixed frame around Pi's existing fullscreen transcript is feasible
without changing Pi itself. This is an experimental adapter tested against
**Pi 1.4.0**, not a supported extension API.

## Try it

Run `/reload` in Pi. `config.transcriptFrame` in `index.ts` enables the prototype.
Set it to `false` and reload to remove it.

- The transcript keeps its original scroll view, history, follow-output behavior,
  and scrollbar. The input dock is not wrapped.
- Tab switches normal/reader modes. The transcript frame uses the current theme's
  `accent` color in reader mode and `dim` otherwise. The footer label remains for
  now so both indications can be compared.
- Half-page scrolling uses the framed transcript's actual viewport height.
- The border is hidden below four columns or eight terminal rows.
- Shutdown/reload restores the original layout; enabling the wrapper clears any
  existing mouse selection because the document's wrapping width changes.

## How invasive is it?

`transcript-frame.ts` reads the private `TuiAltScreen.layoutRoot` and changes the
first entry of the root stack's private `entries` array, keeping its public
`children` array in sync. Structural checks reject an unexpected layout without
modifying it. The wrapper itself is made from public `VStack` and `HStack`
components, with small border-rendering components.

Unlike painting characters over the final terminal screen, this lets Pi's layout
engine account for the border's inset. Scrollbars and mouse selection retain
correct document coordinates. No rendering methods or mouse handlers are patched.
The host's original root and primary scroll-view objects are preserved.

The adapter must be rechecked when upgrading Pi. Extensions that replace the
fullscreen layout may conflict. It is more involved than the cursor-only private
method workaround, but does not require replacing the transcript renderer.

## Checks

```sh
bun run typecheck
bun test
```

Headless tests cover frame geometry, scrolling/follow-end, scrollbar placement,
mouse selection without border text, narrow/wide-character rendering, resizing,
mode colors, repeated install/dispose, and restoration of the original layout.
The prototype was also loaded with the installed Pi/Jiti extension loader to
check imports and host/extension class identity.

Still needs live Ghostty/tmux testing: streaming output, expanded tool output,
images, overlays/search UI, and switching TUI modes while Pi is running. The
headless tests do not establish that all of those interactions are correct.
