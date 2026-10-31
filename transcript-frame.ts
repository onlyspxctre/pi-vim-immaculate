import {
    type Component,
    Container,
    HStack,
    ScrollView,
    Spacer,
    type StackEntry,
    TuiAltScreen,
    VStack,
} from "@earendil-works/pi-tui";

export interface TranscriptFrame {
    readonly viewportHeight: number;
    dispose(): void;
}

// Pi 1.4.0's dock is pending messages, status, above-editor widgets, editor,
// below-editor widgets, footer. Wrap just the widget container's rendered view;
// Pi can continue clearing/repopulating the original container as usual.
function compactAboveEditorWidgets(root: VStack): () => void {
    const dock = root.children[1];
    if (!(dock instanceof VStack)) return () => {};
    const entry = (dock as unknown as { entries?: StackEntry[] }).entries?.[2];
    const widgets = entry?.component;
    if (!entry || !(widgets instanceof Container) || dock.children[2] !== widgets) return () => {};

    const compact = new class extends Container {
        render(width: number): string[] {
            // Skip only the host's leading Spacer, never blank lines belonging
            // to a widget. Refresh each render to survive renderWidgets rebuilds.
            this.children = widgets.children[0] instanceof Spacer
                ? widgets.children.slice(1)
                : widgets.children.slice();
            return super.render(width);
        }

        invalidate(): void {
            widgets.invalidate();
        }
    }();
    entry.component = compact;
    dock.children[2] = compact;

    return () => {
        if (entry.component === compact) entry.component = widgets;
        const index = dock.children.indexOf(compact);
        if (index !== -1) dock.children[index] = widgets;
    };
}

// Experimental Pi 1.4.0 adapter. There is no public layout-root getter or
// replace-child API preserving Stack allocation options. Keep those two private
// accesses here; the actual frame uses ordinary, layout-aware TUI components.
export function installTranscriptFrame(
    tui: TuiAltScreen,
    style: (text: string) => string,
): TranscriptFrame | undefined {
    const root = (tui as unknown as { layoutRoot?: Component }).layoutRoot;
    if (!(root instanceof VStack)) return;

    const entries = (root as unknown as { entries?: StackEntry[] }).entries;
    const entry = entries?.[0];
    if (!entry) return;
    const transcript = entry.component;
    if (!(transcript instanceof ScrollView) || !transcript.primary || root.children[0] !== transcript) return;

    // Visibility is based on terminal size, not transcript document length.
    // On very small terminals, give the cells back to the original scroll view.
    const visible = ({ width, height }: { width: number; height: number }) => width >= 4 && height >= 8;
    const edge = (left: string, right: string): Component => ({
        render: (width) => [style(left + "─".repeat(Math.max(0, width - 2)) + right)],
        invalidate() { },
    });
    const side: Component = {
        // Leaf components are clipped to their allocated height by the layout
        // engine. Drawing a screenful avoids depending on a private height hook.
        render: () => Array.from({ length: tui.terminal.rows }, () => style("│")),
        invalidate() { },
    };
    const frame = new VStack([
        { component: edge("╭", "╮"), basis: 1, shrink: 1, minSize: 0, visible },
        {
            component: new HStack([
                { component: side, basis: 1, shrink: 0, visible },
                { component: transcript, basis: 0, grow: 1, shrink: 1, minSize: 1 },
                { component: side, basis: 1, shrink: 0, visible },
            ]),
            basis: 0,
            grow: 1,
            shrink: 1,
            minSize: 0,
        },
        { component: edge("╰", "╯"), basis: 1, shrink: 1, minSize: 0, visible },
    ]);

    // Preserve the original root, ScrollView, dock, and allocation options.
    // In particular, do not recreate the scroll view: that would lose follow-end,
    // selection/search associations, and the host's scrollbar-settings reference.
    const restoreWidgetSpacing = compactAboveEditorWidgets(root);
    entry.component = frame;
    root.children[0] = frame;
    tui.resetTextSelection(); // The narrower document may wrap at different rows.
    root.invalidate();
    tui.requestRender();

    let disposed = false;
    return {
        get viewportHeight() {
            return transcript.viewportHeight;
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            restoreWidgetSpacing();
            // Do not overwrite a layout another extension has since replaced.
            if (entry.component === frame) entry.component = transcript;
            const index = root.children.indexOf(frame);
            if (index !== -1) root.children[index] = transcript;
            tui.resetTextSelection();
            root.invalidate();
            tui.requestRender();
        },
    };
}
