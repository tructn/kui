import { autocompletion, type Completion as CmCompletion, completionStatus, startCompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { type Diagnostic, linter } from "@codemirror/lint";
import { Annotation, EditorState, Prec, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, placeholder, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

import { messagesApi } from "../api";
import type { FieldCatalog } from "../query/catalog";
import { complete, type SuggestionKind } from "../query/completion";
import { FUNCTIONS, isKeyword, ROOTS, tokenize } from "../query/lexer";
import type { QueryProblem } from "../types";

interface QueryEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Enter, when no suggestion is open. Gets the text as it is now (`onChange` lags behind typing). */
  onSubmit: (text: string) => void;
  /** Fields learned from sampled messages; called when suggestions are needed. */
  getCatalog: () => FieldCatalog;
  /** The parser's verdict on the current text (null = valid or empty). */
  onProblem: (problem: QueryProblem | null) => void;
  /** First focus: a chance to load a bigger sample for suggestions. */
  onFocus?: () => void;
  disabled?: boolean;
  className?: string;
}

/**
 * One-line CodeMirror editor for the message filter: highlighting, suggestions
 * from `query/completion.ts`, and errors underlined by the Rust parser.
 */
export function QueryEditor({ value, onChange, onSubmit, getCatalog, onProblem, onFocus, disabled, className }: QueryEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Extensions are built once; they read the latest props through this ref.
  const props = useRef({ onChange, onSubmit, getCatalog, onProblem, onFocus });
  props.current = { onChange, onSubmit, getCatalog, onProblem, onFocus };
  // Typing reports to the parent at most every CHANGE_DELAY_MS; Enter and blur report right away.
  const pendingChange = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The last text sent through `onChange`. When `value` comes back equal to it, that's our own
  // echo, even if more was typed meanwhile, and the editor must keep the newer text.
  const reported = useRef(value);

  useEffect(() => {
    const cancelChange = () => {
      if (pendingChange.current !== null) clearTimeout(pendingChange.current);
      pendingChange.current = null;
    };
    const flushChange = (v: EditorView) => {
      if (pendingChange.current === null) return;
      cancelChange();
      reported.current = v.state.doc.toString();
      props.current.onChange(reported.current);
    };
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          singleLine,
          history(),
          Prec.high(
            keymap.of([
              {
                key: "Enter",
                run: (v) => {
                  if (completionStatus(v.state) === "active") return false;
                  flushChange(v);
                  props.current.onSubmit(v.state.doc.toString());
                  return true;
                },
              },
            ]),
          ),
          // Suggestions open only when asked: Ctrl+Space everywhere (CodeMirror's default keymap),
          // plus Cmd+L on macOS, where Cmd+Space belongs to Spotlight. Highest precedence, because
          // the default keymap binds Mod-l to "select line".
          Prec.highest(keymap.of([{ mac: "Mod-l", run: startCompletion, preventDefault: true }])),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          placeholder("Filter, e.g. value.status = 'shipped' AND headers.x-source IN ('web', 'ios')"),
          highlighting,
          autocompletion({
            override: [(ctx) => {
              const { from, to, items } = complete(ctx.state.doc.toString(), ctx.pos, props.current.getCatalog());
              if (items.length === 0) return null;
              return {
                from,
                to,
                // Ranking already happened in `complete`, which knows the field types.
                filter: false,
                options: items.map((item, i): CmCompletion => ({
                  label: item.label,
                  detail: item.detail,
                  type: COMPLETION_TYPE[item.kind],
                  boost: -i,
                  apply: (v, _c, applyFrom, applyTo) => {
                    const caret = applyFrom + (item.caret ?? item.insert.length);
                    v.dispatch({ changes: { from: applyFrom, to: applyTo, insert: item.insert }, selection: { anchor: caret } });
                    if (item.retrigger) queueMicrotask(() => startCompletion(v));
                  },
                })),
              };
            }],
            icons: false,
            activateOnTyping: true,
            // Wait for a pause in typing before asking for suggestions (CodeMirror's debounce).
            activateOnTypingDelay: SUGGEST_DELAY_MS,
            maxRenderedOptions: 60,
          }),
          linter(
            async (v): Promise<Diagnostic[]> => {
              const text = v.state.doc.toString();
              if (!text.trim()) {
                props.current.onProblem(null);
                return [];
              }
              const problem = await messagesApi.checkQuery(text).catch(() => null);
              // The text may have changed while the check ran.
              if (v.state.doc.toString() !== text) return [];
              props.current.onProblem(problem);
              if (!problem) return [];
              const length = v.state.doc.length;
              const from = Math.min(problem.start, length);
              // Underline at least one character, even at the end of the text.
              const to = Math.min(Math.max(problem.end, from + 1), length);
              return [{ from: Math.max(0, Math.min(from, to - 1)), to, severity: "error", message: problem.message }];
            },
            { delay: CHECK_DELAY_MS },
          ),
          EditorView.updateListener.of((update) => {
            // Text set from outside (`value`) is already known to the parent.
            const external = update.transactions.some((tr) => tr.annotation(fromProps));
            if (update.docChanged && !external) {
              cancelChange();
              const v = update.view;
              pendingChange.current = setTimeout(() => flushChange(v), CHANGE_DELAY_MS);
            }
            if (update.focusChanged) {
              // Focus only prepares suggestions (loads a sample); it doesn't open them.
              if (update.view.hasFocus) props.current.onFocus?.();
              else flushChange(update.view);
            }
          }),
          EditorView.contentAttributes.of({ "aria-label": "Message filter", spellcheck: "false", autocapitalize: "off" }),
          theme,
        ],
      }),
    });
    view.current = editor;
    return () => {
      cancelChange();
      editor.destroy();
    };
    // Created once; `value` is synced below.
  }, []);

  // Outside changes (Clear, an example) replace the text, and drop any typing not yet reported.
  useEffect(() => {
    const editor = view.current;
    if (!editor || value === reported.current) return;
    reported.current = value;
    if (editor.state.doc.toString() !== value) {
      if (pendingChange.current !== null) clearTimeout(pendingChange.current);
      pendingChange.current = null;
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: value },
        selection: { anchor: value.length },
        annotations: fromProps.of(true),
      });
    }
  }, [value]);

  useEffect(() => {
    view.current?.contentDOM.setAttribute("contenteditable", disabled ? "false" : "true");
  }, [disabled]);

  return <div ref={host} className={cn("min-w-0 flex-1", disabled && "opacity-50", className)} />;
}

