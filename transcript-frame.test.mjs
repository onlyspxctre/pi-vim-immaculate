import { describe, expect, test } from "bun:test";
import {
    ScrollView, TuiAltScreen, VStack, visibleWidth, stripTerminalSequences, wrapTextWithAnsi, truncateToWidth,
} from "@earendil-works/pi-tui";
import { getLayoutBoxesAt, getScrollViewBox, getScrollbarGeometry, renderLayoutFrame } from "@earendil-works/pi-tui/dist/layout.js";
import { KeybindingsManager } from "./node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import extension from "./index.ts";
import { installTranscriptFrame } from "./transcript-frame.ts";

function fixture({ scrollbar = "hidden", lines = ["row 0", "row 1", "row 2"] } = {}) {
    const terminal = { columns: 40, rows: 12, write() {} };
    const tui = new TuiAltScreen(terminal, false, undefined, { copyOnSelect: false });
    tui.requestRender = () => {};
    const document = {
        render: (width) => lines.flatMap((line) => wrapTextWithAnsi(line, width)),
        invalidate() {},
    };
    const transcript = new ScrollView(document, { primary: true, follow: "end", scrollbar });
    const dock = { render: (width) => ["input", "footer"].map((line) => truncateToWidth(line, width, "")), invalidate() {} };
    const root = new VStack([
        { component: transcript, basis: 0, grow: 1, minSize: 1 },
        { component: dock, basis: "auto", grow: 0, minSize: 1 },
    ]);
    tui.setLayoutRoot(root);
    const render = (width = terminal.columns, height = terminal.rows) => {
        terminal.columns = width;
        terminal.rows = height;
        const frame = renderLayoutFrame(root, width, height, () => {});
        // Simulate the renderer retaining its frame for mouse hit-testing.
        tui.currentLayout = frame;
        tui.previousScreen = frame.lines;
        return frame;
    };
    return { tui, terminal, transcript, dock, root, render };
}

function plain(frame) {
    return frame.lines.map(stripTerminalSequences);
}

function assertFits(frame) {
    expect(frame.lines).toHaveLength(frame.height);
    for (const line of frame.lines) {
        expect(visibleWidth(line), `width=${frame.width} line=${JSON.stringify(line)}`).toBeLessThanOrEqual(frame.width);
    }
}

