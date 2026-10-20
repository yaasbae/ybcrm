export function classifyCheckoutClaim(previous: Record<string, any> | null, payloadHash: string) {
  if (!previous) return { state: 'claimed' as const };
  if (previous.payloadHash !== payloadHash) return { state: 'conflict' as const };
  if (previous.status === 'completed' && previous.response?.paymentUrl) {
    return { state: 'completed' as const, response: previous.response };
  }
  // Failed and processing operations may already have external side effects.
  // Recover them explicitly rather than automatically creating another payment.
  return { state: 'pending' as const };
}
