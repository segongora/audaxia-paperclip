// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToastActions, useToastState } from "./ToastContext";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("ToastContext", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("does not rerender action-only consumers when toast state changes", () => {
    const root = createRoot(container);
    let actionOnlyRenderCount = 0;
    let pushToastRef: ((input: { title: string }) => string | null) | null = null;
    let clearToastsRef: (() => void) | null = null;

    function ActionOnlyConsumer() {
      actionOnlyRenderCount += 1;
      const { pushToast, clearToasts } = useToastActions();
      pushToastRef = pushToast;
      clearToastsRef = clearToasts;
      return null;
    }

    function ToastCount() {
      const toasts = useToastState();
      return <div data-testid="toast-count">{String(toasts.length)}</div>;
    }

    act(() => {
      root.render(
        <ToastProvider>
          <ActionOnlyConsumer />
          <ToastCount />
        </ToastProvider>,
      );
    });

    expect(actionOnlyRenderCount).toBe(1);
    expect(container.querySelector('[data-testid="toast-count"]')?.textContent).toBe("0");

    act(() => {
      pushToastRef?.({ title: "Saved" });
    });

    expect(actionOnlyRenderCount).toBe(1);
    expect(container.querySelector('[data-testid="toast-count"]')?.textContent).toBe("1");

    act(() => {
      clearToastsRef?.();
    });

    expect(actionOnlyRenderCount).toBe(1);
    expect(container.querySelector('[data-testid="toast-count"]')?.textContent).toBe("0");

    act(() => {
      root.unmount();
    });
  });

  it("does not auto-dismiss a toast with ttlMs: 0 (persistent)", async () => {
    vi.useFakeTimers();
    const root = createRoot(container);
    let pushToastRef: ((input: Parameters<ReturnType<typeof useToastActions>["pushToast"]>[0]) => string | null) | null = null;
    let stateRef: ReturnType<typeof useToastState> = [];

    function Consumer() {
      const { pushToast } = useToastActions();
      const toasts = useToastState();
      pushToastRef = pushToast;
      stateRef = toasts;
      return null;
    }

    act(() => {
      root.render(
        <ToastProvider>
          <Consumer />
        </ToastProvider>,
      );
    });

    act(() => {
      pushToastRef!({ title: "Persistent toast", ttlMs: 0 });
    });

    expect(stateRef).toHaveLength(1);

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    expect(stateRef).toHaveLength(1);
    vi.useRealTimers();
  });
});
