"use client";

import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CreateLink,
  ListsToggle,
  MDXEditor,
  UndoRedo,
  headingsPlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  thematicBreakPlugin,
  toolbarPlugin
} from "@mdxeditor/editor";

interface NotesMarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const notesEditorPlugins = [
  headingsPlugin(),
  quotePlugin(),
  listsPlugin(),
  thematicBreakPlugin(),
  linkPlugin(),
  linkDialogPlugin(),
  markdownShortcutPlugin(),
  toolbarPlugin({
    toolbarContents: () => (
      <>
        <UndoRedo />
        <BoldItalicUnderlineToggles />
        <ListsToggle />
        <BlockTypeSelect />
        <CreateLink />
      </>
    )
  })
];

export function NotesMarkdownEditor({ value, onChange, disabled = false }: NotesMarkdownEditorProps) {
  return (
    <div style={disabled ? { pointerEvents: "none", opacity: 0.64 } : undefined}>
      <MDXEditor
        markdown={value}
        onChange={onChange}
        className="task-notes-mdx-editor"
        contentEditableClassName="task-notes-mdx-editor-content"
        plugins={notesEditorPlugins}
      />
    </div>
  );
}
