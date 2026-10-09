const CHANNEL_LABELS: Record<string, string> = {
  GOOGLEPAY: 'Google Pay',
  PHONEPE: 'PhonePe',
  PAYTM: 'Paytm',
  UPI: 'UPI',
  ATM: 'ATM',
  NETBANKING: 'Net Banking',
  NEFT: 'NEFT',
  IMPS: 'IMPS',
  CHEQUE: 'Cheque',
  DEBIT_CARD: 'Debit Card',
  CREDIT_CARD: 'Credit Card',
};

export function paymentChannelLabel(channel: string | null | undefined): string | null {
  if (!channel) return null;
  if (CHANNEL_LABELS[channel]) return CHANNEL_LABELS[channel];
  return channel
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
