import { describe, expect, test } from "bun:test";
import { TuiAltScreen } from "@earendil-works/pi-tui";
import { KeybindingsManager } from "./node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import extension from "./index.ts";

function fixture(text) {
    let start;
    let editor;
    extension({ on(event, handler) { if (event === "session_start") start = handler; } });
    const tui = new TuiAltScreen({ columns: 40, rows: 24, write() {} });
    tui.requestRender = () => {};
    const identity = (text) => text;
    const theme = {
        borderColor: identity,
        selectList: Object.fromEntries(["selectedPrefix", "selectedText", "description", "scrollInfo", "noMatch"].map((key) => [key, identity])),
    };
    start({}, { mode: "tui", ui: {
        theme: { fg: (_color, text) => text },
        setStatus() {}, notify() {},
        setEditorComponent(factory) { editor = factory(tui, theme, new KeybindingsManager()); },
    } });
    editor.setText(text);
    return editor;
}

function wordMotion(lines, cursor, direction) {
    const editor = fixture(lines.join("\n"));
    editor.state.cursorLine = cursor.line;
    editor.setCursorCol(cursor.col);
    const moveCursor = editor.moveCursor.bind(editor);
    editor.moveCursor = (deltaLine, deltaCol) => {
        expect(deltaLine).toBe(0);
        expect(deltaCol).toBe(direction);
        moveCursor(deltaLine, deltaCol);
    };
    editor.handleInput(direction > 0 ? "w" : "b");
    expect(editor.getText()).toBe(lines.join("\n"));
    return editor.getCursor();
}

const move = (text, col, direction) => wordMotion(text.split("\n"), { line: 0, col }, direction);

describe("Vim word motions", () => {
    test("w visits starts of keyword and punctuation runs", () => {
        const text = "foo_bar...baz  qux";
        for (const [from, to] of [[0, 7], [3, 7], [7, 10], [10, 15], [13, 15], [15, 17], [17, 17]]) {
            expect(move(text, from, 1)).toEqual({ line: 0, col: to });
        }
    });

    test("b goes to the current or preceding word's start", () => {
        const text = "foo_bar...baz  qux";
        for (const [from, to] of [[17, 15], [15, 10], [14, 10], [10, 7], [7, 0], [3, 0], [0, 0]]) {
            expect(move(text, from, -1)).toEqual({ line: 0, col: to });
        }
    });

    test("crosses lines and indentation but stops on empty lines", () => {
        const lines = ["one", "  two", "", "three"];
        expect(wordMotion(lines, { line: 0, col: 0 }, 1)).toEqual({ line: 1, col: 2 });
        expect(wordMotion(lines, { line: 0, col: 3 }, 1)).toEqual({ line: 1, col: 2 });
        expect(wordMotion(lines, { line: 1, col: 2 }, 1)).toEqual({ line: 2, col: 0 });
        expect(wordMotion(lines, { line: 2, col: 0 }, 1)).toEqual({ line: 3, col: 0 });
        expect(wordMotion(lines, { line: 3, col: 0 }, -1)).toEqual({ line: 2, col: 0 });
        expect(wordMotion(lines, { line: 2, col: 0 }, -1)).toEqual({ line: 1, col: 2 });
        expect(wordMotion(lines, { line: 1, col: 2 }, -1)).toEqual({ line: 0, col: 0 });
    });

    test("empty prompts and whitespace stay in bounds", () => {
        for (const direction of [-1, 1]) expect(move("", 0, direction)).toEqual({ line: 0, col: 0 });
        expect(move("   ", 0, 1)).toEqual({ line: 0, col: 2 });
        expect(move("   ", 3, -1)).toEqual({ line: 0, col: 0 });
    });

    test("normal-mode bindings move without editing, including Unicode and wrapping", () => {
        const text = "cafe\u0301_界 👩‍💻!\n  next";
        const editor = fixture(text);
        editor.render(10);
        editor.handleInput("b");
        expect(editor.getCursor()).toEqual({ line: 1, col: 2 });
        editor.handleInput("b");
        expect(editor.getCursor()).toEqual({ line: 0, col: 8 });
        editor.handleInput("b");
        expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
        editor.handleInput("w");
        expect(editor.getCursor()).toEqual({ line: 0, col: 8 });
        editor.handleInput("w");
        expect(editor.getCursor()).toEqual({ line: 1, col: 2 });
        expect(editor.getText()).toBe(text);
    });

    test("insert mode types w/b; reader mode ignores them", () => {
        const editor = fixture("");
        editor.handleInput("i");
        editor.handleInput("w");
        editor.handleInput("b");
        expect(editor.getText()).toBe("wb");
        editor.handleInput("\x1b");
        editor.handleInput("\t");
        const cursor = editor.getCursor();
        editor.handleInput("w");
        editor.handleInput("b");
        expect(editor.getCursor()).toEqual(cursor);
        expect(editor.getText()).toBe("wb");
    });
});