/** Pause in typing before suggestions are computed. */
const SUGGEST_DELAY_MS = 120;
/** Pause in typing before the text is reported to the parent (re-renders the query bar). */
const CHANGE_DELAY_MS = 150;
/** Pause in typing before the Rust parser checks the text. */
const CHECK_DELAY_MS = 250;

/** Marks a transaction that applies the `value` prop, so it isn't echoed back through `onChange`. */
const fromProps = Annotation.define<boolean>();

const COMPLETION_TYPE: Record<SuggestionKind, string> = {
  field: "property",
  function: "function",
  operator: "operator",
  keyword: "keyword",
  value: "text",
};

/** Keeps the filter on one line: pasted newlines become spaces. */
const singleLine = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.newDoc.lines === 1) return tr;
  const text = tr.newDoc.toString().replace(/\s*\n\s*/g, " ");
  return [tr.startState.update({ changes: { from: 0, to: tr.startState.doc.length, insert: text }, selection: { anchor: Math.min(tr.newSelection.main.head, text.length) } })];
});

const mark = (className: string) => Decoration.mark({ class: className });
const MARKS = {
  keyword: mark("font-semibold text-violet-600 dark:text-violet-400"),
  root: mark("text-sky-700 dark:text-sky-400"),
  function: mark("text-blue-600 dark:text-blue-400"),
  string: mark("text-emerald-700 dark:text-emerald-400"),
  number: mark("text-amber-700 dark:text-amber-400"),
  punct: mark("text-muted-foreground"),
};

function decorate(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const tokens = tokenize(view.state.doc.toString());
  tokens.forEach((t, i) => {
    const previous = tokens[i - 1];
    let m: Decoration | undefined;
    // After a dot it's a field name, even if it reads like a keyword.
    if (previous?.kind === "dot") m = undefined;
    else if (isKeyword(t)) m = MARKS.keyword;
    else if (t.kind === "ident" && (ROOTS as readonly string[]).includes(t.text.toLowerCase())) m = MARKS.root;
    else if (t.kind === "ident" && tokens[i + 1]?.kind === "lparen" && (FUNCTIONS as readonly string[]).includes(t.text.toLowerCase())) {
      m = MARKS.function;
    } else if (t.kind === "string") m = MARKS.string;
    else if (t.kind === "number") m = MARKS.number;
    else if (t.kind === "op" || t.kind === "lparen" || t.kind === "rparen" || t.kind === "comma") m = MARKS.punct;
    if (m && t.end > t.start) ranges.push(m.range(t.start, t.end));
  });
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

/** Blends the editor into the surrounding input group and themes the popups. */
const theme = EditorView.theme({
  "&": { fontSize: "13px", backgroundColor: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.5", overflowX: "auto", scrollbarWidth: "none" },
  ".cm-content": { padding: "5px 0", caretColor: "var(--foreground)" },
  ".cm-line": { padding: "0 8px" },
  ".cm-placeholder": { color: "var(--muted-foreground)" },
  ".cm-tooltip": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    overflow: "hidden",
    boxShadow: "0 8px 24px rgb(0 0 0 / 0.12)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-mono)", fontSize: "12.5px", maxHeight: "18rem", minWidth: "22rem" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "3px 10px", display: "flex", gap: "16px" },
  ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "var(--accent)", color: "var(--accent-foreground)" },
  ".cm-completionLabel": { flex: "1" },
  ".cm-completionDetail": { fontStyle: "normal", color: "var(--muted-foreground)", marginLeft: "auto", fontFamily: "var(--font-sans)", fontSize: "11.5px" },
  ".cm-completionMatchedText": { textDecoration: "none", fontWeight: "600" },
  ".cm-diagnostic": { padding: "4px 10px", fontSize: "12px" },
  ".cm-diagnostic-error": { borderLeft: "3px solid var(--destructive)" },
  ".cm-lintRange-error": {
    backgroundImage: "none",
    textDecoration: "underline wavy var(--destructive)",
    textUnderlineOffset: "3px",
  },
});