describe("fullscreen transcript frame (Pi 1.4.0 private-layout probe)", () => {
    test("fixed rounded border, original scroll view and unmodified input dock", () => {
        const f = fixture();
        const handle = installTranscriptFrame(f.tui, (text) => text);
        const frame = f.render();
        expect(handle).toBeDefined();
        expect(frame.primaryScrollView).toBe(f.transcript);
        expect(getScrollViewBox(frame, f.transcript).rect).toEqual({ x: 1, y: 1, width: 38, height: 8 });
        const lines = plain(frame);
        expect(lines[0]).toBe("╭" + "─".repeat(38) + "╮");
        expect(lines[1].startsWith("│row 0")).toBe(true);
        expect(lines[8].startsWith("│")).toBe(true);
        expect(lines[8].endsWith("│")).toBe(true);
        expect(lines[9]).toBe("╰" + "─".repeat(38) + "╯");
        expect(lines[10].trim()).toBe("input");
        expect(lines[11].trim()).toBe("footer");
        expect(handle.viewportHeight).toBe(8);
        assertFits(frame);
        handle.dispose();
    });

    test("scrolling, follow-end, and scrollbar stay inside the frame", () => {
        const lines = Array.from({ length: 80 }, (_, i) => `row ${i}`);
        const f = fixture({ lines, scrollbar: "always" });
        const handle = installTranscriptFrame(f.tui, (text) => text);
        let frame = f.render();
        expect(f.transcript.isFollowingEnd).toBe(true);
        expect(f.transcript.scrollTop).toBe(72);
        f.tui.scrollToTop();
        frame = f.render();
        expect(f.transcript.scrollTop).toBe(0);
        expect(plain(frame)[1].startsWith("│row 0")).toBe(true);
        f.tui.scrollBy(3);
        frame = f.render();
        expect(plain(frame)[1].startsWith("│row 3")).toBe(true);
        const geometry = getScrollbarGeometry(getScrollViewBox(frame, f.transcript));
        expect(geometry.column).toBe(38); // right border remains at column 39
        expect(geometry.trackTop).toBe(1);
        expect(geometry.trackHeight).toBe(8);
        expect(plain(frame)[1].at(-1)).toBe("│");
        f.tui.scrollToBottom();
        f.render();
        expect(f.transcript.isFollowingEnd).toBe(true);
        lines.push("row 80");
        f.render();
        expect(f.transcript.scrollTop).toBe(73);
        handle.dispose();
    });

    test("mouse selection maps through the inset without yanking border characters", () => {
        const f = fixture();
        const handle = installTranscriptFrame(f.tui, (text) => text);
        const frame = f.render();
        expect(getLayoutBoxesAt(frame, 1, 1).some((box) => box.component === f.transcript)).toBe(true);
        expect(getLayoutBoxesAt(frame, 0, 1).some((box) => box.component === f.transcript)).toBe(false);
        f.tui.handleSelectionMouseEvent({ button: 0, x: 1, y: 1, release: false });
        f.tui.handleSelectionMouseEvent({ button: 32, x: 5, y: 1, release: false });
        f.tui.handleSelectionMouseEvent({ button: 0, x: 5, y: 1, release: true });
        expect(f.tui.hasActiveSelection()).toBe(true);
        expect(f.tui.getActiveSelectionText()).toBe("row 0");
        f.tui.resetTextSelection();
        handle.dispose();
    });

    test("resizing and tiny terminals keep lines within bounds", () => {
        const f = fixture({ lines: ["hello 界 😀 " + "x".repeat(100)] });
        const handle = installTranscriptFrame(f.tui, (text) => text);
        for (const [width, height] of [[80, 24], [15, 10], [4, 8], [3, 8], [2, 5], [1, 3], [40, 12]]) {
            const frame = f.render(width, height);
            expect(frame.primaryScrollView).toBe(f.transcript);
            assertFits(frame);
            if (width < 4 || height < 8) expect(plain(frame).join("")).not.toContain("╭");
        }
        handle.dispose();
    });

    test("dispose is idempotent and repeated reloads do not nest frames", () => {
        const f = fixture();
        const original = plain(f.render());
        for (let i = 0; i < 3; i++) {
            const handle = installTranscriptFrame(f.tui, (text) => text);
            expect(installTranscriptFrame(f.tui, (text) => text)).toBeUndefined();
            expect(plain(f.render()).filter((line) => line.startsWith("╭"))).toHaveLength(1);
            handle.dispose();
            handle.dispose();
            expect(f.root.children[0]).toBe(f.transcript);
            expect(plain(f.render())).toEqual(original);
        }
    });

    test("unknown layout is left untouched", () => {
        const f = fixture();
        const unexpected = new VStack([f.dock]);
        f.tui.setLayoutRoot(unexpected);
        expect(installTranscriptFrame(f.tui, (text) => text)).toBeUndefined();
        expect(f.tui.layoutRoot).toBe(unexpected);
    });

    test("extension mode changes recolor border; shutdown restores the original layout", () => {
        const f = fixture();
        const handlers = {};
        extension({ on: (event, handler) => { handlers[event] = handler; } });
        const statuses = [];
        let editor;
        const ctx = {
            mode: "tui",
            ui: {
                theme: { fg: (color, text) => `\x1b[${color === "accent" ? 31 : 90}m${text}\x1b[0m` },
                setStatus: (_key, text) => statuses.push(text),
                notify: (message) => { throw new Error(message); },
                setEditorComponent: (factory) => {
                    editor = factory(f.tui, { borderColor: (text) => text, selectList: {} }, new KeybindingsManager());
                },
            },
        };
        handlers.session_start({}, ctx);
        expect(f.render().lines[0]).toContain("\x1b[90m");
        editor.handleInput("\t");
        expect(statuses.at(-1)).toBe("READER");
        expect(f.render().lines[0]).toContain("\x1b[31m");
        editor.handleInput("\t");
        expect(f.render().lines[0]).toContain("\x1b[90m");
        handlers.session_shutdown({}, ctx);
        expect(f.root.children[0]).toBe(f.transcript);
        expect(plain(f.render())[0]).not.toContain("╭");
    });
});
