import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey, TuiAltScreen } from "@earendil-works/pi-tui";
import { installTranscriptFrame, type TranscriptFrame } from "./transcript-frame.js";
import { RoundedEditor } from "./rounded-editor.js";

// Configure Vim reading mode here. These are extension bindings, not global
// Pi keybindings: movement depends on whether the editor is in normal or reader mode.
const extensionName = "pi-vim-immaculate"
const config = {
    initialMode: "normal" as "insert" | "normal" | "reader",
    enterNormal: "escape",
    enterInsert: "i",
    toggleReader: "tab",
    cursorLeft: "h",
    cursorRight: "l",
    wordForward: "w",
    wordBackward: "b",
    lineUp: "k",
    lineDown: "j",
    halfPageUp: "ctrl+u",
    halfPageDown: "ctrl+d",
    bottom: "shift+g",
    topSequence: "gg",
    sequenceTimeoutMs: 750,
    linesPerStep: 1,
    transcriptFrame: true, // Experimental fullscreen-only rounded frame.
    inputFrame: true,
} as const;

export default function(pi: ExtensionAPI) {
    let transcriptFrame: TranscriptFrame | undefined;

    pi.on("session_start", (_event, ctx) => {
        if (ctx.mode !== "tui") return;

        ctx.ui.setEditorComponent((tui, theme, keybindings) => {
            transcriptFrame?.dispose();
            transcriptFrame = undefined;
            // Regular-mode scrollback belongs to the terminal, not Pi.
            if (!(tui instanceof TuiAltScreen)) {
                ctx.ui.setStatus(extensionName, "Vim reading requires fullscreen mode");
                return new CustomEditor(tui, theme, keybindings);
            }
            const viewport = tui;
            let mode = config.initialMode;
            let pending = "";
            let pendingAt = 0;
            if (config.transcriptFrame) {
                transcriptFrame = installTranscriptFrame(tui, (text) =>
                    ctx.ui.theme.fg(mode === "reader" ? "accent" : "dim", text));
                if (!transcriptFrame) {
                    ctx.ui.notify("Transcript frame unavailable: Pi's fullscreen layout did not match the expected structure.", "warning");
                }
            }
            const showMode = () => {
                ctx.ui.setStatus(extensionName, `${mode.toUpperCase()} ${pending}`.trim());
                tui.requestRender();
            };
            showMode();

            return new class extends RoundedEditor {
                roundedFrame = config.inputFrame;
                frameColor = (text: string) => ctx.ui.theme.fg(mode === "reader" ? "dim" : "accent", text);

                handleInput(data: string): void {
                    // Shift+Tab always retains Pi's thinking-level shortcut.
                    if (matchesKey(data, "shift+tab")) {
                        super.handleInput(data);
                        return;
                    }

                    if (mode !== "insert") {
                        if (matchesKey(data, config.toggleReader)) {
                            mode = mode === "normal" ? "reader" : "normal";
                            pending = "";
                            showMode();
                            return;
                        }
                        if (matchesKey(data, config.enterInsert)) {
                            mode = "insert";
                            pending = "";
                            showMode();
                            return;
                        }
                        if (matchesKey(data, config.enterNormal)) {
                            pending = "";
                            if (mode === "reader") {
                                mode = "normal";
                            } else {
                                // Escape in normal mode retains Pi's abort/cancel behavior.
                                super.handleInput(data);
                            }
                            showMode();
                            return;
                        }
                    }

                    switch (mode) {
                        case "insert":
                            if (matchesKey(data, config.enterNormal)) {
                                mode = "normal";
                                pending = "";
                                showMode();
                                break;
                            }
                            super.handleInput(data);
                            break;
                        case "normal":
                            if (matchesKey(data, config.cursorLeft)) {
                                this.movePromptCursor(0, -1);
                            } else if (matchesKey(data, config.cursorRight)) {
                                this.movePromptCursor(0, 1);
                            } else if (matchesKey(data, config.wordForward)) {
                                this.movePromptWord(1);
                            } else if (matchesKey(data, config.wordBackward)) {
                                this.movePromptWord(-1);
                            } else if (matchesKey(data, config.lineUp)) {
                                this.movePromptCursor(-1, 0);
                            } else if (matchesKey(data, config.lineDown)) {
                                this.movePromptCursor(1, 0);
                            } else if (data.length > 1 || data.charCodeAt(0) < 32) {
                                super.handleInput(data);
                            }
                            break;
                        case "reader": {
                            const now = Date.now();
                            if (now - pendingAt > config.sequenceTimeoutMs) pending = "";
                            const sequence = pending + data;
                            pending = "";

                            if (sequence === config.topSequence) {
                                viewport.scrollToTop();
                            } else if (config.topSequence.startsWith(sequence) && sequence.length > 0) {
                                pending = sequence;
                                pendingAt = now;
                            } else if (matchesKey(data, config.lineUp)) {
                                viewport.scrollBy(-config.linesPerStep);
                            } else if (matchesKey(data, config.lineDown)) {
                                viewport.scrollBy(config.linesPerStep);
                            } else if (matchesKey(data, config.halfPageUp)) {
                                viewport.scrollBy(-this.halfPageLines());
                            } else if (matchesKey(data, config.halfPageDown)) {
                                viewport.scrollBy(this.halfPageLines());
                            } else if (matchesKey(data, config.bottom)) {
                                viewport.scrollToBottom();
                            } else if (data.length > 1 || data.charCodeAt(0) < 32) {
                                // Preserve application controls such as Ctrl+C and Ctrl+O.
                                super.handleInput(data);
                            }
                            // Unbound printable characters do not edit the prompt in reader mode.
                            showMode();
                            break;
                        }
                    }
                }

                private movePromptCursor(deltaLine: number, deltaCol: number): void {
                    // Pi 1.4.0's arrow handlers also browse history. Its private
                    // moveCursor helper only moves/clamps the cursor, preserving
                    // wrapped-line navigation, sticky columns, and graphemes.
                    // Keep this version-sensitive access isolated until Pi exposes
                    // a public cursor-only API; recheck it when upgrading Pi.
                    const editor = this as unknown as {
                        moveCursor(deltaLine: number, deltaCol: number): void;
                    };
                    editor.moveCursor(deltaLine, deltaCol);
                    tui.requestRender();
                }

                private movePromptWord(direction: -1 | 1): void {
                    const lines = this.getLines();
                    let cursor = this.getCursor();
                    const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
                    const text = () => lines[cursor.line];
                    const char = (col = cursor.col) => graphemes.segment(text()).containing(col)?.segment ?? "";
                    const kind = (text: string) => !text || /^\s+$/u.test(text) ? "space"
                        : /^[\p{L}\p{N}_]/u.test(text) ? "word" : "punctuation";
                    const step = () => {
                        // Stop on the final grapheme, not the insertion position.
                        if (direction > 0 && cursor.line === lines.length - 1 && cursor.col + char().length >= text().length) return false;
                        this.movePromptCursor(0, direction);
                        const next = this.getCursor();
                        if (next.line === cursor.line && next.col === cursor.col) return false;
                        cursor = next;
                        return true;
                    };

                    if (direction > 0) {
                        const line = cursor.line;
                        const run = kind(char());
                        if (cursor.col < text().length || !text().length) {
                            do {
                                if (!step()) return;
                            } while (cursor.line === line && char() && kind(char()) === run);
                        }
                        while (text().length && kind(char()) === "space") {
                            if (!step()) return;
                        }
                    } else {
                        if (!step()) return;
                        while (text().length && kind(char()) === "space") {
                            if (!step()) return;
                        }
                        const run = kind(char());
                        while (cursor.col > 0 && kind(char(cursor.col - 1)) === run) {
                            if (!step()) return;
                        }
                    }
                }

                private halfPageLines(): number {
                    if (transcriptFrame && transcriptFrame.viewportHeight > 0) {
                        return Math.max(1, Math.floor(transcriptFrame.viewportHeight / 2));
                    }
                    // Approximate the transcript height by excluding the input editor.
                    const editorHeight = this.render(tui.terminal.columns).length;
                    return Math.max(1, Math.floor((tui.terminal.rows - editorHeight) / 2));
                }
            }(tui, theme, keybindings);
        });
    });

    pi.on("session_shutdown", (_event, ctx) => {
        transcriptFrame?.dispose();
        transcriptFrame = undefined;
        if (ctx.mode === "tui") ctx.ui.setStatus(extensionName, undefined);
    });
}
