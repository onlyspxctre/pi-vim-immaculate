import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";

export class RoundedEditor extends CustomEditor {
    roundedFrame = true;
    frameColor?: (text: string) => string;
    private frameInset = 0;

    render(width: number): string[] {
        // Keep at least two layout columns for wide graphemes after padding.
        const minimumWidth = Math.max(5, this.getPaddingX() * 2 + 4);
        this.frameInset = this.roundedFrame && width >= minimumWidth ? 1 : 0;
        if (!this.frameInset) return super.render(width);

        const color = this.frameColor ?? this.borderColor;
        const originalColor = this.borderColor;
        let lines: string[];
        try {
            // Let Pi handle wrapping, padding, scroll indicators, and cursor
            // markers at the actual inner width. Only decorate the result.
            this.borderColor = color;
            lines = super.render(width - 2);
        } finally {
            this.borderColor = originalColor;
        }

        // Pi 1.4.0 exposes no public boundary between editor and autocomplete
        // rows. Read just this geometry field so the menu stays below the box.
        const bodyRows = (this as unknown as { renderedVisibleLineCount: number }).renderedVisibleLineCount;
        if (!Number.isInteger(bodyRows) || bodyRows < 1 || bodyRows + 1 >= lines.length) {
            this.frameInset = 0;
            return super.render(width);
        }
        const bottom = bodyRows + 1;
        return lines.map((line, row) => {
            if (row === 0) return color("╭") + line + color("╮");
            if (row === bottom) return color("╰") + line + color("╯");
            if (row < bottom) return color("│") + line + color("│");
            // Autocomplete is outside the editor frame, aligned with its text.
            return " " + line + " ";
        });
    }

    handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
        if (!this.frameInset) return super.handleMouse(event);
        if (event.x < 1 || event.x >= event.width - 1) {
            return event.type === "click" && event.button === "left"
                ? { handled: true, focus: true }
                : undefined;
        }
        return super.handleMouse({ ...event, x: event.x - 1, width: event.width - 2 });
    }
}
