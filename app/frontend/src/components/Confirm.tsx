import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

interface ConfirmOptions {
  title: string;
  message: string;
  /** Label of the button that carries out the action, e.g. "Remove". */
  action: string;
  /** Destructive actions get the warning style and are never the default button. */
  destructive?: boolean;
}

type Ask = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Ask | null>(null);

/** Ask the user to confirm an action. Resolves to true if they did. */
export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext);
  if (!ask) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ask;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<(confirmed: boolean) => void>();
  const dialog = useRef<HTMLDialogElement>(null);

  const ask = useCallback<Ask>((next) => {
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  // A native <dialog> opened with showModal() traps focus, closes on Escape
  // and returns focus to the element that opened it.
  useEffect(() => {
    if (options) dialog.current?.showModal();
  }, [options]);

  function finish(confirmed: boolean) {
    dialog.current?.close();
    resolver.current?.(confirmed);
    resolver.current = undefined;
    setOptions(null);
  }

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {options && (
        <dialog
          ref={dialog}
          className="dialog"
          aria-labelledby="confirm-title"
          aria-describedby="confirm-message"
          onCancel={(event) => {
            event.preventDefault();
            finish(false);
          }}
        >
          <div className="dialog-body">
            <h3 id="confirm-title">{options.title}</h3>
            <p id="confirm-message" className="muted">
              {options.message}
            </p>
          </div>
          <div className="dialog-actions">
            <button className="button" autoFocus onClick={() => finish(false)}>
              Cancel
            </button>
            <button className={`button ${options.destructive ? "button-danger" : "button-primary"}`} onClick={() => finish(true)}>
              {options.action}
            </button>
          </div>
        </dialog>
      )}
    </ConfirmContext.Provider>
  );
}
