export function maskPhone(phone: string) {
  const digits = phone.replace(/\D/gu, "");
  return `*** *** ${digits.slice(-3).padStart(3, "0")}`;
}

export function maskPhoneOrNull(phone: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/\D/gu, "");
  return digits.length >= 3 ? `*** *** ${digits.slice(-3)}` : null;
}
