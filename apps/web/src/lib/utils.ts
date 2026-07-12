import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function compactAddress(address: string, leading = 6, trailing = 4): string {
  if (address.length <= leading + trailing + 3) {
    return address;
  }
  return `${address.slice(0, leading)}...${address.slice(-trailing)}`;
}
