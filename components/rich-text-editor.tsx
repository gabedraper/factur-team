"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Bold,
  Italic,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ImageIcon,
  Link as LinkIcon,
  Minus,
  Undo,
  Redo,
} from "lucide-react";

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /*
   * Merge fields this editor can insert, as names without the braces.
   *
   * Offered here rather than listed beside the editor, because a list you have
   * to copy the braces out of by hand is a reference, not a control -- and
   * getting them wrong is silent: {{contact}} mistyped is not a merge field,
   * it is those characters, sent to a customer.
   */
  mergeFields?: string[];
}

export default function RichTextEditor({
  value, onChange, placeholder, mergeFields,
}: RichTextEditorProps) {
  const [showImageInput, setShowImageInput] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({ inline: false, allowBase64: true }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: placeholder || "Write your lesson content here..." }),
    ],
    content: value,
    onUpdate({ editor }) {
      onChange(editor.getHTML());
    },
  });

  // Sync external value changes (e.g. on initial load)
  useEffect(() => {
    if (editor && value && editor.getHTML() !== value) {
      editor.commands.setContent(value);
    }
  }, [value, editor]);

  if (!editor) return null;

  function insertImage() {
    if (!imageUrl.trim()) return;
    editor!.chain().focus().setImage({ src: imageUrl }).run();
    setImageUrl("");
    setShowImageInput(false);
  }

  function insertLink() {
    if (!linkUrl.trim()) return;
    editor!.chain().focus().setLink({ href: linkUrl }).run();
    setLinkUrl("");
    setShowLinkInput(false);
  }

  const toolbarBtn = (active: boolean) =>
    `h-8 w-8 p-0 ${active ? "bg-accent text-accent-foreground" : ""}`;

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 p-2 border-b bg-muted/30">
        <Button variant="ghost" size="sm" className={toolbarBtn(editor.isActive("bold"))}
          onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" className={toolbarBtn(editor.isActive("italic"))}
          onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="h-4 w-4" />
        </Button>
        <div className="w-px h-5 bg-border mx-1" />
        <Button variant="ghost" size="sm" className={toolbarBtn(editor.isActive("heading", { level: 2 }))}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" className={toolbarBtn(editor.isActive("heading", { level: 3 }))}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
          <Heading3 className="h-4 w-4" />
        </Button>
        <div className="w-px h-5 bg-border mx-1" />
        <Button variant="ghost" size="sm" className={toolbarBtn(editor.isActive("bulletList"))}
          onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" className={toolbarBtn(editor.isActive("orderedList"))}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="h-4 w-4" />
        </Button>
        <div className="w-px h-5 bg-border mx-1" />
        <Button variant="ghost" size="sm" className={toolbarBtn(false)}
          onClick={() => editor.chain().focus().setHorizontalRule().run()}>
          <Minus className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" className={toolbarBtn(editor.isActive("link"))}
          onClick={() => { setShowLinkInput(!showLinkInput); setShowImageInput(false); }}>
          <LinkIcon className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" className={toolbarBtn(false)}
          onClick={() => { setShowImageInput(!showImageInput); setShowLinkInput(false); }}>
          <ImageIcon className="h-4 w-4" />
        </Button>
        <div className="w-px h-5 bg-border mx-1 ml-auto" />
        <Button variant="ghost" size="sm" className={toolbarBtn(false)}
          onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>
          <Undo className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" className={toolbarBtn(false)}
          onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>
          <Redo className="h-4 w-4" />
        </Button>

        {mergeFields && mergeFields.length > 0 && (
          <>
            <div className="w-px h-5 bg-border mx-1" />
            <select
              aria-label="Insert merge field"
              value=""
              onChange={(e) => {
                const field = e.target.value;
                if (!field) return;
                // Inserted at the cursor, then the picker resets so the same
                // field can be inserted twice in a row.
                editor.chain().focus().insertContent(`{{${field}}}`).run();
                e.target.value = "";
              }}
              className="h-8 rounded-md border bg-transparent px-2 text-xs text-muted-foreground"
            >
              <option value="">{"{ }"} Insert field</option>
              {mergeFields.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </>
        )}
      </div>

      {/* Image URL input */}
      {showImageInput && (
        <div className="flex gap-2 p-2 border-b bg-muted/20">
          <Input
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="Paste image URL (https://...)"
            className="h-8 text-sm"
            onKeyDown={(e) => e.key === "Enter" && insertImage()}
            autoFocus
          />
          <Button size="sm" className="h-8" onClick={insertImage}>Insert</Button>
          <Button size="sm" variant="outline" className="h-8" onClick={() => { setShowImageInput(false); setImageUrl(""); }}>Cancel</Button>
        </div>
      )}

      {/* Link URL input */}
      {showLinkInput && (
        <div className="flex gap-2 p-2 border-b bg-muted/20">
          <Input
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="Paste link URL (https://...)"
            className="h-8 text-sm"
            onKeyDown={(e) => e.key === "Enter" && insertLink()}
            autoFocus
          />
          <Button size="sm" className="h-8" onClick={insertLink}>Insert</Button>
          <Button size="sm" variant="outline" className="h-8" onClick={() => { setShowLinkInput(false); setLinkUrl(""); }}>Cancel</Button>
        </div>
      )}

      {/* Editor area */}
      <EditorContent
        editor={editor}
        className="prose prose-sm dark:prose-invert max-w-none p-4 min-h-[200px] focus-within:outline-none [&_.tiptap]:outline-none [&_.tiptap_img]:max-w-full [&_.tiptap_img]:rounded-md [&_.tiptap_img]:my-2 [&_.tiptap_p.is-editor-empty:first-child]:before:text-muted-foreground [&_.tiptap_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)] [&_.tiptap_p.is-editor-empty:first-child]:before:float-left [&_.tiptap_p.is-editor-empty:first-child]:before:pointer-events-none"
      />
    </div>
  );
}
