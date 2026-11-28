import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching } from "@codemirror/language";
import { Annotation, Compartment, EditorState, type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderText,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";

import { cn } from "@/lib/utils";

import { type TemplateTokenKind, tokenizeTemplate } from "../template-tokens";

export interface TemplateEditorHandle {
  /** Replaces the selection with `text` and focuses the editor. */
  insert: (text: string) => void;
}

interface TemplateEditorProps {
  value: string;
  onChange: (value: string) => void;
  "aria-label": string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ref?: Ref<TemplateEditorHandle>;
}

/** CodeMirror for a `{{placeholder}}` template, highlighted as JSON with the placeholders marked. */
export function TemplateEditor({
  value,
  onChange,
  "aria-label": ariaLabel,
  placeholder,
  disabled = false,
  className,
  ref,
}: TemplateEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const editable = useRef(new Compartment());
  // Extensions are built once; they read the latest callback through this ref.
  const change = useRef(onChange);
  change.current = onChange;

  useImperativeHandle(ref, () => ({
    insert(text) {
      const editor = view.current;
      if (!editor) return;
      editor.dispatch(editor.state.replaceSelection(text));
      editor.focus();
    },
  }));

  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          history(),
          closeBrackets(),
          bracketMatching(),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
          highlighting,
          editable.current.of(EditorView.editable.of(!disabled)),
          placeholder ? placeholderText(placeholder) : [],
          EditorView.contentAttributes.of({ "aria-label": ariaLabel, spellcheck: "false", autocapitalize: "off" }),
          EditorView.updateListener.of((update) => {
            const external = update.transactions.some((tr) => tr.annotation(fromProps));
            if (update.docChanged && !external) change.current(update.state.doc.toString());
          }),
          theme,
        ],
      }),
    });
    view.current = editor;
    return () => editor.destroy();
    // Created once; `value` and `disabled` are synced below.
  }, []);

  // A preset or a topic structure replaced the text.
  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === value) return;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: value },
      annotations: fromProps.of(true),
    });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: editable.current.reconfigure(EditorView.editable.of(!disabled)) });
  }, [disabled]);

  return (
    <div
      ref={host}
      className={cn(
        "flex min-h-0 overflow-hidden rounded-lg border border-input transition-colors dark:bg-input/30",
        "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        disabled && "opacity-50",
        className,
      )}
    />
  );
}

/** Marks a transaction that applies the `value` prop, so it isn't echoed back through `onChange`. */
const fromProps = Annotation.define<boolean>();

/** Past this size highlighting stops; a pasted megabyte shouldn't be re-tokenized on every key. */
const MAX_HIGHLIGHT = 100_000;

const MARKS: Record<TemplateTokenKind, Decoration> = {
  placeholder: Decoration.mark({ class: "rounded-sm bg-primary/10 text-primary font-medium" }),
  key: Decoration.mark({ class: "text-json-key" }),
  string: Decoration.mark({ class: "text-json-string" }),
  number: Decoration.mark({ class: "text-json-number" }),
  literal: Decoration.mark({ class: "text-json-boolean" }),
  punct: Decoration.mark({ class: "text-json-punct" }),
};

function decorate(view: EditorView): DecorationSet {
  const text = view.state.doc.toString();
  if (text.length > MAX_HIGHLIGHT) return Decoration.none;
  const ranges: Range<Decoration>[] = tokenizeTemplate(text)
    .filter((t) => t.to > t.from)
    .map((t) => MARKS[t.kind].range(t.from, t.to));
  return Decoration.set(ranges);
}

const highlighting = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = decorate(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged) this.decorations = decorate(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const theme = EditorView.theme({
  "&": { flex: "1", minWidth: "0", fontSize: "var(--text-code)", backgroundColor: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono)", lineHeight: "1.55" },
  ".cm-content": { padding: "8px 0", caretColor: "var(--foreground)" },
  ".cm-line": { padding: "0 12px 0 8px" },
  ".cm-placeholder": { color: "var(--muted-foreground)" },
  ".cm-gutters": {
    backgroundColor: "color-mix(in oklab, var(--muted) 45%, transparent)",
    color: "var(--muted-foreground)",
    borderRight: "1px solid var(--border)",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 10px", minWidth: "28px", fontSize: "0.9em", opacity: "0.7" },
  ".cm-activeLine": { backgroundColor: "color-mix(in oklab, var(--muted) 40%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--foreground)" },
  "&.cm-focused .cm-matchingBracket": {
    backgroundColor: "color-mix(in oklab, var(--primary) 18%, transparent)",
    outline: "1px solid color-mix(in oklab, var(--primary) 40%, transparent)",
    borderRadius: "2px",
  },
  "&.cm-focused .cm-nonmatchingBracket": { backgroundColor: "color-mix(in oklab, var(--destructive) 20%, transparent)" },
});
