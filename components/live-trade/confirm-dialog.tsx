"use client";

import { Button } from "@/components/ui/button";
import { Modal } from "./modal";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="md"
      closeDisabled={pending}
      footer={
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="ds-lt-button-ghost"
            onClick={onCancel}
            disabled={pending}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            size="sm"
            className={destructive ? "ds-lt-button-danger" : "ds-lt-button-primary"}
            onClick={onConfirm}
            loading={pending}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <p className="text-sm leading-relaxed text-[var(--ds-text-secondary)]">{description}</p>
    </Modal>
  );
}
