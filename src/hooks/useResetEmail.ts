import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { requestResetEmail, RESET_EMAIL_ACKNOWLEDGEMENT, type ResetEmailRecipient } from '@/lib/reset-email';

type Feedback = { kind: 'idle' } | { kind: 'sending' | 'success' | 'error'; message: string };

/** Scope feedback and cancellation to the recipient currently on screen. */
export function useResetEmail(scope: string) {
  const [feedback, setFeedback] = useState<Feedback>({ kind: 'idle' });
  const operation = useRef<AbortController | null>(null);
  const clear = useCallback(() => {
    operation.current?.abort(); operation.current = null; setFeedback({ kind: 'idle' });
  }, []);
  useLayoutEffect(() => {
    clear();
    const cancel = () => { operation.current?.abort(); operation.current = null; };
    return cancel;
  }, [scope, clear]);

  const send = async (recipient: ResetEmailRecipient) => {
    if (operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    const isCurrent = () => operation.current === controller && !controller.signal.aborted;
    setFeedback({ kind: 'sending', message: 'Requesting reset link…' });
    try {
      await requestResetEmail(recipient, controller.signal);
      if (isCurrent()) setFeedback({ kind: 'success', message: RESET_EMAIL_ACKNOWLEDGEMENT });
    } catch (error) {
      if (isCurrent()) setFeedback({ kind: 'error', message: error instanceof Error ? error.message : 'Could not request a reset link. Try again.' });
    } finally { if (isCurrent()) operation.current = null; }
  };
  return { feedback, busy: feedback.kind === 'sending', clear, send };
}
