import { createOpenPetsPiExtension, type OpenPetsPiOptions } from "./runtime.js";

export default function openPetsPiExtension(pi: unknown, options: OpenPetsPiOptions = {}): void {
  createOpenPetsPiExtension(pi, options);
}
