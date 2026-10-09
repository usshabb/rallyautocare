import { createHash, randomBytes, randomInt } from 'node:crypto';

export const newId = () => randomBytes(9).toString('base64url');
export const newToken = () => randomBytes(32).toString('base64url');
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const bookingCode = () => 'RAC-' + String(randomInt(10_000, 100_000));
export const otpCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
