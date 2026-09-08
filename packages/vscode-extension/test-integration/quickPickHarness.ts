/**
 * VS Code has no public command to simulate typing into an input box or
 * clicking a QuickPick item/button, so `search.test.ts`/`multiroot.test.ts`
 * intercept the real `vscode.window.showInputBox`/`showQuickPick`/
 * `createQuickPick` calls `commands.ts` makes and invoke the exact callbacks
 * it registers directly — real production code, just triggered by a captured
 * reference instead of a real UI round-trip. Everything else on the real
 * QuickPick (items, title, value, selectedItems, busy) stays genuine.
 *
 * `interceptQuickPick` works by reassigning `onDidAccept`/
 * `onDidTriggerItemButton` on the object VS Code's real `createQuickPick()`
 * returns, which only works because those are today plain writable instance
 * properties, not getter-only bindings — there's no other public seam for
 * this, since VS Code exposes no way to fire an `Event` from outside or to
 * script a real keypress/click into a QuickPick. If a future VS Code build
 * makes them non-writable accessors, this reassignment throws and every test
 * using it fails loudly (not silently) — that's an acceptable trade for the
 * only coverage `commands.ts`'s search flow has at all.
 */

// biome-ignore lint/suspicious/noExplicitAny: intercepting the untyped-for-us `vscode` module object at runtime.
type VscodeModule = any;
// biome-ignore lint/suspicious/noExplicitAny: the real vscode.QuickPick instance, treated structurally here.
type AnyQuickPick = any;

export interface QuickPickIntercept {
  getQuickPick: () => AnyQuickPick;
  getOnAccept: () => () => void | Promise<void>;
  // biome-ignore lint/suspicious/noExplicitAny: QuickPickItem shape, treated structurally.
  getOnButton: () => (event: { item: any }) => void | Promise<void>;
  restore: () => void;
}

export function interceptQuickPick(vscodeModule: VscodeModule): QuickPickIntercept {
  const original = vscodeModule.window.createQuickPick;
  let quickPick: AnyQuickPick;
  let onAccept: (() => void | Promise<void>) | undefined;
  let onButton: ((event: { item: unknown }) => void | Promise<void>) | undefined;

  vscodeModule.window.createQuickPick = (...args: unknown[]) => {
    const real = original.apply(vscodeModule.window, args);
    quickPick = real;
    real.onDidAccept = (callback: () => void | Promise<void>) => {
      onAccept = callback;
      return { dispose() {} };
    };
    real.onDidTriggerItemButton = (
      callback: (event: { item: unknown }) => void | Promise<void>,
    ) => {
      onButton = callback;
      return { dispose() {} };
    };
    return real;
  };

  return {
    getQuickPick: () => quickPick,
    getOnAccept: () => {
      if (!onAccept) {
        throw new Error("quickPick.onDidAccept was never registered");
      }
      return onAccept;
    },
    getOnButton: () => {
      if (!onButton) {
        throw new Error("quickPick.onDidTriggerItemButton was never registered");
      }
      return onButton;
    },
    restore: () => {
      vscodeModule.window.createQuickPick = original;
    },
  };
}

/** Stubs `vscode.window.showInputBox` to resolve with `value` immediately, bypassing the real prompt UI. */
export function stubShowInputBox(
  vscodeModule: VscodeModule,
  value: string | undefined,
): () => void {
  const original = vscodeModule.window.showInputBox;
  vscodeModule.window.showInputBox = async () => value;
  return () => {
    vscodeModule.window.showInputBox = original;
  };
}

/** Stubs `vscode.window.showQuickPick` to resolve with `pick(items)`, bypassing the real folder-picker UI. */
export function stubShowQuickPick<T>(
  vscodeModule: VscodeModule,
  pick: (items: readonly T[]) => T | undefined,
): () => void {
  const original = vscodeModule.window.showQuickPick;
  vscodeModule.window.showQuickPick = async (items: readonly T[] | Promise<readonly T[]>) =>
    pick(await items);
  return () => {
    vscodeModule.window.showQuickPick = original;
  };
}

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
