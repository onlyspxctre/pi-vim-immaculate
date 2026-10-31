import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey, TuiAltScreen } from "@earendil-works/pi-tui";

// Configure Vim reading mode here. These are extension bindings, not global
// Pi keybindings: they only apply while this editor is in normal mode.
const config = {
  initialMode: "normal" as "insert" | "normal",
  enterNormal: "escape",
  enterInsert: "i",
  lineUp: "k",
  lineDown: "j",
  halfPageUp: "ctrl+u",
  halfPageDown: "ctrl+d",
  bottom: "shift+g",
  topSequence: "gg",
  sequenceTimeoutMs: 750,
  linesPerStep: 1,
} as const;

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      // Regular-mode scrollback belongs to the terminal, not Pi.
      if (!(tui instanceof TuiAltScreen)) {
        ctx.ui.setStatus("vim-mode", "Vim reading requires fullscreen mode");
        return new CustomEditor(tui, theme, keybindings);
      }
      const viewport = tui;
      let mode = config.initialMode;
      let pending = "";
      let pendingAt = 0;
      const showMode = () => {
        ctx.ui.setStatus("vim-mode", mode === "insert" ? "INSERT" : `NORMAL ${pending}`.trim());
        tui.requestRender();
      };
      showMode();

      return new class extends CustomEditor {
        handleInput(data: string): void {
          // Leave dialogs and overlays in control of their own input.
          if (mode === "insert") {
            if (matchesKey(data, config.enterNormal)) {
              mode = "normal";
              pending = "";
              showMode();
              return;
            }
            super.handleInput(data);
            return;
          }

          if (matchesKey(data, config.enterInsert)) {
            mode = "insert";
            pending = "";
            showMode();
            return;
          }

          // A second Escape retains Pi's normal abort/cancel behavior.
          if (matchesKey(data, config.enterNormal)) {
            pending = "";
            showMode();
            super.handleInput(data);
            return;
          }

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
          // Unbound printable characters do not edit the prompt in normal mode.
          showMode();
        }

        private halfPageLines(): number {
          // Approximate the transcript height by excluding the input editor.
          const editorHeight = this.render(tui.terminal.columns).length;
          return Math.max(1, Math.floor((tui.terminal.rows - editorHeight) / 2));
        }
      }(tui, theme, keybindings);
    });
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.mode === "tui") ctx.ui.setStatus("vim-mode", undefined);
  });
}
