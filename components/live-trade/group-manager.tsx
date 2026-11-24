"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LiveTradeGroupDto } from "@/lib/live-trade/client";
import { liveTradeErrorMessage } from "@/lib/live-trade/client";
import {
  LIVE_TRADE_GROUP_LIMIT,
  LIVE_TRADE_GROUP_NAME_MAX_LENGTH,
} from "@/lib/live-trade/constants";
import { Modal } from "./modal";

interface GroupManagerProps {
  groups: LiveTradeGroupDto[];
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (group: LiveTradeGroupDto, name: string) => Promise<void>;
  onDelete: (group: LiveTradeGroupDto) => Promise<void>;
  onReorder: (groupId: string, direction: "up" | "down") => Promise<void>;
}

const inputClass =
  "min-h-11 w-full rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] px-3 py-2 text-xs text-[var(--ds-text)] placeholder:text-[var(--ds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ds-gold-500)]/40";

export function GroupManager({
  groups,
  onClose,
  onCreate,
  onRename,
  onDelete,
  onReorder,
}: GroupManagerProps) {
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const busy = creating || pendingId !== null || reordering;
  // Rename/delete may be queued behind an in-flight reorder; the workspace
  // serialises group mutations, so the action is applied to the latest order.
  const rowActionsDisabled = creating || pendingId !== null;
  const atLimit = groups.length >= LIVE_TRADE_GROUP_LIMIT;

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = newName.trim();
    if (trimmed === "") {
      setError("Enter a group name.");
      return;
    }
    if (Array.from(trimmed).length > LIVE_TRADE_GROUP_NAME_MAX_LENGTH) {
      setError(
        `Group names must be at most ${LIVE_TRADE_GROUP_NAME_MAX_LENGTH} characters.`
      );
      return;
    }
    if (atLimit) {
      setError(`You already have ${LIVE_TRADE_GROUP_LIMIT} groups.`);
      return;
    }

    setCreating(true);
    setError(null);
    try {
      await onCreate(trimmed);
      setNewName("");
    } catch (cause) {
      setError(liveTradeErrorMessage(cause));
    } finally {
      setCreating(false);
    }
  }

  async function handleRename(group: LiveTradeGroupDto) {
    const trimmed = editingName.trim();
    if (trimmed === "") {
      setError("Enter a group name.");
      return;
    }
    if (Array.from(trimmed).length > LIVE_TRADE_GROUP_NAME_MAX_LENGTH) {
      setError(
        `Group names must be at most ${LIVE_TRADE_GROUP_NAME_MAX_LENGTH} characters.`
      );
      return;
    }
    if (trimmed === group.name) {
      setEditingId(null);
      return;
    }

    setPendingId(group.groupId);
    setError(null);
    try {
      await onRename(group, trimmed);
      setEditingId(null);
    } catch (cause) {
      setError(liveTradeErrorMessage(cause));
    } finally {
      setPendingId(null);
    }
  }

  async function handleDelete(group: LiveTradeGroupDto) {
    setPendingId(group.groupId);
    setError(null);
    try {
      await onDelete(group);
      setConfirmDeleteId(null);
    } catch (cause) {
      setError(liveTradeErrorMessage(cause));
    } finally {
      setPendingId(null);
    }
  }

  async function moveGroup(index: number, direction: "up" | "down") {
    const target = index + (direction === "up" ? -1 : 1);
    if (target < 0 || target >= groups.length) return;

    setReordering(true);
    setError(null);
    try {
      // The workspace resolves the new order against its latest group list, so
      // a queued move is never based on this render's snapshot.
      await onReorder(groups[index].groupId, direction);
    } catch (cause) {
      setError(liveTradeErrorMessage(cause));
    } finally {
      setReordering(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Manage groups"
      description={`${groups.length} of ${LIVE_TRADE_GROUP_LIMIT} groups. Deleting a group never deletes its instruments.`}
      closeDisabled={busy}
      footer={
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ds-lt-button-ghost"
            onClick={onClose}
            disabled={busy}
          >
            Done
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-[var(--ds-negative)]/25 bg-[var(--ds-negative-soft)] px-3 py-2 text-xs leading-relaxed text-[var(--ds-negative)]"
          >
            {error}
          </p>
        )}

        <form
          onSubmit={(event) => void handleCreate(event)}
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
        >
          <div className="flex-1 space-y-1">
            <label
              htmlFor="new-group-name"
              className="text-[11px] font-semibold text-[var(--ds-text-secondary)]"
            >
              New group
            </label>
            <input
              id="new-group-name"
              type="text"
              value={newName}
              maxLength={LIVE_TRADE_GROUP_NAME_MAX_LENGTH}
              onChange={(event) => {
                setNewName(event.target.value);
                setError(null);
              }}
              placeholder="e.g. Momentum"
              className={inputClass}
              disabled={atLimit || creating}
              data-autofocus
            />
          </div>
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            className="ds-lt-button-secondary"
            loading={creating}
            disabled={atLimit || creating || newName.trim() === ""}
          >
            Create
          </Button>
        </form>

        {atLimit && (
          <p className="text-[11px] leading-relaxed text-[var(--ds-warning)]">
            The {LIVE_TRADE_GROUP_LIMIT}-group limit is reached. Delete a group
            to create another.
          </p>
        )}

        {groups.length === 0 ? (
          <p className="rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] px-3 py-4 text-center text-xs leading-relaxed text-[var(--ds-text-muted)]">
            No groups yet. Create one to organise the watchlist.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--ds-border)] overflow-hidden rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface)]">
            {groups.map((group, index) => {
              const editing = editingId === group.groupId;
              const deleting = confirmDeleteId === group.groupId;
              const pending = pendingId === group.groupId;

              return (
                <li key={group.groupId} className="px-3 py-2">
                  {deleting ? (
                    <div className="space-y-2">
                      <p className="text-xs leading-relaxed text-[var(--ds-text-secondary)]">
                        Delete “{group.name}”? Instruments in this group will
                        become ungrouped. They will not be deleted.
                      </p>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          className="ds-lt-button-danger"
                          loading={pending}
                          onClick={() => void handleDelete(group)}
                        >
                          Delete group
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="ds-lt-button-ghost"
                          disabled={pending}
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : editing ? (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        type="text"
                        value={editingName}
                        maxLength={LIVE_TRADE_GROUP_NAME_MAX_LENGTH}
                        aria-label={`Rename ${group.name}`}
                        onChange={(event) => setEditingName(event.target.value)}
                        className={inputClass}
                        data-autofocus
                      />
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        className="ds-lt-button-primary"
                        loading={pending}
                        onClick={() => void handleRename(group)}
                      >
                        Save
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="ds-lt-button-ghost"
                        disabled={pending}
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-xs font-semibold text-[var(--ds-text)]">
                        {group.name}
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          aria-label={`Move ${group.name} up`}
                          title="Move up"
                          disabled={busy || index === 0}
                          onClick={() => void moveGroup(index, "up")}
                          className="flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] text-[var(--ds-text-muted)] hover:bg-[var(--ds-gold-50)] hover:text-[var(--ds-text)] disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <ChevronUp className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${group.name} down`}
                          title="Move down"
                          disabled={busy || index === groups.length - 1}
                          onClick={() => void moveGroup(index, "down")}
                          className="flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] text-[var(--ds-text-muted)] hover:bg-[var(--ds-gold-50)] hover:text-[var(--ds-text)] disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <ChevronDown className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(group.groupId);
                            setEditingName(group.name);
                            setConfirmDeleteId(null);
                            setError(null);
                          }}
                          disabled={rowActionsDisabled}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] px-3 text-[11px] font-semibold text-[var(--ds-text-secondary)] hover:bg-[var(--ds-gold-50)] hover:text-[var(--ds-text)] disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmDeleteId(group.groupId);
                            setEditingId(null);
                            setError(null);
                          }}
                          disabled={rowActionsDisabled}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-[var(--ds-negative)]/20 bg-[var(--ds-negative-soft)] px-3 text-[11px] font-semibold text-[var(--ds-negative)] hover:bg-[var(--ds-negative)]/10 disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
