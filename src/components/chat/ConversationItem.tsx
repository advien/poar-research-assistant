"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Pin,
  PinOff,
  MoreHorizontal,
  Trash2,
  Pencil,
  Archive,
  ArchiveRestore,
  FileText,
  MessageSquare,
} from "lucide-react";
import type { ChatListItem } from "@/types/db";
import { cn, truncate } from "@/lib/utils";
import { relativeTime } from "./timeGroups";

type Props = {
  chat: ChatListItem;
  active: boolean;
  href: string;
  onPin: (c: ChatListItem) => void;
  onArchive: (c: ChatListItem) => void;
  onRename: (c: ChatListItem, title: string) => void;
  onDelete: (c: ChatListItem) => void;
};

export function ConversationItem({
  chat,
  active,
  href,
  onPin,
  onArchive,
  onRename,
  onDelete,
}: Props) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(chat.title ?? "");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  const submitRename = () => {
    setRenaming(false);
    onRename(chat, draft);
  };

  const handleDelete = () => {
    setMenuOpen(false);
    if (confirm(`Delete "${chat.title || "this conversation"}"?\nThis cannot be undone.`)) {
      onDelete(chat);
    }
  };

  return (
    <div
      className={cn(
        "group relative flex items-start gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
        active ? "bg-accent" : "hover:bg-accent/60"
      )}
    >
      <Link href={href} className="flex-1 min-w-0">
        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
          {chat.paper ? (
            <span className="inline-flex items-center gap-1 truncate" title={chat.paper.title ?? ""}>
              <FileText className="h-3 w-3 shrink-0" />
              <span className="truncate">{truncate(chat.paper.title, 24) || "Untitled paper"}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="h-3 w-3" />
              Library
            </span>
          )}
          <span className="ml-auto shrink-0">
            {relativeTime(chat.last_message_at ?? chat.created_at)}
          </span>
        </div>

        {renaming ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={submitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRename();
              if (e.key === "Escape") {
                setRenaming(false);
                setDraft(chat.title ?? "");
              }
            }}
            className="w-full rounded border bg-background px-1.5 py-0.5 text-sm font-medium"
          />
        ) : (
          <div className="flex items-center gap-1">
            {chat.pinned && <Pin className="h-3 w-3 text-muted-foreground shrink-0" />}
            <span className="font-medium leading-snug truncate">
              {chat.title || "Untitled conversation"}
            </span>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {chat.message_count} {chat.message_count === 1 ? "message" : "messages"}
        </p>
      </Link>

      <div ref={menuRef} className="relative">
        <button
          type="button"
          aria-label="Conversation actions"
          className={cn(
            "shrink-0 rounded p-1 hover:bg-background opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
            (menuOpen || chat.pinned) && "opacity-100"
          )}
          onClick={(e) => {
            e.preventDefault();
            setMenuOpen((v) => !v);
          }}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 top-full mt-1 z-20 w-44 rounded-md border bg-popover shadow-md text-sm py-1"
            role="menu"
          >
            <MenuButton
              icon={chat.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
              onClick={() => {
                setMenuOpen(false);
                onPin(chat);
              }}
            >
              {chat.pinned ? "Unpin" : "Pin"}
            </MenuButton>
            <MenuButton
              icon={<Pencil className="h-3.5 w-3.5" />}
              onClick={() => {
                setMenuOpen(false);
                setDraft(chat.title ?? "");
                setRenaming(true);
              }}
            >
              Rename
            </MenuButton>
            <MenuButton
              icon={
                chat.archived ? (
                  <ArchiveRestore className="h-3.5 w-3.5" />
                ) : (
                  <Archive className="h-3.5 w-3.5" />
                )
              }
              onClick={() => {
                setMenuOpen(false);
                onArchive(chat);
              }}
            >
              {chat.archived ? "Restore" : "Archive"}
            </MenuButton>
            <div className="my-1 h-px bg-border" />
            <MenuButton
              icon={<Trash2 className="h-3.5 w-3.5" />}
              onClick={handleDelete}
              destructive
            >
              Delete
            </MenuButton>
          </div>
        )}
      </div>
    </div>
  );
}

function MenuButton({
  icon,
  children,
  onClick,
  destructive,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-1.5 hover:bg-accent text-left",
        destructive && "text-destructive"
      )}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}
