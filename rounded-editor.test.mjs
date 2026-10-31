import { describe, expect, test } from "bun:test";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, TuiAltScreen, visibleWidth, stripTerminalSequences } from "@earendil-works/pi-tui";
import { KeybindingsManager } from "./node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import { RoundedEditor } from "./rounded-editor.ts";

function fixture() {
    const tui = new TuiAltScreen({ columns: 40, rows: 24, write() {} });
    tui.requestRender = () => {};
    const identity = (text) => text;
    const editor = new RoundedEditor(tui, {
        borderColor: identity,
        selectList: Object.fromEntries(["selectedPrefix", "selectedText", "description", "scrollInfo", "noMatch"].map((key) => [key, identity])),
    }, new KeybindingsManager());
    editor.focused = true;
    return editor;
}

const plain = (lines) => lines.map(stripTerminalSequences);

describe("rounded prompt editor", () => {
    test("rounds borders and adds sides without moving text/cursor into them", () => {
        const editor = fixture();
        editor.setText("abc");
        const lines = editor.render(12);
        const text = plain(lines);
        expect(text[0]).toBe("╭──────────╮");
        expect(text[1].startsWith("│abc")).toBe(true);
        expect(text[1].endsWith("│")).toBe(true);
        expect(text[2]).toBe("╰──────────╯");
        expect(visibleWidth(lines[1].split(CURSOR_MARKER)[0])).toBe(4);
        for (const line of lines) expect(visibleWidth(line)).toBe(12);
    });

    test("mouse clicks account for the left border", () => {
        const editor = fixture();
        editor.setText("abc");
        editor.render(12);
        const event = { type: "click", button: "left", x: 2, y: 1, width: 12, height: 3, screenX: 2, screenY: 1 };
        editor.handleMouse(event);
        expect(editor.getCursor()).toEqual({ line: 0, col: 1 });
        editor.handleMouse({ ...event, x: 0 });
        expect(editor.getCursor()).toEqual({ line: 0, col: 1 });
    });

    test("wrapping, Unicode, padding, resizing, and tiny-width fallback fit", () => {
        const editor = fixture();
        editor.setText("hello 界 😀 " + "abcdef".repeat(15));
        for (const padding of [0, 1, 2]) {
            editor.setPaddingX(padding);
            for (const width of [40, 12, 8, 6]) {
                const lines = editor.render(width);
                for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
                const framed = width >= Math.max(5, padding * 2 + 4);
                expect(plain(lines)[0].startsWith("╭")).toBe(framed);
            }
        }
        // Pi's own editor cannot wrap a two-cell grapheme in a one-cell
        // layout; use ASCII to exercise its existing ultra-narrow fallback.
        editor.setText("abcdef");
        for (const width of [4, 3, 2, 1]) {
            const lines = editor.render(width);
            expect(plain(lines)[0]).not.toContain("╭");
            expect(lines).toEqual(CustomEditor.prototype.render.call(editor, width));
        }
    });

    test("preserves overflow indicators and restores conventional rendering when disabled", () => {
        const editor = fixture();
        editor.setText(Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n"));
        expect(plain(editor.render(40))[0]).toContain("↑");
        for (let i = 0; i < 25; i++) editor.handleInput("\x1b[A");
        const lines = plain(editor.render(40));
        expect(lines.at(-1)).toContain("↓");
        expect(lines.at(-1).endsWith("╯")).toBe(true);
        editor.roundedFrame = false;
        expect(plain(editor.render(40))[0]).not.toContain("╭");
    });

    test("autocomplete stays below the box and remains mouse-selectable", async () => {
        const editor = fixture();
        editor.setAutocompleteProvider({
            getSuggestions: async () => ({ prefix: "/", items: [
                { value: "/alpha", label: "alpha" },
                { value: "/beta", label: "beta" },
            ] }),
            applyCompletion: (_lines, _line, _col, item) => ({ lines: [item.value], cursorLine: 0, cursorCol: item.value.length }),
        });
        editor.setText("/");
        editor.handleInput("\t");
        await Bun.sleep(30);
        expect(editor.isShowingAutocomplete()).toBe(true);
        const lines = plain(editor.render(30));
        expect(lines[2]).toBe("╰" + "─".repeat(28) + "╯");
        expect(lines.length).toBeGreaterThan(3);
        expect(lines[3].startsWith(" ")).toBe(true);
        expect(lines[3]).not.toContain("│");
        for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(30);
        const event = { button: "left", x: 3, y: 4, width: 30, height: lines.length, screenX: 3, screenY: 4 };
        editor.handleMouse({ ...event, type: "press" });
        editor.handleMouse({ ...event, type: "click" });
        expect(editor.getText()).toBe("/beta");
    });
});
